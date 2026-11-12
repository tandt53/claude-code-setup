---
name: test-execution
description: Runs test cases - a batch through the project's test command, or a manual walk - and records one honest verdict per case (pass / fail / flaky / inconclusive) with evidence, before any failure is triaged. Use to run or re-run a suite and record what was observed.
when_to_use: run the tests, run the suite, re-run the failing tests, record the results, manual test run, regression run
---

# Test execution

Running is the one step that produces evidence about the system itself, not
about a document, so its whole discipline is honesty: record what was actually
observed, what was not, and never blur the two. This skill records verdicts; it
does not decide root cause (that is `bug-report`) and does not write test
bodies (`test-authoring`). The craft it leans on is in `../qa-foundations/SKILL.md`.

## Workflow

```
Run <suite>:
- [ ] 1. Environment and data checked before running
- [ ] 2. Run; each case gets one verdict from what was observed
- [ ] 3. A first FAIL re-run 3x in isolation before calling it FLAKY
- [ ] 4. Run record written with evidence and the command that produced it
- [ ] 5. Gates confirmed; failures handed to bug-report
```

## Start when

Runnable test cases exist and a test or local environment is available to run them
against. No cases authored → author them first (this kit uses `test-authoring`);
no environment → report blocked, never fake a verdict.

## Scope

The cases named in the request, or every automated case for the feature.
Confirm scope when ambiguous.

## Before running

Decide where evidence (logs, screenshots, traces) will land and how the run is
recorded **before** invoking the test command — discovering it after the fact
means the first failing run, the one you most needed, has no evidence. The run
record lives in the role the project declares (default `.work/test-runs/`).

## Verdicts

Each case in scope gets exactly one verdict:

| Verdict | When |
|---|---|
| PASS | ran; the assertion held |
| FAIL | ran; the assertion did not hold |
| FLAKY | 3× isolation re-run (same env, same data) gave mixed results |
| INCONCLUSIVE | the verdict cannot be read from this run |

- **FLAKY** only when a first FAIL, re-run 3× in isolation, comes back mixed.
  Consistent FAIL across 3 runs is FAIL, not flaky — send it to triage.
- **INCONCLUSIVE** causes: a crash before the assertion, an environment or
  fixture error (the precondition never held), a timeout with no fail signal, a
  legitimate skip (known incompatibility or unmet precondition — never a
  failure hidden behind `.skip`), or a network blip (re-run; if it recurs, it
  is infrastructure).

Verdict is not root cause. Route every FAIL / FLAKY, and any INCONCLUSIVE whose
cause is unclear, to `bug-report` with the evidence carried forward (log,
screenshots, traces, page source). An INCONCLUSIVE with an unambiguous
environmental cause (env down, fixture missing) is reported blocked, not
triaged.

## Run record

Always write a run record, whatever the outcome:
- per-case verdict (pass / fail / flaky / inconclusive);
- per-case evidence pointer;
- aggregate counts (pass / fail / flaky / inconclusive / skipped);
- the failed-case list with paths, for triage;
- the exact test command invoked, verbatim with flags, and its exit code.

Update each case's status in the test-case file to reflect the run (passed,
failed, or a filed bug reference once `bug-report` files one). Where the file
has per-platform status, write only the platform actually run; leave the others
as they were. Never date-stamp a case as "verified" — the latest run is the
truth of what passes today.

## Confirm gates

Pause and ask before:
- a destructive step (logout, delete, purchase, drop, truncate) on a
  non-ephemeral environment;
- re-running against a shared or production environment — even a read-only
  probe can have observable side effects;
- a parallel run where two or more cases share a mutable fixture (warn about
  the race first);
- a run that threatens a cost ceiling (token, runtime, API quota).

## Honesty rules

- No "all green" claim without per-case verification; the runner's summary is a
  starting point, not the record.
- No silent retry that turns a case red → green. A retry is for setup or
  network only, never an assertion, and is written down when used.
- A skip with no reason is a failure signal, not a pass.

## Output

The run record path, the aggregate counts, the failed-case list routed to
`bug-report`, and anything that could not be run and why. Against a release's
exit criteria, report met / not met with the evidence (`test-plan`).
