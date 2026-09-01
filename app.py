from __future__ import annotations

"""
app.py — Flask web application + APScheduler background monitor.

Run:
    python3 app.py
Then open http://localhost:5055 in your browser.
"""

import json
import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import yaml
from flask import Flask, jsonify, request, send_from_directory
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

import db
import notifier
import scraper
from state import compute_diff

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Flask app ─────────────────────────────────────────────────────────────────

BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
TMPL_DIR   = BASE_DIR / "templates"

app = Flask(__name__, static_folder=str(STATIC_DIR), template_folder=str(TMPL_DIR))
scheduler  = BackgroundScheduler(daemon=True)

# ── Config helpers ────────────────────────────────────────────────────────────

_CFG_PATH = BASE_DIR / "config.yaml"


def _is_cloud_mode() -> bool:
    """True when email credentials come from environment variables (cloud deployment)."""
    return bool(os.environ.get("EMAIL_FROM") and os.environ.get("EMAIL_APP_PASSWORD"))


def _load_email_cfg() -> dict:
    """Load email config. Env vars take priority over config.yaml (for cloud deployments)."""
    if _is_cloud_mode():
        return {
            "from":         os.environ["EMAIL_FROM"],
            "to":           os.environ.get("EMAIL_TO", os.environ["EMAIL_FROM"]),
            "app_password": os.environ["EMAIL_APP_PASSWORD"],
            "smtp_host":    os.environ.get("SMTP_HOST", "smtp.gmail.com"),
            "smtp_port":    int(os.environ.get("SMTP_PORT", 587)),
        }
    if not _CFG_PATH.exists():
        return {}
    try:
        return yaml.safe_load(_CFG_PATH.read_text(encoding="utf-8")).get("email", {}) or {}
    except Exception:
        return {}


def _save_email_cfg(data: dict) -> None:
    """Save email config to config.yaml (local only; on cloud, env vars are authoritative)."""
    if _is_cloud_mode():
        # On cloud, we can't override env vars — just store in yaml as a fallback record
        pass
    cfg: dict = {}
    if _CFG_PATH.exists():
        try:
            cfg = yaml.safe_load(_CFG_PATH.read_text(encoding="utf-8")) or {}
        except Exception:
            pass
    cfg["email"] = data
    try:
        _CFG_PATH.write_text(
            yaml.dump(cfg, default_flow_style=False, allow_unicode=True),
            encoding="utf-8",
        )
    except OSError:
        pass  # read-only filesystem on some cloud platforms — silently ignore


# ── URL cleaning ──────────────────────────────────────────────────────────────

_BMS_RE = re.compile(
    r"https?://(?:www\.)?in\.bookmyshow\.com/[^\s\"'<>\)\]]+",
    re.IGNORECASE,
)


def _extract_bms_url(text: str) -> str | None:
    text = text.strip()
    m = _BMS_RE.search(text)
    if not m:
        return None
    url = m.group(0).rstrip(".,;)")
    return url


def _parse_movie_info(url: str) -> tuple[str, str]:
    """Extract (name, city) from a BMS URL."""
    # /movies/<city>/<movie-slug>/CODE
    m = re.search(r"/movies/([^/?#]+)/([^/?#]+)/", url)
    if m:
        city = m.group(1).replace("-", " ").title()
        name = m.group(2).replace("-", " ").title()
        return name, city

    # /buytickets/<movie-slug>/CODE
    m = re.search(r"/buytickets/([^/?#]+)/", url)
    if m:
        name = m.group(1).replace("-", " ").title()
        return name, ""

    # /events/<slug>/CODE
    m = re.search(r"/events/([^/?#]+)/", url)
    if m:
        name = m.group(1).replace("-", " ").title()
        return name, ""

    return "", ""


# ── Monitoring job ────────────────────────────────────────────────────────────

def _run_check(monitor_id: int) -> None:
    """Called by the scheduler (runs in background thread)."""
    monitor = db.get_monitor(monitor_id)
    if not monitor or monitor["status"] != "active":
        logger.info("Monitor %d is not active — skipping", monitor_id)
        return

    logger.info("Checking monitor %d (%s) …", monitor_id, monitor["name"])
    now = datetime.now().isoformat(timespec="seconds")

    target = {
        "name": monitor["name"],
        "url":  monitor["url"],
        "city": monitor["city"],
    }

    result = scraper.scrape(target)

    if result.get("error"):
        logger.error("Scraper error for monitor %d: %s", monitor_id, result["error"])
        db.update_monitor(monitor_id, {
            "last_checked": now,
            "last_error":   result["error"],
        })
        return

    new_full_snapshot: dict = result["shows"]

    # Apply user-defined filters to both old and new snapshot before diffing
    flt = dict(
        filter_theatres  = monitor.get("filter_theatres") or [],
        filter_dates     = monitor.get("filter_dates") or [],
        filter_time_from = monitor.get("filter_time_from") or "",
        filter_time_to   = monitor.get("filter_time_to") or "",
    )

    old_filtered = scraper.apply_filters(monitor.get("snapshot") or {}, **flt)
    new_filtered  = scraper.apply_filters(new_full_snapshot, **flt)

    changes = compute_diff(old_filtered, new_filtered)

    db.update_monitor(monitor_id, {
        "last_checked": now,
        "last_error":   "",
        "snapshot":     new_full_snapshot,
    })

    if not changes:
        logger.info("Monitor %d — no changes", monitor_id)
        return

    logger.info("Monitor %d — %d change(s) detected", monitor_id, len(changes))

    email_cfg = _load_email_cfg()
    if not email_cfg.get("app_password") or not email_cfg.get("from"):
        logger.warning("Email not configured — skipping notification for monitor %d", monitor_id)
        db.save_alert(monitor_id, changes)   # still log the change
        return

    # Override destination with this monitor's email
    email_cfg_copy = dict(email_cfg)
    email_cfg_copy["to"] = monitor.get("email_to") or email_cfg.get("to", "")

    ok = notifier.send_alert(email_cfg_copy, monitor, changes, monitor.get("interval_minutes", 15))
    if ok:
        db.save_alert(monitor_id, changes)


def _schedule_monitor(monitor: dict) -> None:
    job_id = f"mon_{monitor['id']}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    if monitor["status"] != "active":
        return
    interval = max(5, monitor.get("interval_minutes", 15))
    scheduler.add_job(
        _run_check,
        trigger=IntervalTrigger(minutes=interval),
        args=[monitor["id"]],
        id=job_id,
        replace_existing=True,
        next_run_time=datetime.now(),  # run immediately on add
    )
    logger.info("Scheduled monitor %d every %d min", monitor["id"], interval)


def _unschedule_monitor(monitor_id: int) -> None:
    job_id = f"mon_{monitor_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)


# ── Routes — frontend ─────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(str(TMPL_DIR), "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(str(STATIC_DIR), filename)


# ── Routes — URL cleaning ─────────────────────────────────────────────────────

@app.route("/api/clean-url", methods=["POST"])
def api_clean_url():
    body = request.get_json(force=True, silent=True) or {}
    text = body.get("text", "")
    url  = _extract_bms_url(text)
    if not url:
        return jsonify(error="No BookMyShow URL found in the pasted text"), 400
    name, city = _parse_movie_info(url)
    return jsonify(url=url, name=name, city=city)


# ── Routes — monitors ─────────────────────────────────────────────────────────

@app.route("/api/monitors", methods=["GET"])
def api_list_monitors():
    monitors = db.get_monitors()
    # Add next_run info
    for m in monitors:
        job = scheduler.get_job(f"mon_{m['id']}")
        m["next_run"] = job.next_run_time.isoformat() if job and job.next_run_time else None
    return jsonify(monitors)


@app.route("/api/monitors", methods=["POST"])
def api_create_monitor():
    body = request.get_json(force=True, silent=True) or {}

    url = body.get("url", "").strip()
    if not url:
        return jsonify(error="url is required"), 400

    # Auto-clean if full share text was pasted
    cleaned = _extract_bms_url(url)
    if cleaned:
        url = cleaned

    name, city = _parse_movie_info(url)
    name = body.get("name", name) or name
    city = body.get("city", city) or city

    if not body.get("email_to", "").strip():
        return jsonify(error="email_to is required"), 400

    monitor = db.create_monitor({
        "name":             name,
        "url":              url,
        "city":             city,
        "email_to":         body["email_to"].strip(),
        "filter_theatres":  body.get("filter_theatres") or [],
        "filter_dates":     body.get("filter_dates") or [],
        "filter_time_from": body.get("filter_time_from", ""),
        "filter_time_to":   body.get("filter_time_to", ""),
        "interval_minutes": int(body.get("interval_minutes", 15)),
    })
    _schedule_monitor(monitor)
    return jsonify(monitor), 201


@app.route("/api/monitors/<int:monitor_id>", methods=["GET"])
def api_get_monitor(monitor_id: int):
    m = db.get_monitor(monitor_id)
    if not m:
        return jsonify(error="Not found"), 404
    return jsonify(m)


@app.route("/api/monitors/<int:monitor_id>", methods=["PATCH"])
def api_update_monitor(monitor_id: int):
    m = db.get_monitor(monitor_id)
    if not m:
        return jsonify(error="Not found"), 404

    body    = request.get_json(force=True, silent=True) or {}
    updated = db.update_monitor(monitor_id, body)
    _schedule_monitor(updated)
    return jsonify(updated)


@app.route("/api/monitors/<int:monitor_id>", methods=["DELETE"])
def api_delete_monitor(monitor_id: int):
    _unschedule_monitor(monitor_id)
    db.delete_monitor(monitor_id)
    return jsonify(ok=True)


@app.route("/api/monitors/<int:monitor_id>/pause", methods=["POST"])
def api_pause_monitor(monitor_id: int):
    m = db.get_monitor(monitor_id)
    if not m:
        return jsonify(error="Not found"), 404
    new_status = "active" if m["status"] == "paused" else "paused"
    updated = db.update_monitor(monitor_id, {"status": new_status})
    _schedule_monitor(updated)
    return jsonify(updated)


@app.route("/api/monitors/<int:monitor_id>/check", methods=["POST"])
def api_check_now(monitor_id: int):
    m = db.get_monitor(monitor_id)
    if not m:
        return jsonify(error="Not found"), 404
    # Run in a background thread so the HTTP response returns immediately
    import threading
    t = threading.Thread(target=_run_check, args=(monitor_id,), daemon=True)
    t.start()
    return jsonify(ok=True, message="Check triggered — results will arrive shortly")


@app.route("/api/monitors/<int:monitor_id>/alerts", methods=["GET"])
def api_alerts(monitor_id: int):
    limit = min(int(request.args.get("limit", 30)), 100)
    return jsonify(db.get_alert_log(monitor_id, limit=limit))


# ── Routes — email config ─────────────────────────────────────────────────────

@app.route("/api/email-config", methods=["GET"])
def api_get_email_config():
    cfg = _load_email_cfg()
    safe = {
        "from":          cfg.get("from", ""),
        "to":            cfg.get("to", ""),
        "configured":    bool(cfg.get("app_password") and cfg.get("from")),
        "cloud_managed": _is_cloud_mode(),
        "smtp_host":     cfg.get("smtp_host", "smtp.gmail.com"),
        "smtp_port":     cfg.get("smtp_port", 587),
    }
    return jsonify(safe)


@app.route("/api/email-config", methods=["POST"])
def api_save_email_config():
    body = request.get_json(force=True, silent=True) or {}
    _save_email_cfg({
        "from":         body.get("from", ""),
        "to":           body.get("to", ""),
        "app_password": body.get("app_password", ""),
        "smtp_host":    body.get("smtp_host", "smtp.gmail.com"),
        "smtp_port":    int(body.get("smtp_port", 587)),
    })
    return jsonify(ok=True)


@app.route("/api/email-config/test", methods=["POST"])
def api_test_email():
    body      = request.get_json(force=True, silent=True) or {}
    # On cloud mode, use the env-var credentials (ignore body creds for security)
    if _is_cloud_mode():
        email_cfg = _load_email_cfg()
        email_cfg["to"] = body.get("to") or email_cfg["to"]
    else:
        email_cfg = {
            "from":         body.get("from", ""),
            "to":           body.get("to", ""),
            "app_password": body.get("app_password", ""),
            "smtp_host":    body.get("smtp_host", "smtp.gmail.com"),
            "smtp_port":    int(body.get("smtp_port", 587)),
        }

    fake_monitor = {"name": "Test Movie", "city": "Secunderabad",
                    "url": "https://in.bookmyshow.com/"}
    fake_changes = [
        {"date": "Fri, 01 Sep", "theatre": "Test Theatre", "showtime": "06:30 PM",
         "old_status": "sold-out", "new_status": "available", "change": "🟢 Tickets opened up!"},
    ]

    ok = notifier.send_alert(email_cfg, fake_monitor, fake_changes)
    if ok:
        return jsonify(ok=True, message="Test email sent!")
    return jsonify(ok=False, message="Failed to send — check your credentials"), 500


# ── Startup ───────────────────────────────────────────────────────────────────

def _startup() -> None:
    db.init_db()
    scheduler.start()
    # Re-schedule all active monitors from the database
    for m in db.get_monitors(active_only=True):
        job_id   = f"mon_{m['id']}"
        interval = max(5, m.get("interval_minutes", 15))
        scheduler.add_job(
            _run_check,
            trigger=IntervalTrigger(minutes=interval),
            args=[m["id"]],
            id=job_id,
            replace_existing=True,
        )
        logger.info("Restored monitor %d (%s) — every %d min", m["id"], m["name"], interval)
    port = int(os.environ.get("PORT", 5055))
    logger.info("BMS Monitor web app ready at http://localhost:%d", port)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    _startup()
    port = int(os.environ.get("PORT", 5055))
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)

