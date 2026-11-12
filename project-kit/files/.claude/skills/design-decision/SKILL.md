---
name: design-decision
description: Reaches and records a design or architecture decision - the question, criteria agreed before comparing, at least two options plus doing nothing, a decision brief, then an append-only record. Use when a choice is expensive to reverse or later work will build on it.
when_to_use: which should we use, choose between, should we switch to, architecture decision, ADR, trade-off, pick a library, pick a database
---

# Design decision

## Workflow

```
Decision <question>:
- [ ] 1. Question and why now; what happens if it is not made
- [ ] 2. Criteria agreed, with weights, before any option is compared
- [ ] 3. Options: two or more, plus do nothing, each with evidence
- [ ] 4. Compared against the criteria; what each makes hard later
- [ ] 5. Brief to the decider: recommendation first, the trade-off
- [ ] 6. Record written (append-only), linked from the spec
```

## Start when

A choice is expensive to reverse, or later work will build on it, and the
question and its context are known. A choice that is cheap and local needs no
record — decide it and note it in one line.

## Steps

1. **State the question and why now**: what forces the decision, what
   happens if it is not made.
2. **Agree the criteria first**, with weights if they differ (cost, risk,
   time, how hard to reverse, team skill). Criteria chosen after seeing the
   options tend to favour the option already liked.
3. **Options**: at least two, plus **do nothing**. For each, gather evidence
   (a spike under the Learn purpose, numbers, other projects), not opinion.
4. **Compare** against the criteria. Say what each option makes hard later.
5. **Brief** the person who decides in the decision-brief shape
   (Communication, Asking for a decision): recommendation first, the
   trade-off, what would change the recommendation.
6. **Record** the choice once made.

## Record

The decision records folder the project declares (default
`docs/product/decisions/NNNN-<name>.md`), next free number, template in
`_template.md`: status, date, deciders, context, decision, consequences
(good and bad), options rejected and why.

Records are only added, never edited. A later decision that replaces one gets
its own record with `Supersedes: NNNN`, and the old record gets one line
added at the top: `Superseded by NNNN`. That line is the only edit allowed.

## Links

If the decision changes behaviour, the requirement examples change through
the `requirements` skill. If it changes structure, update the project's architecture docs
(default `docs/product/architecture/`). The task that made the decision names
the record in its spec's Decisions section.
