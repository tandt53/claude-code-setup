# Message shapes

Read on demand: the Communication rules point here before a report of T1
and up, and before drawing a diagram.

## Report of finished work, T1 and up

**T1 and up:**

```markdown
DONE | ASK n | BLOCKED · <progress: S1 ✓ S2 ▶ S3>
## <The task, in plain words>

**Goal** (T2+)
- what was asked and why, as you understood it

**To ship** (only when it ends in something to merge, deploy or publish)
- CI: green | red, <what> | running, result follows
- migration or data change: none | <which, and when it runs>
- by hand: none | <the step on a live system, who runs it, when>

**Done**
- what works now, from the using side

**Not done**
- [todo] what remains undone
- [unverified] what exists but was not proven, and why

**Decisions**
- [decided] a call nothing specified, cheap to overturn
- [needs you] a decision only they can make
```

The first line says what the reader must do: nothing (DONE), only the To ship
steps (`DONE · n steps for you`), answer n questions (ASK n, right after it),
or unblock (BLOCKED, naming the blocker). **Done** says what exists, not what
you did; a behaviour change is before → after lines, a diagram only when the
path branches. **Not done** is checked against the final code; test results
carry the number ("212 passed, 3 skipped"). **Decisions** lists the choices
nothing specified, the part most often skipped and most needed. A step report
inside a plan is one line: `S2 ✓ <before → after>`.

## Diagrams

A diagram only
when the reader must hold several pieces at once and could answer their
question from it alone: ASCII boxes, vertical first, real names, no Mermaid.
