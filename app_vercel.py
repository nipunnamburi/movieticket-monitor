from __future__ import annotations

"""
app_vercel.py — Flask web app for Vercel deployment.

Differences from app.py (the self-hosted version):
  - No APScheduler (scraping runs in GitHub Actions)
  - Uses Neon Postgres via db_neon.py instead of SQLite
  - "Check Now" triggers a GitHub Actions workflow_dispatch via REST API
  - Email config comes from Vercel environment variables

Environment variables to set in Vercel dashboard:
  DATABASE_URL          — Neon connection string (postgresql://...)
  GITHUB_TOKEN          — Personal Access Token (repo + workflow scope)
  GITHUB_REPO           — e.g. "yourname/bms-monitor"
  EMAIL_FROM            — Gmail address (used only for /api/email-config GET)
  EMAIL_APP_PASSWORD    — Gmail App Password
  EMAIL_TO              — Default alert recipient
"""

import logging
import os
import re
from pathlib import Path

import requests as http_req
from flask import Flask, jsonify, render_template, request

import db_neon as db

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Flask ─────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
app = Flask(__name__,
            static_folder=str(BASE_DIR / "static"),
            template_folder=str(BASE_DIR / "templates"))

# ── URL cleaning ──────────────────────────────────────────────────────────────
_BMS_RE = re.compile(
    r"https?://(?:www\.)?in\.bookmyshow\.com/[^\s\"'<>\)\]]+",
    re.IGNORECASE,
)

def _strip_trailing(url: str) -> str:
    return url.rstrip(".,;)")

def _extract_bms_url(text: str) -> str | None:
    m = _BMS_RE.search(text)
    return _strip_trailing(m.group(0)) if m else None

def _parse_url(url: str) -> dict:
    """Extract name and city from a BMS movie URL."""
    # e.g. /movies/secunderabad/bethlehem-kudumba-unit/ET00502829
    m = re.search(r"/movies/([^/]+)/([^/]+)/", url)
    if not m:
        return {"url": url, "name": "", "city": ""}
    city = m.group(1).replace("-", " ").title()
    name = m.group(2).replace("-", " ").title()
    return {"url": url, "name": name, "city": city}

# ── Email config helpers ──────────────────────────────────────────────────────

def _load_email_cfg() -> dict:
    env_from = os.environ.get("EMAIL_FROM", "")
    env_pass = os.environ.get("EMAIL_APP_PASSWORD", "")
    env_to   = os.environ.get("EMAIL_TO", "")
    return {
        "from":         env_from,
        "to":           env_to or env_from,
        "app_password": env_pass,
        "smtp_host":    os.environ.get("SMTP_HOST", "smtp.gmail.com"),
        "smtp_port":    int(os.environ.get("SMTP_PORT", 587)),
        "configured":   bool(env_from and env_pass),
        "cloud_managed": True,   # always env-var driven on Vercel
    }

# ── GitHub Actions dispatch ("Check Now") ────────────────────────────────────

def _trigger_github_check(monitor_id: int | None = None) -> bool:
    """Trigger the GitHub Actions workflow via REST API."""
    token = os.environ.get("GITHUB_TOKEN", "")
    repo  = os.environ.get("GITHUB_REPO", "")   # "owner/repo"
    if not token or not repo:
        logger.warning("GITHUB_TOKEN or GITHUB_REPO not set — Check Now unavailable")
        return False

    url  = f"https://api.github.com/repos/{repo}/actions/workflows/monitor.yml/dispatches"
    body = {
        "ref": "main",
        "inputs": {"monitor_id": str(monitor_id) if monitor_id else ""},
    }
    resp = http_req.post(url, json=body,
                         headers={"Authorization": f"Bearer {token}",
                                  "Accept": "application/vnd.github+json"},
                         timeout=10)
    return resp.status_code == 204

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/clean-url", methods=["POST"])
def api_clean_url():
    body = request.get_json(force=True, silent=True) or {}
    text = body.get("text", "")
    url  = _extract_bms_url(text)
    if not url:
        return jsonify(error="No BookMyShow URL found"), 400
    return jsonify(**_parse_url(url))


@app.route("/api/monitors", methods=["GET"])
def api_list_monitors():
    monitors = db.get_monitors()
    # Add a placeholder next_run (GitHub Actions controls the real schedule)
    for m in monitors:
        m["next_run"] = None   # unknown — shown as "via GitHub Actions"
    return jsonify(monitors)


@app.route("/api/monitors/<int:mid>", methods=["GET"])
def api_get_monitor(mid):
    m = db.get_monitor(mid)
    if not m:
        return jsonify(error="Not found"), 404
    return jsonify(m)


@app.route("/api/monitors", methods=["POST"])
def api_create_monitor():
    body = request.get_json(force=True, silent=True) or {}

    url = body.get("url", "").strip()
    if not url:
        return jsonify(error="URL is required"), 400

    parsed = _parse_url(url)
    monitor = db.create_monitor({
        "url":              url,
        "name":             body.get("name") or parsed["name"] or url,
        "city":             body.get("city") or parsed["city"],
        "email_to":         body.get("email_to", ""),
        "filter_theatres":  body.get("filter_theatres", []),
        "filter_dates":     body.get("filter_dates", []),
        "filter_time_from": body.get("filter_time_from", ""),
        "filter_time_to":   body.get("filter_time_to", ""),
        "interval_minutes": int(body.get("interval_minutes", 30)),
    })
    # Trigger an immediate check via GitHub Actions
    _trigger_github_check(monitor["id"])
    return jsonify(monitor), 201


@app.route("/api/monitors/<int:mid>", methods=["PATCH"])
def api_update_monitor(mid):
    body = request.get_json(force=True, silent=True) or {}
    updated = db.update_monitor(mid, body)
    if not updated:
        return jsonify(error="Not found"), 404
    return jsonify(updated)


@app.route("/api/monitors/<int:mid>", methods=["DELETE"])
def api_delete_monitor(mid):
    ok = db.delete_monitor(mid)
    return jsonify(ok=ok) if ok else (jsonify(error="Not found"), 404)


def _theatres_from_snapshot(snapshot: dict) -> list[str]:
    """Extract unique theatre names from a date-keyed snapshot dict."""
    theatres: set[str] = set()
    for date_data in snapshot.values():
        if isinstance(date_data, dict):
            for key in date_data:
                if key != "_page_hash":
                    theatres.add(key)
    return sorted(theatres)


@app.route("/api/monitors/<int:mid>/theatres")
def api_monitor_theatres(mid):
    """Return theatre names known for a specific monitor (from its last snapshot)."""
    m = db.get_monitor(mid)
    if not m:
        return jsonify([])
    return jsonify(_theatres_from_snapshot(m.get("snapshot") or {}))


@app.route("/api/theatres")
def api_all_theatres():
    """Return all theatre names seen across every monitor's snapshot.
    Used for autocomplete in the Add Monitor form before a monitor is created."""
    all_theatres: set[str] = set()
    for m in db.get_monitors():
        all_theatres.update(_theatres_from_snapshot(m.get("snapshot") or {}))
    return jsonify(sorted(all_theatres))


@app.route("/api/monitors/<int:mid>/pause", methods=["POST"])
def api_pause_monitor(mid):
    m = db.toggle_pause(mid)
    if not m:
        return jsonify(error="Not found"), 404
    return jsonify(m)


@app.route("/api/monitors/<int:mid>/check", methods=["POST"])
def api_check_now(mid):
    m = db.get_monitor(mid)
    if not m:
        return jsonify(error="Not found"), 404
    ok = _trigger_github_check(mid)
    if ok:
        return jsonify(ok=True, message="Check triggered via GitHub Actions (~30s)")
    return jsonify(ok=False,
                   message="Could not trigger — set GITHUB_TOKEN and GITHUB_REPO in Vercel"), 202


@app.route("/api/monitors/<int:mid>/alerts")
def api_alerts(mid):
    limit = min(int(request.args.get("limit", 30)), 100)
    return jsonify(db.get_alert_log(mid, limit=limit))


@app.route("/api/email-config", methods=["GET"])
def api_get_email_config():
    return jsonify(_load_email_cfg())


@app.route("/api/email-config", methods=["POST"])
def api_save_email_config():
    # On Vercel, credentials are set via dashboard env vars — can't save them from the UI.
    return jsonify(ok=True, message="Update EMAIL_FROM, EMAIL_APP_PASSWORD, EMAIL_TO in your Vercel dashboard.")


@app.route("/api/email-config/test", methods=["POST"])
def api_test_email():
    # Trigger a GitHub Actions dispatch which will attempt to send a test email
    ok = _trigger_github_check(monitor_id=None)
    if ok:
        return jsonify(ok=True, message="Test check triggered — you'll get an email if anything changed.")
    # Fallback: try sending via notifier directly (if creds available)
    try:
        import notifier
        email_cfg = _load_email_cfg()
        fake_monitor = {"name": "Test Movie", "city": "Secunderabad", "url": "https://in.bookmyshow.com/"}
        fake_changes = [{"date": "Today", "theatre": "Test Theatre", "showtime": "06:30 PM",
                         "old_status": "sold-out", "new_status": "available",
                         "change": "🟢 Tickets opened up!"}]
        sent = notifier.send_alert(email_cfg, fake_monitor, fake_changes)
        if sent:
            return jsonify(ok=True, message="Test email sent!")
    except Exception:
        pass
    return jsonify(ok=False, message="Set GITHUB_TOKEN + GITHUB_REPO, or check Vercel env vars"), 500


# ── DB initialisation on cold start ──────────────────────────────────────────

def _init():
    try:
        db.init_db()
        logger.info("Neon DB initialised")
    except Exception as e:
        logger.warning("DB init skipped (DATABASE_URL not set?): %s", e)


_init()

# ── Vercel handler ────────────────────────────────────────────────────────────
# Vercel calls the Flask `app` object directly — no app.run() needed.

if __name__ == "__main__":
    # Local dev fallback
    port = int(os.environ.get("PORT", 5055))
    app.run(host="0.0.0.0", port=port, debug=True)
