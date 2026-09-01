"""
monitor.py — BookMyShow ticket availability monitor.

Usage:
    python3 monitor.py              # normal run (used by cron)
    python3 monitor.py --dry-run    # scrape and print snapshot, don't save or email
    python3 monitor.py --force-alert  # send alert even if nothing changed (for testing)
"""

import argparse
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

import yaml

from scraper import scrape
from state import compute_diff, load_state, save_state
from notifier import send_alert

# ── Logging ──────────────────────────────────────────────────────────────────
LOG_FORMAT = "%(asctime)s  %(levelname)-8s  %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def _setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format=LOG_FORMAT, datefmt=DATE_FORMAT)


# ── Config loading ────────────────────────────────────────────────────────────
def _load_config() -> dict:
    cfg_path = Path(__file__).parent / "config.yaml"
    if not cfg_path.exists():
        logging.critical("config.yaml not found at %s", cfg_path)
        sys.exit(1)
    with cfg_path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


# ── Main loop ─────────────────────────────────────────────────────────────────
def run(dry_run: bool = False, force_alert: bool = False, verbose: bool = False) -> None:
    _setup_logging(verbose)
    cfg = _load_config()

    targets     = cfg.get("targets", [])
    email_cfg   = cfg.get("email", {})
    state_file  = str(Path(__file__).parent / cfg.get("state_file", "state.json"))
    interval    = int(cfg.get("interval_minutes", 15))

    if not targets:
        logging.warning("No targets defined in config.yaml — nothing to do.")
        return

    # Load old state (keyed by target URL)
    old_state = load_state(state_file)
    new_state = dict(old_state)  # start from copy; update only processed targets

    run_time = datetime.now().isoformat(timespec="seconds")
    logging.info("=== BookMyShow Monitor run at %s ===", run_time)

    all_changes: dict[str, list] = {}

    for target in targets:
        url  = target["url"]
        name = target.get("name", url)
        logging.info("Checking: %s", name)

        snapshot = scrape(target)

        if snapshot.get("error"):
            logging.error("Scraper error for %s: %s", name, snapshot["error"])
            # Don't overwrite state on error — keep last good state
            continue

        current_shows = snapshot["shows"]
        logging.info("  Theatres/shows found: %d", len(current_shows))

        if dry_run:
            print(f"\n── Snapshot for {name} ──")
            print(json.dumps(current_shows, indent=2, ensure_ascii=False))
            continue

        # Diff against previous
        previous_shows = old_state.get(url, {})
        changes = compute_diff(previous_shows, current_shows)

        if changes:
            logging.info("  ✅ %d change(s) detected", len(changes))
            for c in changes:
                logging.info("     %s | %s — %s", c["theatre"], c["showtime"], c["change"])
            all_changes[url] = changes
        else:
            logging.info("  — No changes since last run")

        # Update state regardless of whether there were changes
        new_state[url] = current_shows

    if dry_run:
        logging.info("Dry-run complete — no state saved, no emails sent.")
        return

    # Persist updated state
    save_state(state_file, new_state)

    # Send email alerts
    if not all_changes and not force_alert:
        logging.info("Nothing changed — no email sent.")
        return

    if force_alert and not all_changes:
        # Build a fake change for testing
        logging.info("--force-alert: sending test email with no real changes")
        for target in targets:
            all_changes[target["url"]] = [{
                "theatre": "Test Theatre",
                "showtime": "Test Run",
                "old_status": "—",
                "new_status": "—",
                "change": "ℹ️ Force-alert test (no real changes)",
            }]

    for target in targets:
        url = target["url"]
        changes = all_changes.get(url)
        if not changes:
            continue
        ok = send_alert(email_cfg, target, changes, interval)
        if not ok:
            logging.error("Failed to send alert for %s", target.get("name", url))

    logging.info("=== Run complete ===")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="BookMyShow ticket availability monitor"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scrape and print snapshot without saving state or sending email",
    )
    parser.add_argument(
        "--force-alert",
        action="store_true",
        help="Send an alert email even if nothing changed (useful for testing email)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug logging",
    )
    args = parser.parse_args()
    run(dry_run=args.dry_run, force_alert=args.force_alert, verbose=args.verbose)
