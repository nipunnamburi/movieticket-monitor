"""
db.py — SQLite database layer for BMS Monitor web app.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

DB_PATH = Path(
    os.environ.get("DATABASE_PATH", str(Path(__file__).parent / "monitors.db"))
)


# ── Connection ────────────────────────────────────────────────────────────────

def _conn():
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


# ── Schema ────────────────────────────────────────────────────────────────────

def init_db() -> None:
    with _conn() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS monitors (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            name              TEXT    NOT NULL,
            url               TEXT    NOT NULL,
            city              TEXT    DEFAULT '',
            email_to          TEXT    NOT NULL,
            -- Filters (all optional; JSON-encoded arrays or empty strings)
            filter_theatres   TEXT    DEFAULT '[]',
            filter_dates      TEXT    DEFAULT '[]',
            filter_time_from  TEXT    DEFAULT '',
            filter_time_to    TEXT    DEFAULT '',
            -- State
            status            TEXT    DEFAULT 'active',
            interval_minutes  INTEGER DEFAULT 15,
            last_checked      TEXT    DEFAULT NULL,
            last_error        TEXT    DEFAULT NULL,
            last_alert        TEXT    DEFAULT NULL,
            snapshot          TEXT    DEFAULT '{}',
            alert_count       INTEGER DEFAULT 0,
            created_at        TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS alert_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            monitor_id  INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
            changes     TEXT    NOT NULL,
            sent_at     TEXT    NOT NULL
        );
        """)


# ── Serialisation helpers ─────────────────────────────────────────────────────

_JSON_FIELDS = {"filter_theatres", "filter_dates", "snapshot"}


def _deserialise(row: sqlite3.Row) -> dict:
    d = dict(row)
    for key in _JSON_FIELDS:
        if key in d and d[key]:
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                d[key] = {} if key == "snapshot" else []
        else:
            d[key] = {} if key == "snapshot" else []
    return d


def _serialise_value(key: str, value: Any) -> Any:
    if key in _JSON_FIELDS and not isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    return value


# ── CRUD ──────────────────────────────────────────────────────────────────────

def get_monitors(active_only: bool = False) -> list[dict]:
    with _conn() as con:
        q = "SELECT * FROM monitors"
        if active_only:
            q += " WHERE status = 'active'"
        q += " ORDER BY created_at DESC"
        rows = con.execute(q).fetchall()
    return [_deserialise(r) for r in rows]


def get_monitor(monitor_id: int) -> dict | None:
    with _conn() as con:
        row = con.execute("SELECT * FROM monitors WHERE id = ?", (monitor_id,)).fetchone()
    return _deserialise(row) if row else None


def create_monitor(data: dict) -> dict:
    now = datetime.now().isoformat(timespec="seconds")
    with _conn() as con:
        cur = con.execute(
            """INSERT INTO monitors
               (name, url, city, email_to,
                filter_theatres, filter_dates, filter_time_from, filter_time_to,
                interval_minutes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                data["name"],
                data["url"],
                data.get("city", ""),
                data["email_to"],
                json.dumps(data.get("filter_theatres") or []),
                json.dumps(data.get("filter_dates") or []),
                data.get("filter_time_from", ""),
                data.get("filter_time_to", ""),
                data.get("interval_minutes", 15),
                now,
            ),
        )
    return get_monitor(cur.lastrowid)


_MUTABLE = {
    "name", "email_to",
    "filter_theatres", "filter_dates", "filter_time_from", "filter_time_to",
    "status", "interval_minutes",
    "last_checked", "last_error", "last_alert",
    "snapshot", "alert_count",
}


def update_monitor(monitor_id: int, data: dict) -> dict | None:
    sets, vals = [], []
    for k, v in data.items():
        if k not in _MUTABLE:
            continue
        sets.append(f"{k} = ?")
        vals.append(_serialise_value(k, v))
    if not sets:
        return get_monitor(monitor_id)
    vals.append(monitor_id)
    with _conn() as con:
        con.execute(f"UPDATE monitors SET {', '.join(sets)} WHERE id = ?", vals)
    return get_monitor(monitor_id)


def delete_monitor(monitor_id: int) -> None:
    with _conn() as con:
        con.execute("DELETE FROM monitors WHERE id = ?", (monitor_id,))


# ── Alert log ─────────────────────────────────────────────────────────────────

def save_alert(monitor_id: int, changes: list) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    with _conn() as con:
        con.execute(
            "INSERT INTO alert_log (monitor_id, changes, sent_at) VALUES (?, ?, ?)",
            (monitor_id, json.dumps(changes, ensure_ascii=False), now),
        )
        con.execute(
            "UPDATE monitors SET alert_count = alert_count + 1, last_alert = ? WHERE id = ?",
            (now, monitor_id),
        )


def get_alert_log(monitor_id: int, limit: int = 30) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM alert_log WHERE monitor_id = ? ORDER BY sent_at DESC LIMIT ?",
            (monitor_id, limit),
        ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        try:
            d["changes"] = json.loads(d["changes"])
        except Exception:
            pass
        result.append(d)
    return result
