from __future__ import annotations

"""
scraper.py — Enhanced Playwright-based BookMyShow scraper.

Scrapes shows grouped by date → theatre → showtime → status.
Snapshot structure:
  {
    "Fri, 01 Sep": {
      "PVR Forum Sujana": {
        "10:30 AM": "available",
        "01:15 PM": "fast-filling"
      }
    }
  }
"""

import asyncio
import hashlib
import logging
import re
from typing import Any

from playwright.async_api import async_playwright, Page, TimeoutError as PWTimeout

logger = logging.getLogger(__name__)

# ── Selectors (BMS uses dynamic/obfuscated class names; try many patterns) ────
# These are tried in order — first one that finds elements wins.

_VENUE_SELECTORS = [
    # 2024-2026 BMS patterns
    "[class*='venueInfoWrapper']",
    "[class*='venue-info']",
    "[class*='venueName']",
    "[class*='venue-name']",
    "[class*='__venueName']",
    "[class*='__venue-name']",
    # Generic name patterns inside a card
    "[class*='__name']",
    ".__name",
    "h3[class*='name']",
    "[class*='cinema-name']",
    "[class*='theater-name']",
    # Fallback: any h3/h4 inside a showtime card
    "[class*='show-card'] h3",
    "[class*='showCard'] h3",
    "[class*='venueBlock'] h3",
]

_SHOWTIME_SELECTORS = [
    "[class*='showtime-button']",
    "[class*='showTimeButton']",
    "[class*='showtime']",
    "[class*='show-time']",
    "[class*='__time']",
    "button[class*='time']",
    "a[class*='time']",
    "time",
]

_DATE_TAB_SELECTORS = [
    # 2024-2026 BMS date tab patterns
    "[class*='date-tab']",
    "[class*='dateTab']",
    "[class*='DateTabs'] li",
    "[class*='date-tabs'] li",
    "[class*='date-selector'] li",
    "[class*='dateSelector'] li",
    "[class*='BookShowDate']",
    "[class*='dateCard']",
    ".slick-slide [class*='date']",
    "[class*='slickSlide'] [class*='date']",
    # Generic: li items inside anything with "date" in the class
    "ul[class*='date'] li",
    "[class*='calendar'] li",
]

_DATE_CONTAINER_SELECTORS = [
    "[class*='date-selector']",
    "[class*='dateSelector']",
    "[class*='DateTabs']",
    "[class*='date-tabs']",
]

# ── Browser settings ──────────────────────────────────────────────────────────

_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-gpu",
]

_VIEWPORT = {"width": 1366, "height": 768}

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

_EXTRA_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

_STEALTH_SCRIPT = """
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'languages', {get: () => ['en-IN', 'en-US', 'en']});
    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
    window.chrome = { runtime: {} };
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _try_selectors(page: Page, selectors: list[str]) -> list:
    for sel in selectors:
        try:
            els = await page.query_selector_all(sel)
            if els:
                return els
        except Exception:
            continue
    return []


async def _dismiss_popups(page: Page) -> None:
    for sel in [
        "button[class*='close']",
        "[class*='modal'] button[class*='cancel']",
        "[class*='modal'] [aria-label='Close']",
        "[class*='location'] button",
        "[class*='overlay'] [class*='close']",
    ]:
        try:
            btn = page.locator(sel).first
            if await btn.is_visible(timeout=1200):
                await btn.click()
                await page.wait_for_timeout(400)
        except Exception:
            pass


def _classify(class_str: str) -> str:
    c = class_str.lower()
    if "sold" in c or "housefull" in c or "blocked" in c:
        return "sold-out"
    if "fast" in c or "filling" in c:
        return "fast-filling"
    if "available" in c or "open" in c:
        return "available"
    return "available"  # default: assume bookable if found


def _is_time(text: str) -> bool:
    return bool(re.search(r"\d{1,2}:\d{2}", text))


# ── Date tab parsing ──────────────────────────────────────────────────────────

async def _get_date_tabs(page: Page) -> list[dict]:
    """
    Return list of {label, element} dicts for each visible date tab.
    label example: "Fri, 01 Sep"
    """
    date_els = await _try_selectors(page, _DATE_TAB_SELECTORS)
    tabs = []
    seen = set()
    for el in date_els:
        text = ((await el.text_content()) or "").strip()
        text = re.sub(r"\s+", " ", text)
        # Filter: must look like a date (contains a digit + month-like word or day)
        if not text or len(text) < 3 or len(text) > 30:
            continue
        if not re.search(r"\d", text):
            continue
        if text in seen:
            continue
        seen.add(text)
        tabs.append({"label": text, "el": el})
    return tabs


# ── Show parsing for a single rendered date ───────────────────────────────────

async def _parse_shows_on_page(page: Page) -> dict[str, dict[str, str]]:
    """
    Parse currently rendered theatre/showtime grid.
    Returns: { theatre_name: { "HH:MM AM/PM": status } }
    """
    shows: dict[str, dict[str, str]] = {}

    venue_els = await _try_selectors(page, _VENUE_SELECTORS)
    if not venue_els:
        return shows

    for venue_el in venue_els:
        raw = (await venue_el.text_content()) or ""
        name = raw.strip().splitlines()[0].strip()
        if not name or len(name) > 120:
            continue

        # Walk to a parent container that also holds showtimes
        try:
            parent_handle = await venue_el.evaluate_handle(
                """el => {
                    let p = el;
                    for (let i = 0; i < 5; i++) {
                        p = p.parentElement;
                        if (!p) break;
                        if (p.querySelectorAll('[class*="showtime"], [class*="show-time"], [class*="__time"], time').length > 0)
                            return p;
                    }
                    return el.parentElement || el;
                }"""
            )
            parent = parent_handle.as_element()
        except Exception:
            parent = venue_el

        # Find showtime buttons within this container
        st_els = []
        for sel in _SHOWTIME_SELECTORS:
            try:
                found = await (parent or venue_el).query_selector_all(sel)
                st_els.extend(found)
                if found:
                    break
            except Exception:
                continue

        times: dict[str, str] = {}
        for st_el in st_els:
            text = ((await st_el.text_content()) or "").strip()
            if not _is_time(text):
                continue
            # Normalise: "6:30 PM" → "06:30 PM"
            m = re.search(r"(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)", text)
            if not m:
                continue
            time_str = m.group(1).upper().strip()

            class_attr = (await st_el.get_attribute("class")) or ""
            status = _classify(class_attr)
            times[time_str] = status

        if times:
            shows[name] = times

    return shows


# ── Full page scrape ──────────────────────────────────────────────────────────

async def _scrape_page(page: Page, max_dates: int = 4) -> dict[str, Any]:
    """
    Returns snapshot keyed by date label:
    { "Fri, 01 Sep": { theatre: { time: status } } }
    Falls back to { "_page_hash": hash } if DOM parsing fails entirely.
    """
    await _dismiss_popups(page)

    # If on movie details page, click "Book tickets" to open the showtimes page
    try:
        book_btn = page.locator('button:has-text("Book tickets"), a:has-text("Book tickets")').first
        if await book_btn.is_visible(timeout=1500):
            logger.info("  Clicking 'Book tickets' button...")
            await book_btn.click()
            await page.wait_for_timeout(3000)
            await _dismiss_popups(page)
    except Exception:
        pass

    date_tabs = await _get_date_tabs(page)
    logger.info("  Found %d date tab(s)", len(date_tabs))

    snapshot: dict[str, Any] = {}

    if not date_tabs:
        # No date tabs — just parse whatever is on the page
        shows = await _parse_shows_on_page(page)
        if shows:
            snapshot["_default"] = shows
        else:
            body = await page.inner_text("body")
            snapshot["_page_hash"] = {"value": hashlib.sha256(body.encode()).hexdigest()[:16]}
        return snapshot

    for tab in date_tabs[:max_dates]:
        label = tab["label"]
        try:
            await tab["el"].click()
            await page.wait_for_timeout(1800)
        except Exception as exc:
            logger.warning("Could not click date tab '%s': %s", label, exc)
            continue

        shows = await _parse_shows_on_page(page)
        if shows:
            snapshot[label] = shows
        logger.info("  Date '%s' → %d theatre(s)", label, len(shows))

    if not snapshot:
        body = await page.inner_text("body")
        snapshot["_page_hash"] = {"value": hashlib.sha256(body.encode()).hexdigest()[:16]}

    return snapshot


# ── Public API ────────────────────────────────────────────────────────────────

async def fetch_snapshot(target: dict[str, Any], max_dates: int = 4) -> dict[str, Any]:
    url   = target["url"]
    name  = target.get("name", url)
    city  = target.get("city", "")

    result: dict[str, Any] = {
        "name": name, "url": url, "city": city,
        "shows": {}, "error": None,
    }

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=_LAUNCH_ARGS)
            ctx = await browser.new_context(
                viewport=_VIEWPORT,
                user_agent=_USER_AGENT,
                extra_http_headers=_EXTRA_HEADERS,
                locale="en-IN",
            )
            await ctx.add_init_script(_STEALTH_SCRIPT)
            page = await ctx.new_page()

            logger.info("Loading %s", url)
            try:
                await page.goto(url, wait_until="networkidle", timeout=50_000)
            except PWTimeout:
                logger.warning("networkidle timeout — continuing with partial load")

            await page.wait_for_timeout(2500)

            body = (await page.inner_text("body")).lower()
            if any(kw in body for kw in ("captcha", "access denied", "403 forbidden", "cf-error")):
                result["error"] = "Bot-detection page encountered — will retry next cycle"
                await browser.close()
                return result

            result["shows"] = await _scrape_page(page, max_dates=max_dates)
            await browser.close()

    except Exception as exc:
        logger.exception("Scraper error for %s", url)
        result["error"] = str(exc)

    return result


def scrape(target: dict[str, Any], max_dates: int = 4) -> dict[str, Any]:
    """Synchronous wrapper — safe to call from Flask/APScheduler threads."""
    return asyncio.run(fetch_snapshot(target, max_dates=max_dates))


# ── Filter application ────────────────────────────────────────────────────────

def apply_filters(
    snapshot: dict[str, Any],
    filter_theatres: list[str],
    filter_dates: list[str],
    filter_time_from: str,
    filter_time_to: str,
) -> dict[str, Any]:
    """
    Return a subset of `snapshot` matching the given filters.
    All filters are optional (empty list / empty string = no filter).
    """
    result: dict[str, Any] = {}

    for date_label, theatres in snapshot.items():
        if date_label == "_page_hash":
            result[date_label] = theatres
            continue

        # Date filter
        if filter_dates:
            # Match if any filter_date appears in the label (partial, case-insensitive)
            if not any(fd.lower() in date_label.lower() for fd in filter_dates):
                continue

        if not isinstance(theatres, dict):
            continue

        filtered_theatres: dict[str, Any] = {}
        for theatre, times in theatres.items():
            # Theatre filter
            if filter_theatres:
                if not any(ft.lower() in theatre.lower() for ft in filter_theatres):
                    continue

            if not isinstance(times, dict):
                continue

            filtered_times: dict[str, str] = {}
            for time_str, status in times.items():
                if not _time_in_range(time_str, filter_time_from, filter_time_to):
                    continue
                filtered_times[time_str] = status

            if filtered_times:
                filtered_theatres[theatre] = filtered_times

        if filtered_theatres:
            result[date_label] = filtered_theatres

    return result


def _parse_time_to_minutes(time_str: str) -> int | None:
    """Convert "06:30 PM" or "18:30" to minutes since midnight."""
    m = re.match(r"(\d{1,2}):(\d{2})\s*(AM|PM)?", time_str.strip(), re.IGNORECASE)
    if not m:
        return None
    h, mn = int(m.group(1)), int(m.group(2))
    meridiem = (m.group(3) or "").upper()
    if meridiem == "PM" and h != 12:
        h += 12
    elif meridiem == "AM" and h == 12:
        h = 0
    return h * 60 + mn


def _time_in_range(time_str: str, from_str: str, to_str: str) -> bool:
    """Return True if time_str falls within [from_str, to_str] (inclusive). Empty = no bound."""
    if not from_str and not to_str:
        return True
    t = _parse_time_to_minutes(time_str)
    if t is None:
        return True  # can't parse → don't filter out
    if from_str:
        f = _parse_time_to_minutes(from_str)
        if f is not None and t < f:
            return False
    if to_str:
        end = _parse_time_to_minutes(to_str)
        if end is not None and t > end:
            return False
    return True
