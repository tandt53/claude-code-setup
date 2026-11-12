---
name: solution-architecture
description: Decides and records how the system is built before its interfaces are specified - components and their one responsibility each, the tech stack and why, the cross-cutting patterns implementers follow, and what a change must not break. Use at the start of a feature that adds or changes structure, before api-contract and the build.
when_to_use: new service, new component, how should we structure, architecture, add a module, split the service, which stack, cross-cutting, restructure
---

# Solution architecture

The shape of the system, above the contracts. It decides what components exist
and how they connect; `api-contract` then specifies the exact interfaces between
them, and `backend` / `frontend` build to both. Implementers make
no structural choice — they read this. A choice that is expensive to reverse gets
a decision record (`design-decision`).

## Workflow

```
Architecture <feature>:
- [ ] 1. What the requirement marks as impact and must-not-change, read
- [ ] 2. Components: each one responsibility, how they connect
- [ ] 3. Stack per layer and why; hard-to-reverse choices to design-decision
- [ ] 4. Cross-cutting patterns implementers follow (auth, errors, state)
- [ ] 5. Changing what exists: rows already there, clients you cannot see, every caller of a shared path
- [ ] 6. Non-obvious decisions explained; scope handed to api-contract
```

## Start when

A feature adds or changes structure — a new component, a new cross-cutting
pattern, a stack choice — and what it must do is known (a requirement, or the request). A change with no
structural impact (one more field on an existing shape) does not need this; go
straight to `api-contract`.

## What it produces

- **System overview** — what the system does, its major components, the key data
  flows. Short.
- **Tech stack** — the technology per layer and why. A non-obvious or
  hard-to-reverse choice (a database, a framework) gets an ADR via
  `design-decision`.
- **Component map** — the named components, each with one responsibility, and how
  they connect. Prose; a diagram only when the connections branch.
- **Key patterns** — the cross-cutting ones implementers follow and do not
  reinvent: the auth strategy, how errors are handled, how state is managed.
- **Non-obvious decisions** — anything an implementer might question: why this
  way and not another.

## Changing something that already exists

Extending is the easy half. Before changing structure, read what the requirement
marks as its impact and must-not-change, and answer what the additive case never
raises:

- **The rows already there.** A schema change on a populated table is migrated,
  defaulted, left alone, or broken — say which, with a rough row count, because
  `backend` needs it to write the backfill. "Add a NOT NULL
  column" succeeds on an empty test database and fails on production.
- **The clients you cannot see.** A field removed or retyped on a shipped
  interface breaks callers that are not in this change and whose tests still pass.
  State the compatibility window, or make the change additive.
- **Every caller of a shared path.** Name them. A signature that moves in a shared
  module is a change to every module that reaches it; the ones you do not name are
  the ones nobody re-reviews.

Anything the requirement marks must-not-change is the owner's line — a finding you
report, not a call you make.

## Scope

It decides component boundaries and responsibilities, the stack, and the
cross-cutting patterns. It does **not** decide the requirement (`requirements`),
the exact interface shapes and data model (`api-contract`), the visual contract
(`design-system`), or the implementation inside a component
(`backend` / `frontend`). A choice outside this scope routes to the
skill that owns it.

## Output

The architecture — overview, stack, component map, patterns, decisions — and in
the chat: the components added or changed, the patterns implementers must follow,
and any structural change with its impact and compatibility window. Then
`api-contract` specifies the interfaces between the components
(Communication, Report of finished work).
