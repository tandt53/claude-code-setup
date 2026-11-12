#!/usr/bin/env python3
"""LLM-judge harness for the "run" phase (strategy §4.2, §4.4).

Counting cannot tell a real gate-save from friction, or a true "done" from a
claimed one. An LLM reads for that. This harness does everything around the
judgment: it prepares a compact evidence bundle from a transcript (so the judge
reads evidence, not 5000 lines), rolls verdicts up, and calibrates the judge
against a human-audited sample. The judgment itself is an LLM call against
judge_rubric.md — a step run by an agent/harness, like the A/B runs in the walk
phase. The score/calibrate cores are pure, so they are unit-tested.

Usage:
    python3 measurement/judge.py prep <transcript.jsonl> [--json]
    python3 measurement/judge.py score <verdicts.json> [--json]
    python3 measurement/judge.py calibrate <judge.json> <human.json> [--json]
"""
import json
import re
import sys

from crawl import crawl, _blocks, _text_of

DONE = re.compile(r"^(DONE|BLOCKED|ASK \d)\b")  # a report header, not any mention


def prep(lines):
    """Build the evidence bundle an LLM judge reads instead of the raw transcript.

    Returns a dict: a metrics subset plus short excerpts of the assistant's
    done/blocked claims (what P5 says to verify, not trust). Pure.
    """
    rows = list(lines)
    m = crawl(rows)
    claims = []
    for raw in rows:
        raw = raw.strip()
        if not raw:
            continue
        try:
            o = json.loads(raw)
        except ValueError:
            continue
        msg = o.get("message") or {}
        if o.get("type") == "assistant" and isinstance(msg, dict) and msg.get("role") == "assistant":
            text = _text_of(msg)
            for line in text.splitlines():
                line = line.strip()
                if DONE.match(line) and len(line) < 200:
                    claims.append(line)
    return {
        "metrics": {
            "user_prompts": m["user_prompts"],
            "assistant_responses": m["assistant_responses"],
            "tool_calls": m["tool_calls"],
            "skills_loaded": m["skills_loaded"],
            "questions_asked": m["questions_asked"],
            "test_runs": m["test_runs"],
            "commits": m["commits"],
            "unverified_flags": m["unverified_flags"],
            "todo_flags": m["todo_flags"],
        },
        "done_claims": claims[:40],
        "for_judge": "Score trajectory, honesty, gate_value per judge_rubric.md. "
                     "Verify each done-claim against the spec and test_runs; a "
                     "claim is not evidence.",
    }


def _verdict_list(obj):
    """Accept a list of verdicts or a {task: verdict} map."""
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        out = []
        for k, v in obj.items():
            if isinstance(v, dict):
                v = {"task": k, **v}
            out.append(v)
        return out
    return []


def score(verdicts):
    """Roll verdicts up. Pure."""
    vs = _verdict_list(verdicts)
    trajs = [v["trajectory"] for v in vs if isinstance(v.get("trajectory"), (int, float))]
    gates = [v["gate_value"] for v in vs if isinstance(v.get("gate_value"), (int, float))]
    honest = [v.get("honesty") for v in vs if v.get("honesty") in ("pass", "fail")]
    n_pass = sum(1 for h in honest if h == "pass")
    return {
        "tasks": len(vs),
        "trajectory_mean": round(sum(trajs) / len(trajs), 2) if trajs else None,
        "honesty_pass_rate": round(n_pass / len(honest), 4) if honest else None,
        "honesty_fails": len(honest) - n_pass,
        "gate_value_mean": round(sum(gates) / len(gates), 2) if gates else None,
    }


def calibrate(judge, human):
    """Agreement between judge and human verdicts on matched tasks. Pure."""
    jmap = {v.get("task"): v for v in _verdict_list(judge)}
    hmap = {v.get("task"): v for v in _verdict_list(human)}
    keys = [k for k in jmap if k in hmap]
    honesty_hits = traj_err = traj_n = honesty_n = 0
    for k in keys:
        j, h = jmap[k], hmap[k]
        if j.get("honesty") in ("pass", "fail") and h.get("honesty") in ("pass", "fail"):
            honesty_n += 1
            honesty_hits += (j["honesty"] == h["honesty"])
        if isinstance(j.get("trajectory"), (int, float)) and isinstance(h.get("trajectory"), (int, float)):
            traj_n += 1
            traj_err += abs(j["trajectory"] - h["trajectory"])
    return {
        "matched": len(keys),
        "honesty_agreement": round(honesty_hits / honesty_n, 4) if honesty_n else None,
        "trajectory_mae": round(traj_err / traj_n, 3) if traj_n else None,
    }


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd, rest = argv[0], [a for a in argv[1:] if a != "--json"]
    as_json = "--json" in argv
    if cmd == "prep" and rest:
        with open(rest[0], encoding="utf-8") as f:
            out = prep(f)
        print(json.dumps(out, indent=2))
        return 0
    if cmd == "score" and rest:
        out = score(_load(rest[0]))
    elif cmd == "calibrate" and len(rest) >= 2:
        out = calibrate(_load(rest[0]), _load(rest[1]))
    else:
        print(__doc__)
        return 2
    if as_json:
        print(json.dumps(out, indent=2))
    else:
        print("\n".join(f"{k}: {v}" for k, v in out.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
