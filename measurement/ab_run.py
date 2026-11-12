#!/usr/bin/env python3
"""Orchestrate one A/B scenario: emit the run commands, then collect and compare
their results — the walk-phase A/B (strategy §6).

The honest comparison is with-kit vs without-kit on the SAME task (P3), N runs a
side (P4):
  - with-kit : the real config (~/.claude: skills, workflow, hooks) is in force.
  - baseline : CLAUDE_CONFIG_DIR points at a kit-free config dir you created and
               logged in to ONCE yourself; none of the kit loads there.

This script does NOT launch agents and never touches credentials or permission
bypass: `emit` prints the exact commands for YOU to run (you decide how each run
is approved), and `collect` reads the runs you produced, crawls each transcript
(crawl.py), grades each (grade_scenario.py), and compares the two sides
(compare.py). `plan()` is pure and unit-tested.

Usage:
    # 1. see the runbook (nothing launched, no tokens spent)
    python3 measurement/ab_run.py emit <scenario-dir> --runs 3 --baseline-config <dir>
    # 2. run the printed commands yourself (each writes work/<name>/result.json)
    # 3. gather the verdict
    python3 measurement/ab_run.py collect <scenario-dir> --runs 3 --baseline-config <dir>
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import crawl  # noqa: E402
import grade_scenario  # noqa: E402
import compare as compare_mod  # noqa: E402

SIDES = ("with-kit", "baseline")


def plan(*, runs, workroot):
    """The run specs: one per (side, i). Pure — paths and side only, no I/O."""
    specs = []
    for side in SIDES:
        for i in range(1, runs + 1):
            name = f"{side}-{i}"
            specs.append({
                "side": side,
                "run": i,
                "name": name,
                "workdir": str(Path(workroot) / name),
                "is_baseline": side == "baseline",
            })
    return specs


def _slug(path) -> str:
    """Claude Code's project-folder name for a cwd: every non-alphanumeric → '-'."""
    return re.sub(r"[^A-Za-z0-9]", "-", str(path))


def transcript_path(config_dir, workdir, session_id) -> Path:
    base = Path(config_dir) if config_dir else (Path.home() / ".claude")
    return base / "projects" / _slug(Path(workdir).resolve()) / f"{session_id}.jsonl"


def emit(scenario: Path, specs, baseline_config, model):
    """Print the runbook: copy the fixture, run claude there, save its json."""
    fixture = scenario / "fixture"
    print(f"# A/B runbook — {scenario.name}   model={model}")
    print(f"# baseline config dir: {baseline_config}")
    print("# run each block; each leaves work/<name>/result.json for `collect`.\n")
    for s in specs:
        wd = s["workdir"]
        cfg = f'CLAUDE_CONFIG_DIR="{baseline_config}" ' if s["is_baseline"] else ""
        print(f"rm -rf '{wd}' && cp -R '{fixture}' '{wd}'")
        print(f"( cd '{wd}' && {cfg}claude -p \"$(cat '{scenario / 'task.md'}')\" "
              f"--model {model} --permission-mode acceptEdits "
              f"--output-format json > result.json )")
        print()
    print("# then: python3 measurement/ab_run.py collect ...")


def collect(scenario: Path, specs, baseline_config, out_dir: Path):
    """Read each produced run, crawl + grade it, then compare the two sides."""
    sides = {s: {} for s in SIDES}
    missing = []
    for s in specs:
        wd = Path(s["workdir"])
        result = wd / "result.json"
        if not result.is_file():
            missing.append(s["name"])
            continue
        session_id = None
        try:
            session_id = json.loads(result.read_text(encoding="utf-8")).get("session_id")
        except ValueError:
            pass
        metrics = {}
        if session_id:
            cfg = baseline_config if s["is_baseline"] else None
            tp = transcript_path(cfg, wd, session_id)
            if tp.is_file():
                with open(tp, encoding="utf-8") as fh:
                    metrics = crawl.crawl(fh)
        try:
            verdict = grade_scenario.grade(grade_scenario.run_checks(wd, scenario))
        except Exception as exc:
            verdict = {"pass": False, "score": 0, "error": str(exc)}
        metrics["grade_score"] = verdict.get("score", 0)
        metrics["grade_pass"] = 1 if verdict.get("pass") else 0
        sides[s["side"]][s["name"]] = metrics
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "with-kit.json").write_text(json.dumps(sides["with-kit"], indent=2), encoding="utf-8")
    (out_dir / "baseline.json").write_text(json.dumps(sides["baseline"], indent=2), encoding="utf-8")
    if missing:
        print(f"! no result.json for: {', '.join(missing)} (run its block first)\n", file=sys.stderr)
    rows = compare_mod.compare(sides["with-kit"], sides["baseline"])
    print(compare_mod.render(rows, "with-kit", "baseline"))
    return sides


def main(argv):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["emit", "collect"])
    ap.add_argument("scenario")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--baseline-config", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)

    scenario = Path(a.scenario).resolve()
    workroot = Path(a.out or (scenario / "runs")) / "work"
    specs = plan(runs=a.runs, workroot=workroot)
    baseline = a.baseline_config or "<SET --baseline-config: a kit-free config dir you logged in once>"

    if a.cmd == "emit":
        emit(scenario, specs, baseline, a.model)
        return 0
    collect(scenario, specs, baseline if a.baseline_config else None,
            Path(a.out or (scenario / "runs")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
