---
name: qa-sweep
description: Find out what a web app actually does by driving it in a real browser and measuring, then write the findings down. Use when asked whether features work, before calling a milestone done, or after any change touching layout, focus or rendering. Never decide from source.
---

# QA sweep — measure the app, do not read it

Exploratory verification: drive the running app, find out what a person actually
gets, and write it down. It is not the example-driven pipeline (`test-design` →
`test-execution`, which tests against known examples); it is the sweep that finds
what no example named. It shares the QA stance in `../qa-foundations/SKILL.md` — the running
system is output and fair game, its source is off-limits — and ends every finding
the way `visual-review` does: a measurement, never an impression.

## Start when

You need to know whether features actually work — before a milestone is called
done, after a change touching layout, focus or rendering, or when asked "does X
work?". No running app to drive → there is nothing to sweep.

## The rule

Never conclude a feature works or fails by reading code. Start it, use it, measure
it. A code path that looks correct and a screen that behaves correctly are
different claims; only the second one ships.

## Setup

Drive the running dev server, or build and preview (the driver is the stack's —
e.g. `playwright-cli`). Give each check a fresh browser context so storage starts
empty and the app initialises the way a first run does.

## Four rules that make a finding worth anything

- **Query by role and accessible name only** — never a CSS class or a test-id. A
  control your query cannot reach is one a screen reader cannot reach; the query
  style is part of the test, and a role query that cannot find something is itself
  a finding. (Stricter than the authoring locator priority in `../qa-foundations/SKILL.md`,
  on purpose: a sweep tests reach, not just stability.)
- **Reopen from a known state before every check** — panels close, focus moves, a
  previous step leaves the app somewhere you did not expect. A sweep run without
  this once reported five failures, three of them its own fault.
- **Measure, do not eyeball** — bounding boxes for layout, computed styles for
  tokens, element counts for rendering. "Looks right" and "looks wrong" are both
  non-findings (`visual-review`).
- **Use content in every script the product supports** — accent and diacritic
  folding is the part most likely to be wrong and least likely to be noticed.

## Triage before you write anything down

A red result is a hypothesis; prove it is the product, not the probe. Dump what
the surface exposes — every control with its role, name and position — and check
your selector against reality. A control that will not respond → ask the DOM why
(disabled? pointer-events? what does a hit test at its centre return?). A shortcut
that does nothing → check where focus is; a key pressed in a text field is a
character. Something that will not render → check whether the data exists: a
counter that increments while the text never appears is a render bug, not a write
bug. Report a false alarm as a false alarm, in writing — chasing one twice costs a
round trip and the trust in the whole sweep.

## Write it down, then make it permanent

Report in the finished-work shape (Communication, Report of finished work):
counts (checks run, passed, real defects, console and page errors); each defect as
**what a person sees** first, then the measurement, then the reading, ranked by
the cost of ignoring; **why nothing caught it** — which test exists and what it
asserts instead (usually the most useful line, because it names the next test to
write); what passed; earlier false alarms; what this pass did not cover. Then turn
each defect a person found into an automated check that **measures** — route it
through `bug-report` as a failing test named for the example. Asserting a bounding
box is identical between two states beats asserting a screenshot looks the same,
because it says what broke.
