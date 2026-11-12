---
name: verify-work
description: Prove a delivery is done - independent checks against the approved acceptance examples, property tests, and checking that the checks themselves can fail (mutation checks). Use before reporting done any change that had examples to approve or a plan of several steps.
---

# Verify

This skill is for deliveries (Workflow, Frame the task). For learning
and deciding, only the Evidence rules below apply: the answer or the brief
still shows its evidence, but throwaway code needs no tests or mutation checks.

Done is when the acceptance examples written at Agree (Workflow, Agree, plan,
do) pass, as the spec's end-to-end check when there is a spec;
the tests and the type check are clean; and the change has been run for
real where it can be.
Show the evidence (the command and its output, a screenshot); never assert.

## Independence

A check is only as independent as its reference. When one context reads the
request, writes the tests and writes the code, a misunderstanding passes every
check. A model re-reading its own work tends to approve it, and without an
outside signal its self-corrections can make things worse.

- **Reference**: the acceptance examples the user approved. Not your reading
  of the request, not the code.
- **Tests come from those examples**, written before the code and seen
  failing. An example that quotes what the user sees (a label, an output line,
  the text on a page) is checked on that visible text, never on an
  attribute or a value the code produces beside it. Seen: twice an approved
  example's wording went unmet while the step's own tests passed, because
  they asserted what the code emitted (an aria-label, a test comment).
- **Add property tests** for the invariants the examples imply. An example test
  can share the code's mistake (code returns `[2,3]` for `factorize(12)`,
  the test written by the same mind expects `[2,3]`); a property ("the
  product of the factors equals the input") rarely does.
- **Run the real thing** wherever possible: the app, the command, real data
  on a copy. Reality shares no one's assumptions.
- **Reference docs that state what the code does get an independent read
  against the new code.** When a change edits documents describing the
  code's behaviour (requirements, API docs, a spec's own examples), or
  changes a behaviour such a document describes, a stale sentence passes
  every test, because prose is not machine-decidable. So a reader who did not
  write the change (a subagent given the diff and the touched documents, not
  your reasoning) confirms each such statement and example describes the new
  code. Read only the statements the change edits or whose behaviour it
  changes: a cited line that merely moved is no reason to read, and documents
  cite files and tests, never line numbers (the project kit's requirements
  skill). Where an example has a test titled after it, that test is the
  stronger check: one marked `test.failing` that starts to pass turns red on
  its own. Seen in three deliveries in a row: each time the reviewer, not I,
  found requirement lines still describing the mechanism the change had
  replaced, while I had only shifted their cited line numbers.

## Check the checks

A check never seen to fail is not yet trusted. For each check the result
relies on (a test, a validator, a hook, a reviewer, an alert):

1. Name the failure it exists to catch, in the user's terms.
2. Make one realistic instance of it: change the code, data, expected value
   or diff so the failure is really there. **Work on a copy or a branch.**
3. Run the check. It must reject the broken version and accept the real one.
4. If it accepts the broken version, it is blind to that failure. Strengthen
   it, and report the gap.
5. Remove the injected failure and confirm it is gone: diff against the start.

A check that makes several claims is several checks: inject one failure per
claim, not one per script. Seen: a mockup check was seen failing on low
contrast, a pale border, a new sentence and a changed pixel, but never on
overflow. Its overflow test could not fail, since each screen frame clipped
what stuck out, and "no overflow" was reported on its word.

Write each injected failure from the spec's own sentence, not from how the
code does it. Seen: the spec said "no counting while a dialog is open"; the
injected failure only showed a nudge behind an open dialog, so a count that
kept running through the dialog, firing one second after it closed, still
passed.

A test that loops over a collection, or whose result depends on which branch
the code takes, first asserts that it got the expected one: the collection's
exact contents or size, or a value only the intended branch produces. Seen:
three new tests passed on a stub, two looping over a list the stub left empty
and one landing in another branch that printed the same thing.

**One test, right after writing it** (a regression test, a bug fix):
1. Save the fixed code outside the working tree, then revert **exactly the
   fix**: the old behaviour, not a random edit.
2. Run only the affected tests. They must go red, and the message must point
   at the real problem, not a crash somewhere incidental.
3. Restore the fix, re-run green, and confirm the tree is clean.

A test that claims behaviour is **unchanged** is not exercised by reverting
the fix, since the old code passes it too: give it a mutation of its own that
breaks that behaviour in the new code. A mutation the tests survive is a
finding: that test does not cover what its name claims, so write the one that
does. Every mutation run has a time limit, a few times the unmutated run's
own, and runs in the foreground; a run that goes over is recorded as timed out
and stopped.

For code this is mutation testing (Stryker for JS/TS, PIT for Java, mutmut
for Python, cargo-mutants for Rust). Run it on the **changed code where being
wrong is expensive**: business rules, permissions, money, data. Read each
surviving mutant as a missing test. Mutants written from a named concern
("expired coupons still apply") beat random ones. Do not chase the score. A
change that does not alter behaviour is not a failure; a check that ignores
it is right to.

## Evidence rules

- Never call a failure pre-existing without checking the base state.
- Know why a check is green. One that passes for a reason unrelated to its
  claim is worse than one that fails: it certifies whatever it is handed.
- A sentence saying how a library, a framework or a permission behaves, or a
  command for someone else to run, written where it will last (a spec's
  Decision or Out line, a code comment, a commit message), is run or probed
  first, or marked inferred. No test fails on it, because prose is not run.
  Seen in one task: a spec said a session in a failing `@BeforeMethod` is never
  quit (it is), a commit said a TestNG configuration result has no status in
  `afterInvocation` (it has), and a spec's command gave 72 failures in a module
  it was not meant to touch.
- A probe or evidence script (a sampling loop, a parser, a one-off driver)
  is trusted only after one run on a case whose answer is already known.
- A failure seen through a harness (a browser or device driver, an emulator,
  a stub, a probe) is a lead, not an app bug, until it is seen again without
  that harness, or a control run (the old code, another build) tells the two
  apart. Seen: a driver that reports a light scheme read as "the app ignores
  dark mode"; a session that wipes app data read as an auth bug.
- A check that may be intermittent (a browser test, anything timed or
  concurrent, anything reading "the latest" row) is run three times on each
  side before a failure is called a regression or pre-existing; until then
  it is "suspected". Seen: one failing run on the new code and one passing
  control run on the old were reported as "confirmed: the fix broke it"; a
  third run passed on the new code, and the test was flaky (two attempts
  created in the same millisecond, read with "order by created desc").
- A claim about what stored data holds (that a field is set, absent, or
  who has it) follows the write path: which screen, route or job writes
  that field. When a decision rests on it, ask for a read-only count from
  production. Seen: a brief priced "block edits outside the manager's
  branches" as costing only parents, reading teachers' branches from the
  schema; no screen writes them, and production had 14 of 14 teachers
  with none. Also: "tokens are not stored" proved by grep, while the whole
  provider result, tokens included, went into a JSON column.
- A screenshot offered as proof of a change shows the change at a glance,
  to someone who did not make it. The test content (a picture, a label)
  looks unlike anything the page already shows. The changed part is marked
  (an outline, an arrow). The shot is cropped to the element that changed,
  after scrolling to it and opening whatever hides it, never the whole
  viewport. Each pair carries a count of that element read from the page
  (`0 → 1`). Every pair is looked at before it is sent. Seen: a before/after
  pair for an image fix used the repository's sample PNG, itself a scan of a
  question ("Question 26 … A B C D"), so the new picture read as one more
  question and the user saw no difference; the first set was also shot above
  the collapsed Answer Review, so it showed no picture at all.
- A skipped, errored or timed-out check did not pass. Say which, and why.
- Test results carry numbers: "212 passed, 3 skipped", not "tests pass".
- A count in a report, a log or a commit message comes from a command that
  counts, or is copied from one named source, and is quoted with it; never
  added up by hand from several reports. Text a user will see, quoted word
  for word, likewise carries its `file:line` or command, or is `assumed`
  (Communication, Say how sure you are, and how you know). Seen: in one
  audit, three counts summed by hand from agent reports were wrong (98/102
  written 120/124, 56/60 written 52/56, 169 written 165), each found only on
  a recount.

## Reporting

In the report (Communication, Report of finished work), each check that could
not run, each blind spot found by checking the checks, and each part with no
reference goes under **Not done** as `[unverified]`, with the reason. Never
fold them into Done.
