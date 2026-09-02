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

import db_neon as db
import notifier
import scraper
import state

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


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
        new_snapshot = scraper.scrape(monitor)
    except Exception as exc:
        log.error("Scrape failed for #%d: %s", mid, exc)
        db.update_monitor(mid, {
            "last_error":   str(exc)[:400],
            "last_checked": "now",
        })
        return

    # ── Apply filters ────────────────────────────────────────────────────────
    new_filtered = scraper.apply_filters(
        new_snapshot,
        filter_theatres  = monitor.get("filter_theatres") or [],
        filter_dates     = monitor.get("filter_dates") or [],
        filter_time_from = monitor.get("filter_time_from") or "",
        filter_time_to   = monitor.get("filter_time_to") or "",
    )

    old_snapshot = monitor.get("snapshot") or {}
    old_filtered = scraper.apply_filters(
        old_snapshot,
        filter_theatres  = monitor.get("filter_theatres") or [],
        filter_dates     = monitor.get("filter_dates") or [],
        filter_time_from = monitor.get("filter_time_from") or "",
        filter_time_to   = monitor.get("filter_time_to") or "",
    )

    # ── Diff ─────────────────────────────────────────────────────────────────
    changes = state.compute_diff(old_filtered, new_filtered)

    # ── Persist snapshot ─────────────────────────────────────────────────────
    db.update_monitor(mid, {
        "snapshot":     new_snapshot,
        "last_checked": "now",
        "last_error":   None,
        "status":       "active",
    })

    # ── Alert ────────────────────────────────────────────────────────────────
    if changes:
        log.info("  → %d change(s) detected — sending alert", len(changes))
        email_cfg = _email_cfg()
        # Per-monitor email override
        if monitor.get("email_to"):
            email_cfg["to"] = monitor["email_to"]

        ok = notifier.send_alert(email_cfg, monitor, changes)
        if ok:
            db.log_alert(mid, changes)
            log.info("  ✅ Alert sent to %s", email_cfg["to"])
        else:
            log.warning("  ⚠ Alert failed to send")
    else:
        log.info("  → No changes")


def main() -> None:
    # Ensure DB schema exists (idempotent)
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
