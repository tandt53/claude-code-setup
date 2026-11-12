# measurement/

Tools for `docs/measurement-strategy.md`. Each tool's core is a pure function
(data in, dict out) with a thin CLI, so the logic is unit-tested on synthetic
fixtures. Run the tests with the repo's Test command, or:

```
.venv/bin/python -m unittest discover -s measurement -p 'test_*.py'   # pytest lives in .venv (CLAUDE.md)
```

## Tools

| Tool | Phase | What it reads | What it prints |
|---|---|---|---|
| `crawl.py` | crawl | a session transcript `.jsonl` | per-session metrics: turns, tool calls, skills loaded, test-runs, commits, self-corrections, `[unverified]`/`[todo]` flags, tokens |
| `churn.py` | walk | `git log --numstat` | rework rate (a file touched again within a commit window) and line churn |
| `trace_rollup.py` | walk | one or more trace-check `status.json` | traceability: examples, proven %, assumed, orphans, level mix |
| `compare.py` | walk | two `crawl.py --json` outputs | per-metric A vs B mean, range and delta (with-kit vs baseline, or per-skill ablation) |
| `judge.py` | run | a transcript (`prep`), verdicts (`score`), judge+human (`calibrate`) | evidence bundle for the LLM judge; verdict rollup; judge-vs-human agreement |
| `history.py` | run | a history file + a dated snapshot | upserts the snapshot by date, for the trend dashboard |
| `grade_scenario.py` | walk | one A/B run's workdir + a scenario | an objective verdict: bug_fixed, edges_ok, regression_test_added, pass, score |
| `ab_run.py` | walk | a scenario dir | `emit` the runbook for one A/B scenario, then `collect` the runs you produced into a with-kit-vs-baseline compare |
| `ab_multi.py` | run | scenario dirs with `hidden_checks.py` | runs three arms (bare, global setup, global + project kit) multi-turn against a simulated user, grades each run by hidden checks + judge + cost, and prints the per-arm table |

```
python3 measurement/crawl.py ~/.claude/projects/<slug>/<session>.jsonl
python3 measurement/churn.py --since main~20..main --window 5
python3 measurement/trace_rollup.py .work/tasks/
python3 measurement/compare.py with-kit.json baseline.json --label-a with-kit --label-b baseline
```

All take `--json` for machine-readable output.

## Automatic crawl (the Stop hook)

`crawl.py` is the one tool that runs on its own. A global Stop hook,
`hooks/measure_session.py`, crawls the current transcript at the end of every
turn and writes one snapshot per session to
`~/.claude/measurement/sessions/<session-id>.json`, tagged with project, cwd and
git branch. One file per session (written atomically) means concurrent sessions
never race; the hook never blocks the session and no-ops if `crawl.py` is not
installed beside it. So the whole-system store fills passively — a later rollup
reads that directory and groups by project or folds all sessions together.

Everything else below is run by hand: counting is cheap enough to automate,
comparing and judging are not.

## The A/B protocol (the part that is run by hand)

Producing the runs is a human step — the analysis cannot invent them — but
`ab_run.py` scaffolds it, and `grade_scenario.py` scores each run objectively.
A scenario lives under `measurement/ab/scenarios/<name>/` (`task.md`, a
`fixture/` the agent edits, and `cases.json` the grader checks against). The
first one is `slug-01`: fix a bug whose edge cases the task does not spell out,
so the kit's thoroughness and test discipline show in the delta.

**One-time: a kit-free baseline config.** The honest "without-kit" side is a
config dir that has none of the kit. You create it and log in once — this is
yours to do; the scripts never touch credentials:

```
mkdir -p ~/.claude-baseline
CLAUDE_CONFIG_DIR=~/.claude-baseline claude    # then /login, then exit
```

That dir has no `CLAUDE.md`, no skills, no hooks — a plain Claude Code.

**Each evaluation:**

1. **Emit the runbook** (nothing launched, no tokens):
   `python3 measurement/ab_run.py emit measurement/ab/scenarios/slug-01 --runs 3 --baseline-config ~/.claude-baseline`
2. **Run the printed blocks yourself.** Each copies the fixture into
   `runs/work/<name>/`, runs `claude -p` there (with-kit uses your real config,
   baseline sets `CLAUDE_CONFIG_DIR`), and saves `result.json`. You approve each
   run; the script prescribes no permission bypass. N ≥ 3 a side for any claim
   (P4).
3. **Collect:**
   `python3 measurement/ab_run.py collect measurement/ab/scenarios/slug-01 --runs 3 --baseline-config ~/.claude-baseline`
   crawls every transcript, grades every run, and prints the with-kit-vs-baseline
   compare. Read the delta *with its range and n* — fewer than 2 runs a side is
   a hypothesis, not a result.

`collect` writes `with-kit.json` / `baseline.json`; `compare.py` is what prints
the table, so you can re-run it alone. Run dirs under `runs/` are gitignored.

**Per-skill ablation** is the same, with one skill suppressed instead of the
whole kit (a baseline config that has every skill but that one); the delta is
that skill's value (strategy §4.3).

## Multi-turn A/B with a simulated user (`ab_multi.py`)

The one-shot protocol above cannot exercise the kit's gates: a single
`claude -p` has no one to answer a question or approve a plan (strategy §7).
`ab_multi.py` adds that person. A second model plays the developer who asked
for the task: it knows the real intent (the scenario's `spec.md`, "What correct
means") but only answers what it is asked and never volunteers a missing case.
An arm that asks before it guesses is rewarded; one that guesses is not told.

The simulated user has a fixed profile per batch (`--user-profile`):
`attentive` (default) reads the whole report and answers every point of the
intent it touches, even one listed under Not done in a report that says DONE;
`busy` answers only direct questions. It first lists the intent points the
message touched and whether each agrees, contradicts or asks; code, not the
model, then decides whether it may reply (`sim_decision`), so it cannot reply
about a case the agent never raised. Each user turn is a majority of
`--sim-votes` calls (default 3).

`sim-check` replays the simulated user on the first agent message of every
recorded run, without running any agent, and prints how often it replied and
how consistent it was. Run it after changing the simulated user's prompt:

```
python3 measurement/ab_multi.py sim-check <dir> --reps 3 --versions 1 2
```

Three arms, each its own `HOME`, so `~/.claude` is whatever the arm installs:

| Arm | `~/.claude` | The task's repo |
|---|---|---|
| `bare` | empty (plain Claude Code) | the fixture |
| `l1` | the global setup: prompts, global skills, reviewer, hooks, settings | the fixture |
| `l1l2` | as `l1` | the fixture + the project kit, installed as project-init would for a Python library (shared, dev and qa skills without the UI ones; `.work/`; a CLAUDE.md with `Test command`) |

Each run copies the fixture into a fresh git repo (so the `require_tests` hook
counts its edits), then loops agent turn → user turn for at most `--max-turns`
agent turns, then grades three ways:

- **hidden**: the scenario's `hidden_checks.py`, one check per point of
  `spec.md`, run against the agent's module. Objective; `core_ok` is the one
  unstated case that matters most.
- **judge**: an LLM reads the conversation (skill names hidden), the diff and
  the hidden results, and scores `trajectory` and `honesty` per
  `judge_rubric.md`. The kit's report shape still shows, so the judge is not
  fully blind.
- **cost**: output tokens, USD, agent turns, how often the agent asked the user.
- **process** (judge-free): `code_before_reply`, whether it wrote a `.py`
  before the user's first answer, and `rework_edits`, writes to code already
  built. Edits through Bash (`cat >`, `sed -i`) count too.

`report` adds each arm pair's difference with a permutation p. Scenarios
cover the SDLC phases (requirements, design, implementation, testing,
review, maintenance). Each has `task.md` (what the agent sees), `spec.md`
(the intent; the simulated user reads "What correct means"), `fixture/`,
`hidden_checks.py` and `reference/`, a correct solution that
`test_ab_multi.py` proves passes every check while the start fails the core
one. A check may read the agent's report and run the agent's own tests
against swapped modules (`ab/hidden_runner.py`). A scenario with
`branch.json` starts on a branch carrying `branch/` over `main`.

```
python3 measurement/ab_multi.py run --runs 3 --out <dir> --jobs 8 \
    --scenarios req-06 design-07 feature-03 config-04 account-05 test-08 review-09 bugfix-10 \
    [--user-profile attentive|busy] [--model sonnet] [--sim-model sonnet]   # 72 runs
python3 measurement/ab_multi.py report <dir>
```

`run` resumes: a run whose record exists is skipped. Unlike `ab_run.py` it
launches agents itself with `--allowedTools Bash` in a throwaway repo, the
same on every arm; run it only in an isolated machine (a cloud session, a
container). Records land in `<dir>/records/<scenario>/<arm>-<i>.json`.

## The judge protocol (the "run" phase)

`judge.py` does everything around the judgment; the judgment is an LLM call.

1. `python3 measurement/judge.py prep <transcript.jsonl>` — a compact evidence
   bundle (metrics + the agent's own done-claims to verify, not trust).
2. An agent reads that bundle + the task's spec + result and returns one JSON
   verdict per `judge_rubric.md` (trajectory 0-5, honesty pass/fail,
   gate_value 0-5).
3. `python3 measurement/judge.py score <verdicts.json>` — rolls them up.
4. `python3 measurement/judge.py calibrate <judge.json> <human.json>` — a human
   audits a sample into the same shape; this reports agreement, so the judge is
   checked (never ship an uncalibrated judge).

Feed a dated snapshot of the day's numbers into the trend view:

```
python3 measurement/history.py measurement/history.json snapshot.json --date 2026-11-08
```

then open `docs/measurement-dashboard.html` (it has sample data; paste your
history.json to render real trends).

## What these do not do

`crawl`, `churn`, `trace_rollup` and `compare` count and compare; they do not
judge. "Did it meet the spec", "was the review deep", "was a gate stop a real
save" are the judge's job (`judge.py` + the LLM call), calibrated against a
human audit. No metric is read alone (strategy P1).
