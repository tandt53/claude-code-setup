---
name: task-spec
description: Write the contract for one task - a self-contained spec saying what correct means - before planning it, or find a reference when no one can state the expected result; also holds the shapes of a plan and a map of slices. Use when the work will outlive this session, when it needs a plan or a map (more than one change or deliverable), or whenever "correct" is unclear.
---

# Task spec

A task spec is the contract for **one** task: what it achieves, what
correct means, how to know it is done. The examples or reference it states
are what every later check is judged against, and the one check that catches
a misread request. Time the user spends here pays back more than time spent
reviewing the result.

It is not a product requirement and not a description of the whole product. A
requirement is a lasting rule the product keeps, with a stable id; a task spec
is the contract for the single piece of work in front of you, and it is thrown
away when that work is done. Where a project keeps lasting requirements (its
CLAUDE.md says where and how they are numbered), the task spec **references**
them and never renumbers them or restates them.

## Where it lives

The spec, in the task folder. Chat is not memory: a later session starts
from the spec, the commits and the pull request. The work
folder may be hidden, so read and write these files by path.

## Self-contained

A fresh session that reads only the spec, with no chat history, can do the
work and prove it is done. Use the spec shape (below, Shapes):
- the goal, and why it matters
- scope, and what is out of it (what a reader might assume is included)
- the files, modules, sources or people involved
- for a slice, its place in the map: the map, the slices before and after,
  what must not break. The map's decisions are inherited, so the spec asks
  only for new assumed values a user would see
- **what correct means**: concrete examples with real values ("an order of
  100,000 VND with a 10% coupon that expired yesterday"), each edge case its
  own; or the reference the result is judged against
- the decisions already made, with the reason and the rejected alternative
- open questions, and who decides them
- one check that can be run or looked at, and what it must show

If the project's CLAUDE.md extends the shape (for example a Changes section
naming requirement IDs), follow it.

## Writing it

1. Gather context first (Workflow, Gathering context), including lessons
   whose tags match the task.
2. Interview the user only for what the request and the sources do not
   answer. Ask about the hard parts: edge cases, trade-offs, existing data,
   what happens on failure. One question at a time when the answer changes
   the next.
3. Every assumption becomes a concrete example marked `assumed`. Confirming
   examples is cheaper for the user than writing requirements.
   **Every input the work reads** (a file, a network source, stored data, a
   user argument) gets examples for what goes wrong with it: a malformed
   record, empty, the smallest size the code must still handle, and, for
   anything fetched, a connection cut off midway or one that never answers.
   State the result for each, or list it under Out.
4. **Check what an example says already exists** (a label, a sentence, a
   number, a count in a file or a system) against that source itself before
   presenting, and name the source beside it. Memory of the file, a text
   dump or one run is not the source, and neither is another document's
   `assumed` example: quoting one keeps it `assumed`. An example not checked
   is `assumed`. The same holds for any quote in a plan or a report
   (Communication, Say how sure you are, and how you know).
   The same holds for a Decision or Out line saying how a library or a
   permission behaves, and for a command the spec tells someone to run: run it
   first, or mark it `assumed` (verify skill, Evidence rules).
   A count (files, tests, cases, steps) comes from a command that counts
   (`ls … | wc -l`, the test runner's own total), quoted beside it, never
   from arithmetic in your head.
5. **For a slice, read the earlier slices' specs** on the files and keys this
   one touches (`grep` them for the names the new examples use), and settle
   any example that contradicts one there in this spec: change one of them
   and say which in Decisions.
6. **Fresh-session test**: read the spec as if nothing else existed. Every
   question you would need to ask is a gap. Fill it, or list it as open.
7. Present the spec, What correct means first as before → after lines (a
   diagram only when the flow branches), and wait for approval. A slice under
   an approved map waits only when it holds an assumed value a user would
   see; otherwise one line, and go on.

## When the expected result is unclear

Where no one can state the exact result, pick another reference (current
behaviour, another implementation, properties that must hold, how outputs
must relate, existing docs, agreed criteria, a draft) as described in
`references.md` beside this file, and name it in the spec. With none, the
work is reported `[unverified: no reference]`, never done.

Reversible assumptions may proceed and are reported as decisions.
Irreversible ones wait for the user.

## Decision records

A decision that is expensive to reverse, or that later work builds on, also
gets a record: how and where is in `references.md` beside this file.

## Shapes

The spec, plan and map shapes are in `shapes.md` beside this file.
Read the one you are about to write before writing it.

## Done

The task is done when the spec's check passes and anything lasting the task
changed (requirements, product docs) has been updated. The task folder stays
as the record; the retro skill reads its spec.
