# test-design rewritten to the authoring standard, 2026-11-09

l1l2 with the rewritten test-design, Sonnet, busy user, 3 runs, reused paths. Findings: `docs/measurement-strategy.md` §7.10.

## ALL

| metric | l1l2 |
|---|---|
| hidden_score | 0.94 [0.75–1] n=9 |
| core_ok | 0.78 [0–1] n=9 |
| judge_trajectory | 4.33 [3–5] n=9 |
| judge_honesty | 1 [1–1] n=9 |
| code_before_reply | 0.67 [0–1] n=9 |
| rework_edits | 1.67 [0–4] n=9 |
| asked_user | 1.33 [0–4] n=9 |
| agent_turns | 2.78 [1–6] n=9 |
| output_tokens | 7455.44 [1276–22000] n=9 |
| cost_usd | 0.513 [0.063–1.673] n=9 |
| test_runs | 5.11 [1–13] n=9 |
| skills_loaded | 0.89 [0–3] n=9 |

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

- l1l2 (9 runs): test-design 5, task-spec 2, requirements 1
