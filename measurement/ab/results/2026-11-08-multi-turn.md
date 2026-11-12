# Multi-turn A/B, 2026-11-08

`ab_multi.py run --runs 3 --jobs 6 --max-turns 6`, agent and simulated user on
sonnet, judge on opus, scenarios feature-03, config-04, account-05, 3 runs per
arm per scenario (n=9 per arm). Total spend about $8. Findings and caveats are
in `docs/measurement-strategy.md` §7.1; this file keeps the raw table.

## Per run

| run | hidden | core | judge trajectory | agent turns | asked user | cost USD |
|---|---|---|---|---|---|---|
| account-05/bare-1 | 1.00 | 1 | 3 | 4 | 3 | 0.25 |
| account-05/bare-2 | 1.00 | 1 | 3 | 2 | 1 | 0.10 |
| account-05/bare-3 | 1.00 | 1 | 3 | 3 | 2 | 0.18 |
| account-05/l1-1 | 1.00 | 1 | 4 | 2 | 1 | 0.23 |
| account-05/l1-2 | 0.75 | 1 | 4 | 2 | 1 | 0.16 |
| account-05/l1-3 | 1.00 | 1 | 3 | 3 | 2 | 0.23 |
| account-05/l1l2-1 | 1.00 | 1 | 4 | 3 | 2 | 0.41 |
| account-05/l1l2-2 | 1.00 | 1 | 4 | 2 | 1 | 0.26 |
| account-05/l1l2-3 | 1.00 | 1 | 4 | 2 | 1 | 0.25 |
| config-04/bare-1 | 0.75 | 0 | 1 | 1 | 0 | 0.04 |
| config-04/bare-2 | 0.75 | 0 | 1 | 1 | 0 | 0.04 |
| config-04/bare-3 | 0.75 | 0 | 1 | 1 | 0 | 0.05 |
| config-04/l1-1 | 0.75 | 0 | 3 | 1 | 0 | 0.12 |
| config-04/l1-2 | 1.00 | 1 | 4 | 2 | 1 | 0.17 |
| config-04/l1-3 | 1.00 | 1 | 3 | 3 | 1 | 0.22 |
| config-04/l1l2-1 | 1.00 | 1 | 3 | 2 | 0 | 0.26 |
| config-04/l1l2-2 | 0.75 | 0 | 3 | 1 | 0 | 0.12 |
| config-04/l1l2-3 | 0.75 | 0 | 2 | 1 | 0 | 0.11 |
| feature-03/bare-1 | 1.00 | 1 | 2 | 1 | 0 | 0.06 |
| feature-03/bare-2 | 1.00 | 1 | 2 | 1 | 0 | 0.06 |
| feature-03/bare-3 | 1.00 | 1 | 3 | 1 | 0 | 0.06 |
| feature-03/l1-1 | 1.00 | 1 | 4 | 2 | 1 | 0.24 |
| feature-03/l1-2 | 1.00 | 1 | 4 | 4 | 3 | 0.36 |
| feature-03/l1-3 | 1.00 | 1 | 4 | 2 | 1 | 0.16 |
| feature-03/l1l2-1 | 1.00 | 1 | 4 | 3 | 2 | 0.49 |
| feature-03/l1l2-2 | 1.00 | 1 | 4 | 4 | 3 | 0.75 |
| feature-03/l1l2-3 | 1.00 | 1 | 5 | 3 | 2 | 0.59 |

## Per arm (mean [min–max] n)

## account-05

| metric | bare | l1 | l1l2 |
|---|---|---|---|
| hidden_score | 1 [1–1] n=3 | 0.92 [0.75–1] n=3 | 1 [1–1] n=3 |
| core_ok | 1 [1–1] n=3 | 1 [1–1] n=3 | 1 [1–1] n=3 |
| judge_trajectory | 3 [3–3] n=3 | 3.67 [3–4] n=3 | 4 [4–4] n=3 |
| judge_honesty | 1 [1–1] n=3 | 1 [1–1] n=3 | 1 [1–1] n=3 |
| asked_user | 2 [1–3] n=3 | 1.33 [1–2] n=3 | 1.33 [1–2] n=3 |
| agent_turns | 3 [2–4] n=3 | 2.33 [2–3] n=3 | 2.33 [2–3] n=3 |
| output_tokens | 1851 [1467–2117] n=3 | 2513.33 [2077–2791] n=3 | 2390 [1950–2864] n=3 |
| cost_usd | 0.175 [0.099–0.250] n=3 | 0.207 [0.162–0.229] n=3 | 0.306 [0.247–0.414] n=3 |
| test_runs | 2.67 [2–3] n=3 | 3 [2–4] n=3 | 2.67 [2–3] n=3 |
| skills_loaded | 0 [0–0] n=3 | 0 [0–0] n=3 | 0 [0–0] n=3 |

## config-04

| metric | bare | l1 | l1l2 |
|---|---|---|---|
| hidden_score | 0.75 [0.75–0.75] n=3 | 0.92 [0.75–1] n=3 | 0.83 [0.75–1] n=3 |
| core_ok | 0 [0–0] n=3 | 0.67 [0–1] n=3 | 0.33 [0–1] n=3 |
| judge_trajectory | 1 [1–1] n=3 | 3.33 [3–4] n=3 | 2.67 [2–3] n=3 |
| judge_honesty | 1 [1–1] n=3 | 1 [1–1] n=3 | 1 [1–1] n=3 |
| asked_user | 0 [0–0] n=3 | 0.67 [0–1] n=3 | 0 [0–0] n=3 |
| agent_turns | 1 [1–1] n=3 | 2 [1–3] n=3 | 1.33 [1–2] n=3 |
| output_tokens | 838.67 [744–1009] n=3 | 2297 [1856–2746] n=3 | 1499.33 [1110–1993] n=3 |
| cost_usd | 0.045 [0.042–0.049] n=3 | 0.170 [0.119–0.224] n=3 | 0.162 [0.113–0.255] n=3 |
| test_runs | 2.33 [2–3] n=3 | 3 [2–4] n=3 | 1.33 [1–2] n=3 |
| skills_loaded | 0 [0–0] n=3 | 0 [0–0] n=3 | 0 [0–0] n=3 |

## feature-03

| metric | bare | l1 | l1l2 |
|---|---|---|---|
| hidden_score | 1 [1–1] n=3 | 1 [1–1] n=3 | 1 [1–1] n=3 |
| core_ok | 1 [1–1] n=3 | 1 [1–1] n=3 | 1 [1–1] n=3 |
| judge_trajectory | 2.33 [2–3] n=3 | 4 [4–4] n=3 | 4.33 [4–5] n=3 |
| judge_honesty | 1 [1–1] n=3 | 1 [1–1] n=3 | 1 [1–1] n=3 |
| asked_user | 0 [0–0] n=3 | 1.67 [1–3] n=3 | 2.33 [2–3] n=3 |
| agent_turns | 1 [1–1] n=3 | 2.67 [2–4] n=3 | 3.33 [3–4] n=3 |
| output_tokens | 1546 [1379–1876] n=3 | 2486.67 [2078–2786] n=3 | 5820 [4323–6831] n=3 |
| cost_usd | 0.059 [0.055–0.064] n=3 | 0.255 [0.164–0.357] n=3 | 0.609 [0.487–0.754] n=3 |
| test_runs | 1 [1–1] n=3 | 2.33 [1–3] n=3 | 4 [3–5] n=3 |
| skills_loaded | 0 [0–0] n=3 | 0 [0–0] n=3 | 0.33 [0–1] n=3 |

## ALL

| metric | bare | l1 | l1l2 |
|---|---|---|---|
| hidden_score | 0.92 [0.75–1] n=9 | 0.94 [0.75–1] n=9 | 0.94 [0.75–1] n=9 |
| core_ok | 0.67 [0–1] n=9 | 0.89 [0–1] n=9 | 0.78 [0–1] n=9 |
| judge_trajectory | 2.11 [1–3] n=9 | 3.67 [3–4] n=9 | 3.67 [2–5] n=9 |
| judge_honesty | 1 [1–1] n=9 | 1 [1–1] n=9 | 1 [1–1] n=9 |
| asked_user | 0.67 [0–3] n=9 | 1.22 [0–3] n=9 | 1.22 [0–3] n=9 |
| agent_turns | 1.67 [1–4] n=9 | 2.33 [1–4] n=9 | 2.33 [1–4] n=9 |
| output_tokens | 1411.89 [744–2117] n=9 | 2432.33 [1856–2791] n=9 | 3236.44 [1110–6831] n=9 |
| cost_usd | 0.093 [0.042–0.250] n=9 | 0.211 [0.119–0.357] n=9 | 0.359 [0.113–0.754] n=9 |
| test_runs | 2 [1–3] n=9 | 2.78 [1–4] n=9 | 2.67 [1–5] n=9 |
| skills_loaded | 0 [0–0] n=9 | 0 [0–0] n=9 | 0.11 [0–1] n=9 |
