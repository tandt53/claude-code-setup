#!/usr/bin/env python3
r"""
Claude Code SessionStart hook, matcher "compact": once the context has been
compacted, tell Claude which skills to load again and which language to
reply in.

Why: after a compaction Claude Code puts back the skills the session loaded,
with the text they had when loaded. A skill edited on disk since then stays
old in the context, and Claude, seeing it there, does not load it again. The
compaction summary is written in English, and replies can drift into it.
Seen: one session ran five days on the skill texts of its first day, missing
rules added on the third, and after one compaction answered in English for
three hours until the user asked for Vietnamese.

What it does: reads the transcript; lists the skills loaded in this session
(Skill tool calls, and /<skill> commands the user typed); marks each one
whose SKILL.md changed on disk after it was last loaded; quotes the start of
the user's last three messages long enough to show their language (pasted
blocks, tables and code left out).
What it does NOT do: load anything, or check that Claude follows it.

A skill is looked up as <cwd>/.claude/skills/<name>/SKILL.md, then
~/.claude/skills/<name>/SKILL.md. A plugin skill (name with a prefix) is
listed but never marked.

Output: JSON whose hookSpecificOutput.additionalContext goes into the
context. Always exit 0: a reminder must never stop a session. An unreadable
transcript still gives the general reminder.
Standard library only.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

MIN_LETTERS = 20  # a reply like "ok" shows no language
SAMPLES = 3       # one message can open with a pasted English error
QUOTE_CHARS = 100
LOCAL_PREFIXES = {"userSettings", "projectSettings"}
COMMAND = re.compile(r"<command-name>/?([^<\s]+)</command-name>")
NOT_TYPED = ("<command-name>", "<command-message>", "<local-command", "<task-notification>",
             "<system-reminder>", "Stop hook feedback", "Caveat:")
# Closing tags can carry the opening tag's id: </pasted_content id="f882">
BLOCKS = re.compile(r"<(pasted_content|system-reminder)\b[^>]*>.*?</\1\b[^>]*>", re.S)
FENCES = re.compile(r"```.*?(```|$)", re.S)
TABLE_ROWS = re.compile(r"^\s*\|.*$", re.M)  # a pasted table shows no language


def parse_time(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def text_of(message) -> str:
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content
                        if isinstance(b, dict) and b.get("type") == "text")
    return ""


def is_tool_result(message) -> bool:
    content = message.get("content") if isinstance(message, dict) else None
    return isinstance(content, list) and any(
        isinstance(b, dict) and b.get("type") == "tool_result" for b in content)


def read_transcript(path: Path):
    """Skills loaded (name -> last load time) and the user's last long messages."""
    loads: dict[str, datetime | None] = {}
    order: list[str] = []
    last_user: list[str] = []

    def loaded(name: str, when: datetime | None):
        if name not in loads:
            order.append(name)
        previous = loads.get(name)
        loads[name] = when if previous is None or (when and when > previous) else previous

    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            if '"Skill"' not in line and '"user"' not in line:
                continue  # cheap filter: transcripts reach hundreds of MB
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue  # a line cut off midway, or not JSON
            if not isinstance(row, dict) or row.get("isSidechain"):
                continue
            when = parse_time(row.get("timestamp"))
            message = row.get("message") or {}
            if row.get("type") == "assistant":
                for block in message.get("content") or []:
                    if (isinstance(block, dict) and block.get("type") == "tool_use"
                            and block.get("name") == "Skill"):
                        name = (block.get("input") or {}).get("skill")
                        if isinstance(name, str) and name.strip():
                            loaded(name.strip(), when)
            elif row.get("type") == "user" and not is_tool_result(message):
                if row.get("isMeta") or row.get("isCompactSummary"):
                    continue  # a skill's own text, or the summary: not typed by the user
                text = text_of(message)
                for name in COMMAND.findall(text):
                    loaded("/" + name, when)  # kept only if a skill of that name exists
                stripped = TABLE_ROWS.sub(" ", FENCES.sub(" ", BLOCKS.sub(" ", text))).strip()
                if stripped.startswith(NOT_TYPED):
                    continue
                if sum(c.isalpha() for c in stripped) >= MIN_LETTERS:
                    last_user = (last_user + [" ".join(stripped.split())])[-SAMPLES:]
    return [(n, loads[n]) for n in order], last_user


def skill_file(name: str, cwd: Path | None) -> Path | None:
    if ":" in name:
        prefix, _, base = name.partition(":")
        if prefix not in LOCAL_PREFIXES:
            return None
        name = base
    roots = ([cwd / ".claude" / "skills"] if cwd else []) + [Path.home() / ".claude" / "skills"]
    for root in roots:
        f = root / name / "SKILL.md"
        if f.is_file():
            return f
    return None


def describe(skills, cwd: Path | None) -> list[str]:
    out = []
    for name, when in skills:
        typed = name.startswith("/")
        clean = name.lstrip("/")
        f = skill_file(clean, cwd)
        if typed and f is None:
            continue  # a built-in command such as /compact, not a skill
        if f and when:
            changed = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc) > when
            if changed:
                stamp = when.astimezone().strftime("%Y-%m-%d %H:%M")
                out.append(f"{clean} (its file changed after it was loaded at {stamp})")
                continue
        out.append(clean)
    return out


def message(skills: list[str], last_user: list[str]) -> str:
    # Each line opens with what to do: a first line that only reports the
    # compaction was read as a status note and the rest ignored (live run 07/11).
    if skills:
        first = ("Before the next step that uses a skill, load it again with the Skill tool. "
                 "After this compaction, the skills loaded earlier are back in the context with the "
                 "text they had when loaded, not the text on disk now. Loaded in this session: "
                 + ", ".join(skills) + ".")
    else:
        first = ("Before the next step that uses a skill, load it with the Skill tool, even if its "
                 "text is already in the context: a copy from before this compaction may be older "
                 "than the file.")
    language = "Reply in the language the user writes in, not the language of the compaction summary."
    if last_user:
        quotes = " · ".join('"' + m[:QUOTE_CHARS] + ("…" if len(m) > QUOTE_CHARS else "") + '"'
                            for m in last_user)
        language += f" Their last messages began (newest last): {quotes}"
    return first + "\n" + language


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        event = {}
    if not isinstance(event, dict):
        event = {}
    source = event.get("source")
    if source not in (None, "compact"):
        return 0
    cwd = Path(event["cwd"]) if isinstance(event.get("cwd"), str) else None
    skills, last_user = [], []
    tp = event.get("transcript_path")
    if isinstance(tp, str) and tp:
        try:
            loaded, last_user = read_transcript(Path(os.path.expanduser(tp)))
            skills = describe(loaded, cwd)
        except OSError:
            pass
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": message(skills, last_user)}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
