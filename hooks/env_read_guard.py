#!/usr/bin/env python3
r"""
Claude Code PreToolUse hook (Bash): stop a command that would print a
protected file or a secret environment variable into Claude's context.

Why: Read(...) deny rules stop Claude's file tools and the Bash file commands
Claude Code recognises (cat, head, tail, sed, tee, redirections). They do not
stop a command that hands the file to another program (`grep KEY .env`,
`awk`, `python3 -c "open('.env')"`), nor one that prints the environment,
where keys exported by a shell profile live.

Which files: the ones the Read(...) deny rules name, read from
~/.claude/settings.json and the project's .claude/settings.json and
.claude/settings.local.json, so the user keeps one list in Claude Code's own
syntax. The anchors follow Claude Code's: `//abs`, `~/home`, `/` from the
project (project settings only), anything else from the current directory.
A bare name (`.env`, `*.pem`) matches at any depth, here anywhere on the
machine. A `!` rule carves a path out of the relative rules listed before it
in the same file, as Claude Code does; it cannot reopen a `~/` or `//` rule.

What it denies:
  - a command that names a protected file (a `cd` earlier in the command
    counts, and so does curl's `@file`), except where the command only uses,
    loads, checks, moves or deletes it without printing it: `source`, `.`,
    `ls`, `test`, `[`, `stat`, `touch`, `rm`, `chmod`, `chown`, `ssh`, `scp`,
    `sftp`, `ssh-add`, `ssh-keygen`, git's `add`, `rm`, `mv`, `checkout`,
    `restore`, `reset`, `commit`, `status`, `ls-files`, `check-ignore`; the
    target of a `>` redirection; `cp`/`mv` to a name that is protected too;
    the value of `--env-file`, `--kubeconfig`, `--cacert`, `--capath`,
    `--cert`, `--key`, `--netrc-file`; and the program being run
    (`.env/bin/python`, a virtualenv named `.env`);
  - `printenv`, `env`, `export`, `declare`/`typeset` or `set` with nothing
    to do but list the variables: they print every one, keys included;
  - `echo`, `printf` or `printenv` of a variable whose name marks it as a
    secret: a part of the name, between underscores, is KEY, TOKEN, SECRET,
    PASSWORD, PASSWD, PASS, CREDENTIAL, CREDS, AUTH or PRIVATE, or one of
    APIKEY, ACCESSKEY, SECRETKEY, PRIVATEKEY, ACCESSTOKEN, AUTHTOKEN; unless
    the name ends in a part that names something else (ID, FILE, PATH, URL,
    PORT, SOCK, HOST, USER, NAME, DIR, TYPE, REGION, ENDPOINT).
The code of `bash -c`/`sh -c`/`zsh -c` is checked as a command of its own.

What it does not deny: a command that reads without naming the file
(`grep -r TOKEN .`), a script that opens the file itself, a secret variable
used rather than printed (`curl -H "api-key: $KEY"`). The OS sandbox covers
the first two; nothing here covers a script that prints the environment.

Way out: CLAUDE_SKIP_ENV_READ_GUARD=1 in the environment turns it off. It never
fails the call: input it cannot read, or an error of its own, lets the
command run with a warning. Exit code is always 0. Standard library only.
"""

from __future__ import annotations

import glob
import json
import os
import re
import shlex
import sys
from pathlib import Path

NAME = "env_read_guard"
NO_READ = {"source", ".", "ls", "test", "[", "[[", "stat", "touch", "rm", "chmod", "chown",
           "ssh", "scp", "sftp", "ssh-add", "ssh-keygen"}
GIT_NO_READ = {"add", "rm", "mv", "checkout", "restore", "reset", "commit", "status", "ls-files", "check-ignore"}
COPY = {"cp", "mv"}
USE_FLAGS = {"--env-file", "--kubeconfig", "--cacert", "--capath", "--cert", "--key", "--netrc-file"}
SHELLS = {"bash", "sh", "zsh", "dash"}
PRINT = {"echo", "printf", "printenv"}
LISTERS = {"printenv", "export", "declare", "typeset", "set"}
SECRET_PART = re.compile(r"KEYS?|TOKENS?|SECRETS?|PASSWORDS?|PASSWD|PASS|CREDENTIALS?|CREDS|AUTH|PRIVATE"
                         r"|APIKEY|ACCESSKEY|SECRETKEY|PRIVATEKEY|ACCESSTOKEN|AUTHTOKEN")
NOT_SECRET_LAST = {"ID", "FILE", "PATH", "URL", "PORT", "SOCK", "HOST", "USER", "NAME", "DIR", "TYPE",
                   "REGION", "ENDPOINT"}
VARIABLE = re.compile(r"\$\{?!?([A-Za-z_][A-Za-z0-9_]*)")
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
PUNCT = set("();<>|&")
SPLIT = re.compile(r"[\s=:,'\"`(){}\[\];|&<>@]+")
INLINE_CODE = {"-c", "-e", "--eval"}  # python -c, node -e, bash -c: the next word is code, read it
SUBSTITUTION = re.compile(r"\$\(([^()]*)\)|`([^`]*)`")
HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1([^\n]*)\n(.*?\n)?[ \t]*\2[ \t]*(?=\n|\)|$)", re.S)
CODE_RUNNERS = re.compile(r"(?:^|[\s;|&(])(?:python[0-9.]*|node|bash|sh|zsh|ruby|perl|php|deno|bun)\b")


# ---------- the rules ----------

def glob_regex(pattern: str) -> str:
    out, i = [], 0
    while i < len(pattern):
        c = pattern[i]
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c == "[":
            j = pattern.find("]", i + 1)
            if j < 0:
                out.append(re.escape(c))
                i += 1
            else:
                body = pattern[i + 1:j]
                out.append("[" + ("^" + body[1:] if body.startswith("!") else body) + "]")
                i = j + 1
        else:
            out.append(re.escape(c))
            i += 1
    return "".join(out)


class Rule:
    def __init__(self, text: str, pattern: str, negated: bool, regex: re.Pattern, relative: bool, source: str):
        self.text, self.pattern, self.negated = text, pattern, negated
        self.regex, self.relative, self.source = regex, relative, source

    def matches(self, path: str) -> bool:
        return bool(self.regex.match(path))


def compile_rule(text: str, source: str, is_user: bool, home: str, project: str, cwd: str) -> Rule | None:
    m = re.fullmatch(r"\s*Read\((.*)\)\s*", text)
    if not m or not m.group(1).strip():
        return None
    pattern = m.group(1).strip()
    negated = pattern.startswith("!")
    body = pattern[1:] if negated else pattern
    if negated:  # Claude Code reads a ! pattern from the current directory, whatever follows it
        body = body.lstrip("/").removeprefix("~/").lstrip("/")
    if not negated and body.startswith("//"):
        base, rest, relative = "", body[1:], False
    elif not negated and body.startswith("~/"):
        base, rest, relative = home, body[1:], False
    elif not negated and body.startswith("/"):
        if is_user:
            return None  # "relative to the settings source": not defined here for user settings
        base, rest, relative = project, body, False
    else:
        rest = body.removeprefix("./")
        relative = True
    if rest.endswith("/**"):  # a folder and all below it: naming the folder reads it too
        rest = rest[:-3]
    if relative:
        if "/" not in rest.rstrip("/"):  # a bare name matches at any depth
            name = glob_regex(rest.rstrip("/"))
            return Rule(text, pattern, negated, re.compile(rf"(?:^|.*/){name}(?:/.*)?$"), True, source)
        base, rest = cwd, "/" + rest.lstrip("/")
    full = glob_regex((base.rstrip("/") + rest).rstrip("/"))
    return Rule(text, pattern, negated, re.compile(rf"^{full}(?:/.*)?$"), relative, source)


def load_rules(home: str, project: str, cwd: str) -> list[list[Rule]]:
    sources = [(Path(home, ".claude", "settings.json"), "~/.claude/settings.json", True),
               (Path(project, ".claude", "settings.json"), ".claude/settings.json", False),
               (Path(project, ".claude", "settings.local.json"), ".claude/settings.local.json", False)]
    groups = []
    for path, shown, is_user in sources:
        try:
            deny = json.loads(path.read_text()).get("permissions", {}).get("deny", [])
        except (OSError, ValueError, AttributeError):
            continue
        if not isinstance(deny, list):
            continue
        rules = [compile_rule(t, shown, is_user, home, project, cwd) for t in deny if isinstance(t, str)]
        groups.append([r for r in rules if r])
    return groups


def protecting_rule(path: str, groups: list[list[Rule]]) -> Rule | None:
    for rules in groups:
        hit = None
        for rule in rules:
            if not rule.matches(path):
                continue
            if not rule.negated:
                hit = rule
            elif hit is not None and hit.relative:
                hit = None
        if hit:
            return hit
    return None


# ---------- the command ----------

def segments(command: str) -> list[list[str]]:
    """The command's simple commands, each a list of words; redirections stay as tokens."""
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:  # an unclosed quote: fall back to a rough split
        tokens = [t for t in re.split(r"(\s+|[();|&<>]+)", command) if t and not t.isspace()]
        tokens = [t.strip("'\"") for t in tokens]
    out, cur = [], []
    for tok in tokens:
        if tok and set(tok) <= PUNCT and "<" not in tok and ">" not in tok:
            if cur:
                out.append(cur)
            cur = []
        else:
            cur.append(tok)
    if cur:
        out.append(cur)
    return out


def strip_prefixes(words: list[str]) -> tuple[list[str], bool]:
    """Drop leading assignments and an `env` prefix. True when `env` had no command to run."""
    i = 0
    while i < len(words) and ASSIGNMENT.match(words[i]):
        i += 1
    if i < len(words) and words[i] == "env":
        i += 1
        while i < len(words):
            if words[i] in ("-u", "--unset", "-C", "--chdir"):
                i += 2
            elif words[i].startswith("-") or ASSIGNMENT.match(words[i]):
                i += 1
            else:
                break
        if i >= len(words):
            return [], True
    return words[i:], False


def lists_every_variable(words: list[str]) -> bool:
    if not words or words[0] not in LISTERS:
        return False
    args = [w for w in words[1:] if not re.fullmatch(r"-[0px]+", w)]
    if words[0] == "set":
        return len(words) == 1
    return not args


def git_subcommand(words: list[str]) -> str | None:
    i = 1
    while i < len(words) and words[i].startswith("-"):
        i += 2 if words[i] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace") else 1
    return words[i] if i < len(words) else None


def read_candidates(words: list[str], protected) -> list[str]:
    """Words that may name a file the command reads. The program itself is
    not one: running .env/bin/python reads no secret. A word with a space in
    it is prose (a commit message, a title), unless it follows -c or -e."""
    if not words or words[0] in NO_READ or words[0] in ("echo", "printf"):
        return []
    if words[0] == "git" and git_subcommand(words) in GIT_NO_READ:
        return []
    out, skip_next, prev = [], False, words[0]
    plain = [w for w in words[1:] if not w.startswith("-")]
    target = plain[-1] if words[0] in COPY and len(plain) >= 2 else None
    if target is not None and protected(target):
        return []  # from one protected name to another: nothing becomes readable
    for w in words[1:]:
        before, prev = prev, w
        if skip_next:
            skip_next = False
            continue
        if set(w) <= PUNCT:  # a redirection: what follows > is written, what follows < is read
            skip_next = ">" in w or w.startswith("<<")
            continue
        if w in USE_FLAGS:
            skip_next = True
            continue
        if w.split("=", 1)[0] in USE_FLAGS or w is target:
            continue
        if re.search(r"\s", w) and before not in INLINE_CODE:
            continue
        out.append(w)
    return out


def split_heredocs(command: str) -> tuple[str, list[str]]:
    """The command without its heredoc bodies, and the bodies a code runner
    reads (python3 - <<EOF), which are checked like the code of `-c`. A body
    that is text (a file being written, a commit message) is dropped."""
    code = []

    def repl(m: re.Match) -> str:
        line = command[command.rfind("\n", 0, m.start()) + 1:m.start()]
        if CODE_RUNNERS.search(line):
            code.append(m.group(4) or "")
        return f"<<{m.group(2)}{m.group(3)}\n"
    return HEREDOC.sub(repl, command), code


def substitutions(command: str) -> list[str]:
    """The commands inside $( ) and backticks; the caller checks each in turn,
    and so finds the nested ones."""
    return [m.group(1) if m.group(1) is not None else m.group(2) for m in SUBSTITUTION.finditer(command)]


def expand(word: str, home: str, cwd: str) -> list[str]:
    word = re.sub(r"\$\{HOME\}|\$HOME(?![A-Za-z0-9_])", home, word)
    word = re.sub(r"\$\{PWD\}|\$PWD(?![A-Za-z0-9_])", cwd, word)
    if word.startswith("~/") or word == "~":
        word = home + word[1:]
    path = os.path.normpath(word if os.path.isabs(word) else os.path.join(cwd, word))
    if any(c in word for c in "*?["):
        found = sorted(glob.glob(path))[:50]
        return found or [path]
    return [path]


def file_reason(words: list[str], groups, home: str, cwd: str) -> str | None:
    def protected(word: str) -> bool:
        return any(protecting_rule(p, groups) for p in expand(word, home, cwd))
    return named_file_reason(read_candidates(words, protected), groups, home, cwd)


def named_file_reason(candidates: list[str], groups, home: str, cwd: str) -> str | None:
    for word in candidates:
        for piece in [word] + [p for p in SPLIT.split(word) if p and p != word]:
            for path in expand(piece, home, cwd):
                rule = protecting_rule(path, groups)
                if rule:
                    return (f"{NAME} stopped this command: it names {os.path.basename(path) or path}, which the "
                            f"rule {rule.text} in {rule.source} protects, so the file's contents would reach "
                            "the model. Work from an example file (such as .env.example) or ask the user for "
                            "the names you need.")
    return None


def every_reason(shown: str) -> str:
    return (f"{NAME} stopped this command: `{shown}` prints every environment variable, keys exported "
            "by shell profiles included. Print only the variable you need, by a name that is not a secret.")


def env_reason(words: list[str]) -> str | None:
    if lists_every_variable(words):
        return every_reason(" ".join(words))
    if words and words[0] in PRINT:
        names = [n for w in words[1:] for n in VARIABLE.findall(w)]
        if words[0] == "printenv":
            names += [w for w in words[1:] if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", w)]
        for n in names:
            if secret_name(n):
                return (f"{NAME} stopped this command: it prints {n}, whose name marks it as a secret. "
                        "Use the variable inside the command that needs it instead of printing it.")
    return None


def secret_name(name: str) -> bool:
    parts = [p for p in name.upper().split("_") if p]
    if not parts or parts[-1] in NOT_SECRET_LAST:  # API_KEY_ID, SSH_AUTH_SOCK: about the secret, not it
        return False
    return any(SECRET_PART.fullmatch(p) for p in parts)


def decide(event: object) -> dict | None:
    if os.environ.get("CLAUDE_SKIP_ENV_READ_GUARD") == "1":
        return None
    if not isinstance(event, dict):
        return warning("no hook input")
    if event.get("tool_name") != "Bash":
        return None
    tool_input = event.get("tool_input")
    if not isinstance(tool_input, dict) or not isinstance(tool_input.get("command", ""), str):
        return warning("no command in the hook input")
    command = tool_input.get("command", "")
    if not command.strip():
        return None
    home = os.path.expanduser("~")
    cwd = event.get("cwd") if isinstance(event.get("cwd"), str) else os.getcwd()
    project = os.environ.get("CLAUDE_PROJECT_DIR") or cwd
    groups = load_rules(home, project, cwd)
    queue = [command]
    while queue:  # the command, then each $( ), backtick and `sh -c` code inside it
        text, code = split_heredocs(queue.pop(0))
        queue += substitutions(text)
        reason = named_file_reason(code, groups, home, cwd)
        if reason:
            return deny(reason)
        here = cwd
        for seg in segments(text):
            words, bare_env = strip_prefixes(seg)
            if words and words[0] in ("cd", "pushd"):  # later commands read from there
                to = words[1] if len(words) > 1 else "~"
                here = here if to == "-" else expand(to, home, here)[0]
                continue
            if words and words[0] in SHELLS and "-c" in words[:-1]:
                queue.append(words[words.index("-c") + 1])
            reason = (every_reason("env") if bare_env
                      else env_reason(words) or file_reason(words, groups, home, here))
            if reason:
                return deny(reason)
    return None


def deny(reason: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": reason}}


def warning(why: str) -> dict:
    return {"systemMessage": f"{NAME} could not check this command ({why}), so it ran unchecked."}


def main() -> int:
    try:
        try:
            event = json.loads(sys.stdin.read())
        except ValueError:
            event = None
        out = decide(event)
    except Exception as exc:  # a broken guard must never stop the work
        out = warning(type(exc).__name__)
    if out is not None:
        print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
