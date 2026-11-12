#!/usr/bin/env python3
"""Run one scenario's hidden checks against a finished run. Executed with -I in a
subprocess, so the agent's code cannot touch the harness.

    python3 -I hidden_runner.py <workdir> <scenario-dir> <final-message-file>

A scenario's hidden_checks.py defines either
  checks(mod)       -> {name: bool}   mod = the fixture's one non-test module
or
  checks_ctx(ctx)   -> {name: bool}   ctx = Ctx below, for checks that need the
                                      final report, git, or the agent's tests
and CORE, the name of the check for the unstated case that matters most.
Prints one JSON line: {"core": ..., "checks": {...}}.
"""
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SKIP_DIRS = {".claude", ".work", ".git", "__pycache__", "reports", "docs", "scripts"}


def load(path, name="agent_mod"):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Ctx:
    def __init__(self, workdir: Path, scenario: Path, final: str):
        self.workdir = workdir
        self.scenario = scenario
        self.final = final

    def load(self, rel):
        """Import a module from the agent's workdir by relative path. The workdir
        goes on sys.path so its modules can import each other; this runs in its
        own -I subprocess, so nothing outside it is shadowed."""
        if str(self.workdir) not in sys.path:
            sys.path.insert(0, str(self.workdir))
        return load(self.workdir / rel, "agent_" + rel.replace("/", "_").replace(".", "_"))

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.workdir, capture_output=True, text=True).stdout

    def imp(self, dotted):
        """Import a module by its dotted name from the workdir (for packages,
        so every module shares the same imported state)."""
        import importlib
        if str(self.workdir) not in sys.path:
            sys.path.insert(0, str(self.workdir))
        return importlib.import_module(dotted)

    def original(self, rel):
        """A file's content in the repository's first commit (the untouched start)."""
        root = self.git("rev-list", "--max-parents=0", "HEAD").strip().splitlines()[0]
        return self.git("show", f"{root}:{rel}")

    def agent_tests(self):
        """Test files the agent added or changed since the start (git), so a
        base repo's own tests do not count. Returns (agent_tests, [])."""
        root = self.git("rev-list", "--max-parents=0", "HEAD").strip().splitlines()[0]
        changed = self.git("diff", "--name-only", root).split()
        changed += self.git("ls-files", "--others", "--exclude-standard").split()
        out = sorted({p for p in changed if Path(p).name.startswith("test_") and p.endswith(".py")
                      and not set(Path(p).parts[:-1]) & SKIP_DIRS})
        return out, []

    def run_tests_with(self, replacements):
        """Run the workdir's tests (pytest) in a copy where each {rel: source}
        replaces a file. Returns {"passed": bool, "collected": int}."""
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / "w"
            shutil.copytree(self.workdir, dst, ignore=shutil.ignore_patterns(
                ".git", "__pycache__", ".claude", ".work", "reports"))
            for rel, src in replacements.items():
                (dst / rel).write_text(src, encoding="utf-8")
            p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                                "--ignore=docs", "--ignore=scripts"],
                               cwd=dst, capture_output=True, text=True, timeout=120)
            tail = (p.stdout or "").strip().splitlines()[-1:] or [""]
            import re
            nums = [int(n) for n in re.findall(r"(\d+) (?:passed|failed|error)", tail[0])]
            return {"passed": p.returncode == 0, "collected": sum(nums), "summary": tail[0]}


def main(argv):
    workdir, scenario, final_file = Path(argv[0]), Path(argv[1]), Path(argv[2])
    hc = load(scenario / "hidden_checks.py", "hidden_checks")
    final = final_file.read_text(encoding="utf-8") if final_file.is_file() else ""
    if hasattr(hc, "checks_ctx"):
        checks = hc.checks_ctx(Ctx(workdir, scenario, final))
    else:
        modules = [p.name for p in (scenario / "fixture").glob("*.py") if not p.name.startswith("test_")]
        checks = hc.checks(load(workdir / modules[0]))
    print(json.dumps({"core": hc.CORE, "checks": {k: bool(v) for k, v in checks.items()}}))


if __name__ == "__main__":
    main(sys.argv[1:])
