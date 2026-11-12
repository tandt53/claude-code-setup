#!/usr/bin/env python3
"""A/B delta between two sets of runs (the "walk" phase, the attribution layer).

The only honest way to attribute an outcome to the setup or to a skill is to
compare matched runs: with-kit vs without-kit (P3), or with-skill vs suppressed
(per-skill ablation). This takes two sets of per-run metrics — each a JSON map
{run_name: metrics} as `crawl.py --json` emits — and reports, per metric, the
mean and range on each side and the delta.

It is deliberately descriptive, not inferential: it prints means AND ranges and
the n on each side (P4, reliability across runs). A delta from one run each side
is a hypothesis, not a result; the range is there to stop you forgetting that.

Usage:
    python3 measurement/compare.py <A.json> <B.json> [--label-a with-kit] [--label-b baseline] [--json]

A.json / B.json are `crawl.py --json` outputs (or any {name: {metric: number}}).
Build them by crawling the with-kit runs into one file and the without-kit runs
into another. Running the sessions themselves is a manual/external step — see
measurement/README.md.
"""
import json
import sys


def _numeric_keys(runs):
    keys = set()
    for m in runs.values():
        for k, v in m.items():
            if isinstance(v, bool):
                continue
            if isinstance(v, (int, float)):
                keys.add(k)
    return keys


def _series(runs, key):
    return [m[key] for m in runs.values() if isinstance(m.get(key), (int, float)) and not isinstance(m.get(key), bool)]


def _stat(xs):
    if not xs:
        return {"n": 0, "mean": None, "min": None, "max": None}
    return {"n": len(xs), "mean": sum(xs) / len(xs), "min": min(xs), "max": max(xs)}


def compare(a_runs, b_runs, keys=None):
    """Per-metric A vs B stats and delta. Pure, so it is testable."""
    if keys is None:
        keys = sorted(_numeric_keys(a_runs) | _numeric_keys(b_runs))
    rows = {}
    for k in keys:
        a = _stat(_series(a_runs, k))
        b = _stat(_series(b_runs, k))
        delta = None
        if a["mean"] is not None and b["mean"] is not None:
            delta = a["mean"] - b["mean"]
        rows[k] = {"a": a, "b": b, "delta": delta}
    return rows


def _fmt(x):
    if x is None:
        return "-"
    if isinstance(x, float):
        return f"{x:.2f}".rstrip("0").rstrip(".")
    return str(x)


def render(rows, label_a, label_b):
    out = [f"# A/B delta   A = {label_a}   B = {label_b}",
           f"  {'metric':<22} {label_a+' (n,mean[min..max])':<30} {label_b+' (n,mean[min..max])':<30} delta"]
    for k, r in rows.items():
        a, b = r["a"], r["b"]
        acol = f"{a['n']}, {_fmt(a['mean'])}[{_fmt(a['min'])}..{_fmt(a['max'])}]" if a["n"] else "0, -"
        bcol = f"{b['n']}, {_fmt(b['mean'])}[{_fmt(b['min'])}..{_fmt(b['max'])}]" if b["n"] else "0, -"
        out.append(f"  {k:<22} {acol:<30} {bcol:<30} {_fmt(r['delta'])}")
    if any(r["a"]["n"] < 2 or r["b"]["n"] < 2 for r in rows.values()):
        out.append("  ! fewer than 2 runs on a side: treat every delta as a hypothesis, not a result (P4)")
    return "\n".join(out)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    as_json = "--json" in argv
    label_a = argv[argv.index("--label-a") + 1] if "--label-a" in argv else "A"
    label_b = argv[argv.index("--label-b") + 1] if "--label-b" in argv else "B"
    if len(args) < 2:
        print(__doc__)
        return 2
    a_runs = json.loads(open(args[0], encoding="utf-8").read())
    b_runs = json.loads(open(args[1], encoding="utf-8").read())
    rows = compare(a_runs, b_runs)
    print(json.dumps(rows, indent=2) if as_json else render(rows, label_a, label_b))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
