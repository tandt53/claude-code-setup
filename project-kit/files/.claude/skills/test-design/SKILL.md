---
name: test-design
description: Finds what a change or a unit must be tested against - its inputs, the code that depends on it, what it depends on, and the operations related to it - then derives the cases, each with its expected result and level, before any test is written. Use when asked to write, add or improve tests, and when a task says to add or run the tests for a change it makes.
when_to_use: write tests, add tests, add a test for, test this, cover the edge cases, improve the tests, a change whose task says "run the tests", before writing a test file
---

# Test design

The model knows the techniques. What it skips under pressure is finding the
**objects** to apply them to: the malformed row nobody mentioned, the
operation that runs after its inverse. This workflow finds them first.

## Workflow

Copy this checklist into your notes and tick it as you go:

```
Test design:
- [ ] 1. Objects: inputs, outputs and state, dependents, dependencies, related operations
- [ ] 2. Classes and sequences for each object
- [ ] 3. Expected result for each case, from its source (or `assumed`, or a question)
- [ ] 4. Level for each case
- [ ] 5. Case table written; questions asked before code
- [ ] 6. Tests written, seen failing for the right reason, then the code
```

**1. Objects.** For the unit being changed or tested, write each of these down,
reading the code, not memory:
- **inputs**: every parameter, and everything it reads (a file, a line of
  text, a config value, stored data, a user's text, a fetched response)
- **outputs and state**: what it returns, raises, stores or sends
- **dependents**: who uses its result. Search for its name: callers, reports,
  notifications, other features
- **dependencies**: what it calls or reads, and what happens when that fails
- **related operations**: its inverse (create ↔ delete, reserve ↔ release), the
  steps before and after it in the same lifecycle, and copies of the same
  logic elsewhere

**2. Classes and sequences.** For each object:
- each input: valid classes, the boundaries (at, just below, just above),
  empty, **malformed** (present but not in the expected shape), unknown values
- each state: every valid transition, and one invalid per state
- each related operation: the sequences **A then B**, **B then A**, **A twice**,
  and what the result must be after each (a balance, a total, a status)
- each dependent: the contract it relies on still holds

**3. Expected result.** Take it from the strongest source there is: a
requirement example, else the task's agreed acceptance examples, else the
code's documented contract. A case no source settles is not yours to decide
silently: a value a user would see becomes a question (ask before building),
any other is marked `assumed` and reported.

**4. Level.** Pick the lowest level that can see the failure: unit for
calculations and rules, integration for stored data and services talking,
e2e only for a user completing a job, manual when it is judged by eye (say
why).

**5. Case table.** One line per case, so a reader sees what was considered:

```
| object | case | expected | source | level |
| row of the CSV import | 3 columns where 4 are expected | rejected, error names row 12 | asked: user | unit |
| cancel then ship | cancel order, then the courier scans it | scan refused, stock not deducted twice | requirement ex4 | integration |
```

An object with no case gets a line saying why it needs none.

**6. Tests.** Write them from the table and run them **before** the code
exists, each failing for the reason it guards. A test that passes before the
change proves nothing about it.

## Conventions of this kit

- **Every test case proves a requirement example**, or, where the project
  keeps no requirement for the behaviour, an example from the source in step
  3. A case that finds behaviour no source states is a gap: ask, or mark the
  example `assumed`. When a lasting product rule changes (T3), route the gap
  to the `requirements` skill, and write the design into the project's
  test-cases file (the role CLAUDE.md declares; default
  `docs/product/test-cases/<area>.md`), with each case's precondition, steps,
  data, expected outcome, example id and priority.
- A test that proves an example names it in its title (`REQ-…-NNN exN`, or
  `test_REQ_…_NNN_exN_…` in Python).
- Find UI elements by role, label or test id. Never by position. Never loosen
  an assertion, change an expected value or skip a test to turn a run green:
  if the test looks wrong, say why with evidence and leave it red.
- Manual runs are recorded in `.work/test-runs/*.json` with evidence.

## Start when

There is a behaviour to test, stated somewhere: a requirement's examples, the
task's agreed acceptance examples, or the code's documented contract. Start
from the strongest one; no requirement file is needed to begin.

## References

- Techniques with one worked case each, and the rules for test code
  (fixtures, waits, data): [reference/techniques.md](reference/techniques.md)
- Priority rubric and locator rules shared by the QA skills: the
  `../qa-foundations/SKILL.md`
