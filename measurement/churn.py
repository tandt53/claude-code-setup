#!/usr/bin/env python3
"""Rework rate from git history (the "walk" phase, lagging/G2).

Rework here means touching a file that was already touched in the recent past:
code redone soon after it was written, as opposed to code written once. It is a
proxy, not a judgment — a legitimate follow-up and a botched first attempt both
show as rework; read it with the per-task self-correction count, never alone.

Definition: over commits in chronological order, a file-touch in commit i is
rework if the same file was touched in any of the previous `window` commits.
    rework_rate = rework_touches / total_touches

Usage:
    python3 measurement/churn.py [--since <git-revision-range>] [--window N] [--json]
Example:
    python3 measurement/churn.py --since main~50..main --window 5
"""
import json
import subprocess
import sys

SEP = "\x1f"  # unit separator, safe in a git --format


def parse_numstat(text):
    """Parse `git log --numstat --format=%H{SEP}%ct` output into commits.

    Returns a list of commits newest-first as git emits them:
    [{"hash", "ts", "files": [(added, deleted, path), ...]}]. A binary file's
    added/deleted ("-") become 0.
    """
    commits = []
    cur = None
    for raw in text.splitlines():
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        if SEP in line:
            h, _, ts = line.partition(SEP)
            cur = {"hash": h.strip(), "ts": int(ts) if ts.strip().isdigit() else 0, "files": []}
            commits.append(cur)
            continue
        parts = line.split("\t")
        if len(parts) >= 3 and cur is not None:
            a = 0 if parts[0] == "-" else int(parts[0]) if parts[0].isdigit() else 0
            d = 0 if parts[1] == "-" else int(parts[1]) if parts[1].isdigit() else 0
            cur["files"].append((a, d, parts[2]))
    return commits


def rework(commits, window=5):
    """Compute rework from a commit list (any order; sorted here by ts ascending).

    Pure: no git, so it is unit-testable.
    """
    ordered = sorted(commits, key=lambda c: c["ts"])
    total_touches = 0
    rework_touches = 0
    churn_lines = 0
    recent = []  # list of sets of paths, one per recent commit, newest last
    for c in ordered:
        touched = set()
        for a, d, path in c["files"]:
            total_touches += 1
            churn_lines += a + d
            touched.add(path)
            if any(path in s for s in recent):
                rework_touches += 1
        recent.append(touched)
        if len(recent) > window:
            recent.pop(0)
    rate = (rework_touches / total_touches) if total_touches else 0.0
    return {
        "commits": len(ordered),
        "files_touched": len({f[2] for c in ordered for f in c["files"]}),
        "total_touches": total_touches,
        "rework_touches": rework_touches,
        "rework_rate": round(rate, 4),
        "churn_lines": churn_lines,
        "window": window,
    }


def git_numstat(revrange):
    cmd = ["git", "log", "--numstat", f"--format=%H{SEP}%ct"]
    if revrange:
        cmd.append(revrange)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"git log failed: {r.stderr.strip().splitlines()[0] if r.stderr.strip() else 'unknown error'}")
    return r.stdout


def render(m):
    return (
        f"# rework (window {m['window']} commits)\n"
        f"  commits       {m['commits']} · files {m['files_touched']}\n"
        f"  file-touches  {m['total_touches']} · churn {m['churn_lines']:,} lines\n"
        f"  rework        {m['rework_touches']} touches · rate {m['rework_rate']:.1%}"
    )


def main(argv):
    since = None
    window = 5
    as_json = "--json" in argv
    if "--since" in argv:
        since = argv[argv.index("--since") + 1]
    if "--window" in argv:
        window = int(argv[argv.index("--window") + 1])
    m = rework(parse_numstat(git_numstat(since)), window)
    print(json.dumps(m, indent=2) if as_json else render(m))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
