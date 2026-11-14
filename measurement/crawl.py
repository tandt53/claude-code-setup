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
import importlib.util
import json
import re
import sys
from pathlib import Path


SKILL_FILE = re.compile(r"skills/([a-z0-9][a-z0-9-]*)/SKILL\.md")
SKILL_READ_BASH = re.compile(
    r"\b(?:cat|head|tail|less|more|bat|sed\s+-n)\b[^|;&<>]*?skills/([a-z0-9][a-z0-9-]*)/SKILL\.md")

# A user line that starts with one of these was written by Claude Code, not typed.
NOT_TYPED = ("<task-notification", "<local-command", "[Request interrupted")


def _load_gate():
    """hooks/require_tests.py, a sibling of measurement/, so that "a test run"
    means the same here as in the Stop hook. None when it is not beside us."""
    f = Path(__file__).resolve().parent.parent / "hooks" / "require_tests.py"
    if not f.is_file():
        return None
    spec = importlib.util.spec_from_file_location("require_tests", f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_gate = _load_gate()


def declared_test_commands(cwd):
    """The `Test command:` lines the project at cwd declares in CLAUDE.md or
    AGENTS.md, as the Stop hook finds them. [] when none can be read."""
    if not cwd or _gate is None:
        return []
    try:
        return _gate.declared_commands(Path(cwd)) or []
    except OSError:
        return []


def _first_cwd(lines):
    for line in lines:
        try:
            cwd = json.loads(line).get("cwd")
        except (ValueError, AttributeError):
            continue
        if cwd:
            return cwd
    return None


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


def crawl(lines, test_commands=()):
    """Compute metrics from an iterable of transcript lines (raw json strings).

    user_prompts counts what a person typed: prompts, slash commands and
    messages typed while Claude worked (queued, origin "human"); not skill
    text, reminders, task notifications, compaction summaries or another
    session's messages. test_runs counts Bash commands that run tests: any
    common test command the Stop hook knows, or one of test_commands (the
    project's declared `Test command:` lines); None when the hook's module is
    not beside this file, since then it cannot be told.

    Returns a dict of metrics. Pure: no I/O, so it is unit-testable with a
    synthetic transcript.
    """
    declared = [" ".join(c.split()) for c in test_commands if c and c.strip()]
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

        if typ == "user" and role == "user" and not o.get("isMeta") and not o.get("isCompactSummary"):
            blocks = _blocks(msg)
            has_tool_result = any(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in blocks
            )
            texts = [
                b.get("text", "") for b in blocks
                if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip()
            ]
            if texts and not has_tool_result and not texts[0].lstrip().startswith(NOT_TYPED):
                m["user_prompts"] += 1

        if typ == "attachment":
            att = o.get("attachment") or {}
            origin = att.get("origin")
            if att.get("type") == "queued_command" and isinstance(origin, dict) and origin.get("kind") == "human":
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
                elif name == "Read":
                    # A skill read straight from its file is a load too.
                    m["skills_loaded"].extend(SKILL_FILE.findall(str(inp.get("file_path") or "")))
                elif name == "Bash":
                    # So is cat, head or sed -n on it; an edit, grep or git diff of it is not.
                    m["skills_loaded"].extend(SKILL_READ_BASH.findall(str(inp.get("command") or "")))
                if name == "WebSearch":
                    m["web_searches"] += 1
                elif name == "AskUserQuestion":
                    m["questions_asked"] += 1
                elif name == "Bash":
                    cmd = " ".join((inp.get("command", "") or "").split())
                    if any(d in cmd for d in declared) or (
                            _gate is not None and _gate.COMMON_TEST_COMMANDS.search(cmd)):
                        m["test_runs"] += 1
                    if re.search(r"\bgit commit\b", cmd):
                        m["commits"] += 1
    if _gate is None:
        m["test_runs"] = None  # without the hook's list, a count would mislead
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
    runs = "n/a" if m["test_runs"] is None else m["test_runs"]
    out.append(f"  discipline    test-runs {runs} · commits {m['commits']} · self-corrections (Fixed:) {m['self_corrections']}")
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
            lines = fh.readlines()
        results[f.name] = crawl(lines, test_commands=declared_test_commands(_first_cwd(lines)))
    if as_json:
        print(json.dumps(results, indent=2))
    else:
        print("\n\n".join(render(name, m) for name, m in results.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
