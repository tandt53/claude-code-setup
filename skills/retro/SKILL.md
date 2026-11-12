---
name: retro
description: Turn what went wrong or surprised during a task into lessons, and promote a lesson seen twice into a check or rule, with a new skill as the last resort and only on evidence. Use at the end of a task that held a surprise (a correction, a failed check, a plan that changed), after an incident, when asked for a retro, and before adding a skill or an always-loaded rule, or when one looks unused.
---

# Retro

Each session starts with an empty memory, so "a mistake seen twice becomes a
check" only works if mistakes are written down somewhere that outlives the
task. The spec, the commits and the pull request hold what happened in one task. The lessons files hold
what is worth remembering across tasks. This skill moves the second out of
the first.

## Inputs

- the spec, read by path, and the task's commits and pull request
- review findings, and the user's corrections in the conversation
- both lessons files, read by path (the work folder may be hidden, and search
  may skip it):
  - the project lessons: the project's domain, code and data
  - the personal lessons: how Claude works, in any project

## What counts as a lesson

Only surprises, things that went differently from what was expected:
- an assumption that turned out wrong
- a plan that had to change
- a finding the reviewer caught
- a check found blind (a surviving mutant, a hook that did not block)
- a correction the user had to make
- something that took far longer than planned, and why

Not a lesson: what went as planned, a summary of the work, a list of steps.
A task with no surprises adds nothing; say so and stop.

## Steps

1. List the surprises from the inputs, one line each, with the cause.
2. For each, decide where it belongs: the project (domain, code, data, team)
   or Claude's way of working (guessing instead of asking, claiming done
   early, over-reaching scope).
3. Search that file for an entry on the same thing. Match by meaning and tags,
   not wording.
4. **New**: add an entry in the lesson shape (below, Lesson entry),
   `Seen: 1 · Status: watching`.
5. **Seen before**: increase the count. At two or more, **propose a
   promotion**: the smallest change that stops it recurring, preferring what
   runs over what must be remembered:
   1. a test or a validation
   2. a lint rule or a hook
   3. a question the relevant skill must always ask
   4. a line in CLAUDE.md, only if nothing above can catch it
   5. a new skill, last, and only when **Is a new skill the fix?** (below)
      says yes
   Show the new check failing on the mistake before calling it done. Once the
   user accepts it, mark the entry `promoted → <what, where>`.
6. Report in the finished-work shape (Communication, Report of finished
   work): lessons added, counts raised, promotions proposed.
   A promotion changes the user's rules or checks, so it waits for approval.

## Is a new skill the fix?

Measured on this setup (the A/B harness, about 1,500 runs): process and
craft skills, this kit's and a widely used public one alike, changed how the
work was done but not the final code, on tasks the base model already does
well, and each added cost on every session they were listed in. So a skill
or a new always-loaded rule is the last fix, never the first. Before
proposing one, answer each:

1. **Is the failure real and repeated?** Seen at least twice, on real tasks,
   with the run or the correction it came from. One surprise is a lesson,
   not a skill.
2. **Does something already cover it?** Search the skills, the workflow and
   the project's instructions. If one does, find out why it did not act: it
   did not fire (fix its trigger: the description opens with the task, its
   Start when does not wait for an artifact that is rarely there) or it fired
   and did not help (fix its content). Neither is a new skill.
3. **Would a smaller fix stop it?** A test, a hook or a line in an existing
   skill (the list above) beats a new skill whenever it can catch the
   mistake.
4. **Does the skill hold what the model lacks?** Project facts, house
   conventions, a tool's quirks, a procedure the model gets wrong: yes. Craft
   the model already knows (TDD, debugging, review, boundary values)
   restated: no. It costs and moves nothing.
5. **How will it be shown to work?** Name the check: the mistake reproduced
   and caught, or an A/B scenario where the plain model fails and the skill
   fixes it, run before and after. Without one, propose the smaller fix.

When a skill is the fix, write or rewrite it to the repository's skill
authoring standard (in this setup's docs): workflow with a checklist first,
only what the model lacks, a Start when with a fallback, evaluated before and
after.

**The same test runs backwards.** A skill or rule that the counts show is
never loaded, or whose removal changes nothing measured, is proposed for
removal or folding into a line elsewhere, with the evidence, and waits for
approval like any promotion.

## Keeping the files useful

- Newest first. One entry per lesson; repeats raise the count.
- Tags name the area and the kind of mistake, so the Context phase of a later
  task can find the entries that concern it.
- A promoted lesson stays, marked, as the reason its check exists.
- Merge entries that turn out to be the same lesson.

## Lesson entry

One entry per surprise, in the project lessons (about the project: domain,
code, data) or the personal lessons (about how Claude works). Newest first.

```markdown
- <yyyy-mm-dd> · <task> · #<tag> #<tag>
  <what happened, in one line>. Cause: <why, in one line>.
  Seen: <n> · Status: watching | promoted → <the check or rule added, and where>
```

Tags name the area and the kind of mistake (`#money`, `#migration`,
`#assumption`, `#claimed-done`), so a later task can find the entries that
concern it. When the same lesson is seen again, update the existing entry's
count rather than adding a new one.
