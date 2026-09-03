"""
notifier.py — Gmail SMTP alert sender (updated for date-keyed snapshots).

Standalone test:
    python3 notifier.py --test
"""

import argparse
import logging
import smtplib
import ssl
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Email template ────────────────────────────────────────────────────────────

_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;margin:0;padding:20px;color:#18181b}}
  .card{{background:#fff;border-radius:14px;max-width:620px;margin:0 auto;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)}}
  .hdr{{background:#e50914;padding:22px 28px}}
  .hdr h1{{color:#fff;margin:0;font-size:20px;font-weight:700}}
  .hdr p{{color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px}}
  .body{{padding:24px 28px}}
  .meta{{background:#fafafa;border-radius:8px;padding:12px 16px;font-size:13px;color:#52525b;margin-bottom:20px;border:1px solid #e4e4e7}}
  .meta strong{{color:#18181b}}
  table{{width:100%;border-collapse:collapse;font-size:13px;margin-top:4px}}
  th{{background:#f4f4f5;text-align:left;padding:9px 12px;font-weight:600;color:#52525b;border-bottom:2px solid #e4e4e7;font-size:12px;text-transform:uppercase;letter-spacing:.5px}}
  td{{padding:10px 12px;border-bottom:1px solid #f4f4f5;vertical-align:middle}}
  .badge{{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600}}
  .b-new{{background:#eff6ff;color:#1d4ed8}}
  .b-open{{background:#f0fdf4;color:#15803d}}
  .b-fast{{background:#fffbeb;color:#b45309}}
  .b-sold{{background:#fef2f2;color:#b91c1c}}
  .b-info{{background:#f4f4f5;color:#52525b}}
  .cta{{margin:24px 0 4px;text-align:center}}
  .cta a{{display:inline-block;background:#e50914;color:#fff;text-decoration:none;padding:13px 32px;border-radius:8px;font-weight:700;font-size:15px}}
  .ft{{background:#f4f4f5;padding:14px 28px;text-align:center;font-size:12px;color:#a1a1aa}}
  .filters{{font-size:12px;color:#71717a;margin-top:8px}}
  .filters span{{background:#e4e4e7;border-radius:4px;padding:2px 7px;margin-right:4px}}
</style>
</head>
<body>
<div class="card">
  <div class="hdr">
    <h1>🔔 New Show Available — Book Now!</h1>
    <p>BookMyShow Monitor · {timestamp}</p>
  </div>
  <div class="body">
    <div class="meta">
      <strong>{name}</strong> &mdash; {city}<br>
      <span>{change_count} change(s) detected</span>
      {filters_html}
    </div>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Theatre</th>
          <th>Show</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows}
      </tbody>
    </table>
    <div class="cta">
      <a href="{url}">Book Tickets on BookMyShow &rarr;</a>
    </div>
  </div>
  <div class="ft">Monitoring every {interval} min · BMS Monitor</div>
</div>
</body>
</html>
"""

_ROW = (
    "<tr>"
    "<td>{date}</td>"
    "<td>{theatre}</td>"
    "<td>{showtime}</td>"
    "<td><span class='badge {badge}'>{change}</span></td>"
    "</tr>"
)


def _badge(change: str) -> str:
    c = change.lower()
    if "🆕" in change or "new" in c:     return "b-new"
    if "🟢" in change or "open" in c:    return "b-open"
    if "🟡" in change or "fast" in c:    return "b-fast"
    if "🔴" in change or "sold" in c:    return "b-sold"
    return "b-info"


def _build_filters_html(monitor: dict) -> str:
    parts = []
    if monitor.get("filter_theatres"):
        parts.append("🏢 " + ", ".join(monitor["filter_theatres"]))
    if monitor.get("filter_dates"):
        parts.append("📅 " + ", ".join(monitor["filter_dates"]))
    if monitor.get("filter_time_from") or monitor.get("filter_time_to"):
        tf = monitor.get("filter_time_from", "any")
        tt = monitor.get("filter_time_to", "any")
        parts.append(f"⏰ {tf} – {tt}")
    if not parts:
        return ""
    spans = "".join(f"<span>{p}</span>" for p in parts)
    return f'<div class="filters">Filters active: {spans}</div>'


def _build_html(monitor: dict, changes: list[dict], interval: int) -> str:
    rows = "\n".join(
        _ROW.format(
            date=c.get("date", "—"),
            theatre=c["theatre"],
            showtime=c["showtime"],
            change=c["change"],
            badge=_badge(c["change"]),
        )
        for c in changes
    )
    return _HTML.format(
        timestamp=datetime.now().strftime("%d %b %Y, %I:%M %p"),
        name=monitor.get("name", "Unknown"),
        city=monitor.get("city", ""),
        url=monitor.get("url", "#"),
        change_count=len(changes),
        rows=rows,
        interval=interval,
        filters_html=_build_filters_html(monitor),
    )


def _build_plain(monitor: dict, changes: list[dict]) -> str:
    lines = [
        f"BookMyShow Alert — {monitor.get('name', '')} ({monitor.get('city', '')})",
        f"Time: {datetime.now().strftime('%d %b %Y, %I:%M %p')}",
        f"Changes: {len(changes)}",
        "",
    ]
    for c in changes:
        lines.append(f"  • [{c.get('date','—')}] {c['theatre']} | {c['showtime']} — {c['change']}")
    lines += ["", f"Book now: {monitor.get('url', '')}"]
    return "\n".join(lines)


# ── Sender ────────────────────────────────────────────────────────────────────

def send_alert(
    email_cfg: dict[str, Any],
    monitor: dict[str, Any],
    changes: list[dict[str, str]],
    interval: int = 15,
) -> bool:
    from_addr    = email_cfg["from"]
    to_addr      = email_cfg["to"]
    app_password = email_cfg["app_password"]
    smtp_host    = email_cfg.get("smtp_host", "smtp.gmail.com")
    smtp_port    = int(email_cfg.get("smtp_port", 587))

    subject = (
        f"🔔 BMS: {monitor.get('name','?')} — "
        f"{len(changes)} new show(s) available — Book now!"
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"BMS Monitor <{from_addr}>"
    msg["To"]      = to_addr

    msg.attach(MIMEText(_build_plain(monitor, changes), "plain", "utf-8"))
    msg.attach(MIMEText(_build_html(monitor, changes, interval), "html", "utf-8"))

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as srv:
            srv.ehlo()
            srv.starttls(context=ctx)
            srv.login(from_addr, app_password)
            srv.sendmail(from_addr, to_addr, msg.as_string())
        logger.info("Alert sent to %s", to_addr)
        return True
    except smtplib.SMTPAuthenticationError:
        logger.error("Gmail auth failed — use an App Password, not your regular password")
        return False
    except Exception as exc:
        logger.exception("Email send failed: %s", exc)
        return False


# ── CLI test ──────────────────────────────────────────────────────────────────

def _test() -> None:
    import yaml
    cfg_path = Path(__file__).parent / "config.yaml"
    if not cfg_path.exists():
        print("config.yaml not found"); return
    cfg = yaml.safe_load(cfg_path.read_text())
    email_cfg = cfg.get("email", {})
    monitor = {
        "name": "Test Movie",
        "city": "Hyderabad",
        "url": "https://in.bookmyshow.com/",
    }

    changes = [
        {"date": "Fri, 01 Sep", "theatre": "Miraj Cinemas Secunderabad", "showtime": "10:30 AM",
         "old_status": "sold-out", "new_status": "available", "change": "🟢 Tickets opened up!"},
        {"date": "Sat, 02 Sep", "theatre": "PVR: Forum Sujana Mall",    "showtime": "01:15 PM",
         "old_status": None,      "new_status": "available", "change": "🆕 New show added (available)"},
        {"date": "Fri, 01 Sep", "theatre": "INOX: GVK One",             "showtime": "07:00 PM",
         "old_status": "available","new_status":"fast-filling","change": "🟡 Now fast-filling"},
    ]

    print(f"Sending test email {email_cfg.get('from')} → {email_cfg.get('to')} …")
    ok = send_alert(email_cfg, monitor, changes, cfg.get("interval_minutes", 15))
    print("✅ Sent!" if ok else "❌ Failed — check config.yaml")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    args = ap.parse_args()
    if args.test:
        _test()
