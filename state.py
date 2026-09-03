from __future__ import annotations

"""
state.py — Snapshot diffing engine.

Snapshot format: { date_label: { theatre: { time: status } } }

Trigger logic (per spec):
  Alert ONLY when a show transitions from NOT BOOKABLE → BOOKABLE.

  NOT BOOKABLE = sold-out | not-listed | unavailable | (absent/removed)
  BOOKABLE     = available | fast-filling

  Truth table:
    not-listed   → available     ✅ ALERT
    not-listed   → fast-filling  ✅ ALERT
    sold-out     → available     ✅ ALERT
    sold-out     → fast-filling  ✅ ALERT
    available    → available     ❌ (no change)
    available    → fast-filling  ❌ (still bookable)
    fast-filling → available     ❌ (still bookable)
    available    → sold-out      ❌ (worsening)
    fast-filling → sold-out      ❌ (worsening)
    removed      → available     ✅ ALERT (treated as new opening)
    removed      → fast-filling  ✅ ALERT (treated as new opening)

  Note on `removed → available`:
    In our diff model, when a show is absent from the old snapshot its
    old_status is "not listed", so this is handled identically to the
    not-listed case. Because the new API-based scraper is highly reliable,
    a false-negative at one check is unlikely; we therefore treat
    "reappeared → bookable" as a genuine new opening. If scraper
    reliability becomes an issue a consecutive-check confirmation can be
    added to db_neon.py / actions_runner.py.

  First-run behavior:
    On the very first check the old snapshot is empty, so every current
    show appears as "not listed → <status>". We deliberately suppress this
    initial diff and save a silent baseline. Only from the second check
    onwards are genuine openings reported.
"""

from typing import Any


# ── Bookability sets ──────────────────────────────────────────────────────────

_BOOKABLE: frozenset[str] = frozenset({"available", "fast-filling"})
_NOT_BOOKABLE: frozenset[str] = frozenset({"sold-out", "not listed", "unavailable", "", "removed"})


def is_bookable(status: str | None) -> bool:
    """Return True if the status means tickets can be purchased right now."""
    return (status or "").lower().strip() in _BOOKABLE


def is_not_bookable(status: str | None) -> bool:
    """Return True if the status means tickets are NOT currently purchasable."""
    s = (status or "").lower().strip()
    return s in _NOT_BOOKABLE or s not in _BOOKABLE  # anything unknown = not bookable


def is_availability_opening(old_status: str | None, new_status: str | None) -> bool:
    """
    Return True when a show transitions from NOT BOOKABLE → BOOKABLE.
    This is the single gating condition for sending an alert.
    """
    return is_not_bookable(old_status) and is_bookable(new_status)


# ── Full diff ─────────────────────────────────────────────────────────────────

def compute_diff(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, str]]:
    """
    Compare two filtered snapshots and return ALL change records.
    Callers use availability_openings() to select only alert-worthy items.

    Each record: { date, date_code, theatre, showtime, old_status, new_status, change }
      - date      : display label e.g. "Fri, 04 Sep"
      - date_code : canonical YYYYMMDD e.g. "20260904" (from _date_codes metadata)
    """
    changes: list[dict[str, str]] = []

    # Merge _date_codes from both snapshots (new takes precedence)
    date_codes: dict[str, str] = {}
    date_codes.update(old.get("_date_codes") or {})
    date_codes.update(new.get("_date_codes") or {})

    all_dates = sorted(
        k for k in set(old.keys()) | set(new.keys())
        if k not in ("_page_hash", "_date_codes")
    )

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

                # Store human-readable sentinel values so callers don't need
                # to handle None explicitly.
                stored_old = old_s if old_s is not None else "not listed"
                stored_new = new_s if new_s is not None else "removed"

                changes.append({
                    "date":       date_label,
                    "date_code":  date_codes.get(date_label, ""),  # canonical YYYYMMDD
                    "theatre":    theatre,
                    "showtime":   showtime,
                    "old_status": stored_old,
                    "new_status": stored_new,
                    "change":     _label(old_s, new_s),
                })

    return changes


def availability_openings(changes: list[dict[str, str]]) -> list[dict[str, str]]:
    """
    Filter compute_diff() output to only records where a show became bookable.
    This is the correct alert gate: NOT BOOKABLE → BOOKABLE.
    """
    return [
        c for c in changes
        if is_availability_opening(c.get("old_status"), c.get("new_status"))
    ]


# ── Label helper ──────────────────────────────────────────────────────────────

def _label(old: str | None, new: str | None) -> str:
    old_s = (old or "").lower()
    new_s = (new or "").lower()

    # NOT BOOKABLE → BOOKABLE transitions
    if new_s == "available" and old_s in ("", "not listed", "unavailable"):
        return "🟢 New show — Available"
    if new_s == "fast-filling" and old_s in ("", "not listed", "unavailable"):
        return "🟡 New show — Fast Filling"
    if new_s == "available" and old_s == "sold-out":
        return "🟢 Tickets opened up!"
    if new_s == "fast-filling" and old_s == "sold-out":
        return "🟡 Fast-filling (was sold-out)"
    # Re-appeared shows
    if new_s in ("available", "fast-filling") and old is None:
        return f"🟢 Show reappeared — {new_s.replace('-', ' ').title()}"

    # Worsening / informational (not alerted)
    if new is None:
        return "🗑️ Show removed"
    if new_s == "sold-out":
        return "🔴 Now sold out"
    if new_s == "fast-filling":
        return "🟡 Now fast-filling"
    if new_s == "available":
        return "🟢 Now available"
    return f"ℹ️ Status: {old} → {new}"
