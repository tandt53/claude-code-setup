# Phase 0 baseline: multi-module scenarios, 2026-11-09

Sonnet agent, busy user, 3 runs per arm, max 8 turns. Columns per arm: core case right · hidden checks passed · wrote code before the user's first reply · USD per run. Findings: `docs/measurement-strategy.md` §7.3.

| scenario | bare: core · hidden · code-first · $ | l1: core · hidden · code-first · $ | l1l2: core · hidden · code-first · $ |
|---|---|---|---|
| multi-11 | 1.00 · 1.00 · 1.00 · 0.27 | 1.00 · 1.00 · 0.00 · 0.51 | 1.00 · 1.00 · 0.00 · 0.91 |
| multi-12 | 1.00 · 1.00 · 1.00 · 0.17 | 1.00 · 1.00 · 0.00 · 0.34 | 1.00 · 1.00 · 0.00 · 0.74 |
| multi-13 | 1.00 · 0.92 · 1.00 · 0.13 | 1.00 · 1.00 · 1.00 · 0.32 | 1.00 · 1.00 · 1.00 · 0.63 |
| ALL | 1.00 · 0.97 · 1.00 · 0.19 | 1.00 · 1.00 · 0.33 · 0.39 | 1.00 · 1.00 · 0.33 · 0.76 |

total $ 17.99 errors: 0

## Differences (delta, permutation p)

| metric | l1-bare | l1l2-bare | l1l2-l1 |
|---|---|---|---|
| hidden_score | +0.028 (p=1.000) | +0.028 (p=1.000) | +0.000 (p=1.000) |
| core_ok | +0.000 (p=1.000) | +0.000 (p=1.000) | +0.000 (p=1.000) |
| code_before_reply | -0.667 (p=0.009) | -0.667 (p=0.009) | +0.000 (p=1.000) |
| rework_edits | -0.111 (p=1.000) | -0.222 (p=0.790) | -0.111 (p=1.000) |
| judge_trajectory | +2.222 (p=0.000) | +2.222 (p=0.000) | +0.000 (p=1.000) |
| cost_usd | +0.200 (p=0.069) | +0.569 (p=0.000) | +0.369 (p=0.007) |
