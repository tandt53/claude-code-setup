# SDLC-phase A/B rounds, 2026-11-08

`ab_multi.py run` on eight scenarios, one or more per SDLC phase, three arms
(`bare`, `l1` global setup, `l1l2` global + project kit installed the Python
way), 3 runs per arm per scenario unless noted. The simulated user is
consistent (code-side decision, 3 votes); judge on opus. Findings are in
`docs/measurement-strategy.md` §7.2. Columns per arm: core case right ·
hidden checks passed · wrote code before the user's first reply · USD per run.

Regraded 2026-11-09 (see measurement-strategy §7.2 correction).

## Round 1: sonnet agent, attentive user (n=24 per arm)

| scenario | bare: core · hidden · code-first · $ | l1: core · hidden · code-first · $ | l1l2: core · hidden · code-first · $ |
|---|---|---|---|
| account-05 | 1.00 · 1.00 · 1.00 · 0.16 | 1.00 · 1.00 · 1.00 · 0.24 | 1.00 · 1.00 · 1.00 · 0.40 |
| bugfix-10 | 1.00 · 1.00 · 1.00 · 0.11 | 1.00 · 1.00 · 1.00 · 0.22 | 1.00 · 1.00 · 0.00 · 0.51 |
| config-04 | 0.67 · 0.92 · 1.00 · 0.08 | 0.33 · 0.83 · 1.00 · 0.16 | 1.00 · 1.00 · 1.00 · 0.43 |
| design-07 | 1.00 · 1.00 · 1.00 · 0.16 | 1.00 · 1.00 · 0.67 · 0.20 | 1.00 · 1.00 · 0.00 · 0.64 |
| feature-03 | 1.00 · 1.00 · 1.00 · 0.07 | 1.00 · 1.00 · 1.00 · 0.19 | 1.00 · 1.00 · 0.00 · 0.63 |
| req-06 | 1.00 · 0.93 · 0.67 · 0.24 | 1.00 · 1.00 · 0.00 · 0.20 | 1.00 · 1.00 · 0.00 · 0.59 |
| review-09 | 1.00 · 1.00 · 0.00 · 0.05 | 1.00 · 0.92 · 0.00 · 0.18 | 1.00 · 1.00 · 0.00 · 0.36 |
| test-08 | 1.00 · 1.00 · 1.00 · 0.14 | 1.00 · 1.00 · 1.00 · 0.18 | 1.00 · 1.00 · 1.00 · 0.55 |
| ALL | 0.96 · 0.98 · 0.83 · 0.13 | 0.92 · 0.97 · 0.71 · 0.19 | 1.00 · 1.00 · 0.38 · 0.51 |

total $ 31.12 errors: 0

## Differences (delta, permutation p)

| metric | l1-bare | l1l2-bare | l1l2-l1 |
|---|---|---|---|
| hidden_score | -0.013 (p=0.610) | +0.019 (p=0.490) | +0.031 (p=0.233) |
| core_ok | -0.042 (p=1.000) | +0.042 (p=1.000) | +0.083 (p=0.491) |
| code_before_reply | -0.125 (p=0.496) | -0.458 (p=0.002) | -0.333 (p=0.042) |
| rework_edits | -0.083 (p=0.842) | -0.208 (p=0.372) | -0.125 (p=0.696) |
| judge_trajectory | +1.125 (p=0.002) | +1.792 (p=0.000) | +0.667 (p=0.015) |
| cost_usd | +0.068 (p=0.003) | +0.386 (p=0.000) | +0.318 (p=0.000) |

## Round 2: sonnet agent, busy user (n=24 per arm)

| scenario | bare: core · hidden · code-first · $ | l1: core · hidden · code-first · $ | l1l2: core · hidden · code-first · $ |
|---|---|---|---|
| account-05 | 1.00 · 1.00 · 1.00 · 0.09 | 1.00 · 1.00 · 1.00 · 0.17 | 1.00 · 1.00 · 1.00 · 0.28 |
| bugfix-10 | 1.00 · 1.00 · 1.00 · 0.12 | 1.00 · 1.00 · 1.00 · 0.20 | 1.00 · 1.00 · 1.00 · 0.34 |
| config-04 | 0.33 · 0.83 · 1.00 · 0.06 | 0.00 · 0.75 · 1.00 · 0.08 | 0.33 · 0.83 · 1.00 · 0.21 |
| design-07 | 1.00 · 0.89 · 1.00 · 0.13 | 1.00 · 0.83 · 1.00 · 0.21 | 1.00 · 1.00 · 0.00 · 0.44 |
| feature-03 | 1.00 · 1.00 · 1.00 · 0.06 | 1.00 · 1.00 · 1.00 · 0.11 | 1.00 · 1.00 · 0.33 · 0.66 |
| req-06 | 0.67 · 0.73 · 0.33 · 0.18 | 1.00 · 1.00 · 0.00 · 0.31 | 1.00 · 1.00 · 0.00 · 0.68 |
| review-09 | 1.00 · 1.00 · 0.00 · 0.06 | 1.00 · 1.00 · 0.00 · 0.22 | 1.00 · 1.00 · 0.00 · 0.26 |
| test-08 | 1.00 · 1.00 · 1.00 · 0.13 | 1.00 · 1.00 · 1.00 · 0.17 | 1.00 · 1.00 · 1.00 · 0.36 |
| ALL | 0.88 · 0.93 · 0.79 · 0.10 | 0.88 · 0.95 · 0.75 · 0.18 | 0.92 · 0.98 · 0.54 · 0.40 |

total $ 26.66 errors: 0

## Differences (delta, permutation p)

| metric | l1-bare | l1l2-bare | l1l2-l1 |
|---|---|---|---|
| hidden_score | +0.016 (p=0.628) | +0.047 (p=0.108) | +0.031 (p=0.249) |
| core_ok | +0.000 (p=1.000) | +0.042 (p=1.000) | +0.042 (p=1.000) |
| code_before_reply | -0.042 (p=1.000) | -0.250 (p=0.126) | -0.208 (p=0.229) |
| rework_edits | +0.000 (p=1.000) | -0.083 (p=0.803) | -0.083 (p=0.829) |
| judge_trajectory | +1.042 (p=0.008) | +1.458 (p=0.000) | +0.417 (p=0.196) |
| cost_usd | +0.078 (p=0.000) | +0.300 (p=0.000) | +0.222 (p=0.000) |

## Round 3: haiku agent, busy user, sonnet user-sim (n=24 per arm)

| scenario | bare: core · hidden · code-first · $ | l1: core · hidden · code-first · $ | l1l2: core · hidden · code-first · $ |
|---|---|---|---|
| account-05 | 1.00 · 0.75 · 1.00 · 0.01 | 1.00 · 0.92 · 1.00 · 0.01 | 1.00 · 0.92 · 1.00 · 0.03 |
| bugfix-10 | 1.00 · 1.00 · 1.00 · 0.01 | 1.00 · 0.92 · 0.33 · 0.02 | 1.00 · 1.00 · 0.67 · 0.04 |
| config-04 | 0.00 · 0.75 · 1.00 · 0.00 | 0.33 · 0.83 · 1.00 · 0.01 | 0.33 · 0.83 · 1.00 · 0.02 |
| design-07 | 1.00 · 0.89 · 1.00 · 0.02 | 1.00 · 0.83 · 1.00 · 0.02 | 1.00 · 0.89 · 0.67 · 0.04 |
| feature-03 | 1.00 · 1.00 · 1.00 · 0.01 | 1.00 · 1.00 · 1.00 · 0.01 | 1.00 · 1.00 · 1.00 · 0.01 |
| req-06 | 0.33 · 0.73 · 1.00 · 0.02 | 1.00 · 0.93 · 0.00 · 0.03 | 1.00 · 1.00 · 0.33 · 0.03 |
| review-09 | 1.00 · 1.00 · 0.00 · 0.01 | 1.00 · 1.00 · 0.33 · 0.01 | 1.00 · 1.00 · 0.00 · 0.02 |
| test-08 | 1.00 · 1.00 · 1.00 · 0.01 | 1.00 · 1.00 · 1.00 · 0.02 | 1.00 · 1.00 · 1.00 · 0.02 |
| ALL | 0.79 · 0.89 · 0.88 · 0.01 | 0.92 · 0.93 · 0.71 · 0.02 | 0.92 · 0.95 · 0.71 · 0.03 |

total $ 11.14 errors: 0

## Differences (delta, permutation p)

| metric | l1-bare | l1l2-bare | l1l2-l1 |
|---|---|---|---|
| hidden_score | +0.039 (p=0.301) | +0.065 (p=0.085) | +0.026 (p=0.415) |
| core_ok | +0.125 (p=0.418) | +0.125 (p=0.413) | +0.000 (p=1.000) |
| code_before_reply | -0.167 (p=0.287) | -0.167 (p=0.286) | +0.000 (p=1.000) |
| rework_edits | +0.000 (p=1.000) | +0.000 (p=1.000) | +0.000 (p=1.000) |
| judge_trajectory | +1.083 (p=0.006) | +1.208 (p=0.004) | +0.125 (p=0.784) |
| cost_usd | +0.007 (p=0.003) | +0.015 (p=0.000) | +0.009 (p=0.007) |

## Round 4a: confirmation on req-06, sonnet, busy (n=6 per arm)

| scenario | bare: core · hidden · code-first · $ | l1: core · hidden · code-first · $ | l1l2: core · hidden · code-first · $ |
|---|---|---|---|
| req-06 | 1.00 · 0.87 · 0.33 · 0.17 | 1.00 · 1.00 · 0.00 · 0.30 | 1.00 · 1.00 · 0.00 · 0.67 |
| ALL | 1.00 · 0.87 · 0.33 · 0.17 | 1.00 · 1.00 · 0.00 · 0.30 | 1.00 · 1.00 · 0.00 · 0.67 |

total $ 10.51 errors: 0

## Differences (delta, permutation p)

| metric | l1-bare | l1l2-bare | l1l2-l1 |
|---|---|---|---|
| hidden_score | +0.133 (p=0.062) | +0.133 (p=0.062) | +0.000 (p=1.000) |
| core_ok | +0.000 (p=1.000) | +0.000 (p=1.000) | +0.000 (p=1.000) |
| code_before_reply | -0.333 (p=0.458) | -0.333 (p=0.458) | +0.000 (p=1.000) |
| rework_edits | -0.333 (p=0.547) | -0.500 (p=0.181) | -0.167 (p=1.000) |
| judge_trajectory | +2.000 (p=0.001) | +2.000 (p=0.001) | +0.000 (p=1.000) |
| cost_usd | +0.129 (p=0.126) | +0.495 (p=0.001) | +0.366 (p=0.003) |

## Round 4b: confirmation on req-06, haiku, busy (n=6 per arm)

| scenario | bare: core · hidden · code-first · $ | l1: core · hidden · code-first · $ | l1l2: core · hidden · code-first · $ |
|---|---|---|---|
| req-06 | 0.67 · 0.80 · 0.83 · 0.01 | 0.83 · 0.83 · 0.17 · 0.02 | 1.00 · 0.87 · 0.17 · 0.03 |
| ALL | 0.67 · 0.80 · 0.83 · 0.01 | 0.83 · 0.83 · 0.17 · 0.02 | 1.00 · 0.87 · 0.17 · 0.03 |

total $ 3.44 errors: 0

## Differences (delta, permutation p)

| metric | l1-bare | l1l2-bare | l1l2-l1 |
|---|---|---|---|
| hidden_score | +0.033 (p=1.000) | +0.067 (p=0.688) | +0.033 (p=1.000) |
| core_ok | +0.167 (p=1.000) | +0.333 (p=0.452) | +0.167 (p=1.000) |
| code_before_reply | -0.667 (p=0.079) | -0.667 (p=0.077) | +0.000 (p=1.000) |
| rework_edits | -1.333 (p=0.134) | -1.000 (p=0.258) | +0.333 (p=0.925) |
| judge_trajectory | +1.833 (p=0.019) | +2.000 (p=0.013) | +0.167 (p=1.000) |
| cost_usd | +0.005 (p=0.122) | +0.016 (p=0.001) | +0.011 (p=0.031) |

