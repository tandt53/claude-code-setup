---
name: release
description: Prepares and runs a release - scope proven by trace-check, migration dry run, backup, rollback plan, changelog, then the irreversible step only with approval, then smoke checks and monitoring. Use when shipping to production or any shared environment people depend on.
when_to_use: release, deploy to production, ship this, cut a release, publish a version, go live, run the migration in production
---

# Release

A release is irreversible for its users even when the code can be rolled
back: data written, emails sent, people who saw the change. So the rule for
irreversible steps applies: prepare fully, then stop and ask.

## Workflow

Copy this checklist and tick it with the evidence for each line:

```
Release <version>:
- [ ] 1. Scope: commits, tasks, REQ ids
- [ ] 2. Proof: trace-check --strict exits 0 (summary attached)
- [ ] 0. Pre-flight of `../ops-foundations/SKILL.md` done for the target environment
- [ ] 3. Data: each migration dry-run on a production-sized copy; time; irreversible ones in bold
- [ ] 4. Backup taken, and restoring it tried for this kind of data
- [ ] 5. Rollback plan: exact steps, who, and the point of no return
- [ ] 6. Changelog in users' words
- [ ] 7. Smoke checks and signals, with the thresholds that trigger rollback
- [ ] GATE: checklist shown, owner approved (who, when)
- [ ] 8. Release, each step timed
- [ ] 9. Smoke checks run, signals watched for the agreed time
- [ ] 10. Record written in .work/releases/
```

## Start when

A change is ready to ship to production or a shared environment, and the scope —
the commits and tasks in it — is known. Examples still assumed or unproven → not
ready; prove them first (trace-check `--strict`).

## Before: prepare (all reversible)

1. **Scope**: the commits and tasks in this release, and their REQ ids.
2. **Proof**: `node scripts/trace-check.mjs --strict …` over the scope exits
   0: every example passes, none still `assumed`, no orphans. Attach its
   summary. Test plan exit criteria met, or waived in writing.
3. **Data**: every migration dry-run on a copy of production-sized data;
   time taken; what old records become. A migration that cannot be undone
   says so in bold.
4. **Backup** taken, and restoring it tried at least once for this kind of
   data.
5. **Rollback plan**: the exact steps, who runs them, and the point after
   which rollback no longer works (for example once new data is written).
6. **Changelog** from the commits and REQ ids: what users will notice, in
   their words.
7. **Smoke checks**: the few checks run right after release (main flows,
   one per critical requirement), and the signals to watch (errors,
   latency, business numbers) with the thresholds that trigger rollback.

## Gate

Present the checklist with evidence, one line each, then stop. The person
who owns the release approves. Nothing below runs unattended.

## During and after

8. Release. Record each step and time.
9. Run the smoke checks. Watch the signals for the agreed time.
10. A threshold crossed → roll back first, investigate after (`incident`
    skill).

## Publish

The changelog and the trace-check summary go out through the channel the
project declares in its CLAUDE.md (a pull request carrying them, the issue
tracker for follow-ups) — the same place `bug-report` files to. Opening or
merging that PR is an outward step: it waits for the Gate above, never runs
unattended.

## Record

`.work/releases/<yyyy-mm-dd>-<version>.md`: scope, the trace-check summary,
checklist with evidence, approval (who, when), timeline, outcome. Anything
surprising goes to `retro`.
