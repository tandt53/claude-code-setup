#!/usr/bin/env python3
r"""
Claude Code UserPromptSubmit hook: stop a message that holds a secret before
it reaches Claude.

What it reads: the whole message, pasted blocks included. Pasting a log, a
curl command or a config file is how a key usually slips in, so unlike
gap_question.py this hook does not skip pasted text.

Two layers:
  1. Patterns in this file, always on, only for forms that are certainly
     secrets: GitHub tokens (ghp_ and the other gh*_ kinds, github_pat_),
     Anthropic keys (sk-ant-), AWS access key ids (AKIA, ASIA), private key
     blocks, JWTs, and a credential header (Authorization, X-API-Key,
     X-Auth-Token...) or a session cookie whose value is not a placeholder
     such as $TOKEN or <your-key>.
  2. gitleaks, when it is installed: the message goes to `gitleaks stdin`,
     given 2 seconds. A finding of a rule for one of the certain forms
     blocks; any other finding (generic-api-key...) only warns. When gitleaks
     is missing, fails or runs out of time, layer 1 decides alone.

What it does: a certain secret blocks the message with JSON (decision
"block", suppressOriginalPrompt) naming the line and the kind of each secret
with the middle of its value masked, never the secret itself. This event
cannot rewrite a message, only stop it, and Claude Code's documentation says
a blocked message may still be saved on this machine (session transcript,
prompt history): the hook keeps a secret from Claude, not off the disk.

The way out: `[secret-ok]` at the start of the message sends it anyway, with
a warning. CLAUDE_SKIP_SECRET_GUARD=1 in the environment turns the hook off.

It never fails the prompt: input it cannot read, or an error of its own, lets
the message through with a warning that it was not scanned. Exit code is
always 0. Standard library only.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import shutil
import subprocess
import sys

GITLEAKS_SECONDS = 2

# Layer 1: forms that are certainly secrets, with the kind shown to the user.
CERTAIN = [
    ("GitHub token (fine-grained)", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{80,255}")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}")),
    ("Anthropic API key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{32,}")),
    ("AWS access key id", re.compile(r"\b(?:AKIA|ASIA)[A-Z2-7]{16}\b")),
    ("private key", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]{40,}")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}")),
]

# A header that carries a credential, in a raw request, a curl -H, or code.
HEADER = re.compile(
    r"""(?ix)
    \b(?:proxy-)?authorization|\bx-api-key|\bapi-key|\bapikey|\bx-auth-token
    |\bx-access-token|\bprivate-token|\bx-goog-api-key
    """)
HEADER_VALUE = re.compile(
    r"""(?ix) ["']?\s*[:=]\s*["'`]?
        (?:(?P<scheme>bearer|token|basic)\s+)?
        (?P<value>[^\s"'`,;{}()\]]+)""")
COOKIE = re.compile(r"""(?i)\bcookie["']?\s*:\s*["']?(?P<pairs>[^\n"'`]+)""")
SESSION_COOKIE = re.compile(r"(?i)sess|sid\b|token|auth|jwt|remember|__secure-|__host-")
PLACEHOLDER = re.compile(
    r"""(?ix)^(?: [$<%\[]|\{\{|process\.env|os\.environ|env\.
        | (?:x+|\*+|\.+|redacted|example|changeme|placeholder|your[-_].*)$ )""")

# gitleaks rules for the certain forms: these block, any other rule warns.
GITLEAKS_CERTAIN = {
    "github-pat", "github-fine-grained-pat", "github-oauth", "github-app-token",
    "github-refresh-token", "anthropic-api-key", "anthropic-admin-api-key",
    "aws-access-token", "private-key", "jwt", "curl-auth-header",
}

IDE_PREFIX = re.compile(r"\A\s*(?:<(ide_[a-z_]+)>.*?</\1>\s*)+", re.DOTALL)
ESCAPE = "[secret-ok]"


def mask(value: str) -> str:
    if value.startswith("-----BEGIN"):
        return value.split("\n", 1)[0].strip() + " …"
    if len(value) <= 12:
        return value[:2] + "…"
    return value[:6] + "…" + value[-4:]


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def looks_real(value: str) -> bool:
    """A header value that is a credential, not a placeholder or a word."""
    value = value.strip()
    if len(value) < 16 or PLACEHOLDER.search(value) or len(set(value)) < 6:
        return False
    return bool(re.search(r"[A-Za-z]", value) and re.search(r"\d", value))


def is_basic_credential(value: str) -> bool:
    try:
        decoded = base64.b64decode(value + "=" * (-len(value) % 4), validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return False
    user, sep, password = decoded.partition(":")
    return bool(sep and user and password and decoded.isprintable())


def pattern_findings(text: str) -> list[tuple[int, str, str]]:
    """(line, kind, masked value) for each certain secret, by layer 1."""
    found: list[tuple[int, int, str, str]] = []
    taken: list[tuple[int, int]] = []

    def add(start: int, end: int, kind: str, value: str) -> None:
        if any(start < e and s < end for s, e in taken):
            return  # already reported as a more specific kind
        taken.append((start, end))
        found.append((start, line_of(text, start), kind, mask(value)))

    for kind, rx in CERTAIN:
        for m in rx.finditer(text):
            if kind == "AWS access key id" and m.group().endswith("EXAMPLE"):
                continue  # AWS's documented sample key
            add(m.start(), m.end(), kind, m.group())
    for h in HEADER.finditer(text):
        v = HEADER_VALUE.match(text, h.end())
        if not v:
            continue
        value, scheme = v.group("value"), (v.group("scheme") or "").lower()
        real = is_basic_credential(value) if scheme == "basic" else looks_real(value)
        if real:
            add(v.start("value"), v.end("value"), "credential header", value)
    for c in COOKIE.finditer(text):
        offset = c.start("pairs")
        for pair in re.finditer(r"([^=;\s]+)=([^;\s]+)", c.group("pairs")):
            if SESSION_COOKIE.search(pair.group(1)) and looks_real(pair.group(2)):
                add(offset + pair.start(2), offset + pair.end(2), "session cookie", pair.group(2))
    return [(line, kind, shown) for _, line, kind, shown in sorted(found)]


def gitleaks_findings(text: str, cwd: str | None) -> list[tuple[int, str]] | None:
    """(line, rule) for each gitleaks finding; None when gitleaks is missing,
    fails, or does not answer in time."""
    exe = shutil.which("gitleaks")
    if not exe:
        return None
    try:
        p = subprocess.run(
            [exe, "stdin", "--no-banner", "--log-level", "error", "--redact",
             "--report-format", "json", "--report-path", "-", "--timeout", str(GITLEAKS_SECONDS)],
            input=text, capture_output=True, text=True, timeout=GITLEAKS_SECONDS,
            cwd=cwd if cwd and os.path.isdir(cwd) else None)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if p.returncode not in (0, 1):
        return None
    try:
        report = json.loads(p.stdout or "[]")
    except ValueError:
        return None
    if not isinstance(report, list):
        return None
    return [(int(f.get("StartLine") or 0), str(f.get("RuleID") or "unknown"))
            for f in report if isinstance(f, dict)]


def block(lines: list[str]) -> dict:
    reason = (
        "secret_guard stopped this message before it reached Claude: it holds what looks like a secret.\n"
        + "\n".join(f"  {x}" for x in lines)
        + f"\nRemove it and send the message again, or start the message with {ESCAPE} to send it as it is."
        " The text may still be saved on this machine (session transcript, prompt history).")
    return {"decision": "block", "reason": reason,
            "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "suppressOriginalPrompt": True}}


def decide(event: object) -> dict | None:
    """The JSON to print, or None to let the message through silently."""
    if os.environ.get("CLAUDE_SKIP_SECRET_GUARD") == "1":
        return None
    if not isinstance(event, dict) or not isinstance(event.get("prompt"), str):
        return {"systemMessage": "secret_guard could not scan this message (no prompt text in the "
                                 "hook input), so it was sent unchecked."}
    text = event["prompt"]
    if not text.strip():
        return None
    if IDE_PREFIX.sub("", text).lstrip().startswith(ESCAPE):
        return {"systemMessage": f"secret_guard: {ESCAPE} at the start, so this message was sent "
                                 "without a secret check."}

    certain = [f"line {line}: {kind} {shown}" for line, kind, shown in pattern_findings(text)]
    warnings = []
    for line, rule in gitleaks_findings(text, event.get("cwd")) or []:
        where = f"line {line}" if line else "somewhere"
        if rule in GITLEAKS_CERTAIN:
            if not any(x.startswith(f"line {line}:") for x in certain):
                certain.append(f"{where}: gitleaks rule {rule}")
        else:
            warnings.append(f"{where} ({rule})")
    if certain:
        return block(certain)
    if warnings:
        return {"systemMessage": "secret_guard: gitleaks flags " + ", ".join(warnings)
                                 + " as a possible secret. The message was sent; check it, and"
                                 " rotate the value if it is real."}
    return None


def main() -> int:
    try:
        raw = sys.stdin.read()
        try:
            event = json.loads(raw)
        except ValueError:
            event = None
        out = decide(event)
    except Exception as exc:  # a broken guard must never trap the user's message
        out = {"systemMessage": f"secret_guard could not scan this message ({type(exc).__name__}), "
                                "so it was sent unchecked."}
    if out is not None:
        print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
