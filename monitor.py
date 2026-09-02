from __future__ import annotations

"""
monitor.py — CLI entry point for BookMyShow ticket availability monitor.

Runs checks for active monitors stored in the database.

Usage:
    python3 monitor.py                    # check all active monitors
    python3 monitor.py --monitor-id 1      # check specific monitor ID
    python3 monitor.py --dry-run          # print results, don't save state or send email
    python3 monitor.py --force-alert      # send alert even if no changes detected
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone

import db
import notifier
import scraper
import state

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_FORMAT = "%(asctime)s  %(levelname)-8s  %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

def _setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format=LOG_FORMAT, datefmt=DATE_FORMAT)

def run(monitor_id: int | None = None, dry_run: bool = False, force_alert: bool = False, verbose: bool = False) -> None:
    _setup_logging(verbose)
    db.init_db()

    if monitor_id:
        m = db.get_monitor(monitor_id)
        if not m:
            logging.error("Monitor #%d not found", monitor_id)
            sys.exit(1)
        monitors = [m]
    else:
        monitors = db.get_monitors(active_only=True)

    if not monitors:
        logging.info("No active monitors to check.")
        return

    logging.info("=== BMS Monitor run at %s (%d monitor(s)) ===", datetime.now().isoformat(), len(monitors))

    for m in monitors:
        mid = m["id"]
        name = m.get("name", f"Monitor #{mid}")
        logging.info("Checking #%d — %s ...", mid, name)

        res = scraper.scrape(m)
        if res.get("error"):
            logging.error("Scraper error for #%d: %s", mid, res["error"])
            if not dry_run:
                db.update_monitor(mid, {
                    "last_checked": datetime.now(timezone.utc).isoformat(),
                    "last_error": res["error"],
                    "status": "error",
                })
            continue

        shows = res.get("shows") or {}
        logging.info("  Found %d date bucket(s)", len(shows))

        if dry_run:
            print(f"\n── Snapshot for {name} ──")
            print(json.dumps(shows, indent=2, ensure_ascii=False))
            continue

        flt = dict(
            filter_theatres  = m.get("filter_theatres") or [],
            filter_dates     = m.get("filter_dates") or [],
            filter_time_from = m.get("filter_time_from") or "",
            filter_time_to   = m.get("filter_time_to") or "",
        )

        old_shows = m.get("snapshot") or {}
        old_filtered = scraper.apply_filters(old_shows, **flt)
        new_filtered = scraper.apply_filters(shows, **flt)

        changes = state.compute_diff(old_filtered, new_filtered)
        logging.info("  Diff: %d change(s) detected", len(changes))

        db.update_monitor(mid, {
            "snapshot": shows,
            "last_checked": datetime.now(timezone.utc).isoformat(),
            "last_error": "",
            "status": "active",
        })

        if force_alert and not changes:
            logging.info("--force-alert set: sending test alert with sample changes")
            changes = [{
                "date": "Today",
                "theatre": "Test Theatre",
                "showtime": "Force Alert Test",
                "old_status": "—",
                "new_status": "—",
                "change": "ℹ️ Force alert test run",
            }]

        if changes:
            email_cfg = {
                "from": m.get("email_to") or "",
                "to": m.get("email_to") or "",
                "app_password": "",
                "smtp_host": "smtp.gmail.com",
                "smtp_port": 587,
            }
            # Load email config from app/env if available
            env_from = db.os.environ.get("EMAIL_FROM") if hasattr(db, "os") else None
            if env_from:
                import os
                email_cfg["from"] = os.environ.get("EMAIL_FROM", "")
                email_cfg["app_password"] = os.environ.get("EMAIL_APP_PASSWORD", "")
                email_cfg["smtp_host"] = os.environ.get("SMTP_HOST", "smtp.gmail.com")
                email_cfg["smtp_port"] = int(os.environ.get("SMTP_PORT", 587))
            
            if email_cfg.get("app_password") and email_cfg.get("from"):
                email_cfg["to"] = m.get("email_to") or email_cfg["from"]
                ok = notifier.send_alert(email_cfg, m, changes, m.get("interval_minutes", 15))
                if ok:
                    db.save_alert(mid, changes)
                    logging.info("  ✅ Alert sent to %s", email_cfg["to"])
                else:
                    logging.warning("  ⚠ Alert failed to send — check email configuration")
            else:
                db.save_alert(mid, changes)
                logging.info("  Saved alert log (email credentials not set in env)")

    logging.info("=== Run complete ===")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BookMyShow ticket availability monitor")
    parser.add_argument("--monitor-id", type=int, help="Check a specific monitor ID")
    parser.add_argument("--dry-run", action="store_true", help="Scrape and print snapshot without saving state or sending email")
    parser.add_argument("--force-alert", action="store_true", help="Send alert even if no changes detected")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose debug logging")
    args = parser.parse_args()

    run(monitor_id=args.monitor_id, dry_run=args.dry_run, force_alert=args.force_alert, verbose=args.verbose)
