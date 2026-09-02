from __future__ import annotations

"""
db_neon.py — Neon Postgres database layer (cloud replacement for db.py / SQLite).

Used by:
  - Vercel web app (reads/writes monitors table via DATABASE_URL env var)
  - GitHub Actions runner (reads monitors, writes snapshots + alert_log)

Requires: psycopg2-binary
"""

import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

# ── Connection ─────────────────────────────────────────────────────────────────

def _get_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set.")
    return url


@contextmanager
def _conn():
    """Context manager that yields a psycopg2 connection with RealDictCursor."""
    con = psycopg2.connect(_get_url(), cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


# ── Schema ─────────────────────────────────────────────────────────────────────

_SCHEMA = """
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
    snapshot         JSONB,
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
    with _conn() as con:
        cur = con.cursor()
        cur.execute(_SCHEMA)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    if row is None:
        return {}
    d = dict(row)
    # Deserialise JSONB fields that psycopg2 returns as dicts/lists already
    for field in ("filter_theatres", "filter_dates", "snapshot"):
        if field in d and isinstance(d[field], str):
            try:
                d[field] = json.loads(d[field])
            except (ValueError, TypeError):
                pass
    # Stringify timestamps for JSON serialisation
    for field in ("last_checked", "last_alert", "created_at"):
        if field in d and d[field] is not None and not isinstance(d[field], str):
            d[field] = d[field].isoformat()
    return d


# ── CRUD — monitors ────────────────────────────────────────────────────────────

def get_monitors(active_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM monitors"
    if active_only:
        sql += " WHERE status = 'active'"
    sql += " ORDER BY created_at DESC"
    with _conn() as con:
        cur = con.cursor()
        cur.execute(sql)
        return [_row_to_dict(r) for r in cur.fetchall()]


def get_monitor(monitor_id: int) -> dict | None:
    with _conn() as con:
        cur = con.cursor()
        cur.execute("SELECT * FROM monitors WHERE id = %s", (monitor_id,))
        row = cur.fetchone()
        return _row_to_dict(row) if row else None


def create_monitor(data: dict) -> dict:
    fields = (
        "name", "url", "city", "email_to",
        "filter_theatres", "filter_dates",
        "filter_time_from", "filter_time_to",
        "interval_minutes",
    )
    vals = []
    for f in fields:
        v = data.get(f, [] if f.startswith("filter_") and f not in ("filter_time_from","filter_time_to") else "")
        if isinstance(v, (list, dict)):
            v = json.dumps(v)
        vals.append(v)

    sql = f"""
        INSERT INTO monitors ({', '.join(fields)})
        VALUES ({', '.join(['%s']*len(fields))})
        RETURNING *
    """
    with _conn() as con:
        cur = con.cursor()
        cur.execute(sql, vals)
        return _row_to_dict(cur.fetchone())


def update_monitor(monitor_id: int, data: dict) -> dict | None:
    allowed = {
        "name", "url", "city", "email_to",
        "filter_theatres", "filter_dates",
        "filter_time_from", "filter_time_to",
        "status", "interval_minutes",
        "last_checked", "last_error", "last_alert",
        "snapshot", "alert_count",
    }
    pairs, vals = [], []
    for k, v in data.items():
        if k not in allowed:
            continue
        if isinstance(v, (list, dict)):
            v = json.dumps(v)
        pairs.append(f"{k} = %s")
        vals.append(v)
    if not pairs:
        return get_monitor(monitor_id)
    vals.append(monitor_id)
    sql = f"UPDATE monitors SET {', '.join(pairs)} WHERE id = %s RETURNING *"
    with _conn() as con:
        cur = con.cursor()
        cur.execute(sql, vals)
        row = cur.fetchone()
        return _row_to_dict(row) if row else None


def delete_monitor(monitor_id: int) -> bool:
    with _conn() as con:
        cur = con.cursor()
        cur.execute("DELETE FROM monitors WHERE id = %s", (monitor_id,))
        return cur.rowcount > 0


def toggle_pause(monitor_id: int) -> dict | None:
    with _conn() as con:
        cur = con.cursor()
        cur.execute("SELECT status FROM monitors WHERE id = %s", (monitor_id,))
        row = cur.fetchone()
        if not row:
            return None
        new_status = "active" if row["status"] == "paused" else "paused"
        cur.execute(
            "UPDATE monitors SET status = %s WHERE id = %s RETURNING *",
            (new_status, monitor_id),
        )
        return _row_to_dict(cur.fetchone())


# ── CRUD — alert_log ───────────────────────────────────────────────────────────

def log_alert(monitor_id: int, changes: list) -> None:
    with _conn() as con:
        cur = con.cursor()
        cur.execute(
            "INSERT INTO alert_log (monitor_id, changes) VALUES (%s, %s)",
            (monitor_id, json.dumps(changes)),
        )
        cur.execute(
            "UPDATE monitors SET alert_count = alert_count + 1, last_alert = NOW() WHERE id = %s",
            (monitor_id,),
        )


def get_alert_log(monitor_id: int, limit: int = 30) -> list[dict]:
    with _conn() as con:
        cur = con.cursor()
        cur.execute(
            "SELECT * FROM alert_log WHERE monitor_id = %s ORDER BY sent_at DESC LIMIT %s",
            (monitor_id, limit),
        )
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            if isinstance(d.get("changes"), str):
                d["changes"] = json.loads(d["changes"])
            if d.get("sent_at") and not isinstance(d["sent_at"], str):
                d["sent_at"] = d["sent_at"].isoformat()
            rows.append(d)
        return rows
