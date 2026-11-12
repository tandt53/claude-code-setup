---
name: review-work
description: Review anything - a diff, PR, spec, running feature, codebase or migration - against a stated reference, in a fresh context, reporting only findings that matter. Use after the last step of a planned task (more than one change) or whenever a review is asked for.
---

# Review

## Four framing questions

Every review, whatever it is called, first states:

1. **Object**: what is under review (a diff, a spec, a running feature, a
   codebase, a migration…).
2. **Reference**: what it is judged against (the spec and its acceptance
   examples, the plan, the rules, the previous version, how it behaves when
   run). With none, find one as in the spec skill, state it, and have it
   confirmed first when the review is expensive.
3. **Zoom**: lines, behaviour, or system. Work at the level the question
   lives at; go one level down only to prove a finding.
4. **Costliest failure**: doing the wrong thing, something missing, something
   hard to change later (APIs, data models, architecture), or risk
   (security, data loss, performance). Spend attention in that order. Leave
   style to tools.

Examples of the same reasoning:

| Review | Object | Reference | Zoom | Costliest failure |
|---|---|---|---|---|
| PR | diff | spec, plan | lines → behaviour | wrong logic, missing branch |
| Feature | running app | acceptance examples | behaviour | a user cannot do the job |
| Project | code + git history | intended architecture | system | hotspots: complex code changed often |
| Spec | document | what the user actually needs | behaviour | building the wrong thing |
| Migration | script + real data | target schema, old data | data | data loss, no rollback |

## Independence

Review in a fresh context, not the one that produced the work: use the
reviewer subagent. Give it the object and the reference only, never the
reasoning that produced the work, and ask it to **refute** the result, not to
confirm it. When possible, a different model reviews, since a model tends to
rate text like its own more highly.

## Doing it

Gather evidence breadth-first to map, then depth-first to prove
(Workflow, Gathering context). Run it, run the tests, trace the path. Look
for what is not in the diff: missing branches, other callers, old data, rules
without a test. For a project, rank by hotspots (change frequency ×
complexity from git history) and look for files that always change together.

## Reporting

Use the review shape:

```markdown
## Review: <object> against <reference>

**Verdict**
- one line: ready / ready after the blocking items / not ready, and why

**Findings**
- `issue (blocking)` file:line: <input or situation> → <wrong result>
- `suggestion (non-blocking)` file:line: <what>, because <why it matters>
- `question` file:line: <what is unclear>

**Not checked**
- <what was not examined, and why>

**Recurring**
- <a finding seen before>, and the rule or check that would stop it
```

The four framing answers sit in the heading and verdict. Findings are ranked
by the cost of ignoring them. No praise section and no style findings: tools
handle style. Every `issue` has a
concrete failure scenario (this input, this wrong result) and the `file:line`
the reviewer read to reach it, including, for something said to be missing,
where it would be. Without them it is a `question`.

Before acting on a review, check each `issue` yourself: reopen the lines it
cites and the code around them, and confirm the failure scenario holds. One
that does not is rejected in the report, with the lines that refute it.
Seen: a reviewer's `issue` said a component was used outside its provider;
the provider wrapped the whole layout, and only the orchestrator's own check
stopped the "fix".

Report only what affects correctness, the reference, or the costliest
failure. A reviewer asked to find problems always finds some; chasing every
one leads to over-engineering. Rank by the cost of ignoring. Say what was not
checked. A finding seen before goes under Recurring, with the check that
would stop it.

## Calibrating the reviewer

To learn how far a reviewer can be trusted, seed it: put two or three known,
realistic bugs into a copy of the object and count how many it finds. If it
finds 2 of 3 seeded bugs and 6 real ones, expect about 3 real ones still
unfound. Remove the seeded bugs afterwards.
