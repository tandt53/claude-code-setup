#!/usr/bin/env python3
"""Grade one A/B scenario run: did the agent fix the bug, handle the edge cases
it was not told about, and leave a regression test behind?

The grade is objective — it runs the scenario's authoritative cases against the
agent's own module (named in cases.json), not against the agent's own tests, so
the agent cannot pass by editing the tests. `grade()` is pure (checks in,
verdict out) and unit-tested; the CLI does the I/O: load the module, run the
cases, count tests.

The three checks are deliberately split so the A/B delta is legible:
  - bug_fixed            the one failure named in task.md
  - edges_ok             the cases task.md did NOT spell out (thoroughness)
  - regression_test_added a test exists that was not in the fixture (discipline)
`pass` needs bug_fixed and edges_ok; regression_test_added is scored, not gating.

Usage:
    python3 measurement/grade_scenario.py <run-workdir> <scenario-dir> [--json]
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

CHECKS = ("bug_fixed", "edges_ok", "regression_test_added")


def grade(checks):
    """Fold the three raw checks into a verdict. Pure."""
    got = {k: bool(checks.get(k)) for k in CHECKS}
    got["pass"] = got["bug_fixed"] and got["edges_ok"]
    got["score"] = sum(1 for k in CHECKS if got[k])
    return got


def _load_fn(workdir: Path, module_file: str, func_name: str):
    """Import the agent's module by path and return its function, without putting
    workdir on sys.path (so a stray module there cannot shadow a stdlib import)."""
    spec = importlib.util.spec_from_file_location("agent_mod", Path(workdir) / module_file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, func_name)


def _call(fn, inp):
    """A case's input is the call's args as a list, or a single bare value."""
    return fn(*inp) if isinstance(inp, list) else fn(inp)


def _cases_pass(fn, cases) -> bool:
    for inp, expected in cases:
        try:
            if _call(fn, inp) != expected:
                return False
        except Exception:
            return False
    return True


def _test_func_count(d: Path) -> int:
    n = 0
    for f in d.glob("test_*.py"):
        n += len(re.findall(r"^\s*def\s+test_\w+", f.read_text(encoding="utf-8", errors="replace"), re.M))
    return n


def run_checks(workdir: Path, scenario: Path) -> dict:
    """Run the raw checks for one run. I/O; returns the dict grade() folds."""
    cases = json.loads((scenario / "cases.json").read_text(encoding="utf-8"))
    fn = _load_fn(workdir, cases.get("module", "slugify.py"), cases.get("function", "slugify"))
    fixture_tests = _test_func_count(scenario / "fixture")
    run_tests = _test_func_count(workdir)
    return {
        "bug_fixed": _cases_pass(fn, cases.get("public", [])),
        "edges_ok": _cases_pass(fn, cases.get("hidden", [])),
        "regression_test_added": run_tests > fixture_tests,
    }


def main(argv):
    args = [a for a in argv if a != "--json"]
    as_json = "--json" in argv
    if len(args) < 2:
        print(__doc__)
        return 2
    workdir, scenario = Path(args[0]), Path(args[1])
    try:
        verdict = grade(run_checks(workdir, scenario))
    except FileNotFoundError as exc:
        print(f"cannot grade: {exc}", file=sys.stderr)
        return 1
    if as_json:
        print(json.dumps(verdict, indent=2))
    else:
        print("  ".join(f"{k}={verdict[k]}" for k in (*CHECKS, "pass", "score")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
