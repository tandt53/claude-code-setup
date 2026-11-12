#!/usr/bin/env python3
"""Crawl a Claude Code transcript and print the auto, transcript-derived
metrics from docs/measurement-strategy.md (the "crawl" phase of the rollout).

This reads only the transcript (a session's .jsonl), the richest always-present
source. It computes the leading, transcript-readable rows of the per-task and
per-skill levels. The lagging rows that need git churn, status.json or a
baseline run (rework rate, traceability, ablation) are the "walk" phase and are
not computed here; see the strategy doc.

Usage:
    python3 measurement/crawl.py <transcript.jsonl> [more.jsonl | dir] [--json]

A transcript lives at
    ~/.claude/projects/<slug>/<session-id>.jsonl
Pass one or more files, or a directory (every *.jsonl in it is read).

The numbers are counts and signals, not judgments: "trajectory" and "honesty"
here are flags (test-runs seen, [unverified] markers), not a graded score. A
graded score is the LLM-judge in the "run" phase. No metric is read alone (P1).
"""
import json
import re
import sys
from pathlib import Path


SKILL_FILE = re.compile(r"skills/([a-z0-9][a-z0-9-]*)/SKILL\.md")


def _blocks(msg):
    """Content blocks of a message, as a list (a string becomes one text block)."""
    if not isinstance(msg, dict):
        return []
    c = msg.get("content")
    if isinstance(c, str):
        return [{"type": "text", "text": c}]
    if isinstance(c, list):
        return c
    return []


def _text_of(msg):
    return " ".join(
        b.get("text", "")
        for b in _blocks(msg)
        if isinstance(b, dict) and b.get("type") == "text"
    )


def crawl(lines):
    """Compute metrics from an iterable of transcript lines (raw json strings).

    Returns a dict of metrics. Pure: no I/O, so it is unit-testable with a
    synthetic transcript.
    """
    m = {
        "user_prompts": 0,
        "assistant_responses": 0,
        "tool_calls": 0,
        "tools": {},
        "skills_loaded": [],
        "web_searches": 0,
        "questions_asked": 0,
        "self_corrections": 0,
        "unverified_flags": 0,
        "todo_flags": 0,
        "test_runs": 0,
        "commits": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "first_ts": None,
        "last_ts": None,
    }
    test_cmd = re.compile(r"trace\.py|unittest|node --test|pytest")
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except ValueError:
            continue  # a truncated or non-json line is skipped, not fatal
        ts = o.get("timestamp")
        if ts:
            if m["first_ts"] is None:
                m["first_ts"] = ts
            m["last_ts"] = ts
        typ = o.get("type")
        msg = o.get("message") or {}
        role = msg.get("role") if isinstance(msg, dict) else None

        if typ == "user" and role == "user":
            blocks = _blocks(msg)
            has_tool_result = any(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in blocks
            )
            has_text = any(
                isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip()
                for b in blocks
            )
            if has_text and not has_tool_result:
                m["user_prompts"] += 1

        if typ == "assistant" and role == "assistant":
            m["assistant_responses"] += 1
            u = msg.get("usage") or {}
            m["output_tokens"] += u.get("output_tokens", 0) or 0
            m["cache_read_tokens"] += u.get("cache_read_input_tokens", 0) or 0
            text = _text_of(msg)
            m["self_corrections"] += len(re.findall(r"(?:^|\s)Fixed:", text))
            m["unverified_flags"] += text.count("[unverified]")
            m["todo_flags"] += text.count("[todo]")
            for b in _blocks(msg):
                if not (isinstance(b, dict) and b.get("type") == "tool_use"):
                    continue
                name = b.get("name", "?")
                m["tool_calls"] += 1
                m["tools"][name] = m["tools"].get(name, 0) + 1
                inp = b.get("input") or {}
                if name == "Skill":
                    skill = inp.get("skill")
                    if skill:
                        m["skills_loaded"].append(skill.split(":")[-1])
                else:
                    # A skill read straight from its file (Read, or cat in Bash) is a load too.
                    for read in SKILL_FILE.findall(json.dumps(inp)):
                        m["skills_loaded"].append(read)
                if name == "WebSearch":
                    m["web_searches"] += 1
                elif name == "AskUserQuestion":
                    m["questions_asked"] += 1
                elif name == "Bash":
                    cmd = inp.get("command", "") or ""
                    if test_cmd.search(cmd):
                        m["test_runs"] += 1
                    if re.search(r"\bgit commit\b", cmd):
                        m["commits"] += 1
    return m


def render(name, m):
    out = []
    out.append(f"# {name}")
    span = ""
    if m["first_ts"] and m["last_ts"]:
        span = f"  ({m['first_ts']} -> {m['last_ts']})"
    out.append(f"  turns         user {m['user_prompts']} / assistant {m['assistant_responses']}{span}")
    out.append(f"  tool calls    {m['tool_calls']}  " + " ".join(
        f"{k}:{v}" for k, v in sorted(m["tools"].items(), key=lambda kv: -kv[1])))
    skills = m["skills_loaded"]
    out.append(f"  skills loaded {len(skills)}  " + (", ".join(skills) if skills else "-"))
    out.append(f"  decisions     questions asked {m['questions_asked']} · web searches {m['web_searches']}")
    out.append(f"  discipline    test-runs {m['test_runs']} · commits {m['commits']} · self-corrections (Fixed:) {m['self_corrections']}")
    out.append(f"  honesty flags [unverified] {m['unverified_flags']} · [todo] {m['todo_flags']}")
    out.append(f"  cost          output {m['output_tokens']:,} tok · cache-read {m['cache_read_tokens']:,} tok")
    return "\n".join(out)


def collect(paths):
    files = []
    for p in paths:
        p = Path(p)
        if p.is_dir():
            files.extend(sorted(p.glob("*.jsonl")))
        else:
            files.append(p)
    return files


def main(argv):
    args = [a for a in argv if a != "--json"]
    as_json = "--json" in argv
    if not args:
        print(__doc__)
        return 2
    files = collect(args)
    if not files:
        print("no transcript files found", file=sys.stderr)
        return 1
    results = {}
    for f in files:
        with open(f, encoding="utf-8") as fh:
            results[f.name] = crawl(fh)
    if as_json:
        print(json.dumps(results, indent=2))
    else:
        print("\n\n".join(render(name, m) for name, m in results.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
