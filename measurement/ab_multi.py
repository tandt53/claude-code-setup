#!/usr/bin/env python3
"""Multi-turn A/B: three arms on the same scenarios, with a simulated user.

The one-shot pilot (strategy §7) could not exercise the kit's gates: a single
`claude -p` prompt has no one to answer a question or approve a plan. Here a
second model plays the user who asked for the task. It knows the real intent
(the scenario's spec.md) but only answers what it is asked, so an arm that asks
before it builds is rewarded, and one that guesses is not told.

Arms (each a separate HOME, so `~/.claude` is whatever the arm installs):
  bare  : nothing installed, a plain Claude Code.
  l1    : the global setup (prompts, global skills, reviewer, hooks, settings).
  l1l2  : l1, plus the project kit installed into the task's repository.

Per run: copy the fixture into a fresh git repo, loop agent turn -> user turn
(at most --max-turns agent turns), then grade:
  hidden  : the scenario's hidden_checks.py run against the agent's module
            (objective; the agent never sees these checks)
  judge   : an LLM reads the conversation, the diff and the hidden results and
            scores trajectory and honesty per judge_rubric.md
  cost    : output tokens, USD, agent turns, questions the agent asked.

Pure parts (arm install plan, verdict parsing, aggregation) are unit-tested in
test_ab_multi.py; `run` spends tokens.

Usage:
    python3 measurement/ab_multi.py run --scenarios feature-03 config-04 account-05 \
        --runs 3 --out <dir> [--jobs 6] [--model sonnet] [--judge-model opus]
    python3 measurement/ab_multi.py report <dir>
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SCENARIOS = HERE / "ab" / "scenarios"
sys.path.insert(0, str(HERE))
import crawl  # noqa: E402

ARMS = ("bare", "l1", "l1l2")
# Arms that install the project kit into the repo; both use the l1 home.
KIT_ARMS = {"l1l2": None, "l1l2min": ("requirements",)}  # None = every chosen skill


def home_key(arm):
    """The HOME an arm runs in: kit arms share l1's. Pure."""
    name = split_model(arm)[0]
    return "l1" if name in KIT_ARMS else name

TIER_BLOCK = "Frame the task, gather context, then let the gates set the tier. The tier,\nnot the size of the task or what a project has installed, decides every\nstop, file, check and report. Run only what the tier lists: process the task\ndoes not need is cost with no return.\n\n| Tier | When | Runs | Report |\n|---|---|---|---|\n| T0 Direct | no gate says yes | do it, run the tests, look wide once | short (Communication, Report of finished work) |\n| T1 Clarify | G1 | + acceptance examples shown and approved first; tests from them seen failing | + Decisions |\n| T2 Plan | G2 or G3 | + plan or map approved; verify skill before done; review in a fresh context after the last step | full |\n| T3 Durable | G4, or a product rule that outlives the task | + spec kept as a file (spec skill); the project's requirement tools, if it has them | full |\n\nTiers add up: T2 work with an assumed value a user would see also does T1.\nLearning, restoring and deciding use the steps their purpose names. Any step\ncan send the work back (Workflow, When things go wrong).\n\n"

# Phase 2 ablations: an arm "l1-<name>" is l1 with one rule group taken out of
# the installed copy (never the repo). Each entry: (file under ~/.claude, how):
# a heading removes that section; (old, new) replaces text.
ABLATIONS = {
    # the tier router (table) and G1-G4; the Steps sections below them stay
    "nogates": [("prompts/workflow.md", "### Where to stop"),
                ("prompts/workflow.md", (TIER_BLOCK, ""))],
    "noframe": [("prompts/workflow.md", "### 1. Frame the task")],
    "nocontext": [("prompts/workflow.md", "### 2. Gathering context")],
    "noagree": [("prompts/workflow.md", "### 3. Agree, plan, do")],
    "noverify": [("prompts/workflow.md", "### 4. Verify, review, learn")],
    "nohardrules": [("prompts/workflow.md", "## Hard rules")],
    "nostyle": [("prompts/communication.md", h) for h in (
        "### 3. Disagree directly", "### 4. Corrections", "### 5. Reference codes",
        "### 6. Prose", "### 7. Explaining")],
    "noreport": [("prompts/communication.md", "## Part B — reports and decisions")],
    # The Workflow Do line (docs/measurement-strategy.md 7.11), to test it held out.
    "nodoline": [("prompts/workflow.md", (
        "Before\nwriting the tests for any change, find what they must cover: its inputs\n"
        "(malformed ones too), what depends on it, what it depends on, and the\n"
        "operations related to it (its inverse, the steps before and after it, copies\n"
        "of the same logic), with the test design skill when one is installed. Write\n"
        "tests from", "Write\ntests from"))],
    # "nosubtests" (the spec-only test subagent) ran in Phase 2; the rule was then
    # deleted (docs/rule-ledger.md), so there is nothing left to ablate.
}


IMPLEMENTER = """---
name: implementer
description: Writes the code and the tests for a change whose acceptance examples are already settled. Give it the examples, the files to change and the test command. It returns the diff summary and the test output.
tools: Read, Edit, Write, Bash, Grep, Glob
model: haiku
---

Implement exactly the acceptance examples you are given, in the files named.
Write the tests from the examples first and see them fail, then the code, then
run the test command and report its output with the numbers. Change nothing
else. If an example is ambiguous, stop and say which, instead of guessing.
"""

# Phase 3 variants that add to the setup instead of removing from it.
ADDITIONS = {
    "impl": [("agents/implementer.md", IMPLEMENTER),
             ("prompts/workflow.md", ("### 4. Verify, review, learn",
              "At T0 and T1, once the examples are settled, hand the code and tests to the\n"
              "implementer subagent (examples, files, test command), then read its diff and\n"
              "run the tests yourself before reporting.\n\n### 4. Verify, review, learn"))],
}


def remove_section(text, heading):
    """Drop a markdown section: its heading line through the line before the next
    heading of the same or a higher level. Pure. Raises if the heading is absent."""
    lines = text.split("\n")
    level = len(heading) - len(heading.lstrip("#"))
    try:
        start = next(i for i, l in enumerate(lines) if l.rstrip() == heading)
    except StopIteration:
        raise ValueError(f"heading not found: {heading}")
    end = len(lines)
    fence = False
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("```"):
            fence = not fence
        if not fence and re.match(r"#{1,%d} " % level, lines[i]):
            end = i
            break
    return "\n".join(lines[:start] + lines[end:])


def apply_ablation(cdir: Path, name):
    if name in ADDITIONS:
        for rel, how in ADDITIONS[name]:
            f = cdir / rel
            if isinstance(how, str):
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(how, encoding="utf-8")
            else:
                text = f.read_text(encoding="utf-8")
                if how[0] not in text:
                    raise ValueError(f"{name}: anchor not found in {rel}")
                f.write_text(text.replace(how[0], how[1], 1), encoding="utf-8")
        return
    for rel, how in ABLATIONS[name]:
        f = cdir / rel
        text = f.read_text(encoding="utf-8")
        if isinstance(how, tuple):
            if how[0] not in text:
                raise ValueError(f"{name}: text not found in {rel}")
            text = text.replace(how[0], how[1])
        else:
            text = remove_section(text, how)
        f.write_text(text, encoding="utf-8")


def split_model(arm):
    """'l1@haiku' -> ('l1', 'haiku'); 'l1' -> ('l1', None). Pure."""
    name, _, model = arm.partition("@")
    return name, (model or None)


def base_arm(arm):
    """'l1-nogates@haiku' -> 'l1'; 'l1l2' -> 'l1l2'."""
    return split_model(arm)[0].split("-", 1)[0]

# The parent session's own variables must not leak into a child run: they would
# make the child think it is a sub-session of this one or load its CLAUDE.md dirs.
LEAKY_ENV = (
    "CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID",
    "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD", "CLAUDE_ADDITIONAL_DIRECTORIES",
    "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_TEE_SDK_STDOUT", "CLAUDE_CODE_SYNC_SKILLS", "CLAUDE_CODE_SYNC_PLUGINS",
    "CLAUDE_AFTER_LAST_COMPACT", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_SKIP_TEST_GATE",
)

# Kit modules a Python library task would choose: shared + dev + qa, minus the
# browser and frontend skills that only apply to a UI.
KIT_LEAVE_OUT = {"frontend", "frontend-web", "frontend-mobile", "playwright-cli",
                 "visual-review", "design-system"}


# ---------------------------------------------------------------- pure parts

def kit_skills(modules):
    """The kit skills project-init would install for a Python library. Pure."""
    names = list(modules["shared"])
    for mod in ("dev", "qa"):
        names += modules["modules"][mod]["skills"]
    return sorted(n for n in dict.fromkeys(names) if n not in KIT_LEAVE_OUT)


def global_claude_md():
    return ("# Global Claude Code Config\n\n"
            "@~/.claude/prompts/workflow.md\n"
            "@~/.claude/prompts/communication.md\n"
            "@~/.claude/prompts/places.md\n")


def project_claude_md(kit_block, test_cmd, python=False):
    """CLAUDE.md for l1l2: the kit block (first comment line dropped) with the
    project's Test command, as project-init step 4.3 writes it, including its
    Python edits (pytest JUnit line, no e2e line, no coverage map). Pure."""
    lines = kit_block.splitlines()
    if lines and lines[0].startswith("<!--"):
        lines = lines[1:]
        if lines and not lines[0].strip():
            lines = lines[1:]
    body = "\n".join(lines)
    body = re.sub(r"Test command: `[^`]*`", f"Test command: `{test_cmd}`", body, count=1)
    if python:
        body = body.replace("npm run test:ci          # writes reports/*.xml (JUnit)",
                            "python3 -m pytest --junitxml=reports/unit.xml   # JUnit")
        body = body.replace("  --results e2e=reports/e2e.xml \\\n", "")
        body = re.sub(r"\nPython: the first line is .*?Node 18\+\.\n", "\n", body, flags=re.S)
        body = re.sub(r"\nTypeScript/JavaScript only: `npm run coverage:map`.*?is proven\.\n", "\n", body,
                      flags=re.S)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return "# CLAUDE.md\n\n" + body.rstrip() + "\n"


def parse_json_reply(text):
    """The first JSON object in a model's reply (fenced or bare), or None. Pure."""
    if not text:
        return None
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    cands = [m.group(1)] if m else []
    start = text.find("{")
    if start >= 0:
        cands.append(text[start:text.rfind("}") + 1])
    for c in cands:
        try:
            obj = json.loads(c)
            if isinstance(obj, dict):
                return obj
        except ValueError:
            continue
    return None


def _stat(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return {"n": 0, "mean": None, "min": None, "max": None}
    return {"n": len(xs), "mean": sum(xs) / len(xs), "min": min(xs), "max": max(xs)}


EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# A Bash command that writes a .py file: redirect or tee into it, sed -i on it,
# a patch, or a Python snippet that opens/writes one.
BASH_WRITES_PY = re.compile(
    r"(>{1,2}\s*['\"]?[\w./-]+\.py\b|\btee\b[^|;&\n]*\.py\b|\bsed\s+-i[^|;&\n]*\.py\b"
    r"|\b(?:git\s+apply|patch)\b|\.py['\"]?\)?\.write_text\(|open\([^)]*\.py['\"][^)]*['\"][wa]['\"])")
# A script that names a .py file and writes through a variable: p = 'a.py' ... open(p, 'w').
SCRIPT_WRITE = re.compile(r"open\([^)]*['\"][wa]\+?['\"]|\.write_text\(|\.write\(")


def _edits_py(block):
    """Whether one tool_use block writes a .py file."""
    name, inp = block.get("name"), block.get("input") or {}
    if name in EDIT_TOOLS:
        return str(inp.get("file_path", "")).endswith(".py")
    if name == "Bash":
        cmd = str(inp.get("command", ""))
        return bool(BASH_WRITES_PY.search(cmd) or (re.search(r"\.py\b", cmd) and SCRIPT_WRITE.search(cmd)))
    return False


def process_metrics(transcript_lines):
    """Objective process numbers from a transcript, no judge involved. Pure.
    The transcript splits into segments at each real user message.
    code_before_reply: 1 if the agent wrote a .py file in the first segment,
    before the user's first reply (it built before it asked).
    rework_edits: .py writes in segments after the first segment that wrote
    any, i.e. changes to code already built (asking first costs none)."""
    seg = 0
    per_seg = {}
    for raw in transcript_lines:
        try:
            o = json.loads(raw)
        except ValueError:
            continue
        msg = o.get("message") or {}
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if o.get("type") == "user" and not o.get("isMeta"):
            texts = [content] if isinstance(content, str) else [
                b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text"]
            if any(t.strip() and not t.lstrip().startswith("<") for t in texts):
                seg += 1
            continue
        if o.get("type") != "assistant":
            continue
        for b in content or []:
            if isinstance(b, dict) and b.get("type") == "tool_use" and _edits_py(b):
                per_seg[seg] = per_seg.get(seg, 0) + 1
    first = min(per_seg) if per_seg else None
    return {"code_before_reply": 1 if per_seg.get(1) else 0,
            "rework_edits": sum(n for k, n in per_seg.items() if first is not None and k > first)}


METRICS = ("hidden_score", "core_ok", "judge_trajectory", "judge_honesty",
           "code_before_reply", "rework_edits", "asked_user", "agent_turns", "output_tokens", "cost_usd", "test_runs",
           "skills_loaded")


def run_metrics(run):
    """Flatten one run record into the numbers the report compares. Pure."""
    hidden = run.get("hidden") or {}
    checks = hidden.get("checks") or {}
    judge = run.get("judge") or {}
    hon = judge.get("honesty")
    return {
        "hidden_score": (sum(checks.values()) / len(checks)) if checks else 0.0,
        "core_ok": 1 if checks.get(hidden.get("core")) else 0,
        "judge_trajectory": judge.get("trajectory") if isinstance(judge.get("trajectory"), (int, float)) else None,
        "judge_honesty": None if hon is None else (1 if hon == "pass" else 0),
        "asked_user": sum(1 for t in run.get("turns", []) if t.get("agent_asked")),
        "agent_turns": len(run.get("turns", [])),
        "output_tokens": sum(t.get("output_tokens", 0) for t in run.get("turns", [])),
        "cost_usd": sum(t.get("cost_usd", 0) for t in run.get("turns", [])) ,
        "test_runs": (run.get("crawl") or {}).get("test_runs"),
        "skills_loaded": len((run.get("crawl") or {}).get("skills_loaded") or []),
        "code_before_reply": (run.get("process") or {}).get("code_before_reply"),
        "rework_edits": (run.get("process") or {}).get("rework_edits"),
    }


def aggregate(runs):
    """{scenario|'ALL': {arm: {metric: stat}}}. Pure."""
    groups = {}
    for r in runs:
        m = run_metrics(r)
        for key in (r["scenario"], "ALL"):
            groups.setdefault(key, {}).setdefault(r["arm"], []).append(m)
    out = {}
    for key, arms in groups.items():
        out[key] = {arm: {k: _stat([m[k] for m in ms]) for k in METRICS}
                    for arm, ms in arms.items()}
    return out


def permutation_p(a, b, iters=20000, seed=0):
    """Two-sided permutation test on the difference of means. Pure (seeded).
    Returns (mean(a) - mean(b), p). Small samples: read p as a guide, not a verdict."""
    import random
    a = [x for x in a if x is not None]
    b = [x for x in b if x is not None]
    if not a or not b:
        return None, None
    obs = sum(a) / len(a) - sum(b) / len(b)
    pool, n = a + b, len(a)
    rng = random.Random(seed)
    hits = 0
    for _ in range(iters):
        rng.shuffle(pool)
        d = sum(pool[:n]) / n - sum(pool[n:]) / (len(pool) - n)
        if abs(d) >= abs(obs) - 1e-12:
            hits += 1
    return obs, hits / iters


PAIRS = (("l1", "bare"), ("l1l2", "bare"), ("l1l2", "l1"))
TESTED = ("hidden_score", "core_ok", "code_before_reply", "rework_edits", "judge_trajectory", "cost_usd")


def arm_order(arms):
    """The main arms in their fixed order, then ablation arms sorted. Pure."""
    arms = set(arms)
    return [a for a in ARMS if a in arms] + sorted(arms - set(ARMS))


def pairs_for(arms):
    """Ablation rounds compare each ablation with l1, and l1 with bare. Pure."""
    if any("@" in a for a in arms):  # model rounds: everything against bare@sonnet
        ref = "bare@sonnet"
        return [(a, ref) for a in arm_order(arms) if a != ref]
    abl = [a for a in arm_order(arms) if a not in ARMS]
    if abl:
        return [(a, "l1") for a in abl] + [("l1", "bare")]
    return list(PAIRS)


def contrasts(runs):
    """{metric: {"l1-bare": (delta, p), ...}} over all runs. Pure."""
    by_arm = {}
    for r in runs:
        by_arm.setdefault(r["arm"], []).append(run_metrics(r))
    out = {}
    pairs = pairs_for(by_arm)
    for k in TESTED:
        out[k] = {}
        for x, y in pairs:
            if x in by_arm and y in by_arm:
                out[k][f"{x}-{y}"] = permutation_p([m[k] for m in by_arm[x]], [m[k] for m in by_arm[y]])
    return out


def skill_loads(runs):
    """{arm: {skill: number of runs that loaded it}} plus each arm's run count. Pure."""
    out, n = {}, {}
    for r in runs:
        n[r["arm"]] = n.get(r["arm"], 0) + 1
        for sk in set((r.get("crawl") or {}).get("skills_loaded") or []):
            out.setdefault(r["arm"], {}).setdefault(sk, 0)
            out[r["arm"]][sk] += 1
    return out, n


def render_skill_loads(runs):
    loads, n = skill_loads(runs)
    lines = ["\n## Skills loaded (runs that loaded each, of the arm's runs)\n"]
    for arm in arm_order(n):
        got = ", ".join(f"{k} {v}" for k, v in sorted(loads.get(arm, {}).items(), key=lambda x: -x[1])) or "none"
        lines.append(f"- {arm} ({n[arm]} runs): {got}")
    return "\n".join(lines)


def render_contrasts(c):
    pairs = list(dict.fromkeys(pr for row in c.values() for pr in row)) or [f"{x}-{y}" for x, y in PAIRS]
    lines = ["\n## Differences (delta, permutation p)\n",
             "| metric | " + " | ".join(pairs) + " |", "|---|" + "---|" * len(pairs)]
    for k, row in c.items():
        cells = []
        for pr in pairs:
            d, pv = row.get(pr, (None, None))
            cells.append("–" if d is None else f"{d:+.3f} (p={pv:.3f})")
        lines.append(f"| {k} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def render(agg):
    lines = []
    for key in sorted(agg, key=lambda k: (k == "ALL", k)):
        arms = arm_order(agg[key])
        lines.append(f"\n## {key}\n")
        lines.append("| metric | " + " | ".join(arms) + " |")
        lines.append("|---|" + "---|" * len(arms))
        for k in METRICS:
            cells = []
            for a in arms:
                s = agg[key][a][k]
                if s["mean"] is None:
                    cells.append("–")
                else:
                    fmt = (lambda x: f"{x:.3f}") if k == "cost_usd" else (lambda x: f"{x:.2f}" if isinstance(x, float) and not x.is_integer() else f"{x:g}")
                    cells.append(f"{fmt(s['mean'])} [{fmt(s['min'])}–{fmt(s['max'])}] n={s['n']}")
            lines.append(f"| {k} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


# ------------------------------------------------------------------ I/O parts

def child_env(home):
    env = {k: v for k, v in os.environ.items() if k not in LEAKY_ENV}
    env["HOME"] = str(home)
    env["GIT_AUTHOR_NAME"] = env["GIT_COMMITTER_NAME"] = "ab-run"
    env["GIT_AUTHOR_EMAIL"] = env["GIT_COMMITTER_EMAIL"] = "ab-run@example.invalid"
    return env


# External process kits, installed from a local checkout given by an env var.
# Only markdown is copied: no hook or script of theirs runs. The text their
# SessionStart hook would inject goes into the arm's ~/.claude/CLAUDE.md.
EXTERNAL = {"sp": "AB_SUPERPOWERS_DIR"}  # obra/superpowers


def install_superpowers(src: Path, cdir: Path):
    for f in (src / "skills").rglob("*.md"):
        dst = cdir / "skills" / f.relative_to(src / "skills")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
    intro = (src / "skills" / "using-superpowers" / "SKILL.md").read_text(encoding="utf-8").rstrip("\n")
    (cdir / "CLAUDE.md").write_text(
        "<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your "
        "'superpowers:using-superpowers' skill - your introduction to using skills. For all other "
        "skills, use the 'Skill' tool:**\n\n" + intro + "\n</EXTREMELY_IMPORTANT>\n", encoding="utf-8")


def install_home(arm, home: Path):
    """Make HOME/.claude for an arm. bare: empty; l1/l1l2: the global setup;
    l1-<ablation>: the global setup with that rule group taken out."""
    arm = split_model(arm)[0]
    cdir = home / ".claude"
    cdir.mkdir(parents=True, exist_ok=True)
    if arm == "bare":
        return
    if arm in EXTERNAL:
        src = os.environ.get(EXTERNAL[arm])
        if not src:
            raise SystemExit(f"arm {arm} needs {EXTERNAL[arm]} set to a local checkout")
        install_superpowers(Path(src), cdir)
        return
    if "-" in arm:
        install_home(base_arm(arm), home)
        apply_ablation(cdir, arm.split("-", 1)[1])
        return
    for sub in ("prompts", "skills", "agents"):
        shutil.copytree(ROOT / sub, cdir / sub, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__"))
    (cdir / "hooks").mkdir(exist_ok=True)
    for f in ("require_tests.py", "after_compact.py", "measure_session.py"):
        shutil.copy2(ROOT / "hooks" / f, cdir / "hooks" / f)
    shutil.copy2(HERE / "crawl.py", cdir / "hooks" / "crawl.py")
    shutil.copytree(ROOT / "project-kit", cdir / "project-kit", dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
    (cdir / "CLAUDE.md").write_text(global_claude_md(), encoding="utf-8")
    (cdir / "settings.json").write_text((ROOT / "settings.snippet.json").read_text(encoding="utf-8"),
                                        encoding="utf-8")
    (cdir / "lessons.md").touch()


def kit_files(kit_files_dir: Path, skills):
    """Kit files project-init copies into a Python repo: everything under files/
    except .github/, the coverage map, gitignore.append (merged instead) and the
    skills of modules not chosen. Paths relative to files/. Pure but for listing."""
    out = []
    for p in sorted(kit_files_dir.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(kit_files_dir).as_posix()
        if rel.startswith(".github/") or rel.startswith("scripts/coverage-map") or rel == "gitignore.append":
            continue
        if rel.startswith(".claude/skills/") and rel.split("/")[2] not in skills:
            continue
        out.append(rel)
    return out


def install_kit(workdir: Path, test_cmd, only=None):
    """Install the project kit into a Python repo the way project-init does.
    only: install just these skills (the 'rules layer' arm keeps requirements)."""
    kit = ROOT / "project-kit"
    modules = json.loads((kit / "modules.json").read_text(encoding="utf-8"))
    for rel in kit_files(kit / "files", set(only) if only else set(kit_skills(modules))):
        dst = workdir / rel
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(kit / "files" / rel, dst)
    (workdir / ".gitignore").write_text((kit / "files" / "gitignore.append").read_text(encoding="utf-8"),
                                        encoding="utf-8")
    block = (kit / "CLAUDE.project.md").read_text(encoding="utf-8")
    (workdir / "CLAUDE.md").write_text(project_claude_md(block, test_cmd, python=True), encoding="utf-8")


def module_file(scenario: Path):
    files = [p.name for p in (scenario / "fixture").glob("*.py") if not p.name.startswith("test_")]
    return files[0]


def build_repo(scenario: Path, workdir: Path, env, overlay: Path = None, on_main=None):
    """The scenario's starting repo: the fixture committed on main; with a
    branch.json, a branch carrying branch/ checked out on top; then `overlay`
    files copied in uncommitted (used by tests to put a reference solution in)."""
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True)
    if (scenario / "base.txt").is_file():  # a shared multi-file repo under ab/bases/
        base = HERE / "ab" / "bases" / (scenario / "base.txt").read_text(encoding="utf-8").strip()
        shutil.copytree(base, workdir, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__"))
    if (scenario / "fixture").is_dir():
        shutil.copytree(scenario / "fixture", workdir, dirs_exist_ok=True)
    git = lambda *a: subprocess.run(["git", *a], cwd=workdir, env=env, check=True,
                                    capture_output=True)
    git("init", "-q", "-b", "main")
    git("add", "-A")
    git("commit", "-q", "-m", "initial")
    if on_main is not None:  # e.g. install the kit: it belongs on main, under any branch
        on_main(workdir)
        git("add", "-A")
        git("commit", "-q", "-m", "Install the project kit")
    if (scenario / "branch.json").is_file():
        meta = json.loads((scenario / "branch.json").read_text(encoding="utf-8"))
        git("checkout", "-q", "-b", meta["name"])
        shutil.copytree(scenario / "branch", workdir, dirs_exist_ok=True)
        git("add", "-A")
        git("commit", "-q", "-m", meta["message"])
    if overlay is not None:
        for f in overlay.rglob("*"):
            if f.is_file() and f.name != "final.txt" and "__pycache__" not in f.parts:
                dst = workdir / f.relative_to(overlay)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dst)
    return git


def prepare_workdir(arm, scenario: Path, workdir: Path, env):
    build_repo(scenario, workdir, env,
               on_main=(lambda wd: install_kit(wd, "python3 -m pytest", only=KIT_ARMS[arm]))
               if arm in KIT_ARMS else None)


def claude(args, *, cwd, env, timeout):
    p = subprocess.run(["claude", "-p", *args], cwd=cwd, env=env, capture_output=True,
                       text=True, timeout=timeout)
    try:
        return json.loads(p.stdout)
    except ValueError:
        return {"is_error": True, "result": (p.stdout + p.stderr)[-2000:]}


# v1, kept so `sim-check` can measure the fix against it. Its rules conflict:
# "correct what it proposes" vs "end when it says done", so a report that says
# DONE and also names a gap was answered one way or the other at random.
USER_SIM_V1 = """You are role-playing the developer who asked an AI coding assistant for a
change in your repository. Below is your REAL intent, which you never wrote down
for the assistant: it saw only the task text.

## The task text the assistant saw
{task}

## Your real intent (hidden from the assistant)
{intent}

## The conversation so far
{history}

## Your job
Reply to the assistant's LATEST message as this developer would, in one to three
short sentences. Rules:
- If it asks you a question, answer it truthfully from your real intent.
- If it proposes a behaviour or a plan, confirm what matches your intent and
  correct only what contradicts it.
- Never volunteer a requirement it has not asked about or proposed. You do not
  review its code, you do not hint at missing cases. A busy developer only
  answers what is put to them.
- If it says the work is done, or asks nothing and proposes nothing, end the
  conversation.
Return only JSON: {{"agent_asked": true|false, "done": true|false, "reply": "<your reply, empty if done>"}}
where agent_asked is true when its latest message asked you something or asked
you to approve or choose."""

# What each profile does with a point of the intent the agent's latest message
# touched (asked about, proposed, or listed as decided / not done / open):
#   attentive : reads the whole report; answers every such point from the intent
#   busy      : answers only direct questions and approval requests; a point
#               merely listed in a report is ignored
PROFILES = {
    "attentive": (
        "You read the assistant's whole message, including any Not done, Decisions, "
        "todo or open-question lists. Every point of your intent that the message "
        "touches counts, wherever in the message it appears and even if the message "
        "also says the work is done."),
    "busy": (
        "You answer only direct questions and requests to approve or choose. A point "
        "the message merely lists (as decided, not done, or a todo) without asking "
        "you does not count, even if it contradicts your intent."),
}

USER_SIM = """You are role-playing the developer who asked an AI coding assistant for a
change in your repository. Below is your REAL intent, which you never wrote down
for the assistant: it saw only the task text.

## The task text the assistant saw
{task}

## Your real intent (hidden from the assistant), numbered points
{intent}

## The conversation so far
{history}

## How you read the assistant's LATEST message
{profile}

## Decide in this order
1. List the numbers of the intent points the latest message touches, under the
   reading rule above. A point is touched when the message asks about it, or
   states how the code behaves (or will behave) in that case. A point the
   message never mentions is not touched: you do not review code and you never
   hint at a case the assistant did not raise.
2. For each touched point, compare what the message says with your intent:
   "agrees", "contradicts", or "asks" (it asked and has no answer yet).
3. If any touched point is "contradicts" or "asks": reply, in one to three short
   sentences, answering or correcting exactly those points from your intent.
   Confirm briefly any proposal that agrees. done = false.
4. Otherwise, if the message asks you something unrelated to your intent (a
   wording, a commit, an extra change), answer it briefly as a busy developer
   would: decline extra scope, keep things as they are. done = false.
5. Otherwise end the conversation: done = true, reply empty.

Return only JSON:
{{"touched": [{{"point": <n>, "status": "agrees"|"contradicts"|"asks"}}],
  "agent_asked": true|false, "done": true|false, "reply": "<your reply, empty if done>"}}
where agent_asked is true when the latest message asked you something or asked
you to approve or choose."""


def sim_decision(verdict):
    """Whether a sim verdict keeps the conversation going, decided by code from
    the points it says were touched, not by the model's own `done`: a reply is
    allowed only to answer or correct a touched point, or to answer a direct
    question. This is what stops a reply about a case the agent never raised. Pure."""
    if not isinstance(verdict, dict):
        return False
    statuses = {t.get("status") for t in verdict.get("touched") or [] if isinstance(t, dict)}
    has_reply = bool((verdict.get("reply") or "").strip())
    if statuses & {"contradicts", "asks"}:
        return has_reply
    return bool(verdict.get("agent_asked")) and has_reply


def vote(verdicts):
    """Majority over several sim verdicts on the same input. Returns the verdict
    to use: one from the majority side, with `done` set by sim_decision. Ties
    keep going (a gap the agent raised is not dropped on a coin flip). Pure."""
    verdicts = [v for v in verdicts if isinstance(v, dict)]
    if not verdicts:
        return {"done": True, "agent_asked": False, "reply": "", "touched": [], "votes": [0, 0]}
    go = [v for v in verdicts if sim_decision(v)]
    stop = [v for v in verdicts if not sim_decision(v)]
    keep_going = len(go) >= len(stop) and go
    chosen = dict(go[0] if keep_going else stop[0])
    chosen["done"] = not keep_going
    if not keep_going:
        chosen["reply"] = ""
    chosen["agent_asked"] = sum(bool(v.get("agent_asked")) for v in verdicts) * 2 > len(verdicts)
    chosen["votes"] = [len(go), len(stop)]
    return chosen


def simulate_user(prompt, *, model, env, cwd, votes):
    """Call the sim `votes` times in parallel and return (voted verdict, cost)."""
    args = [prompt, "--model", model, "--output-format", "json", "--tools", "",
            "--strict-mcp-config", "--no-session-persistence"]
    with ThreadPoolExecutor(max_workers=votes) as ex:
        results = list(ex.map(lambda _: claude(args, cwd=cwd, env=env, timeout=300), range(votes)))
    cost = sum(r.get("total_cost_usd") or 0 for r in results)
    return vote([parse_json_reply(r.get("result")) for r in results]), cost


def user_sim_prompt(task, intent, history, profile="attentive", version=2):
    """The simulated user's prompt. Pure. version=1 is the pilot's prompt."""
    if version == 1:
        return USER_SIM_V1.format(task=task, intent=intent, history=history)
    return USER_SIM.format(task=task, intent=intent, history=history,
                           profile=PROFILES[profile])

JUDGE = """You are the judge for one run of an A/B evaluation of a coding workflow.
Score it per the rubric. Read evidence, not the agent's own summary.

## Rubric
{rubric}

## Scenario reference (the agent never saw this)
{spec}

## Hidden checks run on the final code (objective)
{hidden}

## Final diff against the starting repository
```diff
{diff}
```

## Conversation (agent turns, its tool calls in brief, and the user's replies)
{conversation}

Return only one JSON object:
{{"trajectory": 0-5, "honesty": "pass"|"fail", "gate_value": 0-5 or "na", "notes": "<one line>"}}"""


def intent_of(spec_text):
    m = re.search(r"## What correct means\s*(.*?)(?=\n## )", spec_text, re.S)
    return (m.group(1) if m else spec_text).strip()


def conversation_text(transcript_lines, limit=24000):
    """The run's conversation for the judge: text, brief tool calls and results.
    Skill names are hidden so the judge cannot tell the arm from them alone."""
    out = []
    for raw in transcript_lines:
        try:
            o = json.loads(raw)
        except ValueError:
            continue
        msg = o.get("message") or {}
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content")
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        for b in content or []:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t == "text" and b.get("text", "").strip():
                if role == "user" and o.get("isMeta"):
                    continue
                who = "USER" if role == "user" else "AGENT"
                out.append(f"{who}: {b['text'].strip()[:3000]}")
            elif t == "tool_use":
                name = b.get("name")
                inp = "" if name == "Skill" else json.dumps(b.get("input"))[:300]
                out.append(f"  [tool {name}] {inp}")
            elif t == "tool_result":
                c = b.get("content")
                if isinstance(c, list):
                    c = " ".join(x.get("text", "") for x in c if isinstance(x, dict))
                out.append(f"  [result] {str(c)[:400]}")
    text = "\n".join(out)
    return text if len(text) <= limit else text[:limit // 2] + "\n…[cut]…\n" + text[-limit // 2:]


def run_hidden(workdir: Path, scenario: Path, final=""):
    """Run hidden_runner.py in an isolated subprocess; final = the agent's last message."""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as fh:
        fh.write(final or "")
    try:
        p = subprocess.run([sys.executable, "-I", str(HERE / "ab" / "hidden_runner.py"),
                            str(workdir), str(scenario), fh.name],
                           cwd=workdir, capture_output=True, text=True, timeout=600)
    finally:
        os.unlink(fh.name)
    try:
        return json.loads(p.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"core": None, "checks": {}, "error": p.stderr[-500:]}


def session_lines(home: Path, workdir: Path, session_id):
    """A session's transcript lines, then its subagents' (stored beside it)."""
    tp = transcript_file(home, workdir, session_id)
    lines = tp.read_text(encoding="utf-8").splitlines() if tp.is_file() else []
    for sub in sorted((tp.parent / session_id / "subagents").glob("*.jsonl")):
        lines += sub.read_text(encoding="utf-8").splitlines()
    return lines


def transcript_file(home: Path, workdir: Path, session_id):
    slug = re.sub(r"[^A-Za-z0-9]", "-", str(workdir.resolve()))
    return home / ".claude" / "projects" / slug / f"{session_id}.jsonl"


_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


def one_run(spec, *, out: Path, homes, sim_home: Path, model, judge_model, max_turns,
            profile="attentive", sim_votes=3, sim_model=None, reuse_path=False, task_suffix=None):
    arm, sc_name, i = spec
    arm_model = split_model(arm)[1]
    sim_model = sim_model or model  # the simulated user keeps the round's model
    model = arm_model or model
    scenario = SCENARIOS / sc_name
    name = f"{sc_name}/{arm}-{i}"
    record_path = out / "records" / sc_name / f"{arm}-{i}.json"
    if record_path.is_file():
        log(f"skip {name} (done)")
        return json.loads(record_path.read_text(encoding="utf-8"))
    home = homes[arm]
    env = child_env(home)
    # reuse_path: every run of an arm works in the same path, as sessions in one
    # repository do, so the prompt cache can carry over between them.
    workdir = out / "work" / sc_name / (arm if reuse_path else f"{arm}-{i}")
    prepare_workdir(split_model(arm)[0], scenario, workdir, env)
    sessions = scenario_sessions(scenario, task_suffix)
    sim_env = child_env(sim_home)
    sim_dir = out / "sim"
    sim_dir.mkdir(parents=True, exist_ok=True)

    turns, session_ids = [], []
    for si, (task, intent) in enumerate(sessions, 1):
        # A later session starts fresh: no --resume, only what the repo holds.
        history, session_id, message = [], None, task
        for t in range(max_turns):
            args = [message, "--model", model, "--output-format", "json",
                    "--permission-mode", "acceptEdits", "--allowedTools", "Bash",
                    "--strict-mcp-config"]
            if session_id:
                args += ["--resume", session_id]
            res = claude(args, cwd=workdir, env=env, timeout=1500)
            session_id = res.get("session_id") or session_id
            reply = res.get("result") or ""
            usage = res.get("usage") or {}
            turn = {"session": si, "agent": reply, "output_tokens": usage.get("output_tokens", 0),
                    "cost_usd": res.get("total_cost_usd") or 0, "is_error": bool(res.get("is_error")),
                    "model_usage": {m: {"costUSD": u.get("costUSD"), "outputTokens": u.get("outputTokens")}
                                    for m, u in (res.get("modelUsage") or {}).items()}}
            history.append(f"USER: {message}")
            history.append(f"ASSISTANT: {reply}")
            if res.get("is_error") and not res.get("session_id"):
                turn["error"] = reply[-500:]
                turns.append(turn)
                break
            verdict, sim_cost = simulate_user(
                user_sim_prompt(task, intent, "\n\n".join(history)[-20000:], profile),
                model=sim_model or model, env=sim_env, cwd=sim_dir, votes=sim_votes)
            turn["agent_asked"] = bool(verdict.get("agent_asked"))
            turn["touched"] = verdict.get("touched")
            turn["sim_votes"] = verdict.get("votes")
            turn["user_reply"] = verdict.get("reply", "")
            turn["user_done"] = bool(verdict.get("done"))
            turn["sim_cost_usd"] = sim_cost
            turns.append(turn)
            log(f"{name} s{si} turn {t + 1}: asked={turn['agent_asked']} done={turn['user_done']}")
            if turn["user_done"] or not turn["user_reply"].strip():
                break
            message = turn["user_reply"]
        if session_id:
            session_ids.append(session_id)
    session_id = session_ids[0] if session_ids else None

    hidden = run_hidden(workdir, scenario, "\n\n".join(t.get("agent", "") for t in turns))
    tlines = []
    for sid in session_ids:
        tlines += session_lines(home, workdir, sid)
    crawled = crawl.crawl(tlines) if tlines else {}
    diff = subprocess.run(["git", "diff", "HEAD", "--", ".", ":(exclude).work", ":(exclude).claude"],
                          cwd=workdir, env=env, capture_output=True, text=True).stdout
    untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard"], cwd=workdir,
                               env=env, capture_output=True, text=True).stdout
    judge_res = claude([JUDGE.format(rubric=(HERE / "judge_rubric.md").read_text(encoding="utf-8"),
                                     spec="\n\n".join(p.read_text(encoding="utf-8") for p in
                                                       (scenario / "spec.md", scenario / "spec2.md") if p.is_file()),
                                     hidden=json.dumps(hidden, indent=1),
                                     diff=(diff + ("\nUntracked files:\n" + untracked if untracked else ""))[:12000],
                                     conversation=conversation_text(tlines)),
                        "--model", judge_model, "--output-format", "json", "--tools", "",
                        "--strict-mcp-config", "--no-session-persistence"],
                       cwd=sim_dir, env=sim_env, timeout=600)
    judge = parse_json_reply(judge_res.get("result")) or {"error": (judge_res.get("result") or "")[-300:]}

    record = {"scenario": sc_name, "arm": arm, "run": i, "session_id": session_id,
              "session_ids": session_ids,
              "user_profile": profile, "sim_votes": sim_votes, "model": model, "task_suffix": task_suffix,
              "sim_model": sim_model or model,
              "turns": turns, "hidden": hidden, "judge": judge,
              "judge_cost_usd": judge_res.get("total_cost_usd") or 0,
              "crawl": {k: crawled.get(k) for k in ("test_runs", "skills_loaded", "tool_calls",
                                                     "questions_asked", "commits")},
              "process": process_metrics(tlines) if tlines else None,
              "diff": diff}
    record_path.parent.mkdir(parents=True, exist_ok=True)
    record_path.write_text(json.dumps(record, indent=1), encoding="utf-8")
    m = run_metrics(record)
    log(f"DONE {name}: hidden={m['hidden_score']:.2f} core={m['core_ok']} "
        f"traj={m['judge_trajectory']} honesty={m['judge_honesty']} cost=${m['cost_usd']:.2f}")
    return record


def scenario_sessions(scenario: Path, task_suffix=None):
    """[(task, intent)] per session. A scenario with task2.md/spec2.md runs a
    second, fresh session after the first; its simulated user knows only
    spec2's intent (a teammate who was not there for session one). Pure I/O."""
    out = [((scenario / "task.md").read_text(encoding="utf-8") + (task_suffix or ""),
            intent_of((scenario / "spec.md").read_text(encoding="utf-8")))]
    if (scenario / "task2.md").is_file():
        out.append(((scenario / "task2.md").read_text(encoding="utf-8"),
                    intent_of((scenario / "spec2.md").read_text(encoding="utf-8"))))
    return out


def consistency(decisions):
    """How often a replayed sim made its majority decision, and the rate at which
    it kept the conversation going. decisions: list of bools (True = replied). Pure."""
    if not decisions:
        return {"n": 0, "replied_rate": None, "agreement": None}
    k = sum(decisions)
    return {"n": len(decisions), "replied_rate": k / len(decisions),
            "agreement": max(k, len(decisions) - k) / len(decisions)}


def sim_check(out: Path, scenarios, reps, model, versions, profile, jobs, votes=3):
    """Replay the simulated user on each recorded run's FIRST agent message,
    `reps` times per prompt version, and report how consistent its decision is.
    No agent runs: only the sim is called, on inputs already recorded."""
    sim_home = out / "homes" / "sim"
    install_home("bare", sim_home)
    env = child_env(sim_home)
    sim_dir = out / "sim"
    sim_dir.mkdir(parents=True, exist_ok=True)
    jobs_list = []
    for r in load_records(out):
        if scenarios and r["scenario"] not in scenarios or not r.get("turns"):
            continue
        scenario = SCENARIOS / r["scenario"]
        task = (scenario / "task.md").read_text(encoding="utf-8")
        intent = intent_of((scenario / "spec.md").read_text(encoding="utf-8"))
        history = f"USER: {task}\n\nASSISTANT: {r['turns'][0]['agent']}"
        for v in versions:
            prompt = user_sim_prompt(task, intent, history, profile, version=v)
            for _ in range(reps):
                jobs_list.append((f"{r['scenario']}/{r['arm']}-{r['run']}", v, prompt))

    def call(job):
        name, v, prompt = job
        if v == 1:  # the pilot: one call, the model's own `done`
            res = claude([prompt, "--model", model, "--output-format", "json", "--tools", "",
                          "--strict-mcp-config", "--no-session-persistence"],
                         cwd=sim_dir, env=env, timeout=300)
            verdict = parse_json_reply(res.get("result")) or {"done": True, "reply": ""}
            return name, v, not verdict.get("done") and bool((verdict.get("reply") or "").strip())
        verdict, _ = simulate_user(prompt, model=model, env=env, cwd=sim_dir, votes=votes)
        return name, v, not verdict["done"]

    with ThreadPoolExecutor(max_workers=jobs) as ex:
        results = list(ex.map(call, jobs_list))
    table = {}
    for name, v, replied in results:
        table.setdefault(name, {}).setdefault(v, []).append(replied)
    return {name: {f"v{v}": consistency(ds) for v, ds in sorted(by_v.items())}
            for name, by_v in sorted(table.items())}


def load_records(out: Path):
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((out / "records").rglob("*.json"))]


def main(argv):
    import argparse
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--scenarios", nargs="+", default=["feature-03", "config-04", "account-05"])
    r.add_argument("--arms", nargs="+", default=list(ARMS))
    r.add_argument("--runs", type=int, default=3)
    r.add_argument("--out", required=True)
    r.add_argument("--jobs", type=int, default=6)
    r.add_argument("--model", default="sonnet")
    r.add_argument("--judge-model", default="opus")
    r.add_argument("--sim-model", default=None, help="the simulated user's model (default: --model)")
    r.add_argument("--task-suffix", default=None, help="text appended to every task (e.g. to make it outlive the session)")
    r.add_argument("--reuse-path", action="store_true",
                   help="all runs of an arm share one workdir path, run one after another")
    r.add_argument("--max-turns", type=int, default=6)
    r.add_argument("--user-profile", choices=sorted(PROFILES), default="attentive")
    r.add_argument("--sim-votes", type=int, default=3)
    rep = sub.add_parser("report")
    rep.add_argument("out")
    rg = sub.add_parser("regrade", help="re-run hidden checks and process metrics on existing runs")
    rg.add_argument("out")
    sc = sub.add_parser("sim-check")
    sc.add_argument("out")
    sc.add_argument("--scenarios", nargs="*", default=[])
    sc.add_argument("--reps", type=int, default=3)
    sc.add_argument("--versions", nargs="+", type=int, default=[1, 2])
    sc.add_argument("--user-profile", choices=sorted(PROFILES), default="attentive")
    sc.add_argument("--model", default="sonnet")
    sc.add_argument("--jobs", type=int, default=8)
    sc.add_argument("--sim-votes", type=int, default=3)
    a = ap.parse_args(argv)

    out = Path(a.out).resolve()
    if a.cmd == "regrade":
        n = 0
        for path in sorted((out / "records").rglob("*.json")):
            r = json.loads(path.read_text(encoding="utf-8"))
            wd = out / "work" / r["scenario"] / f"{r['arm']}-{r['run']}"
            if wd.exists():
                r["hidden"] = run_hidden(wd, SCENARIOS / r["scenario"],
                                         "\n\n".join(t.get("agent", "") for t in r["turns"]))
            else:
                # A --reuse-path round keeps one path per arm, holding only the last
                # run's code: keep the hidden results graded at run time, and
                # recount only what the transcripts hold.
                wd = out / "work" / r["scenario"] / r["arm"]
            home = out / "homes" / home_key(r["arm"])
            lines = []
            for sid in r.get("session_ids") or ([r["session_id"]] if r.get("session_id") else []):
                lines += session_lines(home, wd, sid)
            if lines:
                r["process"] = process_metrics(lines)
                r.setdefault("crawl", {})["skills_loaded"] = crawl.crawl(lines).get("skills_loaded")
            path.write_text(json.dumps(r, indent=1), encoding="utf-8")
            n += 1
        print(f"regraded {n} runs (the judge's verdicts are kept; it saw the old hidden results)")
        return 0
    if a.cmd == "sim-check":
        res = sim_check(out, a.scenarios, a.reps, a.model, a.versions, a.user_profile, a.jobs,
                        votes=a.sim_votes)
        print(f"| run | " + " | ".join(f"v{v} replied / agreement" for v in a.versions) + " |")
        print("|---|" + "---|" * len(a.versions))
        for name, by_v in res.items():
            cells = [f"{by_v[f'v{v}']['replied_rate']:.2f} / {by_v[f'v{v}']['agreement']:.2f}"
                     if f"v{v}" in by_v else "–" for v in a.versions]
            print(f"| {name} | " + " | ".join(cells) + " |")
        return 0
    if a.cmd == "report":
        records = load_records(out)
        for r in records:  # records from before process metrics: compute from the transcript
            if r.get("process") is None and r.get("session_id"):
                home = out / "homes" / home_key(r["arm"])
                tp = transcript_file(home, out / "work" / r["scenario"] / f"{r['arm']}-{r['run']}", r["session_id"])
                if tp.is_file():
                    r["process"] = process_metrics(tp.read_text(encoding="utf-8").splitlines())
        agg = aggregate(records)
        print(render(agg))
        print(render_contrasts(contrasts(records)))
        print(render_skill_loads(records))
        (out / "aggregate.json").write_text(json.dumps(agg, indent=1), encoding="utf-8")
        return 0

    homes = {}
    for arm in a.arms:
        key = home_key(arm)
        homes[arm] = out / "homes" / key
        install_home(key, homes[arm])
    sim_home = out / "homes" / "sim"
    install_home("bare", sim_home)
    # Interleave arms so a slow stretch of the API hits every arm alike.
    specs = [(arm, sc, i) for i in range(1, a.runs + 1) for sc in a.scenarios for arm in a.arms]
    if a.reuse_path:  # one worker per (arm, scenario) path, runs in order
        groups = {}
        for s_ in specs:
            groups.setdefault((s_[0], s_[1]), []).append(s_)

        def run_group(group):
            for s_ in group:
                one_run(s_, out=out, homes=homes, sim_home=sim_home, model=a.model,
                        judge_model=a.judge_model, max_turns=a.max_turns, profile=a.user_profile,
                        sim_votes=a.sim_votes, sim_model=a.sim_model, reuse_path=True,
                        task_suffix=a.task_suffix)
        with ThreadPoolExecutor(max_workers=a.jobs) as ex:
            list(ex.map(run_group, groups.values()))
        print(render(aggregate(load_records(out))))
        return 0
    with ThreadPoolExecutor(max_workers=a.jobs) as ex:
        futures = [ex.submit(one_run, s, out=out, homes=homes, sim_home=sim_home, model=a.model,
                             judge_model=a.judge_model, max_turns=a.max_turns,
                             profile=a.user_profile, sim_votes=a.sim_votes,
                             sim_model=a.sim_model, task_suffix=a.task_suffix) for s in specs]
        for f in futures:
            try:
                f.result()
            except Exception as exc:  # one broken run must not stop the batch
                log(f"RUN FAILED: {exc!r}")
    print(render(aggregate(load_records(out))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
