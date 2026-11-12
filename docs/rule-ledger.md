# Rule ledger

Each always-loaded rule group, what it is meant to move, what removing it
did, its size, and the decision. Principle P3 of `docs/optimization-strategy.md`:
a group stays in the core only with evidence or a hard safety reason.

Evidence: Phase 2 ablation, 2026-11-09 (`docs/measurement-strategy.md` §7.5).
Each arm is l1 with one group removed from the installed copy. Six scenarios
spanning requirements, design, implementation, review and two multi-module
tasks; Sonnet, busy user, 3 runs per scenario (n=18 per arm), every run in a
reused path so the cost is the real one. **n=18 detects only large effects**: a
"no effect" below means none large enough to see, not none.

| Group (words) | Meant to move | Removing it: core · hidden · code first · USD vs l1 | Decision |
|---|---|---|---|
| l1 as is | — | 0.83 · 0.91 · 0.33 · $0.177 | reference; bare is 0.83 · 0.91 · 0.78 · $0.128 |
| Tiers + G1–G4 (≈300) | ask before building; process sized to risk | 0.83 · 0.87 · **0.50** · −$0.008 | **keep**: with hard rules, the only groups whose removal moved asking first |
| Hard rules (257) | honesty; no silent gap; ask before user-visible | 0.94 · 0.94 · **0.50** · −$0.016 | **keep**: carries asking first; safety |
| Frame the task (253) | the right way of working per purpose | 0.89 · 0.95 · 0.33 · −$0.003 | compressed 2026-11-09 (D2): no effect seen on these Deliver tasks; its Learn/Restore/Irreversible lines are not exercised by any scenario |
| Gathering context (112) | look wide: other callers, copies | 0.83 · 0.94 · 0.33 · −$0.019 | compressed 2026-11-09 (D2): every arm, bare too, found the multi-13 refund copy |
| Agree, plan, do (115) | tests from examples, seen failing | 0.83 · 0.94 · 0.33 · +$0.010 | compressed 2026-11-09 (D2): no effect seen |
| Verify, review, learn (124) | evidence before done; retro | 0.89 · 0.96 · 0.33 · −$0.004 | compressed 2026-11-09 (D2): no effect seen |
| Prose and explaining (281) | readable, honest messages | 0.89 · 0.94 · 0.33 · +$0.011 | **keep, unmeasured**: the harness scores code, not message quality |
| Report shapes (≈450) | short, decision-first reports | 0.94 · 0.97 · 0.33 · **+$0.035** | **keep**: without it output rose most (+455 tokens) |
| mutation-check skill (global) | a new test proves it fails on the bug it guards | loaded in 1 of about 1,000 runs; regression-test checks equal with and without the kit | **folded** 2026-11-09: two sentences in Workflow, Do (seen failing for the right reason; revert a fix written before its test), and the procedure in the verify skill's Check the checks. Skill removed |
| Spec-only test subagent (verify skill) | independence of tests from code | never fired: 0 of 9 T3 runs loaded the verify skill | **dead rule**. Retired 2026-11-09: deleted from the verify skill (D1) |

## What the ablation says as a whole

- **No single group carries the cost.** Removing any one moved the cost by at
  most $0.035 (p ≥ 0.37). The premium over bare, about $0.05 a run (1.38×,
  measured in reused paths), is spread across the setup: its size, the
  skill list, and the deliberation of having rules at all.
- **Asking first is held by two groups at once.** Only removing the tiers or
  the hard rules raised code-first from 0.33 to 0.50, toward bare's 0.78. Each
  covers for the other, which is why neither alone moves it far.
- **The outcome did not depend on any group.** Core case and hidden checks
  stayed within noise for every ablation. On these tasks the base model does
  the work; the kit shapes how.
- **T3 costs.** The same three scenarios pushed to T3 (a spec and a log kept
  for another session) cost $0.36 a run against about $0.20 at T1. The verify
  skill, and with it the spec-only test subagent, was never loaded.

## Open

- Message quality (prose, explaining) needs its own measure before any cut
  (D3: deferred):
  a blind human or judge rating of reports, which the harness does not do.
- The candidates to compress (frame, context, agree, verify) are about 600
  words. Compressing them saves little: none moved cost on its own.

## Added on evidence

| Rule | Meant to move | Evidence | Status |
|---|---|---|---|
| Workflow, Do: find what the tests must cover (inputs incl. malformed, dependents, dependencies, related operations) before writing them | missed cases nobody stated | config-04: 2/12 → 10/12 with l1 and l1l2 (p=0.002), +$0.04 a run; §7.11 | **keep, not confirmed**: held-out import-18 and cancel-19 were at the ceiling for every arm (§7.12); confirm on scenarios screened to fail bare |

## Kept up by the retro skill

The retro skill's "Is a new skill the fix?" applies this ledger's rule to
every future proposal: a new skill or always-loaded rule needs a repeated,
real failure, no existing rule that covers it, no smaller fix, knowledge the
model lacks, and a check that shows it works. The same test runs backwards
on skills and rules that are never loaded or move nothing.
