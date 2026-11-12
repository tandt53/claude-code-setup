#!/usr/bin/env python3
"""Traceability rollup from trace-check status.json files (the "walk" phase,
leading/G1).

trace-check writes one status.json per task (requirement examples, whether each
is proven by a test, by which level, and which are still `assumed`). This rolls
several of them into coverage numbers across tasks.

It measures linkage (is an example proven by a test), not whether the test is a
good one — mutation score (the verify skill's mutation runs) is the counter-metric.

Usage:
    python3 measurement/trace_rollup.py <status.json | dir> [more...] [--json]
"""
import json
import sys
from pathlib import Path


def rollup(status_objs):
    """Aggregate a list of parsed status.json dicts. Pure, so it is testable."""
    agg = {
        "tasks": 0,
        "ok": 0,
        "blocked": 0,
        "examples": 0,
        "proven": 0,
        "fail": 0,
        "skipped": 0,
        "no_test": 0,
        "assumed": 0,
        "orphans": 0,
        "problems": 0,
        "levels": {},
    }
    for st in status_objs:
        if not isinstance(st, dict):
            continue
        agg["tasks"] += 1
        if st.get("ok"):
            agg["ok"] += 1
        else:
            agg["blocked"] += 1
        s = st.get("summary") or {}
        agg["proven"] += s.get("pass", 0)
        agg["fail"] += s.get("fail", 0)
        agg["skipped"] += s.get("skipped", 0)
        agg["no_test"] += s.get("no test", 0)
        agg["assumed"] += s.get("assumed", 0)
        agg["orphans"] += s.get("orphans", 0)
        agg["problems"] += s.get("problems", 0)
        for r in (st.get("requirements") or {}).values():
            for e in (r.get("examples") or {}).values():
                agg["examples"] += 1
                for lv in e.get("levels") or []:
                    agg["levels"][lv] = agg["levels"].get(lv, 0) + 1
    total = agg["proven"] + agg["fail"] + agg["skipped"] + agg["no_test"]
    agg["proven_pct"] = round(agg["proven"] / total, 4) if total else 0.0
    agg["assumed_pct"] = round(agg["assumed"] / total, 4) if total else 0.0
    return agg


def render(m):
    lv = " ".join(f"{k}:{v}" for k, v in sorted(m["levels"].items(), key=lambda kv: -kv[1])) or "-"
    return (
        f"# traceability rollup\n"
        f"  tasks         {m['tasks']} · ok {m['ok']} · blocked {m['blocked']}\n"
        f"  examples      {m['examples']} · proven {m['proven']} ({m['proven_pct']:.1%})\n"
        f"  unproven      fail {m['fail']} · skipped {m['skipped']} · no-test {m['no_test']}\n"
        f"  assumed       {m['assumed']} ({m['assumed_pct']:.1%}) · orphans {m['orphans']} · problems {m['problems']}\n"
        f"  levels        {lv}"
    )


def collect(paths):
    files = []
    for p in paths:
        p = Path(p)
        if p.is_dir():
            files.extend(sorted(p.rglob("status.json")))
        else:
            files.append(p)
    return files


def main(argv):
    args = [a for a in argv if a != "--json"]
    as_json = "--json" in argv
    if not args:
        print(__doc__)
        return 2
    objs = []
    for f in collect(args):
        try:
            objs.append(json.loads(Path(f).read_text(encoding="utf-8")))
        except (ValueError, OSError) as e:
            print(f"skip {f}: {e}", file=sys.stderr)
    m = rollup(objs)
    print(json.dumps(m, indent=2) if as_json else render(m))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
