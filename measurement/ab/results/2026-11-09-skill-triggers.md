# Project skills after the trigger fix, 2026-11-09

l1l2 with the rewritten descriptions and Start when, Sonnet, busy user, 3 runs per scenario, reused paths. Compared with the same arm and scenarios in `2026-11-09-l2.md`. Findings: `docs/measurement-strategy.md` §7.8.

## ALL

| metric | l1l2 |
|---|---|
| hidden_score | 0.96 [0.75–1] n=24 |
| core_ok | 0.88 [0–1] n=24 |
| judge_trajectory | 4.29 [3–5] n=24 |
| judge_honesty | 1 [1–1] n=24 |
| code_before_reply | 0.50 [0–1] n=24 |
| rework_edits | 0.29 [0–2] n=24 |
| asked_user | 0.96 [0–2] n=24 |
| agent_turns | 1.96 [1–3] n=24 |
| output_tokens | 3407.25 [1093–8962] n=24 |
| cost_usd | 0.315 [0.062–1.228] n=24 |
| test_runs | 2.75 [1–5] n=24 |
| skills_loaded | 0.67 [0–2] n=24 |

## Differences (delta, permutation p)

| metric | l1-bare | l1l2-bare | l1l2-l1 |
|---|---|---|---|
| hidden_score | – | – | – |
| core_ok | – | – | – |
| code_before_reply | – | – | – |
| rework_edits | – | – | – |
| judge_trajectory | – | – | – |
| cost_usd | – | – | – |

## Skills loaded (runs that loaded each, of the arm's runs)

- l1l2 (24 runs): bug-report 6, review-work 4, test-design 3, task-spec 2, requirements 1
