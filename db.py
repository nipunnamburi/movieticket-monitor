from __future__ import annotations

"""
db.py — Unified database layer for BMS Monitor.

Supports:
  - Neon Postgres (when DATABASE_URL environment variable is set)
  - SQLite fallback (when DATABASE_URL is not set)
"""

import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

logger = logging.getLogger(__name__)

# Check if PostgreSQL URL is provided
_DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

def is_postgres() -> bool:
    return bool(_DATABASE_URL and (_DATABASE_URL.startswith("postgresql://") or _DATABASE_URL.startswith("postgres://")))

DB_PATH = Path(
    os.environ.get("DATABASE_PATH", str(Path(__file__).parent / "monitors.db"))
)

# ── Connection Management ──────────────────────────────────────────────────────

@contextmanager
def _get_connection() -> Generator[Any, None, None]:
    if is_postgres():
        import psycopg2
        import psycopg2.extras
        con = psycopg2.connect(_DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()
    else:
        con = sqlite3.connect(str(DB_PATH))
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()

# ── Schema Initialization ──────────────────────────────────────────────────────

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS monitors (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT    NOT NULL DEFAULT '',
    url               TEXT    NOT NULL,
    city              TEXT    NOT NULL DEFAULT '',
    email_to          TEXT    NOT NULL DEFAULT '',
    filter_theatres   TEXT    NOT NULL DEFAULT '[]',
    filter_dates      TEXT    NOT NULL DEFAULT '[]',
    filter_time_from  TEXT    NOT NULL DEFAULT '',
    filter_time_to    TEXT    NOT NULL DEFAULT '',
    status            TEXT    NOT NULL DEFAULT 'active',
    interval_minutes  INTEGER NOT NULL DEFAULT 15,
    last_checked      TEXT    DEFAULT NULL,
    last_error        TEXT    DEFAULT NULL,
    last_alert        TEXT    DEFAULT NULL,
    snapshot          TEXT    NOT NULL DEFAULT '{}',
    alert_count       INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id  INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
    changes     TEXT    NOT NULL DEFAULT '[]',
    sent_at     TEXT    NOT NULL
);
"""

_POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS monitors (
    id               SERIAL PRIMARY KEY,
    name             TEXT    NOT NULL DEFAULT '',
    url              TEXT    NOT NULL,
    city             TEXT    NOT NULL DEFAULT '',
    email_to         TEXT    NOT NULL DEFAULT '',
    filter_theatres  JSONB   NOT NULL DEFAULT '[]',
    filter_dates     JSONB   NOT NULL DEFAULT '[]',
    filter_time_from TEXT    NOT NULL DEFAULT '',
    filter_time_to   TEXT    NOT NULL DEFAULT '',
    status           TEXT    NOT NULL DEFAULT 'active',
    interval_minutes INTEGER NOT NULL DEFAULT 15,
    last_checked     TIMESTAMPTZ,
    last_error       TEXT,
    last_alert       TIMESTAMPTZ,
    snapshot         JSONB   NOT NULL DEFAULT '{}',
    alert_count      INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_log (
    id         SERIAL PRIMARY KEY,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    changes    JSONB   NOT NULL DEFAULT '[]',
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

def init_db() -> None:
    with _get_connection() as con:
        cur = con.cursor()
        if is_postgres():
            cur.execute(_POSTGRES_SCHEMA)
        else:
            cur.executescript(_SQLITE_SCHEMA)

# ── Deserialisation Helpers ────────────────────────────────────────────────────

_JSON_FIELDS = {"filter_theatres", "filter_dates", "snapshot"}

def _row_to_dict(row: Any) -> dict:
    if row is None:
        return {}
    d = dict(row)
    for field in _JSON_FIELDS:
        if field in d:
            if isinstance(d[field], str):
                try:
                    d[field] = json.loads(d[field])
                except (ValueError, TypeError):
                    d[field] = {} if field == "snapshot" else []
            elif d[field] is None:
                d[field] = {} if field == "snapshot" else []
    for field in ("last_checked", "last_alert", "created_at"):
        if field in d and d[field] is not None and not isinstance(d[field], str):
            d[field] = d[field].isoformat()
    return d

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ── CRUD Operations ────────────────────────────────────────────────────────────

def get_monitors(active_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM monitors"
    if active_only:
        sql += " WHERE status = 'active'"
    sql += " ORDER BY created_at DESC"
    
    with _get_connection() as con:
        cur = con.cursor()
        cur.execute(sql)
        rows = cur.fetchall()
        return [_row_to_dict(r) for r in rows]

def get_monitor(monitor_id: int) -> dict | None:
    placeholder = "%s" if is_postgres() else "?"
    sql = f"SELECT * FROM monitors WHERE id = {placeholder}"
    with _get_connection() as con:
        cur = con.cursor()
        cur.execute(sql, (monitor_id,))
        row = cur.fetchone()
        return _row_to_dict(row) if row else None

def create_monitor(data: dict) -> dict:
    now = _now_iso()
    fields = (
        "name", "url", "city", "email_to",
        "filter_theatres", "filter_dates",
        "filter_time_from", "filter_time_to",
        "interval_minutes",
    )
    
    if is_postgres():
        vals = []
        for f in fields:
            v = data.get(f, [] if f.startswith("filter_") and f not in ("filter_time_from", "filter_time_to") else "")
            if isinstance(v, (list, dict)):
                v = json.dumps(v)
            vals.append(v)
        sql = f"""
            INSERT INTO monitors ({', '.join(fields)})
            VALUES ({', '.join(['%s']*len(fields))})
            RETURNING *
        """
        with _get_connection() as con:
            cur = con.cursor()
            cur.execute(sql, vals)
            return _row_to_dict(cur.fetchone())
    else:
        with _get_connection() as con:
            cur = con.cursor()
            cur.execute(
                """INSERT INTO monitors
                   (name, url, city, email_to,
                    filter_theatres, filter_dates, filter_time_from, filter_time_to,
                    interval_minutes, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    data.get("name", ""),
                    data["url"],
                    data.get("city", ""),
                    data.get("email_to", ""),
                    json.dumps(data.get("filter_theatres") or []),
                    json.dumps(data.get("filter_dates") or []),
                    data.get("filter_time_from", ""),
                    data.get("filter_time_to", ""),
                    int(data.get("interval_minutes", 15)),
                    now,
                ),
            )
            monitor_id = cur.lastrowid
        return get_monitor(monitor_id) or {}

def update_monitor(monitor_id: int, data: dict) -> dict | None:
    allowed = {
        "name", "url", "city", "email_to",
        "filter_theatres", "filter_dates",
        "filter_time_from", "filter_time_to",
        "status", "interval_minutes",
        "last_checked", "last_error", "last_alert",
        "snapshot", "alert_count",
    }
    placeholder = "%s" if is_postgres() else "?"
    pairs, vals = [], []
    for k, v in data.items():
        if k not in allowed:
            continue
        pairs.append(f"{k} = {placeholder}")
        if isinstance(v, (list, dict)):
            vals.append(json.dumps(v, ensure_ascii=False))
        else:
            vals.append(v)
            
    if not pairs:
        return get_monitor(monitor_id)
        
    vals.append(monitor_id)
    
    if is_postgres():
        sql = f"UPDATE monitors SET {', '.join(pairs)} WHERE id = %s RETURNING *"
        with _get_connection() as con:
            cur = con.cursor()
            cur.execute(sql, vals)
            row = cur.fetchone()
            return _row_to_dict(row) if row else None
    else:
        sql = f"UPDATE monitors SET {', '.join(pairs)} WHERE id = ?"
        with _get_connection() as con:
            cur = con.cursor()
            cur.execute(sql, vals)
        return get_monitor(monitor_id)

def delete_monitor(monitor_id: int) -> bool:
    placeholder = "%s" if is_postgres() else "?"
    sql = f"DELETE FROM monitors WHERE id = {placeholder}"
    with _get_connection() as con:
        cur = con.cursor()
        cur.execute(sql, (monitor_id,))
        return (cur.rowcount > 0) if is_postgres() else True

def toggle_pause(monitor_id: int) -> dict | None:
    m = get_monitor(monitor_id)
    if not m:
        return None
    new_status = "active" if m.get("status") == "paused" else "paused"
    return update_monitor(monitor_id, {"status": new_status})

# ── Alert Logging ──────────────────────────────────────────────────────────────

def save_alert(monitor_id: int, changes: list) -> None:
    now = _now_iso()
    changes_json = json.dumps(changes, ensure_ascii=False)
    placeholder = "%s" if is_postgres() else "?"
    
    with _get_connection() as con:
        cur = con.cursor()
        if is_postgres():
            cur.execute(
                "INSERT INTO alert_log (monitor_id, changes) VALUES (%s, %s)",
                (monitor_id, changes_json),
            )
            cur.execute(
                "UPDATE monitors SET alert_count = alert_count + 1, last_alert = NOW() WHERE id = %s",
                (monitor_id,),
            )
        else:
            cur.execute(
                "INSERT INTO alert_log (monitor_id, changes, sent_at) VALUES (?, ?, ?)",
                (monitor_id, changes_json, now),
            )
            cur.execute(
                "UPDATE monitors SET alert_count = alert_count + 1, last_alert = ? WHERE id = ?",
                (now, monitor_id),
            )

# Alias for backwards compatibility
log_alert = save_alert

def get_alert_log(monitor_id: int, limit: int = 30) -> list[dict]:
    placeholder = "%s" if is_postgres() else "?"
    sql = f"SELECT * FROM alert_log WHERE monitor_id = {placeholder} ORDER BY sent_at DESC LIMIT {placeholder}"
    with _get_connection() as con:
        cur = con.cursor()
        cur.execute(sql, (monitor_id, limit))
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = _row_to_dict(r)
            if isinstance(d.get("changes"), str):
                try:
                    d["changes"] = json.loads(d["changes"])
                except Exception:
                    pass
            result.append(d)
        return result
