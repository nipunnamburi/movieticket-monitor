from __future__ import annotations

"""
state.py — Snapshot diffing engine (updated for date-keyed snapshots).

Snapshot format: { date_label: { theatre: { time: status } } }
"""

from typing import Any


def compute_diff(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, str]]:
    """
    Compare two filtered snapshots and return change records.

    Each record: { date, theatre, showtime, old_status, new_status, change }
    """
    changes: list[dict[str, str]] = []

    # ── Hash fallback mode ────────────────────────────────────────────────────
    if "_page_hash" in new or "_page_hash" in old:
        old_h = (old.get("_page_hash") or {}).get("value", "")
        new_h = (new.get("_page_hash") or {}).get("value", "")
        if old_h and new_h and old_h != new_h:
            changes.append({
                "date": "—",
                "theatre": "Page content",
                "showtime": "—",
                "old_status": f"hash:{old_h}",
                "new_status": f"hash:{new_h}",
                "change": "⚠️ Page content changed — check manually",
            })
        return changes

    # ── Structured diff ───────────────────────────────────────────────────────
    all_dates = sorted(set(old.keys()) | set(new.keys()))

    for date_label in all_dates:
        old_theatres: dict = old.get(date_label) or {}
        new_theatres: dict = new.get(date_label) or {}

        if not isinstance(old_theatres, dict):
            old_theatres = {}
        if not isinstance(new_theatres, dict):
            new_theatres = {}

        all_theatres = sorted(set(old_theatres.keys()) | set(new_theatres.keys()))

        for theatre in all_theatres:
            old_times: dict = old_theatres.get(theatre) or {}
            new_times: dict = new_theatres.get(theatre) or {}

            if not isinstance(old_times, dict):
                old_times = {}
            if not isinstance(new_times, dict):
                new_times = {}

            all_times = sorted(set(old_times.keys()) | set(new_times.keys()))

            for showtime in all_times:
                old_s = old_times.get(showtime)
                new_s = new_times.get(showtime)

                if old_s == new_s:
                    continue

                changes.append({
                    "date": date_label,
                    "theatre": theatre,
                    "showtime": showtime,
                    "old_status": old_s or "not listed",
                    "new_status": new_s or "removed",
                    "change": _label(old_s, new_s),
                })

    return changes


def _label(old: str | None, new: str | None) -> str:
    if old is None and new is not None:
        return f"🆕 New show added ({new})"
    if new is None:
        return "🗑️ Show removed"
    if new in ("available",) and old in ("sold-out",):
        return "🟢 Tickets opened up!"
    if new == "fast-filling" and old == "sold-out":
        return "🟡 Fast-filling (was sold-out)"
    if new == "sold-out":
        return "🔴 Now sold out"
    if new == "fast-filling":
        return "🟡 Now fast-filling"
    if new == "available":
        return "🟢 Now available"
    return f"ℹ️ Status changed: {old} → {new}"
