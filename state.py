from __future__ import annotations

"""
state.py — Snapshot diffing engine.

Snapshot format: { date_label: { theatre: { time: status } } }

Trigger logic (per spec):
  - Alert ONLY when a show transitions from NOT AVAILABLE → AVAILABLE.
  - The unique show key is: theatre + date + showtime.
  - A show that was already alerted is NOT alerted again next cycle.
  - "Removed" shows and "availability worsening" never trigger alerts.
"""

from typing import Any


# ── Status helpers ────────────────────────────────────────────────────────────

_BOOKABLE = {"available", "fast-filling"}
_UNBOOKABLE = {"sold-out", "not listed", None, ""}


def is_bookable(status: str | None) -> bool:
    return (status or "").lower() in _BOOKABLE


def is_availability_opening(old_status: str | None, new_status: str | None) -> bool:
    """
    Return True when a show becomes newly bookable.
    Triggers:
      None/not-listed/sold-out  →  available / fast-filling
    Does NOT trigger:
      available  →  fast-filling   (still bookable, not worth noise)
      available  →  sold-out       (worsening — user can't do anything)
      any        →  removed        (gone, not useful)
    """
    old = (old_status or "").lower().strip()
    new = (new_status or "").lower().strip()
    was_unavailable = old in ("", "not listed", "sold-out")
    now_bookable = new in ("available", "fast-filling")
    return was_unavailable and now_bookable


# ── Full diff ─────────────────────────────────────────────────────────────────

def compute_diff(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, str]]:
    """
    Compare two filtered snapshots and return ALL change records
    (used internally; callers should then call availability_openings() to filter).

    Each record: { date, theatre, showtime, old_status, new_status, change }
    """
    changes: list[dict[str, str]] = []

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
                    "date":       date_label,
                    "theatre":    theatre,
                    "showtime":   showtime,
                    "old_status": old_s or "not listed",
                    "new_status": new_s or "removed",
                    "change":     _label(old_s, new_s),
                })

    return changes


def availability_openings(changes: list[dict[str, str]]) -> list[dict[str, str]]:
    """
    Filter a compute_diff() result to only records where a show became bookable.
    This is the correct alert trigger per the spec:
        NOT AVAILABLE → AVAILABLE = ALERT
    """
    return [
        c for c in changes
        if is_availability_opening(c.get("old_status"), c.get("new_status"))
    ]


# ── Label helper ──────────────────────────────────────────────────────────────

def _label(old: str | None, new: str | None) -> str:
    if old is None and new in ("available", "fast-filling"):
        return f"🟢 New show opened — {new.replace('-', ' ').title()}"
    if old in ("sold-out", "not listed") and new in ("available", "fast-filling"):
        return "🟢 Tickets now available!"
    if old is None:
        return f"🆕 New show added ({new})"
    if new is None:
        return "🗑️ Show removed"
    if new == "sold-out":
        return "🔴 Now sold out"
    if new == "fast-filling":
        return "🟡 Now fast-filling"
    if new == "available":
        return "🟢 Now available"
    return f"ℹ️ Status changed: {old} → {new}"
