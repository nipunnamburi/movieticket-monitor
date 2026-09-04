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
    Load the BMS buytickets page and extract JSON data via XHR interception or deep window state search.
    Returns: { date_code: API_data_dict }
    """
    all_api_responses: dict[str, Any] = {}

    # 1. Broad XHR Response Interceptor
    async def on_response(response):
        u_lower = response.url.lower()
        if any(k in u_lower for k in ("showtime", "showtimes", "primary-dynamic", "buytickets")) or "datecode=" in u_lower:
            dc_match = re.search(r"datecode=(\d{8})", u_lower)
            dc = dc_match.group(1) if dc_match else ""
            try:
                data = await response.json()
                if isinstance(data, dict):
                    json_str = json.dumps(data)
                    if "showtimeWidgets" in json_str or "venue-card" in json_str:
                        target_dc = dc or (date_codes[0] if date_codes else "unknown")
                        all_api_responses[target_dc] = data
            except Exception:
                pass

    page.on("response", on_response)

    # 2. Deep recursive search in window.__INITIAL_STATE__ / window.__NEXT_DATA__
    async def extract_initial_state(current_dc: str):
        try:
            state_data = await page.evaluate('''() => {
                const st = window.__INITIAL_STATE__ || window.__NEXT_DATA__;
                if (!st) return null;

                // Priority 1: Check queries inside showtimesFunctionalApi
                const queries = st.showtimesFunctionalApi?.queries || {};
                for (const k in queries) {
                    const qData = queries[k]?.data;
                    if (qData && (qData.data?.showtimeWidgets || qData.showtimeWidgets)) {
                        const dcMatch = k.match(/20\d{6}/);
                        const dc = dcMatch ? dcMatch[0] : null;
                        return { dateCode: dc, data: qData };
                    }
                }

                // Priority 2: Deep recursive search for showtimeWidgets anywhere in window state
                function findWidgets(obj, depth = 0) {
                    if (!obj || depth > 6) return null;
                    if (obj.showtimeWidgets && Array.isArray(obj.showtimeWidgets)) return obj;
                    for (const k in obj) {
                        if (typeof obj[k] === 'object' && obj[k] !== null) {
                            const res = findWidgets(obj[k], depth + 1);
                            if (res) return res;
                        }
                    }
                    return null;
                }

                const found = findWidgets(st);
                if (found) {
                    return { dateCode: null, data: { data: found } };
                }
                return null;
            }''')
            if state_data and state_data.get("data"):
                raw_dc = str(state_data.get("dateCode") or "")
                dc = raw_dc if re.match(r"^\d{8}$", raw_dc) else current_dc
                all_api_responses[dc] = state_data["data"]
                logger.info("  ✅ Extracted showtimes via deep state search for dateCode=%s", dc)
        except Exception as exc:
            logger.warning("  Initial state extraction warning: %s", exc)

    # Navigate to first date
    first_date = date_codes[0] if date_codes else None
    nav_url = _build_buytickets_url(url, first_date)
    logger.info("  Loading: %s", nav_url)

    try:
        await page.goto(nav_url, wait_until="domcontentloaded", timeout=40_000)
    except PWTimeout:
        logger.warning("  DOM load timeout — continuing")

    await page.wait_for_timeout(4000)
    await extract_initial_state(first_date or "unknown")

    # If multiple dates needed and not already captured, navigate to each date
    for dc in date_codes[1:]:
        if dc not in all_api_responses:
            try:
                nav2 = _build_buytickets_url(url, dc)
                await page.goto(nav2, wait_until="domcontentloaded", timeout=30_000)
                await page.wait_for_timeout(3000)
                await extract_initial_state(dc)
            except Exception:
                pass

    return all_api_responses


# ── Parse API response into snapshot dict ────────────────────────────────────

def _parse_api_response(api_response: dict) -> tuple[dict[str, dict[str, str]], str]:
    """
    Parse one BMS showtimes API response into ({ venue: { time: status } }, language).
    """
    shows: dict[str, dict[str, str]] = {}
    detected_lang = ""
    try:
        data = api_response.get("data", {})
        
        # Check topStickyWidgets for language title (e.g. "Telugu  •  2D")
        top_widgets = data.get("topStickyWidgets", [])
        for w in top_widgets:
            if w.get("type") == "horizontal-text-list":
                for item in w.get("data", []):
                    left_text = item.get("leftText", {}).get("data", [])
                    for lt in left_text:
                        for comp in lt.get("components", []):
                            txt = comp.get("text", "").strip()
                            if "•" in txt:
                                lang_part = txt.split("•")[0].strip()
                                if lang_part:
                                    detected_lang = lang_part
                                    break
                            elif txt and txt not in ("Change",):
                                detected_lang = txt
                                break

        if not detected_lang:
            header = data.get("header", {})
            subtitle = ((header.get("subtitle") or {}).get("text") or "").strip()
            if subtitle:
                parts = [p.strip() for p in subtitle.split(",")]
                if parts and not parts[0].startswith("Movie runtime"):
                    detected_lang = parts[0]

        widgets = data.get("showtimeWidgets", [])
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
    return shows, detected_lang


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

            # Build snapshot: { "Fri, 04 Sep": { venue: { time: status } } }
            # Also store "_date_codes" and "_language" metadata
            snapshot: dict[str, Any] = {}
            date_codes_map: dict[str, str] = {}
            detected_language = target.get("language", "")

            for dc, resp in api_responses.items():
                date_label = _date_code_to_label(dc)
                shows, lang = _parse_api_response(resp)
                if lang:
                    detected_language = lang
                if shows:
                    snapshot[date_label] = shows
                    date_codes_map[date_label] = dc
                    logger.info("  %s (%s) → %d venue(s)", date_label, dc, len(shows))
                else:
                    logger.warning("  %s (%s) → 0 venues parsed from API", date_label, dc)

            if date_codes_map:
                snapshot["_date_codes"] = date_codes_map  # metadata, not show data
            if detected_language:
                snapshot["_language"] = detected_language

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
    filter_language: str = "",
) -> dict[str, Any]:
    """
    Return a subset of `snapshot` matching the given filters.
    All filters are optional (empty list / empty string = no filter).
    """
    # Language filter check — if configured, compare with snapshot language metadata or target language
    if filter_language:
        snap_lang = snapshot.get("_language", "")
        if snap_lang and filter_language.strip().lower() not in snap_lang.strip().lower():
            logger.info("Snapshot language '%s' does not match filter language '%s' — returning empty",
                        snap_lang, filter_language)
            return {}

    result: dict[str, Any] = {}

    # Propagate canonical date-code map and language metadata
    if "_date_codes" in snapshot:
        result["_date_codes"] = snapshot["_date_codes"]
    if "_language" in snapshot:
        result["_language"] = snapshot["_language"]

    for date_label, theatres in snapshot.items():
        if date_label in ("_page_hash", "_date_codes", "_language"):
            # Internal metadata — not show data
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
