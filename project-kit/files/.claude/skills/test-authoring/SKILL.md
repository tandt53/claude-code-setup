---
name: test-authoring
description: Writes test code from designed cases - in the project's runner, reusing its helpers and fixtures, locating every element or endpoint that exists rather than inventing one, each test named for the example it proves and run once. Use when writing test code, from test-design's cases or cases named in the task.
when_to_use: write the test code, implement these test cases, automate the tests, add an e2e test, write the pytest, write the spec file
---

# Test authoring

Turn the cases `test-design` produced into runnable test bodies. You write
**from the example**, not from the product's source; you **reuse** the
project's helpers; you **surface** a missing contract rather than inventing
one. The craft — the locator priority and forbidden anti-patterns, reuse
before creation, assert-observable-not-internal, the no-invent rule — lives in
`../qa-foundations/SKILL.md`. Read it by path; this is the authoring playbook on top.

Separate from `test-design` on purpose: design decides which cases and at what
level; authoring writes robust bodies for the ones to automate. On a small
task one person does both; the discipline below is the same either way.

## Workflow

```
Author <cases>:
- [ ] 1. Inputs read: the examples, the case table, one or two existing test files, the helpers
- [ ] 2. Each case: its example re-read; every element and endpoint found in the helpers (missing → surface, stop)
- [ ] 3. Locators by priority, auto-waited assertions, no sleeps
- [ ] 4. Each test named for its example; asserts what a user or caller observes
- [ ] 5. Run once: mechanics fixed here, deeper failures to bug-report
- [ ] 6. Re-read: helpers exist, names encode examples, tests independent
```

## Start when

There are cases to implement, from `test-design` or named in the task, and the
code and helpers they exercise exist. No cases yet → derive them with
`test-design` in the same task, then come back. A selector or endpoint a case
needs does not exist → surface the gap, never invent it.

## Scope

The cases named in the request, or every designed case not yet implemented
that is meant to be automated (manual cases are run, not coded). Confirm scope
when ambiguous; do not silently pull in cases the user did not name.

## Steps

1. **Read the inputs.** The requirement and its examples, the test-case file,
   one or two existing test files for convention, and the project's existing
   page objects, API wrappers and fixtures. Discover the runner from the
   project (its deps, config and neighbours), not from language defaults.
2. **For each case:**
   - Find the example it proves; re-read it. The test asserts that example.
   - Reproduce the case's precondition, steps, data and expected outcome
     faithfully, in the runner's idioms (you need not keep literal step
     numbers if the runner has better primitives).
   - Locate every element or endpoint in the existing helper layer (or verify
     it live through the stack's driver skill, e.g. `playwright-cli`). **If
     anything is missing, stop and surface the gap** — never invent a selector
     or endpoint. This is the cardinal failure mode this skill prevents.
   - Apply the locator priority on emit and avoid the forbidden anti-patterns
     (`../qa-foundations/SKILL.md`): test-id, then role+name, then label, then unique text,
     CSS last. No XPath, no positional selectors, no fixed-delay sleeps. Use
     the framework's auto-waited assertion on the specific condition; can't
     name the condition → the test is not ready, report partial.
   - **Name the test for the example it proves** (`REQ-CHECKOUT-012 ex2: …`),
     so trace-check ties the test to the example. This is what makes a case
     count as covered.
   - Assert what the user or API consumer observes, not internal state (DB
     rows, flags).
   - Reuse existing helpers; extend one only when the task scope allows it, and
     say so. Adding a sibling helper is drift.
3. **Self-verify** by running the test once.
   - Passes → done for that case.
   - Fails on mechanics (selector typo, missing wait, fixture drift, helper
     signature) → fix the call site and re-run. That is authoring's scope.
   - Fails deeper → route to `bug-report` with the evidence (log, trace, page
     source); authoring does not classify product vs script vs flake.
   - Live passes but the test fails on re-run → a reliable failure, not flake;
     debug the test's encoding. Never weaken the assertion to go green.
4. **Validate.** Re-read each file: the body exists, the helpers it calls
   exist, the name encodes the example, and the test is independent and cleans
   up its own state (`../qa-foundations/SKILL.md`, test data).

## Anti-patterns

1. Writing the test from the product's source code — it inherits the code's
   bugs. Derive from the example and the running system only.
2. Inventing a selector or endpoint because it looks plausible — look it up or
   verify it live; absent → surface the gap.
3. A name that describes steps (`logs in and clicks reset`) instead of the
   assertion. The steps live in the case; the name states what is proven.
4. Asserting internal state instead of observable behaviour.
5. Tests that depend on each other's order; they must pass alone and shuffled.
6. Writing the assertion as a comment (`// should reject`) instead of code.
7. Editing the requirement or the case's intent while authoring — surface it
   and route back to `requirements` / `test-design`; conversational drift is
   not authorisation.

## Output

The test files written (paths), the cases implemented, any reuse-surface
extension made, and any gap surfaced (missing element, ambiguous example).
Next: run the suite; send failures to `bug-report` / `test-execution`.
