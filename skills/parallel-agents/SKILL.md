---
name: parallel-agents
description: Orchestrate a fan-out of parallel agents to build something larger than one agent's context, or to read and judge a list too long for one (grading, auditing, triage). Covers the phase shape, the three rules that keep concurrent writes safe, the review pass that finds the defects every individual agent misses, and the calibration that catches an agent that skimmed.
---

# Building with parallel agents

## The shape

```
Groundwork  →  Foundation  →  Fan-out (parallel)  →  Composition  →  Verify
```

**Groundwork and foundation are sequential.** Everything downstream depends on their
contract, and a contract discovered independently by six agents is six contracts.

**The fan-out is parallel, one directory per agent.** Wall-clock becomes the slowest
agent rather than the sum of all of them.

**Composition is a single agent.** Wiring is where the pieces meet; it cannot be split
without recreating the problem the fan-out solved.

**Verify is one agent that owns everything.** Not a formality — see below.

## Three rules that make concurrent writing safe

### 1. Absolute file ownership

An agent may create and edit only inside the directory its assignment names. Everything
else belongs to an agent writing to it at that moment. State this in every prompt, in
those words, and say who owns the rest.

Without it, two agents fix the same import in opposite directions and the last writer
silently wins.

### 2. A signature manifest between phases

Each agent returns **every export with its exact signature**. The next phase is handed
those manifests rather than told to go and read the source.

Downstream agents then build against a contract none of them has to rediscover, and the
prompts stay small enough to leave room for the actual work.

### 3. Name the binding decisions first, in a stated order

Open every prompt with the document that outranks the others, and say plainly that it
outranks them. Without that sentence agents follow whichever document they read last —
and the newest decisions are usually not in the oldest document.

## The verify agent is where the real defects are

Every agent passes its own tests. That is the problem, not the reassurance. Give the
verify agent this checklist; each entry is a defect that survived a fully green suite:

- **The same rule implemented twice, disagreeing** on an edge case neither owner saw.
- **A hand-written stub of a real module living in a test helper**, which every test in
  that area was silently verifying against instead of the shipped implementation.
- **A copy that drifted from its original**, and now crashes on input the original
  handles.
- **Two sources of truth** — one layer mutating storage without telling the layer that
  caches it.
- **An interface no implementation can satisfy**, declared by one agent and never wired
  by anyone.
- **Import or load order changing behaviour**, which type checking cannot see at all.
- **Anything a project-wide rule forbids** that a single-directory agent had no reason
  to check.

**The orchestrator's own findings get the same check.** A finding or rule you add
yourself (a merge rule, "this is not built, remove it") goes to the verifier or reviewer
with the agents' findings before an agent applies it to the files. Seen: twice in one
audit, an orchestrator's instruction to the merge agents was wrong — a merge rule that
contradicted the project's own convention, and an AC removed as "not built" because no
code read the field, though the object holding it was stored whole — and both reached
the files before the reviewer caught them.

## When the fan-out reads and judges many items

Grading, auditing or triaging a long list splits it into parts, one agent
each. The defect here is not in code: an agent that skims grades each item
from its first lines, and its results look exactly like careful ones. Before
merging the parts:

1. **Every agent reports its reading**: how many of its N items it read in
   full, every field included, and whether a script produced any result (and
   if so, the script). A part that read fewer than all, or used a script, is
   opened before it is trusted. A script that holds a verdict written for each
   item can stand; one that derives verdicts from a prefix or a keyword cannot.
2. **Calibrate every part.** Draw 5–10 items at random from each part and
   give them, with the full text and the grading rules but without the first
   agent's results, to a different agent to grade again.
3. **Re-grade a part that disagrees.** When the key field (the harm level, the
   verdict) differs on more than one in five sampled items (3 or more of 10),
   a new agent grades that whole part again.
4. **Read one or two items of every part yourself**, against that part's
   results.

Calibration measures the graders the way seeded bugs measure a reviewer (the
review skill, Calibrating the reviewer). Seen: four agents graded 600 items
"Recommend: fix code". One said, unasked, that it had read only the first
150–260 characters of each item and skipped the `why` field: its part was
graded again, and it was caught only because it said so. Another produced its
results with a script; it held a verdict written for each item and could
stand, but that was known only after opening it.

## Writing the prompts

- Name what to implement precisely, and say to read those sections **in full**.
- State the gates that will reject the work, so the agent runs them itself rather than
  discovering them at review.
- Say what tests to write and at which level, and give the edge cases **by name**. "Test
  the happy path" produces tests that assert nothing.
- Forbid explicitly what you do not want: new dependencies, escape hatches in the type
  system, TODO comments left behind.
- Say to run checks in the foreground: the named test classes while working, the whole
  suite once at the end. An agent that ends its turn with a run still going is listed as
  completed while that run holds the build folder, and the user sees nothing running.
  Seen: a test writer left `mvn test` going, and the user wrote that they could see no
  agent running. (The verify skill holds the same time limit for mutation runs.)
- Ask for what you actually need back: the manifest, what was implemented, the test
  count, and **what the specification left ambiguous with the choice made**. That last
  one surfaces at review the decisions you would otherwise discover at integration.
  An agent that reads items also reports how many of its N it read in full and
  whether a script produced any result (When the fan-out reads and judges many
  items, above).

## Cost and recovery

Keep concurrency under about 16; beyond that they queue. Where the runner supports
resuming a run, edit the script and replay — unchanged agents return from cache and
only what you changed re-runs, which turns a thirteen-agent research phase into a
one-agent revision.
