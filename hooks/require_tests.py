#!/usr/bin/env python3
r"""
Claude Code Stop hook: do not let a turn end after code was edited unless the
project's tests were run after the last edit.

What it enforces: a test command ran, after the last code edit, in this turn.
What it does NOT enforce: that the tests passed, that they test the right
thing, or that they are any good. That is the job of the `verify-work` skill.

What counts as a code edit: an Edit/Write/MultiEdit/NotebookEdit of a file
that is not documentation and lies inside a git work tree (a `.git` in its
directory or a parent). Files outside every repository, such as a session's
scratchpad or /tmp, never count: they are throwaway. Documentation is a file
with a documentation suffix (.md, .txt, an image...), or any file under a
`docs` folder at the root of the repository or of a package (a folder holding
package.json, pyproject.toml, go.mod...). A `docs` folder deeper in the code,
such as a web app's app/docs/ route, stays code: a wrong guess here should
cost a test run, never skip one.

How it finds the test command for an edited file, in order:
  1. A line `Test command: \`<cmd>\`` in CLAUDE.md, AGENTS.md or
     .claude/CLAUDE.md, in the file's directory or any parent up to its repo
     root. The session's working directory plays no part, so a session working
     from a scratchpad still finds the repository's command. Several lines are
     allowed; any one of them counts. `Test command: \`none\`` switches the
     gate off for that project.
  2. Otherwise, any common test command (npm test, pytest, go test, ...).
Each edited file needs its own command to have run after it, so a turn that
edits two repositories needs both test runs.

Escape hatches:
  - The hook blocks once per turn. If Claude stops again after being told
    (stop_hook_active), it is let through: Claude must then report the tests
    as [unverified] instead of looping.
  - CLAUDE_SKIP_TEST_GATE=1 in the environment disables it.

Exit 0 = allow. Exit 2 + message on stderr = block; Claude sees the message.
Standard library only.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}

# Edits to these do not require tests.
NON_CODE_SUFFIXES = {
    ".md", ".mdx", ".txt", ".rst", ".adoc", ".png", ".jpg", ".jpeg", ".gif",
    ".svg", ".webp", ".pdf", ".csv", ".lock", ".log",
}
NON_CODE_NAMES = {"CLAUDE.md", "AGENTS.md", "LICENSE", "CHANGELOG", ".gitignore"}

# A folder holding one of these is a package root: its docs/ is documentation.
PACKAGE_MANIFESTS = {
    "package.json", "deno.json", "pyproject.toml", "setup.py", "go.mod", "Cargo.toml",
    "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json", "mix.exs",
    "Package.swift",
}

COMMON_TEST_COMMANDS = re.compile(
    r"""(?x)
    \b(
      (npm|pnpm|yarn|bun)\s+(run\s+)?test\b
    | npx\s+(vitest|jest|mocha|playwright\s+test)\b
    | (vitest|jest|mocha)\b
    | pytest\b | python3?\s+-m\s+(pytest|unittest)\b | tox\b | nox\b
    | go\s+test\b
    | cargo\s+(test|nextest)\b
    | mvn\s+(\S+\s+)*(test|verify)\b | (\./)?gradlew?\s+(\S+\s+)*(test|check)\b
    | dotnet\s+test\b
    | (bundle\s+exec\s+)?(rspec|rake\s+test)\b
    | mix\s+test\b | phpunit\b | swift\s+test\b | deno\s+test\b
    | make\s+(test|check)\b
    | tsx\s+--test\b | node\s+--test\b
    )
    """
)

DECLARED = re.compile(r"^\s*[-*]?\s*\**Test command\**\s*:\s*`([^`]+)`", re.IGNORECASE | re.MULTILINE)


def repo_root(path: Path) -> Path | None:
    """The git work tree holding path, or None when it lies outside every repo."""
    for d in path.parents:
        if (d / ".git").exists():
            return d
    return None


def declared_commands(start: Path) -> list[str] | None:
    """Commands declared in CLAUDE.md / AGENTS.md from start up to the repo root.
    Returns None when nothing is declared, [] when declared `none`."""
    here = start.resolve()
    for d in [here, *here.parents]:
        found: list[str] = []
        for name in ("CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md"):
            f = d / name
            if f.is_file():
                try:
                    found += DECLARED.findall(f.read_text(encoding="utf-8", errors="replace"))
                except OSError:
                    pass
        if found:
            cmds = [c.strip() for c in found]
            return [] if any(c.lower() == "none" for c in cmds) else cmds
        if (d / ".git").exists():
            break
    return None


def load_turn(transcript_path: str) -> list[dict]:
    """Entries of the current turn: everything after the last real user prompt
    (a user message that is not just tool results)."""
    entries: list[dict] = []
    with open(transcript_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    def is_prompt(e: dict) -> bool:
        if e.get("type") != "user":
            return False
        content = (e.get("message") or {}).get("content")
        if isinstance(content, str):
            return True
        if isinstance(content, list):
            return any(isinstance(b, dict) and b.get("type") == "text" for b in content) and not any(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in content
            )
        return False

    start = 0
    for i, e in enumerate(entries):
        if is_prompt(e):
            start = i + 1
    return entries[start:]


def tool_uses(entries: list[dict]):
    for e in entries:
        if e.get("type") != "assistant":
            continue
        content = (e.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for b in content:
            if isinstance(b, dict) and b.get("type") == "tool_use":
                yield b.get("name", ""), b.get("input") or {}


def is_code_path(path: str) -> bool:
    p = Path(path)
    if p.name in NON_CODE_NAMES:
        return False
    return p.suffix.lower() not in NON_CODE_SUFFIXES


def in_docs_folder(path: Path, root: Path) -> bool:
    """True when path lies under a `docs` folder that sits at the repository
    root or at a package root (a folder holding a package manifest)."""
    parts = path.relative_to(root).parts[:-1]
    for i, part in enumerate(parts):
        if part.lower() != "docs":
            continue
        parent = root.joinpath(*parts[:i])
        if parent == root or any((parent / m).is_file() for m in PACKAGE_MANIFESTS):
            return True
    return False


def normalize(cmd: str) -> str:
    return " ".join(cmd.split())


def decide(event: dict, cwd: Path) -> tuple[bool, str]:
    """(allow, reason)."""
    if os.environ.get("CLAUDE_SKIP_TEST_GATE") == "1":
        return True, "disabled by CLAUDE_SKIP_TEST_GATE"
    if event.get("stop_hook_active"):
        return True, "already reminded once this turn"
    tp = event.get("transcript_path")
    if not tp or not os.path.isfile(tp):
        return True, "no transcript"

    edits: list[tuple[int, Path, list[str] | None]] = []  # (index, file, its test commands)
    runs: list[tuple[int, str]] = []
    for i, (name, inp) in enumerate(tool_uses(load_turn(tp))):
        if name in EDIT_TOOLS:
            raw = inp.get("file_path") or inp.get("notebook_path") or ""
            if not raw or not is_code_path(raw):
                continue
            path = (cwd / raw).resolve() if not Path(raw).is_absolute() else Path(raw).resolve()
            root = repo_root(path)
            if root is None:
                continue  # scratchpad, /tmp, anything outside a repository
            if in_docs_folder(path, root):
                continue  # documentation, whatever its suffix
            declared = declared_commands(path.parent)
            if declared == []:
                continue  # project declares Test command: none
            edits.append((i, path, declared))
        elif name == "Bash":
            runs.append((i, normalize(str(inp.get("command", "")))))

    def ran_after(i: int, declared: list[str] | None) -> bool:
        for j, cmd in runs:
            if j <= i:
                continue
            if declared and any(normalize(d) in cmd for d in declared):
                return True
            if declared is None and COMMON_TEST_COMMANDS.search(cmd):
                return True
        return False

    if not edits:
        return True, "no code edited in a repository this turn"
    missing = [(path, declared) for i, path, declared in edits if not ran_after(i, declared)]
    if not missing:
        return True, "tests ran after the last edit"

    shown = ", ".join(sorted({p.name for p, _ in missing})[:5])
    commands = sorted({d for _, declared in missing for d in (declared or [])})
    how = (f"Run: {' or '.join(f'`{d}`' for d in commands)}" if commands else "")
    if any(declared is None for _, declared in missing):
        how = (how + ". " if how else "") + (
            "No `Test command:` line found in CLAUDE.md or AGENTS.md; run the project's tests, "
            "and add that line so this check knows the command")
    return False, (
        f"Code was edited this turn ({shown}) but the tests were not run after the last edit. "
        f"{how}. If they cannot run here, say so in the report and mark them [unverified]; "
        f"do not claim they pass."
    )


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # never block on a malformed event
    cwd = Path(event.get("cwd") or os.getcwd())
    try:
        allow, reason = decide(event, cwd)
    except Exception as exc:  # a broken hook must not trap the session
        print(f"require_tests hook error, allowing: {exc}", file=sys.stderr)
        return 0
    if allow:
        return 0
    print(reason, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
