from __future__ import annotations

"""
app.py — Unified Flask Web Application for BookMyShow Monitor.

Supports both:
  - Cloud / Serverless Deployment (Vercel, Railway, Render with Neon Postgres)
  - Self-Hosted / Local Deployment (SQLite + APScheduler)
"""

import json
import logging
import os
import re
import sys
import threading
from datetime import datetime
from pathlib import Path

import requests as http_req
import yaml
from flask import Flask, jsonify, render_template, request, send_from_directory

import db
import notifier
import state

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Flask App Setup ───────────────────────────────────────────────────────────

BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
TMPL_DIR   = BASE_DIR / "templates"

app = Flask(__name__, static_folder=str(STATIC_DIR), template_folder=str(TMPL_DIR))

# Background scheduler (only initialized when running in self-hosted persistent mode)
_scheduler = None
_CFG_PATH = BASE_DIR / "config.yaml"

def _is_cloud_mode() -> bool:
    """True if email credentials or serverless env indicators are present."""
    return bool(os.environ.get("VERCEL") or os.environ.get("EMAIL_FROM") or db.is_postgres())

def _load_email_cfg() -> dict:
    env_from = os.environ.get("EMAIL_FROM", "")
    env_pass = os.environ.get("EMAIL_APP_PASSWORD", "")
    env_to   = os.environ.get("EMAIL_TO", "")
    
    if env_from and env_pass:
        return {
            "from":         env_from,
            "to":           env_to or env_from,
            "app_password": env_pass,
            "smtp_host":    os.environ.get("SMTP_HOST", "smtp.gmail.com"),
            "smtp_port":    int(os.environ.get("SMTP_PORT", 587)),
            "configured":   True,
            "cloud_managed": True,
        }
        
    if _CFG_PATH.exists():
        try:
            cfg = yaml.safe_load(_CFG_PATH.read_text(encoding="utf-8")).get("email", {}) or {}
            if cfg.get("from") and cfg.get("app_password"):
                return {
                    "from":         cfg.get("from", ""),
                    "to":           cfg.get("to") or cfg.get("from", ""),
                    "app_password": cfg.get("app_password", ""),
                    "smtp_host":    cfg.get("smtp_host", "smtp.gmail.com"),
                    "smtp_port":    int(cfg.get("smtp_port", 587)),
                    "configured":   True,
                    "cloud_managed": False,
                }
        except Exception:
            pass

    return {
        "from": "", "to": "", "app_password": "",
        "smtp_host": "smtp.gmail.com", "smtp_port": 587,
        "configured": False, "cloud_managed": _is_cloud_mode(),
    }

def _save_email_cfg(data: dict) -> None:
    if _is_cloud_mode():
        return
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
        pass

# ── URL Extraction & Parsing ─────────────────────────────────────────────────

_BMS_RE = re.compile(
    r"https?://(?:www\.)?in\.bookmyshow\.com/[^\s\"'<>\)\]]+",
    re.IGNORECASE,
)

def _extract_bms_url(text: str) -> str | None:
    m = _BMS_RE.search(text.strip())
    if not m:
        return None
    return m.group(0).rstrip(".,;)")

def _parse_movie_info(url: str) -> tuple[str, str]:
    m = re.search(r"/movies/([^/?#]+)/([^/?#]+)/", url)
    if m:
        city = m.group(1).replace("-", " ").title()
        name = m.group(2).replace("-", " ").title()
        return name, city

    m = re.search(r"/buytickets/([^/?#]+)/", url)
    if m:
        return m.group(1).replace("-", " ").title(), ""

    m = re.search(r"/events/([^/?#]+)/", url)
    if m:
        return m.group(1).replace("-", " ").title(), ""

    return "", ""

# ── Check Triggering (GitHub Actions or Local Thread) ──────────────────────────

def _trigger_github_check(monitor_id: int | None = None) -> bool:
    token = os.environ.get("GITHUB_TOKEN", "")
    repo  = os.environ.get("GITHUB_REPO", "")
    if not token or not repo:
        return False
    url = f"https://api.github.com/repos/{repo}/actions/workflows/monitor.yml/dispatches"
    body = {"ref": "main", "inputs": {"monitor_id": str(monitor_id) if monitor_id else ""}}
    try:
        resp = http_req.post(
            url, json=body,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            timeout=10
        )
        return resp.status_code == 204
    except Exception as exc:
        logger.warning("Failed to trigger GitHub check: %s", exc)
        return False

def _run_local_check(monitor_id: int) -> None:
    import scraper
    m = db.get_monitor(monitor_id)
    if not m or m.get("status") != "active":
        return
    logger.info("Local check running for monitor #%d (%s)...", monitor_id, m.get("name"))
    now = datetime.now().isoformat(timespec="seconds")
    res = scraper.scrape(m)
    if res.get("error"):
        db.update_monitor(monitor_id, {"last_checked": now, "last_error": res["error"]})
        return
    shows = res.get("shows") or {}
    flt = dict(
        filter_theatres  = m.get("filter_theatres") or [],
        filter_dates     = m.get("filter_dates") or [],
        filter_time_from = m.get("filter_time_from") or "",
        filter_time_to   = m.get("filter_time_to") or "",
    )
    old_filtered = scraper.apply_filters(m.get("snapshot") or {}, **flt)
    new_filtered = scraper.apply_filters(shows, **flt)
    changes = state.compute_diff(old_filtered, new_filtered)
    
    db.update_monitor(monitor_id, {"last_checked": now, "last_error": "", "snapshot": shows})
    
    if changes:
        cfg = _load_email_cfg()
        if cfg.get("app_password") and cfg.get("from"):
            cfg["to"] = m.get("email_to") or cfg.get("to")
            if notifier.send_alert(cfg, m, changes, m.get("interval_minutes", 15)):
                db.save_alert(monitor_id, changes)
        else:
            db.save_alert(monitor_id, changes)

# ── Helper for Theatre Autocomplete ───────────────────────────────────────────

def _theatres_from_snapshot(snapshot: dict) -> list[str]:
    theatres: set[str] = set()
    if isinstance(snapshot, dict):
        for date_data in snapshot.values():
            if isinstance(date_data, dict):
                for k in date_data:
                    if k != "_page_hash":
                        theatres.add(k)
    return sorted(theatres)

# ── Routes — Frontend ─────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(str(STATIC_DIR), filename)

# ── Routes — API ──────────────────────────────────────────────────────────────

@app.route("/api/clean-url", methods=["POST"])
def api_clean_url():
    body = request.get_json(force=True, silent=True) or {}
    url = _extract_bms_url(body.get("text", ""))
    if not url:
        return jsonify(error="No BookMyShow URL found"), 400
    name, city = _parse_movie_info(url)
    return jsonify(url=url, name=name, city=city)

@app.route("/api/monitors", methods=["GET"])
def api_list_monitors():
    monitors = db.get_monitors()
    for m in monitors:
        if _scheduler and _scheduler.get_job(f"mon_{m['id']}"):
            job = _scheduler.get_job(f"mon_{m['id']}")
            m["next_run"] = job.next_run_time.isoformat() if job and job.next_run_time else None
        else:
            m["next_run"] = None
    return jsonify(monitors)

@app.route("/api/monitors/<int:mid>", methods=["GET"])
def api_get_monitor(mid: int):
    m = db.get_monitor(mid)
    if not m:
        return jsonify(error="Not found"), 404
    return jsonify(m)

@app.route("/api/monitors", methods=["POST"])
def api_create_monitor():
    body = request.get_json(force=True, silent=True) or {}
    url = body.get("url", "").strip()
    if not url:
        return jsonify(error="url is required"), 400
    cleaned = _extract_bms_url(url)
    if cleaned:
        url = cleaned
    parsed_name, parsed_city = _parse_movie_info(url)
    email_to = body.get("email_to", "").strip()
    if not email_to:
        return jsonify(error="email_to is required"), 400

    monitor = db.create_monitor({
        "name":             body.get("name") or parsed_name or url,
        "url":              url,
        "city":             body.get("city") or parsed_city,
        "email_to":         email_to,
        "filter_theatres":  body.get("filter_theatres") or [],
        "filter_dates":     body.get("filter_dates") or [],
        "filter_time_from": body.get("filter_time_from", ""),
        "filter_time_to":   body.get("filter_time_to", ""),
        "interval_minutes": int(body.get("interval_minutes", 15)),
    })
    
    # Trigger initial check (via GitHub Actions if configured, else background thread)
    if not _trigger_github_check(monitor["id"]):
        t = threading.Thread(target=_run_local_check, args=(monitor["id"],), daemon=True)
        t.start()
        
    return jsonify(monitor), 201

@app.route("/api/monitors/<int:mid>", methods=["PATCH"])
def api_update_monitor(mid: int):
    body = request.get_json(force=True, silent=True) or {}
    # If filters were updated, reset last_alert so next check sends a fresh status report
    if any(k in body for k in ("filter_theatres", "filter_dates", "filter_time_from", "filter_time_to")):
        body["last_alert"] = None
    updated = db.update_monitor(mid, body)
    if not updated:
        return jsonify(error="Not found"), 404
    # Trigger an immediate check via GitHub Actions / local runner
    if not _trigger_github_check(mid):
        t = threading.Thread(target=_run_local_check, args=(mid,), daemon=True)
        t.start()
    return jsonify(updated)

@app.route("/api/monitors/<int:mid>", methods=["DELETE"])
def api_delete_monitor(mid: int):
    ok = db.delete_monitor(mid)
    return jsonify(ok=ok) if ok else (jsonify(error="Not found"), 404)

@app.route("/api/monitors/<int:mid>/pause", methods=["POST"])
def api_pause_monitor(mid: int):
    updated = db.toggle_pause(mid)
    if not updated:
        return jsonify(error="Not found"), 404
    return jsonify(updated)

@app.route("/api/monitors/<int:mid>/check", methods=["POST"])
def api_check_now(mid: int):
    m = db.get_monitor(mid)
    if not m:
        return jsonify(error="Not found"), 404
    if _trigger_github_check(mid):
        return jsonify(ok=True, message="Check triggered via GitHub Actions (~30s)")
    t = threading.Thread(target=_run_local_check, args=(mid,), daemon=True)
    t.start()
    return jsonify(ok=True, message="Local check triggered — results will arrive shortly")

@app.route("/api/monitors/<int:mid>/alerts", methods=["GET"])
def api_alerts(mid: int):
    limit = min(int(request.args.get("limit", 30)), 100)
    return jsonify(db.get_alert_log(mid, limit=limit))

@app.route("/api/monitors/<int:mid>/theatres", methods=["GET"])
def api_monitor_theatres(mid: int):
    m = db.get_monitor(mid)
    if not m:
        return jsonify([])
    return jsonify(_theatres_from_snapshot(m.get("snapshot") or {}))

@app.route("/api/theatres", methods=["GET"])
def api_all_theatres():
    all_theatres: set[str] = set()
    for m in db.get_monitors():
        all_theatres.update(_theatres_from_snapshot(m.get("snapshot") or {}))
    return jsonify(sorted(all_theatres))

@app.route("/api/email-config", methods=["GET"])
def api_get_email_config():
    return jsonify(_load_email_cfg())

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
    body = request.get_json(force=True, silent=True) or {}
    cfg = _load_email_cfg()
    if not cfg["cloud_managed"]:
        cfg["from"] = body.get("from") or cfg["from"]
        cfg["app_password"] = body.get("app_password") or cfg["app_password"]
    cfg["to"] = body.get("to") or cfg.get("to") or cfg.get("from")

    fake_monitor = {"name": "Test Movie", "city": "Hyderabad", "url": "https://in.bookmyshow.com/"}
    fake_changes = [
        {"date": "Today", "theatre": "Test Theatre", "showtime": "06:30 PM",
         "old_status": "sold-out", "new_status": "available", "change": "🟢 Tickets opened up!"}
    ]
    ok = notifier.send_alert(cfg, fake_monitor, fake_changes)
    if ok:
        return jsonify(ok=True, message="Test email sent!")
    return jsonify(ok=False, message="Failed to send — check credentials"), 500

# ── DB Initialization on Startup ──────────────────────────────────────────────

def _init():
    try:
        db.init_db()
        logger.info("Database initialized")
    except Exception as exc:
        logger.warning("Database initialization deferred: %s", exc)

_init()

# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5055))
    app.run(host="0.0.0.0", port=port, debug=False)
