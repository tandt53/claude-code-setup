# Writing a skill for this setup

The standard every skill in this repo is written and reviewed against: global
skills in `skills/`, project-kit skills in `project-kit/files/.claude/skills/`.
It is Anthropic's skill authoring guidance, with what this repo's own
measurements added. Sources are at the end. A skill that does not meet it is
a candidate for the retro skill's "Is a new skill the fix?".

## 1. Only what Claude does not already know

Anthropic's default assumption is "Claude is already very smart. Only add
context Claude doesn't already have." Every paragraph answers yes to "does
Claude really need this?".

Measured here (`docs/measurement-strategy.md` §7.7–7.9): skills that restate
general craft (test design techniques, TDD, debugging, review) loaded
reliably, in this kit and in obra/superpowers alike, and did not change the
final code. They cost 30–50% more per run. What a skill can add:

| Worth a skill | Not worth one |
|---|---|
| this kit's conventions: REQ ids, test naming, trace-check, where files live | definitions and catalogues of techniques the model knows |
| a **way of working** the model skips under pressure: which objects to analyse, in what order, what to check before done | prose explaining why a practice is good |
| a company's or team's conventions: error format, money, logging, release steps | anything one project's CLAUDE.md or `docs/product` can hold instead |
| a fragile procedure, a new or rare tool, a format the model gets wrong | |

## 2. Evaluate first, then write the least that fixes it

1. Run the plain model on representative tasks **without** the skill and write
   down where it fails. A skill with no observed failure to fix is not
   written.
2. Build at least three scenarios that reproduce those failures, and
   **screen each first**: run the plain model on it (3 runs) and keep only
   the ones it gets wrong. A scenario the plain model already passes cannot
   show a skill's value (measured: two held-out scenarios built without this
   check came back at the ceiling for every arm). In this repo
   that means a scenario under `measurement/ab/scenarios/` with hidden checks
   and a reference solution (`measurement/README.md`).
3. Measure the baseline: `bare`, and the setup without the skill.
4. Write the minimum instructions that make those scenarios pass.
5. Re-run with the skill and compare. Keep it only if it moves the failure.
   Test with every model it will run on (Haiku, Sonnet, Opus).
6. Watch real use. A skill that is never loaded, or a section never read, is
   removed or moved. `crawl.py` and `ab_multi.py report` count loads, and
   Claude Code's `/skill-doctor` lists skills never invoked.

## 3. Shape of SKILL.md

```markdown
---
name: <lowercase-hyphens, ≤ 64 chars>
description: <what it does, then "Use when …" with the words a user would say. Third person. Key use case first>
when_to_use: <optional: more trigger phrases or example requests>
---

# <Title>

## Workflow                      ← first, so it survives truncation
Copy this checklist and track it:
- [ ] Step 1: <find the objects: inputs, dependents, dependencies, related operations>
- [ ] Step 2: …
- [ ] Step N: <check before done: run the validator or the tests, quote the numbers>

**Step 1: …** what to look at, in order, and what to write down.

## Conventions of this kit      ← what the model cannot know
## Start when                   ← a state, with a fallback when an upstream artifact is missing
## References                   ← one level deep: see reference/<topic>.md
```

- **Description is the trigger.** Claude picks a skill from its `name` and
  `description`, and in Claude Code also `when_to_use`. The listing truncates
  `description` plus `when_to_use` at 1,536 characters, so the core use case
  goes first. Open with the task a user asks for ("Use when asked to write
  tests"), not with the process ("design the tests for one or more
  requirements").
- **Workflow first, with a copyable checklist.** Clear steps keep the model
  from skipping a step, and the checklist shows each step was done. After a
  compaction, Claude Code keeps only the first 5,000 tokens of each re-attached
  skill (25,000 in all), so the steps that matter come first.
- **Feedback loops.** Run validator → fix → re-run, until it passes.
  `trace-check` is this kit's example. A deterministic check is a script the
  skill runs, not code the model writes each time.
- **Degrees of freedom match the risk.** Give heuristics where many approaches
  are valid (a review), and an exact command or script where a slip breaks
  something (a migration).
- **Start when never dead-ends.** A missing upstream artifact (a requirement,
  a contract) is no reason not to begin: start from the strongest source there
  is, mark chosen values `assumed`, and go on. Measured: a gate on an artifact
  that is rarely there kept 19 of 20 project skills from ever loading.
- **Progressive disclosure.** `SKILL.md` stays under 500 lines and reads like
  a table of contents. Detail goes in reference files linked directly from it,
  never two levels deep, and a reference file over 100 lines opens with a
  table of contents. One skill loading another skill counts as two levels.
- **One term per thing, no dated statements, a default instead of a menu of
  options, concrete examples.**

## 4. Checklist before merging a skill

- [ ] An observed failure it fixes, with the scenario that reproduces it
- [ ] Baseline and with-skill results recorded (`measurement/ab/results/`)
- [ ] Description: what plus when, user's words, key use case first, third person
- [ ] Workflow with a copyable checklist at the top
- [ ] Nothing the model already knows; conventions and way of working only
- [ ] Start when has a fallback; no dead end on a missing artifact
- [ ] Under 500 lines; references one level deep
- [ ] Deterministic checks are scripts with clear errors
- [ ] Loads where expected in the scenarios (the report's "Skills loaded")
- [ ] Tested on each model it will run on

## Sources

- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) (Anthropic)
- [Skills in Claude Code](https://code.claude.com/docs/en/skills) (frontmatter fields, the 1,536-character listing cap, compaction budget, `/skill-doctor`)
- This repo's measurements: `docs/measurement-strategy.md` §7.7–7.9, `docs/rule-ledger.md`
