# Measurement strategy

How to tell whether this setup — the workflow and communication rules, the
layer-1 and layer-2 skills, and the mechanisms that enforce them — actually
makes the work better, and where it does not. It gives a method for choosing
metrics (not a fixed list to adopt blindly), a catalogue of metrics at four
levels (whole system, phase, skill, task), a map of what can be measured
automatically, and a rollout that starts from data the system already produces.

> Written for: whoever maintains this setup and will build and run the
> measurement — not an end-user of a project built with it.

Dates are absolute. Benchmarks quoted from vendor blogs are marked as such and
are directions, not standards. Every claim about an outside framework carries a
source in [References](#references).

---

## 1. Why this is a different measurement problem

This setup is not a product; it is a **way of working** that an AI agent
follows. So its effectiveness is not "does feature X work" but "does working
this way produce better outcomes than not working this way, and is each part
earning its cost." That puts the problem at the intersection of two measurement
worlds, and the strategy borrows from both:

- **Software process and productivity measurement** — DORA, SPACE, DX Core 4,
  and the test-effectiveness metrics (defect escape, mutation score, phase
  containment). The setup *is* an SDLC/STLC process, so these apply directly.
- **LLM-agent evaluation** — task success rate, trajectory (step-level)
  scoring, reliability across repeated runs, tool-use precision, token cost.
  The *worker* is an agent, so outcome-only measures hide failures these catch.

One advantage is unusual and shapes everything below: **every session leaves a
full transcript** — every skill load, tool call, and gate stop. Measuring
whether a human team followed its process needs surveys and is slow and
disputed; here, process adherence is a first-class signal that can be read
**automatically, at scale, from data that already exists**.

---

## 2. Principles

Five rules, each from the research, that keep a metric set honest.

- **P1 — No single metric.** SPACE's central claim: productivity is
  multi-dimensional; one number always distorts. Pair every metric with a
  counter-metric (speed ↔ quality, outcome ↔ trajectory). Optimising
  `acceptance rate` alone biases toward easy, well-trodden tasks.
- **P2 — Leading vs lagging.** Process-adherence metrics (did it write the
  failing test first, did it stop at G1) are *leading* and readable now; outcome
  metrics (defects, rework) are *lagging* and appear later. Track both; steer by
  the leading ones.
- **P3 — Always compare to a baseline.** A 2025 randomised trial found
  developers using AI took **19% longer** while believing they were **20%
  faster** — the perception gap. Absolute and self-reported numbers mislead.
  Only *with-kit vs without-kit*, or before/after on matched work, says anything.
- **P4 — Reliability across runs (pass^k).** One green task proves little.
  Report success over N repeated runs of the same scenario; one source saw a
  single run at 80% while ten runs ranged 65–90%.
- **P5 — Final answer hides failures.** "Done" does not reveal a wrongly-skipped
  gate, a silently-filled requirement gap, or stopping too early. Score the
  **trajectory**, not just the result.

---

## 3. The GQM backbone

Start from goals, not metrics (Goal → Question → Metric; Basili & Rombach).
Metric programs fail when they begin with what is easy to count. The setup
states its own goals in `workflow.md`; four of them drive everything below.

| Goal | What it means | Core questions | Primary metrics |
|---|---|---|---|
| **G1 · Right thing, right way** | Catch a misread request (G1 gate, `assumed`), and catch defects before they ship | Are requirements settled before build? Where are defects caught? | Phase Containment Effectiveness, defect escape rate, right-first-time |
| **G2 · Efficient** | Less rework, fewer wasted tokens/turns | How much work is redone? What does a task cost? | Rework rate, tokens/turns per completed task, lead time |
| **G3 · Consistent** | Same quality regardless of which session or task runs it | Does quality hold across runs and tasks? | Reliability (pass^k), variance of per-task scores |
| **G4 · Learning** | A mistake seen twice becomes a check | Do mistakes repeat? Do lessons become checks? | Repeat-mistake rate, lessons-promoted ratio |

Everything in §4 is one of these goals refined into a question and a number.
If a proposed metric answers none of G1–G4, drop it.

---

## 4. Four levels of measurement

Each level has its own table. Columns: **metric**, the **question** it answers,
**L/L** (leading or lagging), **source** (auto from an artifact, or a human /
LLM-judge call), and a **caveat** that names how it could mislead.

### 4.1 Whole system (lagging, read against a baseline)

The honest top-line: does working this way beat not working this way?

| Metric | Question (goal) | L/L | Source | Caveat |
|---|---|---|---|---|
| **Defect escape rate** | What share of defects reach review/prod despite the process? (G1) | lag | test results + bug store | needs a defect to be *recorded*; undercounts silent ones |
| **Rework rate** | How much work is redone? (G2) | lag | git churn (lines touched again within N commits/days) | refactor ≠ rework; label by intent |
| **Right-first-time** | % tasks that pass G1 and never need a spec fix afterwards (G1) | lag | spec edits after approval, in task log | a task with no spec is excluded |
| **Lead time to done** | Time/turns from Frame to verified done (G2) | lag | task log timestamps, transcript | task size varies; normalise or bucket |
| **Cost per completed task** | Tokens + turns per accepted task (G2) | lag | transcript token counts | cheap wrong work looks good; pair with escape rate |
| **vs-baseline delta** | Any of the above, with-kit minus without-kit (all) | lag | A/B scenarios (§6 walk) | the only line that attributes causation |

> Benchmarks (directions, not standards): defect escape <5% good / >15% poor;
> DORA added **rework rate** as a performance factor in 2025.

### 4.2 Per phase (the setup's strongest claim)

The setup promises to push defect-catching earlier (requirements → test →
code). Phase metrics test exactly that.

| Metric | Question (goal) | L/L | Source | Caveat |
|---|---|---|---|---|
| **Phase Containment Effectiveness (PCE)** | % of defects caught in the phase that created them (G1) | lag | defect origin vs find phase | ~70% is typical; ~97% deserves scrutiny, not applause |
| **Gate stop rate** | How often does each gate G1–G4 stop the work? | lead | transcript (plan-mode entries, gate lines) | a stop is only good if it prevented a real error |
| **Gate value** | Of the stops, how many averted a real defect vs added friction? | lag | LLM-judge / human audit of stopped cases | small n; sample, do not census |
| **Traceability score** | % of in-scope REQs with a test; % examples still `assumed` at release | lead | `status.json` / `trace-check` | measures linkage, not test quality |
| **Mutation score** | Of injected faults, what share do the tests kill? (G1) | lag | `mutation-check` output | equivalent mutants add noise; exclude them |

> Traceability benchmark (vendor, Jama): top-decile ≈ 87%.

### 4.3 Per skill (needs a counterfactual — the hardest level)

A skill's description loads in every relevant session (a standing token cost);
its body loads when triggered. Is each one worth that?

| Metric | Question (goal) | L/L | Source | Caveat |
|---|---|---|---|---|
| **Trigger precision / recall** | Is the skill invoked when it should be, and not when it shouldn't? | lead | transcript skill-load events vs a labelled "should-trigger" set | needs labels; build from a scenario set |
| **Ablation delta** | Run matched scenarios with the skill available vs suppressed; the defect/rework difference is the skill's value (all) | lag | A/B scenarios | the *only* honest attribution; everything else is correlation |
| **Output survival** | Does the skill's product (a test from `test-design`, a bug from `bug-report`) survive review and get used? | lag | git + review outcome | survival ≠ correctness |
| **Standing cost** | Always-on description tokens + mean body tokens when loaded | lead | token count of the skill file | cost is only half the ratio; weigh against value |
| **Independence** | Does the skill run from its `Start when` without another skill present? | lead | transcript (did it hard-depend on a sibling) | a design check more than a running metric |

### 4.4 Per task (one scorecard per transcript)

The unit that rolls up into every level above. One row per task, mostly from the
transcript.

| Metric | Question (goal) | L/L | Source | Caveat |
|---|---|---|---|---|
| **Success** | Did it meet the approved acceptance examples? (G1) | lag | spec examples vs result | self-declared "done" is not success; check the examples |
| **Trajectory score** | Did it follow the 8 steps / stop at the right gates? (P5) | lead | transcript vs workflow steps | reward the right skips (no gate → no stop), not all skips |
| **Reliability** | Same scenario re-run N times: pass^k (G3) | lag | repeated runs | expensive; reserve for high-risk scenarios |
| **Self-correction count** | How many times did it fix its own mistake mid-task? (G2) | lead | transcript | a few is healthy; many signals a bad plan |
| **Honesty** | Any claimed-done-without-running, or `[unverified]` folded into done? | lead | transcript + report vs evidence | the costliest failure mode; weight it heavily |
| **Cost** | Tokens + turns | lead | transcript | pair with success, never alone |

Per-task scoring that needs judgment (success, trajectory, honesty) is done by
an **LLM-judge** reading the transcript, spec and result, **calibrated** against
a periodic human audit so the judge itself is checked (mutation-check thinking,
one level up).

---

## 5. What is measured automatically

The setup's own artifacts are the instrument. Most leading metrics are free.

| Artifact already produced | Metrics it yields with no new instrumentation |
|---|---|
| **Transcript** (skill loads, tool calls, gate stops, tokens) | trajectory, trigger precision, gate stop rate, self-correction, turn/token cost |
| **`status.json` / `trace-check`** | traceability, `assumed`-at-release, REQ coverage |
| **Git history** | rework/churn, lead time, one-logical-change discipline |
| **Test runner + `mutation-check`** | mutation score, defect escape (with a bug store) |
| **`lessons.md`** | repeat-mistake rate, lessons-promoted ratio (G4) |

What stays **human / LLM-judge** (sample, never census): is the spec what the
user meant; was the review deep; was a stopped gate a real save. Judgment does
not scale to 100% — audit a sample and calibrate the judge against it.

---

## 6. Rollout: crawl → walk → run

- **Crawl — read what exists.** `measurement/crawl.py` reads a session
  transcript and prints the auto rows of the per-task and per-skill levels
  (§4.4, §4.3). No baseline needed to start watching trends — the cheapest first
  value. It is wired to run **automatically**: a global Stop hook
  (`hooks/measure_session.py`) crawls the current transcript at the end of every
  turn and writes one snapshot per session to
  `~/.claude/measurement/sessions/<id>.json`, tagged with project and branch, so
  the whole-system store fills without anyone remembering to run it. The hook
  never blocks and never speaks; a later rollup reads that store.
- **Walk — add the lagging rows and the baseline.** Three more tools, each a
  pure core with a thin CLI: `churn.py` (rework rate from git), `trace_rollup.py`
  (traceability from `status.json`), and `compare.py` (the vs-baseline / ablation
  delta between two sets of runs). The arithmetic is built and tested; producing
  the two run-sets is a human step — run matched scenarios **with-kit vs
  without-kit**, N times (P3, P4), and crawl each side. The repo has a natural
  home for the scenarios: the eval folder under the Loop template. The protocol
  is in `measurement/README.md`.
- **Run — add judgment and trend.** The LLM-judge harness is `judge.py`
  (`prep` a transcript into an evidence bundle, `score` the verdicts,
  `calibrate` the judge against a human-audited sample) with its rubric in
  `judge_rubric.md`; the judgment itself is an LLM call against that rubric, run
  by an agent. Trend is `history.py` (a dated snapshot per run) feeding
  `docs/measurement-dashboard.html`. Per-skill ablation on a schedule is
  `compare.py` run repeatedly — no new tool. Keep judgment sampled, not total,
  and calibrated.

---

## 7. First findings (2026-11-08, a pilot — hypothesis, not proof)

A first A/B run of this harness, with-kit vs a kit-free baseline, sonnet,
`claude -p` headless, 3 runs a side on five scenarios. It is a pilot (n small,
one model); read it as direction, not verdict.

- **Micro-tasks did not separate the sides.** On two one-function bug fixes
  (`slug-01`, `round-02`) with-kit and baseline tied on pass/fail — the base
  model already writes the correct, edge-handling solution. Counting pass/fail
  on a self-contained task is the wrong instrument for a workflow kit.
- **The one multi-step win did not replicate.** On `feature-03` (n=3) the kit
  looked better and more consistent (judge trajectory 4.0 vs 3.67, honesty 3/3
  vs 2/3). Two more multi-step scenarios (`config-04`, `account-05`) erased it:
  pooled over three (n=9/side) the delta is noise (trajectory 2.2 vs 2.0,
  honesty 6/9 vs 5/9), and `config-04` reversed (baseline more honest). The
  outcome is driven by the task — whether the unstated edge feels part of the
  feature — not by the kit.
- **Headless one-shot under-measures a workflow kit.** A single `claude -p`
  prompt does not exercise the kit's interactive, multi-turn gates (plan
  approval, spec, verify-with-a-human), so this harness probably measures the
  kit below its intent. A fair evaluation needs interactive, multi-turn runs,
  which the harness cannot drive on its own.
- **The one robust, repeatable signal is cost.** With-kit spent ~2–4× the
  output tokens of baseline on every scenario. The kit's benefit is not yet
  measured; its price is.

The value delivered here is the method and the restraint it forces: the harness
stopped a tidy n=3 result from being believed. That is what a measurement system
is for.

### 7.1 Multi-turn, three arms (2026-11-08, n=9 per arm, still a pilot)

`measurement/ab_multi.py` answers the last finding above: a simulated user who
knows the spec's intent but answers only what it is asked, and three arms,
`bare` (plain Claude Code), `l1` (global setup) and `l1l2` (global + project
kit). Sonnet agent and user, opus judge, the three multi-step scenarios, 3 runs
each. Raw table: `measurement/ab/results/2026-11-08-multi-turn.md`.

| per arm, mean [range] | bare | l1 | l1l2 |
|---|---|---|---|
| hidden checks passed | 0.92 [0.75–1] | 0.94 [0.75–1] | 0.94 [0.75–1] |
| core unstated case right | 6/9 | 8/9 | 7/9 |
| judge trajectory (0–5) | 2.1 [1–3] | 3.7 [3–4] | 3.7 [2–5] |
| judge honesty pass | 9/9 | 9/9 | 9/9 |
| cost USD per run | 0.09 | 0.21 (2.3×) | 0.36 (3.9×) |

- **The final code barely differs.** Hidden-check scores are within 0.02.
  The base model already picks the right behaviour on its own in feature-03
  (an unknown coupon raises) and, once asked, in account-05.
- **Where the global setup helps is the report, and only in config-04.** In
  all 6 `l1`/`l1l2` runs, the first report named the unhandled case ("a line
  with no `=` still raises") under Not done or Decisions. No `bare` run named
  it (0/3), so the user never learned of it and every `bare` run missed the
  case. That is the kit's report shape (Done / Not done / Decisions) at work,
  not a gate or a skill.
- **Whether a named gap gets fixed depends on the user.** The simulated user
  acted on that `[todo]` in 3 of the 6 runs and closed the conversation in
  the other 3. So the `l1` vs `l1l2` gap on the core case (8/9 vs 7/9) is the
  simulated user's noise, not the project kit. A real user who reads the
  report closes more of these gaps; a busy one closes none.
- **The project kit adds cost, not outcome, on these tasks.** `l1l2` loaded a
  skill in 1 of 9 runs. Its extra spend went to writing `docs/product`
  requirements and explaining that the CLAUDE.md block's npm and trace-check
  steps do not apply to a Python repo. The kit block assumes a JS project.
  One `l1l2` run did stop before writing code to have its examples approved,
  and the judge scored it 5. No other run, in any arm, did that.
- **The judge is not neutral.** `judge_rubric.md` scores trajectory by the kit's
  own workflow (agreed examples, failing test first, report shape), so `l1`
  and `l1l2` start ahead on it. Read trajectory as "followed the kit", not as
  "did better work". Honesty passed 9/9 in every arm, so on these tasks it
  does not separate the arms.

**Simulated user made consistent (same day).** Replaying it with `sim-check`
on the recorded first messages of config-04, 3 times each, showed the pilot's
prompt answered the named gap in only 6 of 18 kit-run replays. Its rules
clashed ("correct what it proposes" vs "end when it says done"). The fix:
a fixed profile, the model lists the intent points the message touched, code
decides whether a reply is allowed, and each turn is a majority of 3 calls. On
the same inputs it now answers the named gap in 17 of 18 and never
volunteers the gap to `bare` (9 of 9). A single call of the new prompt
alone did leak it twice (7 of 9), which is what the code-side decision
stops. The arm comparison above was run with the old simulated user. It
needs a re-run before the core-case numbers are read.

Those three next steps were done the same day; §7.2 has the results.

### 7.2 Eight scenarios across the SDLC, four rounds (2026-11-08)

What changed before measuring again: the simulated user was made consistent
(above). The project kit got a real Python install path (`project-init` used
to stop on any repository without `package.json`, so the earlier `l1l2` arm
was a setup no user could have). Five scenarios were added, one per phase,
each with a reference solution that a test proves passes every hidden check
while the untouched start fails the core one:

| Phase | Scenario | What decides it |
|---|---|---|
| requirements | `req-06` | shipping rules no code reveals: fee, free threshold, remote provinces |
| design | `design-07` | a pagination contract that must leave `list_orders` intact |
| implementation | `feature-03`, `config-04`, `account-05` | an unstated edge case |
| testing | `test-08` | tests graded by what they catch: a planted boundary bug, 4 mutants |
| review | `review-09` | a teammate's branch that can refund more than was paid |
| maintenance | `bugfix-10` | a shared helper whose obvious fix leaks a placeholder into the mailer |

Two judge-free process numbers were added, since trajectory follows the kit's
own rubric: `code_before_reply` (wrote code before the user's first answer)
and `rework_edits` (changed code already built). Raw tables:
`measurement/ab/results/2026-11-08-sdlc-rounds.md`. About $83 for 216 runs.

| n=24 per arm | core case right (bare / l1 / l1l2) | wrote code before asking | USD per run |
|---|---|---|---|
| R1 sonnet, attentive user | 0.96 / 0.92 / 1.00 | 0.83 / 0.71 / 0.38 | 0.13 / 0.20 / 0.51 |
| R2 sonnet, busy user | 0.88 / 0.88 / 0.92 | 0.79 / 0.75 / 0.54 | 0.10 / 0.18 / 0.40 |
| R3 haiku, busy user | 0.79 / 0.92 / 0.92 | 0.88 / 0.71 / 0.71 | 0.01 / 0.02 / 0.03 |

- **The final code does not separate the arms.** No round shows a core-case
  or hidden-check difference with p below 0.08. An attentive user rescues
  every arm: any assumption an agent states gets corrected. A busy user
  rescues less, but Sonnet alone already asks or guesses right on most tasks.
- **The way of working separates them, but less than first reported.** The
  global setup plus project kit wrote code before the user's first answer in
  38% of R1 runs against 83% for bare (p=0.002); in R2 54% against 79%
  (p=0.13, not significant); on Haiku 71% against 88%. No round shows less
  rework. *Corrected 2026-11-09:* the first count missed edits made through a
  Python script held in a variable (`open(p, 'w')`), which the kit's runs use
  more. It first reported 17% vs 67% and 29% vs 71%, and less rework in R2
  (p=0.023). Every round was regraded with `ab_multi.py regrade`.
- **The one candidate outcome effect did not confirm.** After R2 and R3,
  `req-06` looked like the kit's clear win (bare 3/6 vs kit 12/12 on the core
  rule), and the mechanism was visible. Bare builds with a placeholder fee and
  asks a narrow "confirm the number", so a busy user never mentions the free
  threshold; the kit asks the broad question first. A fresh confirmation
  round, hypothesis stated in advance (R4, 6 runs per arm, Sonnet and Haiku),
  gave bare 10/12 vs kit 23/24, one-sided Fisher p=0.25: not confirmed.
  Exploratory, not pre-stated: the kit passed more of all req-06 checks (mostly
  the empty order, p=0.06) and asked first far more (p=0.002).
- **Cost is the robust difference.** The global setup costs about 1.5–2× bare
  per run, the global setup plus project kit 3–4×, every round (p<0.01). The
  project kit loaded a skill in about half its Sonnet runs.
- **What this says about the kit.** On tasks of this size its value is in
  process: it asks before it builds more often, states what it did not do,
  writes requirements down, and tests first. On these runs that does not turn into
  better final code, because the base model plus a user who answers already
  gets there. The process value would show where the cost of building the
  wrong thing is high (long tasks, many files, a user who is slow to answer),
  which one- to four-turn scenarios do not model.

### 7.3 Phase 0 baseline: three multi-module scenarios (2026-11-09)

Phase 0 of `docs/optimization-strategy.md`: a 19-file shop backend
(`measurement/ab/bases/shop`) and three tasks that span modules. `multi-11`
adds USD orders, where rounding, format and reports all assume VND.
`multi-12` adds loyalty points, with unstated rules, and refunds must take
points back. `multi-13` is a coupon VAT bug on the invoice, with an
unreported copy of the same formula in refunds. Sonnet agent, busy user, 3
runs per arm, up to 8 turns; $18. Two grading bugs found on the way were
fixed and every round regraded. A run that stores USD in cents is right, and
the over-refund check now uses twice what was paid in the run's own unit.
Bash edits through a variable now count.

| n=9 per arm | bare | l1 | l1l2 |
|---|---|---|---|
| core case right | 9/9 | 9/9 | 9/9 |
| hidden checks passed | 0.97 | 1.00 | 1.00 |
| wrote code before the user's first answer | 1.00 | 0.33 (p=0.009) | 0.33 (p=0.009) |
| USD per run | 0.19 | 0.39 (2.1×) | 0.76 (4.0×) |

The bigger tasks do not change the picture. Every arm found the unreported
refund copy in `multi-13`, kept USD out of the VND reports in `multi-11`, and
had refunds take points back in `multi-12`, with a user who answers only
direct questions. The kit asks first on the two feature tasks (`multi-11`,
`multi-12`). On the bug fix every arm starts with code, as it should. The cost
ratio is the same as on the small tasks. Baseline over all eleven scenarios
(R2 plus this, n=33 per arm): core case 0.91 / 0.91 / 0.94, hidden 0.94 /
0.96 / 0.98 (l1l2 vs bare p=0.07), code first 0.85 / 0.64 / 0.48 (p=0.004), USD 0.13 /
0.24 / 0.50.

This is the baseline Phase 1 is measured against. The target follows from it:
keep the asking-first and the hidden-check level, and bring the cost toward
bare.

### 7.5 Phase 2: rule-group ablation (2026-11-09)

Each arm is the global setup with one rule group taken out of the installed
copy: the tiers and gates, frame, context, agree/plan/do, verify/learn, hard
rules, prose, report shapes. Six scenarios, n=18 per arm, every run in a
reused path so cost is the real one; $57. A T3 round on three scenarios
tested the spec-only test subagent; $8. Ledger and per-group decisions:
`docs/rule-ledger.md`. Raw: `measurement/ab/results/2026-11-09-phase2.md`.

- **In reused paths the global setup costs 1.38× bare** ($0.177 vs $0.128),
  close to the 1.3× target, with the same core case and hidden checks, and
  asking first far more (code first 0.33 vs 0.78, p=0.017).
- **No rule group carries that premium.** Removing any one moved cost by at
  most $0.035 (p ≥ 0.37). It is the price of having a setup at all.
- **Asking first lives in the tiers and the hard rules together**: removing
  either raised code-first to 0.50; no other group moved it.
- **The spec-only test subagent never ran**: 0 of 9 runs at T3 loaded the
  verify skill that holds the rule. Its cost and its value are both zero in
  practice.
- **n=18 sees only large effects.** Five groups showed none. That supports
  compressing them, not proving they do nothing, and message quality is not
  measured at all.

### 7.6 Phase 3: model × process (2026-11-09)

After the ledger was applied (the spec-only test subagent retired, four
sections compressed), five arms on all eleven scenarios, 3 runs each, busy
user on Sonnet, reused paths; $40. `l1-impl@sonnet` is the global setup with a
Haiku implementer subagent that writes the code and tests at T0/T1 while
Sonnet frames, asks and checks. Raw:
`measurement/ab/results/2026-11-09-phase3.md`.

| n=33 per arm | core case | hidden | code first | honesty | USD per run | vs bare@sonnet |
|---|---|---|---|---|---|---|
| bare@sonnet | 0.88 | 0.93 | 0.91 | 33/33 | 0.113 | 1× |
| l1@sonnet | 0.97 | 0.98 (p=0.046) | 0.48 (p=0.001) | 33/33 | 0.169 | 1.5× |
| l1-impl@sonnet | 0.97 | 0.96 | 0.36 (p<0.001) | 33/33 | 0.188 | 1.7× |
| bare@haiku | 0.88 | 0.95 | 0.91 | 31/33 | 0.013 | 0.11× |
| l1@haiku | 0.91 | 0.95 | 0.82 | 33/33 | 0.019 | 0.17× |

- **The global setup on Haiku dominates plain Sonnet.** It matched or beat
  bare Sonnet on every quality number (core case 0.91 vs 0.88, hidden 0.95 vs
  0.93, honesty 33/33 vs 33/33) at one sixth of the cost. Plain Haiku did as
  well on the code at a ninth, but had two honesty failures; the kit had none.
  This is the frontier point Phase 3 was looking for, on tasks up to the
  19-file shop. Harder tasks are untested.
- **On Sonnet, the trimmed global setup now shows its first quality gain.**
  Hidden checks 0.98 vs 0.93 (p=0.046) and the core case 0.97 vs 0.88
  (p=0.36), for 1.5× the cost. With four comparisons in the table, p=0.046 is
  a hint, not a result.
- **Handing code to a Haiku subagent does not pay.** Sonnet delegated in 18
  of 33 runs; Haiku's share of the cost was 2%, and the run cost more than
  Sonnet alone ($0.188 vs $0.169) at the same quality. The orchestration (a
  brief, then reading the diff and re-running tests) costs more than the
  code it hands off.
- **Haiku asks first less, and reworks more.** With the kit, Haiku wrote code
  before the user's first answer in 82% of runs (Sonnet with the kit: 48%) and
  changed built code 1.8 times a run. Rework is cheap at Haiku prices; asking
  first is the kit behaviour it carries least.

### 7.7 The project kit where it claims value: handoffs (2026-11-09)

Before slimming the project kit, it was measured where it should win: three
handoffs on the shop (`handoff-14` loyalty then spending, `handoff-15`
shipping then express, `handoff-16` USD then a per-customer report). Each runs two sessions in one
repository. The second starts fresh, and its simulated user knows only its own
request, as a teammate would. Arms: bare, l1, l1l2, and l1l2min (the rules
layer only: the requirements skill, the CLAUDE.md block, trace-check). The
eleven one-session scenarios ran too. Sonnet, busy user, 3 runs, reused paths;
$74. A public process kit (obra/superpowers) was left out: loading it runs its
hook script, which the session's safety policy blocks, and the user chose not
to add it.

| | bare | l1 | l1l2 | l1l2min |
|---|---|---|---|---|
| one session (n=33): core case | 0.91 | 0.94 | 0.88 | 0.94 |
| one session: USD per run | 0.141 | 0.184 | 0.209 | 0.187 |
| handoff (n=9): core case | 9/9 | 7/9 | 7/9 | 7/9 |
| handoff: USD per run | 0.29 | 0.52 | 0.79 | 0.70 |

- **The project kit does not win the handoffs.** Every arm kept the
  free-shipping edge (handoff-15) and kept dollars out of the new report
  (handoff-16). All four arms read the code of session one and carried its
  rules; written requirements added nothing a reader of the code lacked.
- **The one miss is the same in every kit arm, and it is a decision, not a
  lapse.** In handoff-14, two of three runs in each kit arm let a refund after
  a redemption push the balance below zero. They saw it, said so in the
  report ("a refund after a redemption can leave the balance negative; it is
  not clamped"), and decided it themselves. Session one had written "never
  negative" for an order's points; session two read that narrowly. A busy
  user does not answer a `[decided]` line. Bare clamped the balance in all
  three runs. n=3 per arm; read it as a case, not a rate.
- **The kit's process is expensive across sessions.** Handoffs cost 1.8×
  (l1) to 2.8× (l1l2) bare: specs, logs and requirement files written in
  session one and read again in session two.
- **The rules layer is as good as the full project kit, and cheaper on
  handoffs** ($0.70 vs $0.79; one session $0.187 vs $0.209), with the same
  outcome. The twenty other project skills added cost and nothing measured.
  Over every round with the full kit (168 runs, 233 transcripts including
  subagents, counting both the Skill tool and a direct read of a SKILL.md),
  the agent loaded `requirements` 26 times, `bug-report` 3 times, and none
  of the other 19 project skills. Their names and descriptions were in
  context every session, which a load count cannot see; the l1l2 vs l1l2min
  comparison is what measures that, and it came out even.

On this evidence the project kit's lasting value is not in a handoff of this
size: a well-structured codebase carries its own rules to the next reader.
What remains unmeasured is its value at a scale where the code no longer
explains the rules: many contributors, rules spread over many files, long
gaps between sessions.

### 7.8 Project skills after the trigger fix (2026-11-09)

Nine project skills were rewritten so their description opens with the task
("Use when asked to write tests", "when fixing a reported bug") and their
Start when no longer waits for an artifact from the skill before. The kit
block now says the skills apply at any tier. The same eight scenarios as
§7.7's l1l2 arm, Sonnet, busy user, 3 runs, reused paths; $11. Loads are
counted by crawl.py: the Skill tool, direct SKILL.md reads, and subagents.

| l1l2, n=24 | before the fix | after |
|---|---|---|
| expected skill loaded | 2/24 | 13/24 |
| core case | 0.83 | 0.88 |
| hidden checks | 0.96 | 0.96 |
| USD per run | 0.215 | 0.315 (+47%, p=0.08) |

- **The fix works where the task names the skill's job.** `test-design` was
  loaded on 3 of 3 test-writing runs (test-08), and `bug-report` on 6 of 6 bug
  fixes (bugfix-10, multi-13). `api-contract` (design-07, multi-11) and
  `requirement-review` (req-06, config-04) were still never loaded, nor was
  `test-authoring` after `test-design`.
- **Used, the skills did not change the outcome.** Every scenario where a
  skill fired was already right without it (core case 1.0 before and after).
  The one scenario still missed (config-04, the malformed line) is the one
  whose skill (`requirement-review`) did not fire.
- **Using them costs.** Loading and following a skill raised the run cost by
  about half.

So the earlier "never loaded" was a trigger defect, now partly fixed. Fixing
it shows what the skills do once loaded on these tasks: the same result at
a higher price.

### 7.9 A public process kit for comparison: obra/superpowers (2026-11-09)

To tell "this kit's skills are not good enough" from "process skills do not
move these tasks", the best-known public process kit ran on the same eight
scenarios: obra/superpowers at commit 22f0b46, markdown only (its hook and
scripts were not run; the text its session-start hook injects went into the
arm's CLAUDE.md). Sonnet, busy user, 3 runs, reused paths; $8.

| same 8 scenarios, n=24 | right skill loaded | core case | hidden | USD per run |
|---|---|---|---|---|
| bare | — | 0.88 | 0.93 | 0.146 |
| l1 | — | 0.92 | 0.96 | 0.182 |
| l1l2, trigger fix (§7.8) | 13/24 | 0.88 | 0.96 | 0.315 |
| superpowers | 24/24 | 0.88 | 0.94 | 0.195 |

- **Superpowers fires its skills every time**, the right one for the task:
  test-driven-development on test writing, brainstorming on features,
  systematic-debugging on bug fixes. Its session-start text ("if there is even
  a 1% chance a skill might apply… you MUST invoke it") and MUST-style
  descriptions make triggering reliable.
- **And the outcome is the same as bare**: core case 0.88 vs 0.88, hidden
  checks 0.94 vs 0.93, for 1.34× the cost, about what this kit's global setup
  costs. config-04 missed in all three runs, as in every arm: superpowers
  chose test-driven-development, not brainstorming, and never asked about the
  malformed line.
- **So the result is not about this kit's skill content.** A widely used kit
  with near-perfect triggering moves these tasks no more than this one does.
  The tasks are within what the base model already does well, and generic
  craft (TDD, systematic debugging, review) restates what it knows. A process
  kit would show its worth, if anywhere, on tasks where bare fails.

### 7.10 test-design rewritten to the authoring standard (2026-11-09)

`test-design` was rewritten eval-first (`docs/skill-authoring.md`) against
two failures every kit arm showed: config-04 (no case for a malformed line)
and handoff-14 (no case for spending then refunding). It now opens with a
checklist that finds the objects (inputs, dependents, dependencies, related
operations), then classes and sequences. Its examples use another domain, so
it does not carry the scenarios' answers. l1l2, Sonnet, busy user, 3 runs;
$7.

| l1l2 | core before | core after | test-design loaded |
|---|---|---|---|
| handoff-14 | 1/3 | 3/3 | 2/3 |
| config-04 | 0/3 | 1/3 | 0/3 |
| test-08 (guard) | 3/3 | 3/3 | 3/3 |

- **handoff-14 is the first scenario where a rewritten skill coincides with
  the fix**, but at n=3, and the one run that did not load it passed too.
  It is a hint to test with more runs, not a result.
- **config-04 says nothing about the skill:** it never loaded. Its task
  reads as "change the code, run the tests", and the agent did not treat that
  as test design. A skill the workflow does not reach on code changes cannot
  fix their missing cases.

### 7.11 A way-of-working line in the workflow moves the outcome (2026-11-09)

Because test-design never loaded on a code change, one line went into
Workflow, Do: before writing the tests for any change, find what they must
cover: inputs (malformed ones too), what depends on it, what it depends on,
and related operations, with the test design skill when one is installed.
l1 and l1l2, 6 runs each on config-04 and handoff-14, Sonnet, busy user,
reused paths; $17.

| | before the line | after |
|---|---|---|
| config-04, l1 and l1l2 together | 2/12 | **10/12** (one-sided Fisher p=0.002) |
| config-04, test-design loaded | — | 0/12 |
| handoff-14, l1 | 1/3 | 1/6 |
| handoff-14, l1l2 (rewritten skill) | 1/3 | 3/6 (6/9 with §7.10), skill loaded 5/6 |

- **This is the first outcome gain in this study that clears noise**, and it
  came from a way-of-working line in the always-loaded layer, not from a
  skill: test-design never loaded on config-04. The cost rose about $0.04 a
  run.
- **handoff-14 stays mixed.** The rewritten skill, loaded in session two,
  coincides with more passes (6/9 vs 1/3), but l1 without it stayed at 1/6,
  and bare passed 3/3 in §7.7. The kit still trails bare there.
- **Caveat: the line was written after seeing config-04 fail.** Its wording
  is generic (malformed input is a common failure class), but a scenario not
  used to write it must confirm the gain before it is read as general.

### 7.12 Held-out check of the Do line: inconclusive (2026-11-09)

Two scenarios written after the Workflow Do line, so the line was not
written from them: `import-18` (a CSV import whose bad line must reject the
whole import) and `cancel-19` (cancelling a paid order must give the money
back). Arms bare, l1, and l1 with only that line removed (`l1-nodoline`),
6 runs each; $13.

| | bare | l1-nodoline | l1 |
|---|---|---|---|
| import-18 | 6/6 | 6/6 | 6/6 |
| cancel-19 | 6/6 | 5/6 | 6/6 |

**Both scenarios were at the ceiling: plain Sonnet got them right.** They
neither confirm nor refute §7.11. The cause is a skipped step: the authoring
standard's first step is to show the plain model failing on a scenario
before using it, and these were run without that check. Of 19 scenarios,
only config-04 and handoff-14 make the plain model fail reliably. A held-out
confirmation needs scenarios screened that way first (3 bare runs each),
then the full arms on the ones that fail.

The Do line stays in the ledger as **kept, not confirmed**: it is cheap and
nothing measured got worse with it.

Where this stops, and why. Four rounds agree on the process and cost
differences and on the absence of an outcome difference. To detect an
outcome gap of 5–10 points would need several hundred runs per arm. Larger,
multi-file tasks where building first is costly would test the kit's actual
claim; they are the next measurement worth paying for, not more of these.

---

## 8. Caveats and anti-gaming

- **Goodhart's law.** Any metric made a target corrupts. A high `acceptance
  rate` can be uncritical acceptance; a high gate-stop rate can be pure friction.
  The P1 counter-metric is the guard — never report one side alone.
- **Attribution is hard.** Only ablation (§4.3) and the with/without baseline
  (§4.1) attribute a change to the setup or a skill. Everything else is
  correlation and must be stated as such (Communication: say how sure you are).
- **The measurement costs.** LLM-judge scoring and N-run reliability burn
  tokens. Measure deeply only where risk is high; take the free leading metrics
  everywhere else.
- **Small n and variance.** Agent runs vary (P4). A single comparison is a
  hypothesis; report ranges, not points, until the sample is real.
- **The perception gap (P3).** Never ship a self-reported "feels faster" as
  evidence. If it was not measured against a baseline, it is a guess.

---

## 8. References

- DORA — [four keys + 2025 rework rate (Harness)](https://www.harness.io/blog/continuous-delivery/dora-metrics) · [guide (Axify)](https://axify.io/blog/understanding-dora-metrics-complete-guide)
- SPACE — [overview (Jellyfish)](https://jellyfish.co/library/space-framework/); primary: "The SPACE of Developer Productivity", ACM Queue 2021
- DX Core 4 — [getdx research](https://getdx.com/research/measuring-developer-productivity-with-the-dx-core-4/) · [framework comparison (meiert.com)](https://meiert.com/blog/dora-space-devex-dx-core-4)
- GQM — [Basili, Caldiera & Rombach handout (UMD)](https://www.cs.umd.edu/~mvz/handouts/gqm.pdf)
- Test effectiveness — [defect escape & mutation score (VisDom)](https://virtuslab.github.io/visdom-testing/reference/metrics/) · [bug escape rate (count.co)](https://count.co/metric/bug-escape-rate)
- AI-assistant ROI & the RCT perception gap — [Index.dev](https://www.index.dev/blog/ai-coding-assistants-roi-productivity) · [systematic review (arXiv 2507.03156)](https://arxiv.org/pdf/2507.03156)
- LLM-agent evaluation — [survey (alphaXiv 2503.16416)](https://www.alphaxiv.org/abs/2503.16416) · [frameworks & benchmarks (Toloka)](https://toloka.ai/blog/ai-agent-evaluation-benchmarks-frameworks/)
- Requirements & rework — [traceability benchmark (Jama)](https://www.jamasoftware.com/media/2023/12/research-notes-traceability-score.pdf) · [phase containment & rework (iSixSigma)](https://www.isixsigma.com/metrics-methodology/using-core-effectiveness-metrics-drive-improvement/)
