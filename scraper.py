from __future__ import annotations

"""
scraper.py — BookMyShow scraper using BMS's own internal JSON API.

Instead of fragile DOM parsing, we intercept the XHR request that BMS's own
frontend makes to populate the showtime grid. This gives us perfect structured
data: venue name → showtime → availability status.

Snapshot structure:
  {
    "Wed, 03 Sep": {
      "PVR: Forum Sujana Mall": {
        "10:30 AM": "available",
        "01:15 PM": "fast-filling"
      }
    }
  }
"""

import asyncio
import logging
import re
from datetime import datetime
from typing import Any

from playwright.async_api import async_playwright, Page, TimeoutError as PWTimeout

logger = logging.getLogger(__name__)

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
    "Chrome/124.0.0.0 Safari/537.36"
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


# ── Status mapping from BMS styleId ──────────────────────────────────────────

def _classify_style(style_id: str) -> str:
    s = (style_id or "").lower()
    if "grey" in s or "gray" in s or "sold" in s:
        return "sold-out"
    if "orange" in s or "fast" in s or "filling" in s:
        return "fast-filling"
    return "available"  # green or unknown


# ── Date normalisation ────────────────────────────────────────────────────────

_MONTHS = {
    "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
    "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
    "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
}
_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _date_code_to_label(date_code: str) -> str:
    """Convert '20260904' → 'Thu, 04 Sep'."""
    try:
        dt = datetime.strptime(date_code, "%Y%m%d")
        day_name = _DAYS[dt.weekday()]
        return f"{day_name}, {dt.day:02d} {_MONTHS[f'{dt.month:02d}']}"
    except Exception:
        return date_code


# ── BMS API URL construction ──────────────────────────────────────────────────

def _build_buytickets_url(base_url: str, date_code: str | None = None) -> str:
    """
    Convert movie page URL to buytickets URL for a given date.
    e.g. https://in.bookmyshow.com/movies/hyderabad/bethlehem.../ET00515244
      → https://in.bookmyshow.com/movies/hyderabad/bethlehem.../buytickets/ET00515244/20260904
    """
    # Already a buytickets URL — extract the date from it
    if "/buytickets/" in base_url:
        # Strip query params, normalise
        clean = base_url.split("?")[0].rstrip("/")
        # Try to reuse the date already in the URL if not overriding
        m = re.search(r"/buytickets/([^/]+)/(\d{8})", clean)
        if m and date_code is None:
            return clean
        elif m and date_code:
            return clean.rsplit("/", 1)[0] + "/" + date_code
        return clean

    # Movie detail page — convert to buytickets URL
    m = re.search(r"/(ET\d{8})", base_url)
    if not m:
        return base_url
    event_code = m.group(1)
    base = base_url.split("?")[0].rstrip("/")
    if date_code:
        return f"{base}/buytickets/{event_code}/{date_code}"
    return f"{base}/buytickets/{event_code}"


def _extract_region_and_event(url: str) -> tuple[str, str]:
    """Extract region code and event code from BMS URL."""
    event_m = re.search(r"/(ET\d{8})", url)
    event_code = event_m.group(1) if event_m else ""

    city_m = re.search(r"in\.bookmyshow\.com/movies/([^/]+)", url)
    city = city_m.group(1) if city_m else ""

    # City slug → region code mapping for major cities
    _REGION_MAP = {
        "mumbai": "MUMBAI", "hyderabad": "HYD", "secunderabad": "HYD",
        "bengaluru": "BANG", "bangalore": "BANG", "delhi": "NCR",
        "ncr": "NCR", "chennai": "CHEN", "kolkata": "KOLK",
        "pune": "PUNE", "ahmedabad": "AHED",
    }
    region = _REGION_MAP.get(city.lower(), city.upper()[:4])
    return region, event_code


# ── API call interceptor ──────────────────────────────────────────────────────

async def _intercept_api(page: Page, url: str, date_codes: list[str]) -> dict[str, Any]:
    """
    Load the BMS buytickets page and intercept the JSON API response.
    Returns: { "date_label": { venue: { time: status } } }
    """
    region, event_code = _extract_region_and_event(url)
    all_api_responses: dict[str, Any] = {}  # date_code → JSON response

    # Register response interceptor BEFORE navigation
    async def on_response(response):
        if "showtimes-by-event" in response.url and "primary-dynamic" in response.url:
            dc_match = re.search(r"dateCode=(\d{8})", response.url)
            dc = dc_match.group(1) if dc_match else "unknown"
            try:
                data = await response.json()
                all_api_responses[dc] = data
                logger.info("  ✅ Captured API for dateCode=%s (%d venues)", dc,
                            sum(1 for w in data.get("data", {}).get("showtimeWidgets", [])
                                if w.get("type") == "groupList"
                                for g in w.get("data", [])
                                for i in g.get("data", [])
                                if i.get("type") == "venue-card"))
            except Exception as exc:
                logger.warning("  API response parse error: %s", exc)

    page.on("response", on_response)

    # Navigate to first date to get the API call
    first_date = date_codes[0] if date_codes else None
    nav_url = _build_buytickets_url(url, first_date)
    logger.info("  Loading: %s", nav_url)

    try:
        await page.goto(nav_url, wait_until="domcontentloaded", timeout=40_000)
    except PWTimeout:
        logger.warning("  DOM load timeout — continuing")

    await page.wait_for_timeout(4000)

    # If multiple dates needed and not already captured, navigate to each
    for dc in date_codes[1:]:
        if dc not in all_api_responses:
            try:
                nav2 = _build_buytickets_url(url, dc)
                await page.goto(nav2, wait_until="domcontentloaded", timeout=30_000)
                await page.wait_for_timeout(3000)
            except Exception:
                pass

    return all_api_responses


# ── Parse API response into snapshot dict ────────────────────────────────────

def _parse_api_response(api_response: dict) -> dict[str, dict[str, str]]:
    """
    Parse one BMS showtimes API response into { venue: { time: status } }.
    """
    shows: dict[str, dict[str, str]] = {}
    try:
        widgets = api_response.get("data", {}).get("showtimeWidgets", [])
        for widget in widgets:
            if widget.get("type") != "groupList":
                continue
            for group in widget.get("data", []):
                for item in group.get("data", []):
                    if item.get("type") != "venue-card":
                        continue
                    venue_name = (item.get("additionalData") or {}).get("venueName", "")
                    if not venue_name:
                        continue
                    times: dict[str, str] = {}
                    for section in item.get("showtimesSections", []):
                        for st in section.get("showtimes", []):
                            title = st.get("title", "").strip()
                            if not title or not re.search(r"\d{1,2}:\d{2}", title):
                                continue
                            # Normalise to "HH:MM AM/PM"
                            m = re.match(r"(\d{1,2}):(\d{2})\s*(AM|PM)", title, re.IGNORECASE)
                            if m:
                                title = f"{int(m.group(1)):02d}:{m.group(2)} {m.group(3).upper()}"
                            status = _classify_style(st.get("styleId", ""))
                            times[title] = status
                    if times:
                        shows[venue_name] = times
    except Exception as exc:
        logger.warning("  API parse error: %s", exc)
    return shows


# ── Determine date codes to check ────────────────────────────────────────────

def _get_date_codes(url: str, filter_dates: list[str]) -> list[str]:
    """
    Return YYYYMMDD date codes to query. 
    - If URL already has a date, use that.
    - If user specified filter dates, convert them.
    - Otherwise, use today + next 3 days.
    """
    # Extract date from buytickets URL
    m = re.search(r"/buytickets/ET\d{8}/(\d{8})", url)
    if m:
        return [m.group(1)]

    if filter_dates:
        codes = []
        for fd in filter_dates:
            # Try "YYYYMMDD" format first
            if re.match(r"^\d{8}$", fd):
                codes.append(fd)
                continue
            # Try "DD/MM/YYYY" or "YYYY-MM-DD"
            for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d %b %Y", "%d %B %Y"):
                try:
                    dt = datetime.strptime(fd, fmt)
                    codes.append(dt.strftime("%Y%m%d"))
                    break
                except ValueError:
                    continue
        if codes:
            return codes

    # Default: today + next 3 days
    from datetime import date, timedelta
    today = date.today()
    return [(today + timedelta(days=i)).strftime("%Y%m%d") for i in range(4)]


# ── Public API ────────────────────────────────────────────────────────────────

async def fetch_snapshot(target: dict[str, Any]) -> dict[str, Any]:
    url   = target["url"]
    name  = target.get("name", url)
    city  = target.get("city", "")
    filter_dates = target.get("filter_dates") or []

    result: dict[str, Any] = {
        "name": name, "url": url, "city": city,
        "shows": {}, "error": None,
    }

    date_codes = _get_date_codes(url, filter_dates)
    logger.info("Scraping %s | dates: %s", name, date_codes)

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

            api_responses = await _intercept_api(page, url, date_codes)
            await browser.close()

            if not api_responses:
                result["error"] = "BMS API call not captured — page may have failed to load"
                return result

            # Build snapshot: { "Thu, 04 Sep": { venue: { time: status } } }
            snapshot: dict[str, Any] = {}
            for dc, resp in api_responses.items():
                date_label = _date_code_to_label(dc)
                shows = _parse_api_response(resp)
                if shows:
                    snapshot[date_label] = shows
                    logger.info("  %s → %d venue(s)", date_label, len(shows))
                else:
                    logger.warning("  %s → 0 venues parsed from API", date_label)

            result["shows"] = snapshot

    except Exception as exc:
        logger.exception("Scraper error for %s", url)
        result["error"] = str(exc)

    return result


def scrape(target: dict[str, Any]) -> dict[str, Any]:
    """Synchronous wrapper — safe to call from Flask/APScheduler threads."""
    return asyncio.run(fetch_snapshot(target))


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
            # Legacy hash-mode snapshot — skip, we don't use hashes anymore
            continue

        # Date filter — flexible matching: "04 Sep", "Thu, 04 Sep", "20260904" all match
        if filter_dates:
            matched = False
            for fd in filter_dates:
                fd_clean = fd.strip().lower()
                # Try to convert filter date to a short date label for comparison
                # e.g. "20260904" → "04 Sep"
                if re.match(r"^\d{8}$", fd_clean):
                    try:
                        dt = datetime.strptime(fd_clean, "%Y%m%d")
                        fd_label = f"{dt.day:02d} {_MONTHS[f'{dt.month:02d}']}"
                        if fd_label.lower() in date_label.lower():
                            matched = True
                            break
                    except Exception:
                        pass
                # Also try dd/mm/yyyy
                for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
                    try:
                        dt = datetime.strptime(fd_clean, fmt)
                        fd_label = f"{dt.day:02d} {_MONTHS[f'{dt.month:02d}']}"
                        if fd_label.lower() in date_label.lower():
                            matched = True
                            break
                    except ValueError:
                        continue
                # Plain substring match as last resort
                if fd_clean in date_label.lower() or date_label.lower() in fd_clean:
                    matched = True
                if matched:
                    break
            if not matched:
                continue

        if not isinstance(theatres, dict):
            continue

        filtered_theatres: dict[str, Any] = {}
        for theatre, times in theatres.items():
            # Theatre filter — case-insensitive substring
            if filter_theatres:
                if not any(ft.strip().lower() in theatre.lower() for ft in filter_theatres):
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
    if not from_str and not to_str:
        return True
    t = _parse_time_to_minutes(time_str)
    if t is None:
        return True
    if from_str:
        f = _parse_time_to_minutes(from_str)
        if f is not None and t < f:
            return False
    if to_str:
        end = _parse_time_to_minutes(to_str)
        if end is not None and t > end:
            return False
    return True
