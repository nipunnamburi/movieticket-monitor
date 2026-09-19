from __future__ import annotations

"""
main.py — BookMyShow Ticket Notifier

Architecture Flow (Mermaid-compliant):
  GitHub Actions / CLI Runner
    -> Main Checker (main.py)
    -> URL/Region Resolver
    -> Showtime Fetcher
    -> BookMyShow API
    -> Movie / Date / Show Parsers
    -> Show Filters
    -> JSON State (bms_state.json)
    -> Change Detector
    -> HTML Email Builder
    -> Email Sender
    -> Resend API (with fallback)
    -> Email Recipient
"""

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from playwright.async_api import async_playwright, Page, TimeoutError as PWTimeout

# Load environment variables (.env)
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("bms-monitor")

STATE_FILE = Path("bms_state.json")

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

_MONTHS = {
    "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
    "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
    "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
}
_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


# ==============================================================================
# 1. URL / REGION RESOLVER
# ==============================================================================

class UrlRegionResolver:
    """Resolves movie codes, region codes, slugs, and buytickets URLs."""

    REGION_MAP = {
        "mumbai": "MUMBAI",
        "hyderabad": "HYD",
        "secunderabad": "HYD",
        "bengaluru": "BANG",
        "bangalore": "BANG",
        "delhi": "NCR",
        "delhi-ncr": "NCR",
        "ncr": "NCR",
        "chennai": "CHEN",
        "kolkata": "KOLK",
        "pune": "PUNE",
        "ahmedabad": "AHED",
        "chandigarh": "CHD",
        "kochi": "COCH",
    }

    @classmethod
    def resolve(cls, raw_url: str) -> dict[str, str]:
        clean_url = raw_url.strip().split("?")[0].rstrip("/")
        
        # Match event code (e.g. ET00506465)
        event_match = re.search(r"/(ET\d{8})", clean_url)
        event_code = event_match.group(1) if event_match else ""

        # Match city
        city_match = re.search(r"in\.bookmyshow\.com/(?:movies|buytickets)/([^/]+)", clean_url)
        city_slug = city_match.group(1) if city_match else ""

        # Match movie slug
        slug_match = re.search(r"in\.bookmyshow\.com/movies/[^/]+/([^/]+)", clean_url)
        movie_slug = slug_match.group(1) if slug_match else ""

        region_code = cls.REGION_MAP.get(city_slug.lower(), city_slug.upper()[:4] if city_slug else "HYD")

        return {
            "raw_url": raw_url,
            "clean_url": clean_url,
            "event_code": event_code,
            "city_slug": city_slug,
            "movie_slug": movie_slug,
            "region_code": region_code,
        }

    @classmethod
    def build_buytickets_url(cls, target_info: dict[str, str], date_code: str | None = None) -> str:
        clean = target_info["clean_url"]
        event_code = target_info["event_code"]
        region = target_info["region_code"].lower()
        slug = target_info["movie_slug"] or "movie"

        if "/buytickets/" in clean:
            # If date code is specified, update or append it
            if date_code:
                # Replace trailing date code if exists
                if re.search(r"/\d{8}$", clean):
                    return re.sub(r"/\d{8}$", f"/{date_code}", clean)
                return f"{clean}/{date_code}"
            return clean

        # Format: https://in.bookmyshow.com/buytickets/{slug}/movie-{region}-{event_code}-MT/{date_code}
        if date_code:
            return f"https://in.bookmyshow.com/buytickets/{slug}/movie-{region}-{event_code}-MT/{date_code}"
        return f"https://in.bookmyshow.com/buytickets/{slug}/movie-{region}-{event_code}-MT"


# ==============================================================================
# 2. DATE PARSER
# ==============================================================================

class DateParser:
    """Handles normalization between YYYYMMDD and display strings."""

    @staticmethod
    def date_code_to_label(date_code: str) -> str:
        try:
            dt = datetime.strptime(date_code, "%Y%m%d")
            day_name = _DAYS[dt.weekday()]
            return f"{day_name}, {dt.day:02d} {_MONTHS[f'{dt.month:02d}']}"
        except Exception:
            return date_code

    @staticmethod
    def get_target_date_codes(raw_url: str, filter_dates: list[str]) -> list[str]:
        # 1. Date in URL
        m = re.search(r"(\d{8})", raw_url)
        if m and m.group(1).startswith("20"):
            return [m.group(1)]

        # 2. Filter dates specified by user
        if filter_dates:
            codes = []
            for fd in filter_dates:
                fd_clean = fd.strip()
                if re.match(r"^\d{8}$", fd_clean):
                    codes.append(fd_clean)
                    continue
                for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d %b %Y", "%d %B %Y"):
                    try:
                        dt = datetime.strptime(fd_clean, fmt)
                        codes.append(dt.strftime("%Y%m%d"))
                        break
                    except ValueError:
                        continue
            if codes:
                return codes

        # 3. Default: Today + next 2 days
        today = date.today()
        return [(today + timedelta(days=i)).strftime("%Y%m%d") for i in range(3)]


# ==============================================================================
# 3. MOVIE & SHOW PARSERS
# ==============================================================================

class ShowParser:
    """Parses raw BMS showtimes API/state JSON into structured show dictionary."""

    @staticmethod
    def classify_style(style_id: str) -> str:
        s = (style_id or "").lower()
        if "grey" in s or "gray" in s or "sold" in s:
            return "sold-out"
        if "orange" in s or "fast" in s or "filling" in s:
            return "fast-filling"
        return "available"

    @classmethod
    def parse_showtime_widgets(cls, raw_data: dict[str, Any]) -> tuple[dict[str, dict[str, str]], str, str]:
        """Returns ({ venue: { time: status } }, detected_language, movie_title)."""
        shows: dict[str, dict[str, str]] = {}
        detected_lang = ""
        movie_title = ""

        try:
            data = raw_data.get("data", raw_data)
            
            # Extract movie title & language from header / top widgets
            header = data.get("header", {})
            if isinstance(header, dict):
                movie_title = ((header.get("title") or {}).get("text") or "").strip()
                subtitle = ((header.get("subtitle") or {}).get("text") or "").strip()
                if subtitle:
                    parts = [p.strip() for p in subtitle.split(",")]
                    if parts and not parts[0].startswith("Movie runtime"):
                        detected_lang = parts[0]

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
                                m = re.match(r"(\d{1,2}):(\d{2})\s*(AM|PM)?", title, re.IGNORECASE)
                                if m:
                                    meridiem = (m.group(3) or "").upper()
                                    title = f"{int(m.group(1)):02d}:{m.group(2)} {meridiem}".strip()
                                status = cls.classify_style(st.get("styleId", ""))
                                times[title] = status
                        if times:
                            shows[venue_name] = times
        except Exception as exc:
            logger.warning("Error parsing showtime widgets: %s", exc)

        return shows, detected_lang, movie_title


# ==============================================================================
# 4. SHOWTIME FETCHER (BookMyShow API)
# ==============================================================================

class ShowtimeFetcher:
    """Interacts with BookMyShow to acquire showtime JSON data using Playwright."""

    @classmethod
    async def fetch(cls, target_info: dict[str, str], date_codes: list[str]) -> dict[str, Any]:
        api_responses: dict[str, Any] = {}

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
                                api_responses[target_dc] = data
                    except Exception:
                        pass

            page.on("response", on_response)

            async def extract_initial_state(current_dc: str):
                try:
                    state_data = await page.evaluate('''() => {
                        const st = window.__INITIAL_STATE__ || window.__NEXT_DATA__;
                        if (!st) return null;
                        const queries = st.showtimesFunctionalApi?.queries || {};
                        for (const k in queries) {
                            const qData = queries[k]?.data;
                            if (qData && (qData.data?.showtimeWidgets || qData.showtimeWidgets)) {
                                const dcMatch = k.match(/20\\d{6}/);
                                const dc = dcMatch ? dcMatch[0] : null;
                                return { dateCode: dc, data: qData };
                            }
                        }
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
                        api_responses[dc] = state_data["data"]
                        logger.info("Extracted showtimes from page state for dateCode=%s", dc)
                except Exception as exc:
                    logger.debug("State extraction warning: %s", exc)

            for idx, dc in enumerate(date_codes):
                nav_url = UrlRegionResolver.build_buytickets_url(target_info, dc)
                logger.info("Fetching showtimes [%s]: %s", dc, nav_url)
                try:
                    await page.goto(nav_url, wait_until="domcontentloaded", timeout=35000)
                except PWTimeout:
                    logger.warning("DOM load timeout for %s, checking intercepted data", nav_url)
                await page.wait_for_timeout(3500)
                await extract_initial_state(dc)

            await browser.close()

        return api_responses


# ==============================================================================
# 5. SHOW FILTERS
# ==============================================================================

class ShowFilters:
    """Applies theatre, date, time, and language criteria."""

    @staticmethod
    def parse_time_to_minutes(time_str: str) -> int | None:
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

    @classmethod
    def time_in_range(cls, time_str: str, from_str: str, to_str: str) -> bool:
        if not from_str and not to_str:
            return True
        t = cls.parse_time_to_minutes(time_str)
        if t is None:
            return True
        if from_str:
            f = cls.parse_time_to_minutes(from_str)
            if f is not None and t < f:
                return False
        if to_str:
            e = cls.parse_time_to_minutes(to_str)
            if e is not None and t > e:
                return False
        return True

    @classmethod
    def apply(
        cls,
        snapshot: dict[str, Any],
        filter_theatres: list[str] | None = None,
        filter_dates: list[str] | None = None,
        filter_time_from: str = "",
        filter_time_to: str = "",
        filter_language: str = "",
    ) -> dict[str, Any]:
        filter_theatres = filter_theatres or []
        filter_dates = filter_dates or []

        if filter_language and "_language" in snapshot:
            snap_lang = snapshot["_language"].lower()
            if filter_language.lower() not in snap_lang:
                logger.info("Language filter mismatch: '%s' vs '%s'", filter_language, snap_lang)
                return {}

        result: dict[str, Any] = {}
        if "_date_codes" in snapshot:
            result["_date_codes"] = snapshot["_date_codes"]
        if "_language" in snapshot:
            result["_language"] = snapshot["_language"]

        date_codes_map = snapshot.get("_date_codes", {})

        for date_label, theatres in snapshot.items():
            if date_label.startswith("_"):
                continue

            if filter_dates:
                matched = False
                cur_dc = date_codes_map.get(date_label, "")
                for fd in filter_dates:
                    fd_clean = fd.strip().lower()
                    if cur_dc and fd_clean == cur_dc.lower():
                        matched = True
                        break
                    # Check if fd is a date code or format matching date_label
                    for fmt in ("%Y%m%d", "%d/%m/%Y", "%Y-%m-%d"):
                        try:
                            dt = datetime.strptime(fd_clean, fmt)
                            if dt.strftime("%Y%m%d") == cur_dc:
                                matched = True
                                break
                            label_sub = f"{dt.day:02d} {_MONTHS.get(f'{dt.month:02d}', '')}".lower()
                            if label_sub and label_sub in date_label.lower():
                                matched = True
                                break
                        except ValueError:
                            pass
                    if matched:
                        break
                    if fd_clean in date_label.lower():
                        matched = True
                        break
                if not matched:
                    continue

            if not isinstance(theatres, dict):
                continue

            filtered_theatres: dict[str, Any] = {}
            for theatre, times in theatres.items():
                if filter_theatres:
                    if not any(ft.lower() in theatre.lower() for ft in filter_theatres):
                        continue

                filtered_times: dict[str, str] = {}
                for time_str, status in times.items():
                    if not cls.time_in_range(time_str, filter_time_from, filter_time_to):
                        continue
                    filtered_times[time_str] = status

                if filtered_times:
                    filtered_theatres[theatre] = filtered_times

            if filtered_theatres:
                result[date_label] = filtered_theatres

        return result


# ==============================================================================
# 6. JSON STATE & CHANGE DETECTOR
# ==============================================================================

class JsonState:
    """Manages reading and writing snapshots to bms_state.json."""

    @staticmethod
    def load(path: Path = STATE_FILE) -> dict[str, Any]:
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as exc:
                logger.warning("Failed to load %s: %s", path, exc)
        return {}

    @staticmethod
    def save(state_data: dict[str, Any], path: Path = STATE_FILE) -> None:
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(state_data, f, indent=2)
            logger.info("Saved state to %s", path)
        except Exception as exc:
            logger.error("Failed to save state to %s: %s", path, exc)


class ChangeDetector:
    """Detects availability changes (NOT BOOKABLE -> BOOKABLE)."""

    BOOKABLE = frozenset({"available", "fast-filling"})
    NOT_BOOKABLE = frozenset({"sold-out", "not listed", "unavailable", "", "removed"})

    @classmethod
    def is_bookable(cls, status: str | None) -> bool:
        return (status or "").lower().strip() in cls.BOOKABLE

    @classmethod
    def is_not_bookable(cls, status: str | None) -> bool:
        s = (status or "").lower().strip()
        return s in cls.NOT_BOOKABLE or s not in cls.BOOKABLE

    @classmethod
    def is_opening(cls, old_status: str | None, new_status: str | None) -> bool:
        return cls.is_not_bookable(old_status) and cls.is_bookable(new_status)

    @classmethod
    def detect_changes(cls, old_snapshot: dict[str, Any], new_snapshot: dict[str, Any]) -> list[dict[str, str]]:
        openings: list[dict[str, str]] = []
        date_codes = {}
        date_codes.update(old_snapshot.get("_date_codes", {}))
        date_codes.update(new_snapshot.get("_date_codes", {}))

        all_dates = sorted(k for k in set(old_snapshot.keys()) | set(new_snapshot.keys()) if not k.startswith("_"))

        for date_label in all_dates:
            old_theatres = old_snapshot.get(date_label, {}) or {}
            new_theatres = new_snapshot.get(date_label, {}) or {}
            all_theatres = sorted(set(old_theatres.keys()) | set(new_theatres.keys()))

            for theatre in all_theatres:
                old_times = old_theatres.get(theatre, {}) or {}
                new_times = new_theatres.get(theatre, {}) or {}
                all_times = sorted(set(old_times.keys()) | set(new_times.keys()))

                for showtime in all_times:
                    old_s = old_times.get(showtime)
                    new_s = new_times.get(showtime)

                    if cls.is_opening(old_s, new_s):
                        label = "🟢 Available" if new_s == "available" else "🟡 Fast Filling"
                        if old_s == "sold-out":
                            label += " (Was Sold Out!)"
                        elif not old_s or old_s == "not listed":
                            label += " (New Show Added!)"

                        openings.append({
                            "date": date_label,
                            "date_code": date_codes.get(date_label, ""),
                            "theatre": theatre,
                            "showtime": showtime,
                            "old_status": old_s or "not listed",
                            "new_status": new_s or "unknown",
                            "change": label,
                        })

        return openings


# ==============================================================================
# 7. HTML EMAIL BUILDER & EMAIL SENDER (Resend API)
# ==============================================================================

class HtmlEmailBuilder:
    """Builds clean, responsive HTML email alert for new tickets."""

    TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f172a; margin: 0; padding: 24px; color: #f8fafc; }}
  .card {{ background: #1e293b; border-radius: 16px; max-width: 620px; margin: 0 auto; overflow: hidden; border: 1px solid #334155; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }}
  .hdr {{ background: linear-gradient(135deg, #ef4444, #b91c1c); padding: 24px; text-align: left; }}
  .hdr h1 {{ color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; }}
  .hdr p {{ color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 13px; }}
  .body {{ padding: 24px; }}
  .meta {{ background: #0f172a; border-radius: 10px; padding: 14px 18px; font-size: 14px; color: #94a3b8; margin-bottom: 20px; border: 1px solid #334155; }}
  .meta strong {{ color: #38bdf8; font-size: 16px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }}
  th {{ background: #334155; text-align: left; padding: 10px 12px; font-weight: 600; color: #cbd5e1; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }}
  td {{ padding: 12px 12px; border-bottom: 1px solid #334155; vertical-align: middle; color: #e2e8f0; }}
  .badge {{ display: inline-block; padding: 4px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; }}
  .b-open {{ background: #064e3b; color: #34d399; border: 1px solid #059669; }}
  .b-fast {{ background: #78350f; color: #fde047; border: 1px solid #d97706; }}
  .cta {{ margin: 28px 0 10px; text-align: center; }}
  .cta a {{ display: inline-block; background: #ef4444; color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(239,68,68,0.4); }}
  .ft {{ background: #0f172a; padding: 16px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #334155; }}
</style>
</head>
<body>
<div class="card">
  <div class="hdr">
    <h1>🎟️ BookMyShow Tickets Opened!</h1>
    <p>Automated Real-Time Cloud Alert • {timestamp}</p>
  </div>
  <div class="body">
    <div class="meta">
      <strong>{movie_name}</strong> &mdash; {city}<br>
      <span style="color:#4ade80;font-weight:600;">✨ {count} show(s) now bookable!</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Theatre</th>
          <th>Showtime</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows}
      </tbody>
    </table>
    <div class="cta">
      <a href="{booking_url}" target="_blank">Book Now on BookMyShow &rarr;</a>
    </div>
  </div>
  <div class="ft">Powered by BookMyShow Monitor • Checked automatically via GitHub Actions</div>
</div>
</body>
</html>
"""

    ROW_TEMPLATE = """\
<tr>
  <td><strong>{date}</strong></td>
  <td>{theatre}</td>
  <td>{showtime}</td>
  <td><span class="badge {badge_class}">{change}</span></td>
  <td><a href="{book_url}" style="background:#38bdf8;color:#0f172a;padding:5px 12px;border-radius:6px;text-decoration:none;font-size:11px;font-weight:700;">Book</a></td>
</tr>
"""

    @classmethod
    def build(cls, movie_name: str, city: str, main_url: str, openings: list[dict[str, str]]) -> str:
        rows = []
        for op in openings:
            b_class = "b-open" if "Available" in op["change"] else "b-fast"
            date_code = op.get("date_code", "")
            book_url = f"{main_url}/{date_code}" if date_code and "/buytickets/" in main_url else main_url
            rows.append(cls.ROW_TEMPLATE.format(
                date=op["date"],
                theatre=op["theatre"],
                showtime=op["showtime"],
                change=op["change"],
                badge_class=b_class,
                book_url=book_url,
            ))

        return cls.TEMPLATE.format(
            timestamp=datetime.now(timezone.utc).strftime("%d %b %Y, %I:%M %p UTC"),
            movie_name=movie_name,
            city=city.title(),
            count=len(openings),
            rows="\n".join(rows),
            booking_url=main_url,
        )


class EmailSender:
    """Sends email via Resend API (with Gmail SMTP fallback)."""

    @classmethod
    def send(cls, subject: str, html_content: str, to_address: str | None = None) -> bool:
        recipient = to_address or os.environ.get("DEFAULT_EMAIL_TO") or "nipunnamburi@gmail.com"
        resend_key = os.environ.get("RESEND_API_KEY", "").strip()

        # 1. Primary: Resend API
        if resend_key:
            try:
                import resend
                resend.api_key = resend_key
                resend_from = os.environ.get("RESEND_FROM", "BookMyShow Alerts <onboarding@resend.dev>")
                
                # Resend trial account restriction: can only send to the account owner email (nipunnamburi@gmail.com)
                # Ensure delivery to the verified account
                actual_recipient = "nipunnamburi@gmail.com" if "onboarding@resend.dev" in resend_from else recipient

                logger.info("Dispatching email alert via Resend API to %s...", actual_recipient)
                params: resend.Emails.SendParams = {
                    "from": resend_from,
                    "to": [actual_recipient],
                    "subject": subject,
                    "html": html_content,
                }
                email_res = resend.Emails.send(params)
                logger.info("✅ Resend API alert sent successfully! ID: %s", email_res.get("id"))
                return True
            except Exception as exc:
                logger.error("Resend API failed: %s. Trying SMTP fallback...", exc)

        # 2. Fallback: SMTP (Gmail)
        smtp_user = os.environ.get("EMAIL_FROM", "").strip()
        smtp_pass = os.environ.get("EMAIL_APP_PASSWORD", "").strip()
        if smtp_user and smtp_pass:
            try:
                import smtplib
                import ssl
                from email.mime.multipart import MIMEMultipart
                from email.mime.text import MIMEText

                logger.info("Dispatching email alert via Gmail SMTP to %s...", recipient)
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = f"BMS Monitor <{smtp_user}>"
                msg["To"] = recipient
                msg.attach(MIMEText(html_content, "html", "utf-8"))

                ctx = ssl.create_default_context()
                host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
                port = int(os.environ.get("SMTP_PORT", 587))
                with smtplib.SMTP(host, port, timeout=15) as server:
                    server.starttls(context=ctx)
                    server.login(smtp_user, smtp_pass)
                    server.sendmail(smtp_user, recipient, msg.as_string())
                logger.info("✅ SMTP alert sent successfully to %s", recipient)
                return True
            except Exception as exc:
                logger.error("SMTP delivery failed: %s", exc)

        logger.error("No valid email transport succeeded.")
        return False


# ==============================================================================
# 8. MAIN CHECKER (Orchestrator)
# ==============================================================================

class MainChecker:
    """Main Orchestration Checker following Mermaid workflow."""

    def __init__(self, target_url: str, filter_theatres: list[str] | None = None, filter_dates: list[str] | None = None):
        self.raw_url = target_url
        self.filter_theatres = filter_theatres or []
        self.filter_dates = filter_dates or []

    async def run(self, force_alert: bool = False) -> None:
        logger.info("=== STARTING BMS MONITOR CYCLE ===")
        
        # 1. URL / Region Resolver
        target_info = UrlRegionResolver.resolve(self.raw_url)
        logger.info("Target: %s (Region: %s, Event: %s)", 
                    target_info["clean_url"], target_info["region_code"], target_info["event_code"])

        # 2. Date Parser
        date_codes = DateParser.get_target_date_codes(self.raw_url, self.filter_dates)
        logger.info("Querying date codes: %s", date_codes)

        # 3. Showtime Fetcher (BookMyShow API)
        api_responses = await ShowtimeFetcher.fetch(target_info, date_codes)
        if not api_responses:
            logger.error("Could not fetch BookMyShow showtime data.")
            sys.exit(1)

        # 4. Movie / Date / Show Parsers
        current_snapshot: dict[str, Any] = {}
        date_codes_map: dict[str, str] = {}
        movie_title = target_info["movie_slug"].replace("-", " ").title()
        detected_language = ""

        for dc, resp in api_responses.items():
            date_label = DateParser.date_code_to_label(dc)
            shows, lang, title = ShowParser.parse_showtime_widgets(resp)
            if title:
                movie_title = title
            if lang:
                detected_language = lang
            if shows:
                current_snapshot[date_label] = shows
                date_codes_map[date_label] = dc
                logger.info("Parsed %d venue(s) for %s (%s)", len(shows), date_label, dc)

        current_snapshot["_date_codes"] = date_codes_map
        if detected_language:
            current_snapshot["_language"] = detected_language

        # 5. Show Filters
        filtered_current = ShowFilters.apply(
            current_snapshot,
            filter_theatres=self.filter_theatres,
            filter_dates=self.filter_dates,
        )

        # 6. JSON State
        previous_state = JsonState.load(STATE_FILE)
        is_first_run = not previous_state

        filtered_previous = ShowFilters.apply(
            previous_state,
            filter_theatres=self.filter_theatres,
            filter_dates=self.filter_dates,
        )

        # 7. Change Detector
        openings = ChangeDetector.detect_changes(filtered_previous, filtered_current)

        if is_first_run and not force_alert:
            logger.info("First run detected: saving baseline snapshot in %s without alert.", STATE_FILE)
            openings = []

        logger.info("Change detection result: %d new opening(s) found.", len(openings))

        # 8. HTML Email Builder & Email Sender (Resend API)
        if openings:
            subject = f"🔔 BMS Alert: {movie_title} — {len(openings)} New Show(s) Available!"
            html_alert = HtmlEmailBuilder.build(
                movie_name=movie_title,
                city=target_info["city_slug"] or "Hyderabad",
                main_url=self.raw_url,
                openings=openings,
            )
            EmailSender.send(subject, html_alert)
        else:
            logger.info("No new availability openings. No alert needed.")

        # Save updated snapshot
        JsonState.save(current_snapshot, STATE_FILE)
        logger.info("=== BMS MONITOR CYCLE COMPLETE ===")


def main():
    parser = argparse.ArgumentParser(description="BookMyShow Ticket Notifier")
    parser.add_argument(
        "--url",
        default=os.environ.get("MONITOR_URL", "https://in.bookmyshow.com/movies/hyderabad/vibe/ET00506465"),
        help="BookMyShow Movie or Buytickets URL",
    )
    parser.add_argument("--theatres", nargs="*", help="Filter theatres by substring")
    parser.add_argument("--dates", nargs="*", help="Filter dates (YYYYMMDD or DD/MM/YYYY)")
    parser.add_argument("--force-alert", action="store_true", help="Force send alert if any shows are bookable")

    args = parser.parse_args()

    checker = MainChecker(
        target_url=args.url,
        filter_theatres=args.theatres,
        filter_dates=args.dates,
    )
    asyncio.run(checker.run(force_alert=args.force_alert))


if __name__ == "__main__":
    main()
