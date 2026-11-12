#!/usr/bin/env python3
r"""
Claude Code Stop hook: record this session's crawl metrics, passively.

Every turn's end, this crawls the current transcript and writes one snapshot
file per session to the measurement store (default
`~/.claude/measurement/sessions/<session-id>.json`). It is the "crawl" phase of
docs/measurement-strategy.md (§6) made automatic: no one has to remember to run
`measurement/crawl.py`. A later `trace_rollup`/history pass reads the store and
groups by project or folds all sessions into the whole-system view.

It never blocks and never speaks: it always exits 0, swallows every error, and
no-ops when the transcript or the `crawl` module is missing. One file per
session (written atomically) means two sessions ending a turn at once do not
race on a shared file.

The snapshot carries session_id, project (the transcript's folder), cwd and git
branch alongside the crawl metrics, so a rollup can slice per project or global.

Store location: $CLAUDE_MEASURE_DIR if set, else ~/.claude/measurement/sessions.
Standard library only (plus measurement/crawl.py, a sibling of hooks/).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path


def _load_crawl():
    """Import measurement/crawl.py, a sibling of the hooks/ dir. None if absent."""
    mdir = Path(__file__).resolve().parent.parent / "measurement"
    if str(mdir) not in sys.path:
        sys.path.insert(0, str(mdir))
    try:
        import crawl  # type: ignore
        return crawl
    except Exception:
        return None


def _read_lines(transcript_path: str) -> list[str]:
    with open(transcript_path, encoding="utf-8", errors="replace") as fh:
        return fh.readlines()


def _git_branch(lines: list[str]) -> str | None:
    """The last gitBranch seen in the transcript, without shelling out to git."""
    branch = None
    for line in lines:
        line = line.strip()
        if not line or '"gitBranch"' not in line:
            continue
        try:
            o = json.loads(line)
        except ValueError:
            continue
        b = o.get("gitBranch")
        if b:
            branch = b
    return branch


def build_snapshot(lines, *, session_id, project, cwd, crawl) -> dict:
    """The per-session record written to the store. Pure given `crawl`."""
    m = crawl.crawl(lines)
    return {
        "session_id": session_id,
        "project": project,
        "cwd": cwd,
        "git_branch": _git_branch(lines),
        "metrics": m,
    }


def write_snapshot(out_dir: Path, session_id: str, snapshot: dict) -> Path:
    """Atomically write one session's snapshot. temp + replace, so a reader
    never sees a half-written file and concurrent sessions keep their own."""
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{session_id}.json"
    fd, tmp = tempfile.mkstemp(dir=out_dir, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(snapshot, fh, indent=2)
        os.replace(tmp, dest)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return dest


def store_dir() -> Path:
    env = os.environ.get("CLAUDE_MEASURE_DIR")
    if env:
        return Path(env)
    return Path.home() / ".claude" / "measurement" / "sessions"


def run(event: dict, out_dir: Path | None = None) -> Path | None:
    """Crawl the event's transcript and write its snapshot. None when there is
    nothing to record (no transcript, or crawl unavailable)."""
    tp = event.get("transcript_path")
    if not tp or not os.path.isfile(tp):
        return None
    crawl = _load_crawl()
    if crawl is None:
        return None
    lines = _read_lines(tp)
    session_id = event.get("session_id") or Path(tp).stem
    project = Path(tp).resolve().parent.name
    cwd = event.get("cwd") or os.getcwd()
    snapshot = build_snapshot(
        lines, session_id=session_id, project=project, cwd=cwd, crawl=crawl
    )
    return write_snapshot(out_dir or store_dir(), session_id, snapshot)


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # never block on a malformed event
    try:
        run(event)
    except Exception as exc:  # a measurement hook must never trap the session
        print(f"measure_session hook error, ignoring: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
