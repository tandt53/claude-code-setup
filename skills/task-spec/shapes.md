# Task spec: shapes

Read the shape you are about to write, before writing it.

## Shapes

### Spec

```markdown
# <The task, in plain words>

## Goal
What it achieves and why, in two or three lines.

## Scope
- In: …
- Out: … (what a reader might assume is included but is not)

## Where
Files, modules, sources or people involved, as paths or names.

## In the map
(only for a slice) <map path> · after: S1 · before: S4 · must not break: <what>

## What correct means
Either acceptance examples:
- <given this state> → <when this happens> → <this exact result>
- <the edge case> → …
Or the reference it is judged against: agreed criteria, the previous version,
properties that must hold, a draft the user approves.

## Decisions
- <choice made> — because <reason>; rejected <alternative> because <reason>

## Open questions
- <anything still undecided, and who decides>

## Done when
<one check that can be run or looked at, and what it must show>
```

A project may extend this shape in its own CLAUDE.md (a software project adds
a Changes section naming the requirement IDs the task adds or modifies).

### Plan

```markdown
## <The task, in plain words> — plan

**Goal**
- what is asked and why

**Steps**
- S1 <the result that exists after this step>
- S2 ...

**Decide first**
- decisions to settle before starting, each briefed (Communication, Asking
  for a decision)

**Out of scope**
- what this plan will not do
```

Each step names the result they could see or test after it, not the
activity. **Inputs**: every input the work reads gets, in the step that reads
it, what happens when it is malformed, empty, at the smallest size, and for
anything fetched, cut off or never answering; or it is listed Out of scope.
A step promising text a user will see quotes it with its source, or marks it
`assumed`. A revised plan shows the same shape with changes marked, and why.

### Map

A request split into slices (Workflow, Where to stop): one approval for the
whole, then the slices run. Saved as the map in its task folder; each slice's
spec points back to it. Rewritten as slices finish.

```markdown
# Map: <the request, in plain words>        S1 ✓ S2 ▶ S3 S4

- S1 <one user-visible result> · after: — · touches: <modules, REQ ids>
- S2 <…> · after: S1 · touches: <…>
- S3 <…> · after: S1 · touches: <…> · hard to undo: <what>

Untouched: <what a reader might expect to change and does not>

Decide first:
- Q1 <question, naming what they would see> · a <…> · b <…> · rec: a
```

Each slice is one line at the zoom of the whole: what a user gets, not how.
Order is dependency order, riskiest first among the independent ones. Every
question carries a recommended pick, so `ok` answers them all. Once answered,
a question leaves the map: its answer goes into the Decisions of the spec it
affects, and the map keeps no history. A decision written in two files drifts.
