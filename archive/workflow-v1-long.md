# Workflow

How to carry out work. How to write about it is set in communication.md:
when a rule below says to report, plan, spec, review or ask, use the shape
defined there.

```
gather context ─→ size the task ─small─→ do it ──────────────┐
                       │large                                 │
                       ▼                                      ▼
                  spec ◀approve─→ plan ◀approve─→ steps ─→ verify ─→ review
                   (acceptance examples                                │
                    = the reference)       recurring finding → new check ◀┘
```

## 1. Gathering context

For exploring, planning, debugging and reviewing alike: breadth to map,
depth to prove.

1. **Map wide and shallow.** List what is involved (files, entry points,
   callers, tests, data) without reading deeply. Use a subagent when the map
   needs many files, so the main context stays free for depth.
2. **Rank** by cost of being wrong × likelihood of being wrong.
3. **Go deep on the top item**, following one path end to end in the order
   data flows.
4. **At each point on that path, look wide again**: other branches, other
   callers, error paths, old data. Most missing-case bugs are found here.
5. **Stop** when reading more no longer changes the conclusion, or the budget
   is spent. Say what was not examined.

## 2. Sizing the task

If the change can be described in one sentence, do it directly. Otherwise
write a spec, then a plan.

Split into steps when the task changes more than one behaviour, contains a
decision that is theirs to make, or would produce a diff too large to review
in one sitting. Splitting a simple task adds stops and nothing else.

## 3. Spec before plan

A spec must be **self-contained**: a fresh session that reads only the spec,
with no chat history, can build the thing and prove it is done. It states the
goal and why, the scope and what is out of it, the files and interfaces
involved, the rules, **concrete acceptance examples**, the decisions already
made, and an end-to-end check.

- Interview the user for what the request and the code do not answer. Ask
  about the hard parts: edge cases, trade-offs, existing data.
- Save it as a file in the project (where the project keeps specs, otherwise
  `docs/specs/<name>.md`). Chat is not memory.
- Test it: would a fresh session need to ask anything? Each question it
  would ask is a gap to fill.
- Present it and write no plan until it is approved.

**The approved acceptance examples are the reference for everything after.**
They are the one check no AI can pass by misreading the request, so the
user's review time is best spent here, not on the code.

An architectural decision (one that is expensive to reverse, or that later
work will depend on) also gets a short decision record: context, decision,
consequences, alternatives rejected.

### When the expected result is unclear

Never fill a gap silently. Turn each assumption into a concrete example,
mark it `assumed` in the spec, and ask the user to confirm the examples:
confirming examples is cheaper for them than writing a spec. Reversible
assumptions may proceed and are reported as decisions. Irreversible ones wait.

Where no one can state the exact result, find another reference:
- **current behaviour**, recorded before changing it (characterization tests)
- **another implementation**, old or reference, run on the same inputs
  (differential testing)
- **properties that must always hold**: totals never negative,
  decode(encode(x)) = x, the product of the factors equals the input
  (property-based testing)
- **how outputs must relate** when inputs change in a known way: adding an
  item never lowers the total (metamorphic testing)
- **existing code, docs or tickets** that already answer the question
- **a quick draft** the user can look at and judge

If none exists, the work is `[unverified: no reference]`, never done.

## 4. Plan and steps

**Plan, then wait.** Present the plan and write no code until it is
approved. Each step leaves the code working and can be reviewed on its own.
Put the riskiest step first: whatever could invalidate the plan is checked
before anything is built on it.

**Each step.** Write the tests from the acceptance examples first and watch
them fail, then write the code. Present the approach first only if the step
contains a decision the spec and plan did not settle. Otherwise do the step,
verify it, report it, and stop for review.

**When the plan turns out wrong**, stop and present the revised plan. Do not
quietly continue on a different plan.

## 5. Deciding alone or asking

Decide alone what is reversible and invisible: naming, file placement,
ordering, refactors within a file. Report it as a decision you made.

Ask when it changes something the user sees, changes the data model, or is
expensive to undo. Ask one decision at a time. Group two only when the first
changes what the second means.

## 6. Scope

Deliver what was asked, at the scope asked. No cleanup, refactoring, docs or
adjacent features that were not requested.

Finding something else broken is a report, not a licence to fix it.

## 7. Verifying

**Done** is when the spec's end-to-end check passes, the tests and the type
check are clean, and the change has been run for real where it can be. Show
the evidence (the command and its result, a screenshot); do not assert.

### Independence

A check is only as independent as its reference. When one context reads the
request, writes the tests and writes the code, a misunderstanding passes every
check, and a model re-reading its own work tends to approve it. So:
- The reference is the acceptance examples the user approved (§3).
- Tests come from those examples, before the code. On a large task, write
  them in a separate context from the one that writes the code.
- Add property tests for the invariants the spec implies. An example test can
  share the code's mistake; a property rarely does.
- Run the real thing wherever possible. Reality shares no one's assumptions.
- Review in a fresh context (§8).

### Check the checks

A check that has never been seen to fail is not yet trusted. For each check
the result relies on (a test, a reviewer, a validator, a hook, an alert):

1. Name the failure it exists to catch, in the user's terms.
2. Make one realistic instance of that failure: change the code, the data,
   the expected value or the diff so the failure is really there. Work on a
   copy or a branch.
3. Run the check. It must reject the broken version and accept the real one.
4. If it accepts the broken version, it is blind to that failure: strengthen
   it, and report the gap.
5. Remove the injected failure and confirm it is gone.

For code, this is mutation testing (Stryker, PIT, mutmut, cargo-mutants): run
it on the changed code where being wrong is expensive (business rules,
permissions, money, data), and read each surviving mutant as a missing test.
Do not chase the score. A change that does not alter behaviour is not a
failure, and a check that ignores it is right to.

### Evidence rules

- Never claim a test passes without running it.
- Never call a failure pre-existing without checking the base state.
- A check that could not run is not a check that passed.
- Know why a check is green. One that passes for a reason unrelated to its
  claim is worse than one that fails, because it certifies whatever it is
  handed.
- Before reporting what is not done, check each item against the final code,
  not against earlier messages or the plan.
- Commit one logical change at a time. The message says why, and what was
  rejected: the diff already says what, and the log is the context that
  outlives every chat.

## 8. Reviewing

Any review, whatever it is called, starts by stating four things:

1. **Object**: what is under review (a diff, a spec, a running feature, a
   codebase, a migration…).
2. **Reference**: what it is judged against (the spec, the plan, the rules,
   the previous version, how it behaves when run). With no reference, find
   one as in §3, state it, and have it confirmed first when the review is
   expensive.
3. **Zoom**: lines, behaviour, or system. Work at the level the question
   lives at. Go one level down only to prove a finding.
4. **Costliest failure**: doing the wrong thing, something missing,
   something hard to change later (APIs, data models, architecture), or risk
   (security, data loss, performance). Spend attention in that order of cost.
   Leave style to tools.

Then gather evidence as in §1: run it, run the tests, trace the path, look
for what is not there. Review in a fresh context from the one that produced
the work, and see only the result and the reference, not the reasoning that
produced it. Ask it to refute the result, not to confirm it.

Report only what affects correctness, the reference, or the costliest
failure. A reviewer asked to find problems always finds some, and chasing
every one leads to over-engineering. Say what was not checked.

To learn how far an AI reviewer can be trusted, seed it: put two or three
known, realistic bugs into a copy of the diff and see how many it finds.

## 9. Learning from repeats

A mistake or review finding seen a second time is a missing rule or check.
Propose the smallest fix that stops it recurring, preferring a check that
runs over a rule that must be remembered: a test, a lint, a hook, then a line
in CLAUDE.md. Then check that new check as in §7: show it failing on the
mistake it exists to stop.

## 10. Sessions and context

- One task per session. Unrelated work starts a fresh one.
- For multi-step work, each step can start fresh from the spec and plan
  files. Those files carry the context, not the conversation.
- After two failed corrections on the same issue, stop and say so. Suggest
  a fresh session, and write the better starting prompt: the task plus what
  the failed attempts taught.
