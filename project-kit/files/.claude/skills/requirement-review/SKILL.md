---
name: requirement-review
description: Finds what a request or requirement leaves open before anyone builds or tests it - ambiguous terms, missing edge cases, inputs whose bad cases are unspecified, unconfirmed assumptions, criteria no one could verify - and returns them as ranked questions, each with a recommended answer. Use when a request leaves things open, before building or testing it; works on a raw request as well as a written requirement.
when_to_use: what about the edge cases, is this ready to build, the request is vague, before implementing a feature, review the requirement, what should happen when, unclear spec
---

# Clarify requirements

A requirement is ready only when a developer and a tester could both work from it
without inventing anything. This skill finds what they would have to invent, before
the cost of inventing it lands in code or a test. It does not write the requirement
(`requirements`) or test it (`test-design`): it hands back the questions.

## Workflow

Copy this checklist and tick it for the request in front of you:

```
Review <request>:
- [ ] 1. Each criterion is one claim (split "X, so Y")
- [ ] 2. Each criterion proves a user benefit, not only that code runs
- [ ] 3. Every term, unit, role and state is defined
- [ ] 4. Edge cases: boundary, zero / one / limit / one over, empty, invalid, each failure path, old records
- [ ] 5. Every input's bad cases have a stated result: malformed, empty, smallest size, cut off, no answer
- [ ] 6. Every `assumed` or reverse-engineered example listed
- [ ] 7. No two examples contradict each other or another requirement
- [ ] 8. Read from each angle: data / shape, build, test
- [ ] 9. Ranked questions, each with a recommended answer and what would close it
```

## Start when

A request or requirement is about to be built or tested, and something in it
is unclear, or it feels ready and you want to be sure before the expensive
work begins. A written requirement is not needed: a raw request is enough.

## What to look for — each becomes a question

1. **One criterion, one claim.** A criterion that joins a mechanism to an outcome
   is two claims, and they fail apart. "The Add button is disabled, *so* a second
   click cannot send a second request" — a build that disables the button still
   submits twice on Enter; a test asserts the easy half (the button is disabled),
   the suite goes green, and the user gets two rows. The outcome is the criterion;
   the mechanism is only *feature presence* (the AC quality spectrum in `../qa-foundations/SKILL.md`). Watch
   for `so`, `so that`, `which means`, `and therefore` — each joins something
   observable to something someone hoped would follow. Split it.
2. **Too weak to matter.** A criterion that only proves code runs ("returns 200")
   rather than that a user benefits — grade each on the AC quality spectrum
   (`../qa-foundations/SKILL.md`) and flag the ones stuck at code-existence or feature-presence.
3. **Ambiguous or undefined terms** — "fast", "recent", "notify" with no channel
   or threshold; a number with no unit; a role or state never defined.
4. **Missing edge cases** — the boundary, zero / one / the limit / one over, the
   empty case, invalid or missing input, each failure path, and records made under
   the old rule.
5. **An input whose bad-case behaviour is unspecified** — a file, source, stored
   value or argument that could be malformed, empty, at the smallest size the code
   must still handle, or (when fetched) cut off midway or never answering. The
   requirement states the result for each, or it is a question.
6. **Unconfirmed assumptions** — every example marked `assumed`, every value that
   came from you not the owner, and every example tagged `reverse-engineered`
   (transcribed from existing code, so it describes what was built, not what was
   wanted). These block a release.
7. **Contradictions** — two examples that cannot both hold, or one that conflicts
   with another requirement.

## The three angles (step 8)

- **Data / shape.** What entity, field or endpoint does this require that does not
  exist yet? Can two criteria both be true of the same record at the same time? Is
  there an ordering or transaction boundary it relies on but never states?
- **Build.** Is any criterion unimplementable as written, or ambiguous about who
  computes what? For each value the result shows, does the requirement say where
  that value comes from?
- **Test.** Could a tester watch each criterion pass or fail? Does it name *every*
  error case, or only the common ones? Is it only assertable once rewritten as a
  prohibition ("must never…")?

## Output

A ranked list of open questions, costliest-to-ignore first. Each names what a user
would see, who decides, and — the discipline worth keeping — **what answer would
make it stop being a question**, so the owner knows exactly what to resolve. Then a
readiness verdict: ready to build and test, or blocked on N questions. A gap that
needs a new example routes to `requirements`; a choice expensive to reverse routes
to `design-decision`. Do not answer the questions yourself and do not edit the
requirement — surfacing them is the whole job (Communication, Report of finished
work).
