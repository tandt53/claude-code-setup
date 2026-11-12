#!/usr/bin/env python3
r"""
Claude Code UserPromptSubmit hook: when the user's typed message asks what
something is, why, or whether they read it right, or is just "??", remind
Claude that an earlier explanation may not have landed.

Why: the user rarely says when something did not land, and silence, "ok" or
a pick was read as understanding. Seen three times in one session (11/2026):
the user wrote "xem xét bỏ qa-sweep", then asked when qa-sweep is used, and
once told, kept it; approved the measurement tools and a PR, then asked what
churn, trace_rollup, compare, judge and history are; picked the Appium 4
upgrade, then asked what the iOS typing problem was. The rule "if they must
ask what this is about, the brief did not happen" was in the context all
three times and was not acted on.

What it does: reads the prompt the user typed (pasted blocks, system
reminders, code fences and harness text left out, and so is a message from
another Claude session). A question pattern counts only inside a clause that
ends in "?", so an instruction ("Chạy test khi nào xong thì báo") is not a
question. Some patterns are cancelled by a word in the same clause: a next
step ("tiếp theo là gì ?"), a status ("xong rồi ah?"), a plan ("ta cần làm
gì ?"). On a match it adds a reminder: confirm and go deeper if the question
builds correctly, else answer from one real case, explain another way if it
was explained before, and reopen any pick or approval that rested on it.
"??" gets a reminder to say the last message again another way.
What it does NOT do: block, rewrite or judge the message, or catch every
status question ("layout bị dính ah?" still matches); the reminder says to
just answer those. Measured on 1119 short messages the user typed in earlier
sessions: 185 matched before these rules, see docs/MECHANISMS.md for after.

Output: JSON whose hookSpecificOutput.additionalContext goes into the
context, or nothing. Always exit 0: a reminder must never stop a message.
Standard library only; reuses after_compact.py, which sits beside it. If that
file is missing the hook stays silent.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:  # python3 -I drops the script's folder from sys.path: add it back
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from after_compact import BLOCKS, FENCES, NOT_TYPED
except Exception:  # after_compact.py missing or broken: stay silent, never block
    BLOCKS = FENCES = NOT_TYPED = None

FROM_OTHER_SESSION = ("Another Claude session sent a message", "<agent-message")

# Words that cancel a pattern when they share its clause.
NEXT = r"\b(?:tiếp\s+theo|còn\s+lại|next)\b"
STATUS = r"\b(?:xong|rồi)\b"
PLAN = r"\b(?:nên|cần|phải)\s+làm\s+gì\b"

# (name, pattern, where, cancelled by). where "q": only in a clause ending in
# "?"; "any": anywhere. Each name is quoted back in the reminder. Vietnamese
# first: it is what the user writes. Every rule has a test that only it meets.
PATTERNS = [
    ("là gì", r"\blà\s+(?:cái\s+)?(?:gì|j)\b", "q", NEXT),
    ("là sao", r"\blà\s+sao\b", "q", None),
    ("khác gì", r"\bkhác\s+(?:gì|nhau)\b", "q", None),
    ("có phải là", r"\bcó\s+phải\s+là\b", "q", None),
    ("tại sao", r"\b(?:tại|vì)\s+sao\b|\bsao\s+(?:lại|phải)\b", "q", None),
    ("khi nào", r"\bkhi\s+nào\b", "q", None),
    ("làm gì", r"\blàm\s+gì\b", "q", PLAN + "|" + NEXT),
    ("hay là", r"\bhay\s+là\b", "q", None),
    ("đúng ko", r"\bđúng\s+(?:ko|không|k|chưa|hông)\b", "q", STATUS),
    ("chưa hiểu", r"\b(?:chưa|ko|không|k)\s+(?:hiểu|rõ)\b", "any", None),
    ("ah?", r"\b(?:ah|à|hả)\s*\?", "q", STATUS),
    ("what is", r"\bwhat(?:'s|\s+is|\s+are|\s+does)\b", "q", NEXT),
    ("why", r"\bwhy\b", "q", None),
    ("difference", r"\bdifference\s+between\b", "q", None),
    ("when to use", r"\bwhen\s+(?:do|should|would|to)\b.*\buse\b", "q", None),
    ("same as", r"\bthe\s+same\s+as\b", "q", None),
    ("don't get", r"\b(?:don'?t|do\s+not|didn'?t)\s+(?:get|understand|follow)\b", "any", None),
]
COMPILED = [(name, re.compile(rx, re.I), where, re.compile(skip, re.I) if skip else None)
            for name, rx, where, skip in PATTERNS]
# A sentence ends at . ! ? followed by a space, so "compare.py?" stays whole.
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
AGAIN = re.compile(r"^\?\?")

GAP = ('The user\'s message asks what something is, why, or whether they read it right ("{name}"). '
       "Users rarely say when an explanation did not land. If the question builds correctly on what you "
       "said, confirm it in one line and go one level deeper. If it shows a gap, answer from one real case "
       "first, and if you explained this before, explain it another way, not in the same words. If a pick "
       "or approval of theirs rested on it, restate that decision with what they now know and ask whether "
       "it still holds. A plain status, lookup or instruction message needs none of this: just answer it.")
RE_EXPLAIN = ("The user typed ??: your last message did not land. Say its main point again another way: "
              "one real case first, fewer terms, smaller steps, not the same words.")


def typed(prompt: str) -> str:
    """The text the user typed: pasted blocks, reminders and code fences removed."""
    return " ".join(FENCES.sub(" ", BLOCKS.sub(" ", prompt)).split())


def gap(text: str) -> str | None:
    """The name of the first pattern that matches and is not cancelled in its clause."""
    clauses = [s for s in SENTENCE_END.split(text) if s.rstrip().endswith("?")]
    for name, rx, where, skip in COMPILED:
        for part in (clauses if where == "q" else [text]):
            if rx.search(part) and not (skip and skip.search(part)):
                return name
    return None


def reminder(prompt: str) -> str | None:
    text = typed(prompt)
    if not text or text.startswith(NOT_TYPED) or text.startswith(FROM_OTHER_SESSION):
        return None
    if AGAIN.match(text):
        return RE_EXPLAIN
    name = gap(text)
    return GAP.format(name=name) if name else None


def main() -> int:
    try:
        if BLOCKS is None:
            return 0
        event = json.load(sys.stdin)
        prompt = event.get("prompt") if isinstance(event, dict) else None
        if not isinstance(prompt, str):
            return 0
        text = reminder(prompt)
        if text:
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit", "additionalContext": text}}))
    except Exception:  # malformed or cut-off input, or a bug: never block the message
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
