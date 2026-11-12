#!/usr/bin/env python3
"""Append a dated metrics snapshot to a history file, for the trend dashboard
(the "run" phase shows movement over time).

A snapshot is a flat JSON object of {metric: number} plus a "date". You build
one by gathering the day's crawl/churn/trace_rollup numbers; this upserts it by
date into a history array that measurement-dashboard.html reads.

Usage:
    python3 measurement/history.py <history.json> <snapshot.json> [--date YYYY-MM-DD]
If --date is given it overrides the snapshot's date. The history file is created
if missing. Prints the updated history.
"""
import json
import sys
from pathlib import Path


def append(history, snapshot):
    """Upsert a snapshot (must carry a 'date') into history, sorted by date. Pure."""
    if not isinstance(snapshot, dict) or "date" not in snapshot:
        raise ValueError("snapshot needs a 'date'")
    out = [row for row in history if row.get("date") != snapshot["date"]]
    out.append(snapshot)
    out.sort(key=lambda r: r.get("date", ""))
    return out


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    date = argv[argv.index("--date") + 1] if "--date" in argv else None
    if len(args) < 2:
        print(__doc__)
        return 2
    hist_path, snap_path = Path(args[0]), Path(args[1])
    history = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else []
    snapshot = json.loads(snap_path.read_text(encoding="utf-8"))
    if date:
        snapshot["date"] = date
    updated = append(history, snapshot)
    hist_path.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(updated, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
