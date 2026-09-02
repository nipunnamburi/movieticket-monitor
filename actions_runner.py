from __future__ import annotations

"""
actions_runner.py — GitHub Actions entry point.

Reads all active monitors from Neon Postgres, scrapes BookMyShow via
Playwright, diffs against the previous snapshot, and sends Gmail alerts.
Triggered by the GitHub Actions cron schedule or workflow_dispatch.

Environment variables (set as GitHub Secrets):
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
        # scraper.scrape() returns {"shows": {date: {theatre: {time: status}}},
        #                           "name": str, "url": str, "city": str, "error": str|None}
        scrape_result = scraper.scrape(monitor)
    except Exception as exc:
        log.error("Scrape failed for #%d: %s", mid, exc)
        db.update_monitor(mid, {
            "last_error":   str(exc)[:400],
            "last_checked": _now(),
            "status":       "error",
        })
        return

    # ── Check for scrape-level errors ────────────────────────────────────────
    if scrape_result.get("error"):
        log.warning("Scrape error for #%d: %s", mid, scrape_result["error"])
        db.update_monitor(mid, {
            "last_error":   scrape_result["error"][:400],
            "last_checked": _now(),
            "status":       "error",
        })
        return

    # ── Extract the shows dict (date → theatre → time → status) ─────────────
    # IMPORTANT: scrape_result["shows"] is the actual snapshot, not the full result dict
    new_shows = scrape_result.get("shows") or {}
    log.info("  Scrape returned %d date bucket(s)", len(new_shows))

    if not new_shows:
        log.warning("  Scraper returned empty shows — page may have changed structure")
        log.warning("  Saving empty snapshot and continuing (no alert sent)")
        db.update_monitor(mid, {
            "last_checked": _now(),
            "last_error":   "Scraper returned no shows — check GitHub Actions logs for selector debug info",
            "status":       "error",
        })
        return

    # ── Apply filters ────────────────────────────────────────────────────────
    new_filtered = scraper.apply_filters(
        new_shows,                                       # ← shows dict, NOT full result
        filter_theatres  = monitor.get("filter_theatres") or [],
        filter_dates     = monitor.get("filter_dates") or [],
        filter_time_from = monitor.get("filter_time_from") or "",
        filter_time_to   = monitor.get("filter_time_to") or "",
    )

    # old snapshot stored in DB is already the shows dict
    old_shows = monitor.get("snapshot") or {}
    old_filtered = scraper.apply_filters(
        old_shows,
        filter_theatres  = monitor.get("filter_theatres") or [],
        filter_dates     = monitor.get("filter_dates") or [],
        filter_time_from = monitor.get("filter_time_from") or "",
        filter_time_to   = monitor.get("filter_time_to") or "",
    )

    # ── Diff ─────────────────────────────────────────────────────────────────
    changes = state.compute_diff(old_filtered, new_filtered)

    # ── Initial Alert Override ───────────────────────────────────────────────
    # If no alert has ever been sent for this monitor (or filters were recently updated),
    # and matching shows exist, report current availability immediately rather than staying silent.
    if not changes and not monitor.get("last_alert"):
        log.info("  First alert for monitor #%d — generating current status report", mid)
        for date_label, theatres in new_filtered.items():
            if date_label == "_page_hash" or not isinstance(theatres, dict):
                continue
            for theatre, times in theatres.items():
                if isinstance(times, dict):
                    for showtime, status in times.items():
                        changes.append({
                            "date": date_label,
                            "theatre": theatre,
                            "showtime": showtime,
                            "old_status": "initial scan",
                            "new_status": status,
                            "change": f"🟢 Currently {status.replace('-', ' ').title()}",
                        })

    log.info("  Diff: %d change(s) detected", len(changes))

    # ── Persist snapshot (store only the shows dict, not the full result) ─────
    db.update_monitor(mid, {
        "snapshot":     new_shows,          # ← shows dict only
        "last_checked": _now(),
        "last_error":   None,
        "status":       "active",
    })

    # ── Alert ────────────────────────────────────────────────────────────────
    if changes:
        log.info("  Sending alert for %d change(s) to %s",
                 len(changes), monitor.get("email_to"))
        email_cfg = _email_cfg()
        if monitor.get("email_to"):
            email_cfg["to"] = monitor["email_to"]

        ok = notifier.send_alert(email_cfg, monitor, changes)
        if ok:
            db.log_alert(mid, changes)
            log.info("  ✅ Alert sent to %s", email_cfg["to"])
        else:
            log.warning("  ⚠ Alert failed to send — check EMAIL_FROM / EMAIL_APP_PASSWORD")
    else:
        log.info("  No changes since last check")


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
