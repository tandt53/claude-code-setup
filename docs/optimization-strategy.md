# Optimization strategy: value per token

*Pay for process only where it buys something, and prove that it does.*

Status: Phases 0–3 run, 2026-11-09 (results: `docs/measurement-strategy.md` §7.3–7.6, `docs/rule-ledger.md`). Evidence: `docs/measurement-strategy.md` §7.2
(216 A/B runs, eight scenarios across the SDLC).

---

## 1. The problem, in numbers

On tasks of one to four files and on a 19-file backend, the global setup (`l1`) costs 1.5–2× a plain
Claude Code (`bare`) per run, and the global setup plus project kit (`l1l2`)
costs 3–4×. The final code is not better: no round separates the arms on the
core case or the hidden checks. What the kit does buy, and replicates, is a
way of working: it asks before it builds more often (over all eleven
scenarios, it wrote code before the user's first answer in 48% of runs against
85%, p=0.004), and it names what it did not do. Rework did not differ. The
three 19-file scenarios of Phase 0 (`docs/measurement-strategy.md` §7.3) show
the same: every arm right, the kit 2× and 4× the cost.

Where the extra cost goes (Sonnet, R1 and R2, means per run):

| | bare | l1 | l1l2 |
|---|---|---|---|
| fixed context per API call | 32.8k tokens | 45.4k | 47.9k |
| API calls | 7 | 9 | 14 |
| cache writes (new content) | 7.7k | 17.6k | 57k |
| output | 2.4k | 4.5k | 8.9k |
| USD | 0.12 | 0.19 | 0.46 |

Cost ≈ calls × context × read price + new content × write price + output ×
output price. Prompt caching makes the fixed context cheap: the always-loaded
prompts cost about $0.03–0.05 a run. **Behaviour is the bill**: twice the calls,
seven times the new content, nearly four times the output. And the behaviour is
the same on a ten-line change as on a migration.

## 2. Root causes

1. **Two process systems that do not talk.** Layer 1 already gates by risk
   (Workflow G1–G4: "gate by what a mistake would cost, not by how much code
   it takes"). Layer 2's CLAUDE.md block bypasses them: it prescribes
   requirements, named examples, trace-check and a JUnit run for every change.
2. **Procedure lives in the always-loaded layer.** `communication.md` (3,400
   words) carries the shapes of a spec, a log, a map, review findings and a
   lesson. Most tasks produce none of them. A shape in context also pulls the
   output toward it: the full finished-work report on a ten-line fix.
3. **Nothing in the setup is accountable to evidence.** Rules are added when a
   failure is seen (the retro loop); none is removed when it stops paying. The
   harness that could check this exists but runs by hand.
4. **The evaluation does not reach where the kit claims value.** All eight
   scenarios are small; a fair price for process on a 15-file change cannot be
   judged from 2-file runs.

## 3. The strategy: five principles

### P1. One risk router decides all process

Framing assigns a **tier** from the existing gates, and the tier, not the
layer, decides every stop, file, check and report shape. Layer 2 becomes part
of the tiers instead of a parallel procedure.

| Tier | Fires when | What it adds | Report |
|---|---|---|---|
| T0 Direct | no gate | do, run the tests, report | 3–6 lines: what changed, tests, anything not done |
| T1 Clarify | G1: a user-visible value is not in the request | acceptance examples first, `assumed` marked, wait | + Decisions |
| T2 Plan | G2 or G3: several changes, or hard to undo | plan or map approved, rollback for G3 | full shape |
| T3 Durable | G4, or a business rule that outlives the task | spec and log files, REQ + examples, trace-check | full shape + trace status |

Requirements, test naming and trace-check are T3 tools. A bug fix that
changes no rule is T0 or T1, whatever the repository has installed.

### P2. Load by trigger: a small core, everything else on demand

- **Core (always loaded), target ≤ 2k tokens:** framing and the tier table;
  the hard rules; the honesty rules (claim only what was run, mark
  `[unverified]`); the T0 report. Only rules with measured value or a hard
  safety reason sit here.
- **On demand:** every message shape beyond T0 moves into the skill that
  produces it (spec into `task-spec`, review findings into `review-work`,
  lesson into `retro`, map and plan into a planning skill). They load when
  their tier fires.
- **Layer 2:** the CLAUDE.md block shrinks to facts (where things live, the
  Test command, the REQ id format) and triggers ("a change to a business rule
  → `requirements`"). Procedure stays in the project skills.

Smaller context matters less than shorter behaviour, but it also stops the
long shapes from pulling every answer toward them.

### P3. Every always-loaded rule earns its place

A **rule ledger** lists each always-loaded rule with the metric it is meant to
move, its measured effect, and its token cost. A rule enters the core only with
evidence (an ablation, or a failure the retro loop saw twice). A rule whose
ablation shows no effect on any metric moves to a skill or is deleted. The
retro loop gains the missing half: demotion, not only promotion.

### P4. Optimise the system (model × process), not the process alone

R3 hints at a lever the kit has not used. Haiku with the kit got the core case
right in 0.92 of runs, Sonnet bare in 0.88, at about a quarter of the cost
($0.02–0.03 vs $0.10). n=24, not significant, so it is a hypothesis. If it holds,
the strategy is to route by tier: a small model executes T0 and T1 work inside
the kit's structure, and a strong model frames, plans T2/T3 and reviews. The
kit's value would then show as cheaper models doing the same work, which is a
saving, not a premium.

### P5. Measurement as a gate on the kit itself

- **Fixed eval suite:** the eight small scenarios (cost regression and ceiling)
  plus three new multi-file ones (10–15 files, cross-module calls, a user who
  answers slowly), where building the wrong thing first is expensive. That is
  where T2/T3 must show their price is worth it.
- **Frontier, not averages:** each configuration is a point (cost, quality),
  with quality = core case + hidden checks + honesty, and process (ask-first,
  rework) beside it. A change to the kit is accepted only if it is not
  dominated: cost up requires quality or process up.
- **Every kit change runs the suite** before merge (about $20 for the small
  set on one model), and the result lands in the trend dashboard.

## 4. Targets

| Task size | Cost vs bare | Quality vs bare | Process |
|---|---|---|---|
| small (T0/T1) | ≤ 1.3× | not worse (core case, hidden, honesty) | ask-first and named gaps kept at today's level |
| large (T2/T3) | any, if it pays | better core case or less rework, p < 0.05 | — |
| whole kit | below today's l1 | — | — |

If large tasks show no gain at any price, T2/T3 are cut back to what safety
needs (G3) and the rest is removed.

## 5. Rollout

| Phase | Work | Accept when | Cost |
|---|---|---|---|
| 0. Instrument | three multi-file scenarios; baseline every arm on all eleven | each new scenario has a reference that passes and a start that fails | ~$40 |
| 1. Restructure | tier router in `workflow.md`; shapes moved into skills; the L2 block cut to facts and triggers; core ≤ 2k tokens | small-task targets met in one suite run, no hidden-check or honesty loss | ~$25 |
| 2. Ledger | ablate each core rule group (framing, gates, honesty, report) on the suite; demote what moves nothing | ledger committed, every core rule has an entry | ~$60 |
| 3. Model routing | haiku executor + sonnet framer/reviewer vs sonnet alone, both with the kit | frontier point that dominates sonnet bare, or the hypothesis dropped | ~$30 |
| 4. Keep it | the suite runs on every kit change; retro demotes as well as promotes | — | ~$20 per change |

Each phase ends with a written result in `docs/measurement-strategy.md`, kept
even when it says the idea did not work.

## 6. What this rejects

- **Trimming files one by one** without a router: the bill is behaviour, and
  behaviour follows the process the tier asks for.
- **Removing the kit from small tasks entirely:** the ask-first and named-gaps
  behaviour is measured and cheap; it is the part to keep.
- **Judging by the LLM judge's trajectory score:** it follows the kit's own
  rubric. The acceptance numbers are hidden checks, honesty, judge-free process
  counts and cost.
