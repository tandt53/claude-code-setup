---
name: api-contract
description: Agrees the shape of an interface before it is built - a function's signature or return shape, an endpoint's request, response and errors, the data model and its migrations - keeping every existing caller working, so code and tests are built to one contract. Use when a change adds or changes an interface others call.
when_to_use: add an endpoint, change the API, new field, change the return value, rename a parameter, paginate, add a column, migration, change the response shape, a new function other modules call
---

# API contract

The contract is the single source of truth for an interface: implementers code
to it, testers write against it (`test-authoring` takes endpoints from here, not
from a guess), and no one invents a shape. Design it before the code, from the
requirement examples (`requirements`) upstream, between the components
`solution-architecture` named. A non-trivial choice it
settles gets a decision record (`design-decision`).

## Workflow

Copy this checklist and tick it before writing the implementation:

```
Contract <interface>:
- [ ] 1. Callers found: every module, test and client that uses this interface (grep its name)
- [ ] 2. Shape: request / arguments, response / return, errors, each with types
- [ ] 3. Values a caller or user would see that you chose: settled with the user as examples
- [ ] 4. Shipped interface? Additive or versioned; each caller from step 1 still works
- [ ] 5. Data model and migrations: reversible, backfill for existing rows
- [ ] 6. Ops: the one signal that shows it broke, flag, rollback threshold
- [ ] 6b. Auth and authorization per role and per record named in the contract (`../security-foundations/SKILL.md`)
- [ ] 7. Non-trivial choice recorded (design-decision)
```

## Start when

A change adds or changes an interface. What it must do comes from a
requirement or from the request itself; you do not need a requirement file to
begin. Settle the shape with the user as examples when a value they would see
is yours to choose. Changing a shipped interface → have the old shape and its
callers in hand, keep them working or ask first: a broken caller is hard to
undo.

## What a contract says, per endpoint

- **Request**: every field, its type, required or optional, the validation rule.
- **Response**: the full shape including nested fields, and the exact status
  code(s).
- **Errors**: a table of `status · code · reason`, with the error body shape
  (`{ "code": …, "message": … }`).
- **Notes**: the behaviours a shape alone does not show — "always 200 even for an
  unknown email, to avoid enumeration"; "the token is single-use and expires in
  1 hour"; an unsafe method a client may retry takes an idempotency key or is
  naturally idempotent, and the contract says which.

## The data model

Entities between the requirement and the database: each field with type,
constraints, whether it is nullable, its default, and the relationships
(`User 1—N Session`). Index every foreign key and every column a hot-path query
filters on. Never expose a secret field (a password hash is `never expose`).

## Migrations

- **Reversible**: write up and down; the down must not lose data written after
  the up.
- **A change touching existing rows ships a backfill** — idempotent,
  re-runnable, stated with the row count it expects. A column added `NOT NULL`
  to a populated table without one is a deploy that passes on an empty test
  database and fails on real data.
- Never edit a committed migration; a correction is a new migration.

## Changing a shipped contract

- Additive or versioned. Removing a field, retyping one, or tightening a
  validation breaks callers that are not in this change and whose tests still
  pass — so it is a decision to surface, not one to take silently.
- State the compatibility window (what old clients get, and until when). Name
  every caller of a shared path.
- Anything the requirement marks must-not-change is the owner's line: a finding
  you report, not a call you make.
- Need to deviate from the contract while implementing? Stop, change the
  contract first (record it with `design-decision` when non-trivial), then code.
  Never change a shape silently — everything downstream depends on it.

## Ops, for anything that deploys

Name, in the contract or the task, the one signal that tells someone this broke
(a rate or a latency, not "logs"); the feature flag if it is gated, or `none`;
the rollback threshold and window; the SLO target. A criterion no emitted signal
can evaluate is itself a finding.

## Output

The contract and the data model, and in the chat: the endpoints defined
(method + path), the entities and their migrations, what changed on any shipped
shape and its compatibility window, and the open questions for the owner. Pairs
with `requirements` upstream and `test-design` / `backend`
downstream (Communication, Report of finished work).
