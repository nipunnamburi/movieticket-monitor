from __future__ import annotations

"""
actions_runner.py — GitHub Actions entry point.

Monitoring flow (per spec):
  1. Fetch current shows from BookMyShow
  2. Apply user filters
  3. Compare with previous snapshot
  4. Alert ONLY if new shows became bookable (NOT AVAILABLE → AVAILABLE)
  5. Save updated snapshot

A show is uniquely identified by: theatre + date + showtime
Repeated alerts for the same show are suppressed automatically — the snapshot
comparison means once a show is "available" in old AND new, compute_diff()
finds no change and availability_openings() returns nothing.

Environment variables (GitHub Secrets):
  DATABASE_URL       — Neon Postgres connection string
  EMAIL_FROM         — Gmail address
  EMAIL_APP_PASSWORD — Gmail App Password
  EMAIL_TO           — Default recipient (overridden per-monitor)
  MONITOR_ID         — (optional) Only check this specific monitor ID
"""

import logging
import os
import sys
from datetime import datetime, timezone

import db
import notifier
import scraper
import state

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _email_cfg() -> dict:
    return {
        "from":         os.environ.get("EMAIL_FROM", ""),
        "to":           os.environ.get("EMAIL_TO", ""),
        "app_password": os.environ.get("EMAIL_APP_PASSWORD", ""),
        "smtp_host":    os.environ.get("SMTP_HOST", "smtp.gmail.com"),
        "smtp_port":    int(os.environ.get("SMTP_PORT", 587)),
    }


def run_check(monitor: dict) -> None:
    mid  = monitor["id"]
    name = monitor["name"]
    log.info("Checking monitor #%d — %s", mid, name)

    # ── Scrape ──────────────────────────────────────────────────────────────
    try:
        scrape_result = scraper.scrape(monitor)
    except Exception as exc:
        log.error("Scrape failed for #%d: %s", mid, exc)
        db.update_monitor(mid, {
            "last_error":   str(exc)[:400],
            "last_checked": _now(),
            "status":       "error",
        })
        return

    if scrape_result.get("error"):
        log.warning("Scrape error for #%d: %s", mid, scrape_result["error"])
        db.update_monitor(mid, {
            "last_error":   scrape_result["error"][:400],
            "last_checked": _now(),
            "status":       "error",
        })
        return

    # ── Extract shows dict ───────────────────────────────────────────────────
    new_shows = scrape_result.get("shows") or {}
    log.info("  Scrape returned %d date bucket(s)", len(new_shows))

    if not new_shows:
        log.warning("  Scraper returned empty shows")
        db.update_monitor(mid, {
            "last_checked": _now(),
            "last_error":   "Scraper returned no shows — check Actions logs",
            "status":       "error",
        })
        return

    # ── Apply filters ────────────────────────────────────────────────────────
    filter_kwargs = dict(
        filter_theatres  = monitor.get("filter_theatres") or [],
        filter_dates     = monitor.get("filter_dates") or [],
        filter_time_from = monitor.get("filter_time_from") or "",
        filter_time_to   = monitor.get("filter_time_to") or "",
    )
    new_filtered = scraper.apply_filters(new_shows, **filter_kwargs)

    old_shows    = monitor.get("snapshot") or {}
    old_filtered = scraper.apply_filters(old_shows, **filter_kwargs)

    log.info("  After filters: %d date(s) in new, %d in old",
             len(new_filtered), len(old_filtered))

    # ── Diff — only alert on NOT AVAILABLE → AVAILABLE ────────────────────
    all_changes = state.compute_diff(old_filtered, new_filtered)
    openings    = state.availability_openings(all_changes)

    # First run: old snapshot is empty — save baseline silently, no alert.
    # The comparison on the *next* run will catch genuinely new shows.
    is_first_run = not old_shows
    if is_first_run:
        log.info("  First run — saving baseline snapshot silently (no alert)")
        openings = []

    log.info("  %d availability opening(s) detected", len(openings))

    # ── Persist snapshot ─────────────────────────────────────────────────────
    db.update_monitor(mid, {
        "snapshot":     new_shows,
        "last_checked": _now(),
        "last_error":   None,
        "status":       "active",
    })

    # ── Alert ────────────────────────────────────────────────────────────────
    if openings:
        log.info("  🔔 Sending alert: %d new show(s) available → %s",
                 len(openings), monitor.get("email_to"))
        email_cfg = _email_cfg()
        if monitor.get("email_to"):
            email_cfg["to"] = monitor["email_to"]

        ok = notifier.send_alert(email_cfg, monitor, openings)
        if ok:
            db.log_alert(mid, openings)
            log.info("  ✅ Alert sent to %s", email_cfg["to"])
        else:
            log.warning("  ⚠ Alert failed — check EMAIL_FROM / EMAIL_APP_PASSWORD")
    else:
        log.info("  No new availability — no alert sent")


def main() -> None:
    db.init_db()

    specific_id = os.environ.get("MONITOR_ID", "").strip()

    if specific_id:
        monitor = db.get_monitor(int(specific_id))
        if not monitor:
            log.error("Monitor #%s not found", specific_id)
            sys.exit(1)
        monitors = [monitor]
    else:
        monitors = db.get_monitors(active_only=True)

    if not monitors:
        log.info("No active monitors to check.")
        return

    log.info("Checking %d monitor(s)…", len(monitors))
    for m in monitors:
        try:
            run_check(m)
        except Exception as exc:
            log.exception("Unexpected error for monitor #%d: %s", m["id"], exc)

    log.info("Done.")


if __name__ == "__main__":
    main()
