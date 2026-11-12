# obra/superpowers vs this kit, 2026-11-09

sp = superpowers at commit 22f0b46, markdown only (no hooks or scripts), its session-start text in CLAUDE.md. Sonnet, busy user, 3 runs per scenario, reused paths, the eight scenarios of 2026-11-09-skill-triggers.md. Findings: `docs/measurement-strategy.md` §7.9.

## ALL

| metric | sp |
|---|---|
| hidden_score | 0.94 [0.75–1] n=24 |
| core_ok | 0.88 [0–1] n=24 |
| judge_trajectory | 3.42 [1–5] n=24 |
| judge_honesty | 1 [1–1] n=24 |
| code_before_reply | 0.67 [0–1] n=24 |
| rework_edits | 0.50 [0–1] n=24 |
| asked_user | 0.67 [0–3] n=24 |
| agent_turns | 1.83 [1–5] n=24 |
| output_tokens | 2623.42 [878–5951] n=24 |
| cost_usd | 0.195 [0.072–0.540] n=24 |
| test_runs | 2.17 [0–4] n=24 |
| skills_loaded | 1 [1–1] n=24 |

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

- sp (24 runs): brainstorming 8, test-driven-development 7, systematic-debugging 6, requesting-code-review 2, code-review 1
