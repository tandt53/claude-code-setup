---
name: backend
description: Implements or changes backend code - business logic, an endpoint, data access - to the agreed interface, layered so each part is testable, with the security rules that always apply, errors that do not leak, reuse before creation, and tests run before done. Use when implementing or changing business logic, an endpoint or data access.
when_to_use: implement the endpoint, add the service, business logic, write the handler, data access, repository, the API should, server side
---

# Secure implementation

Build to the contract (`api-contract`). The craft this skill adds over the
general workflow is three things code reviews catch most: structure, the
security rules that always apply, and errors that do not leak. It is the dev
counterpart of the QA skills — what they test against, you build.

## Workflow

```
Backend <change>:
- [ ] 1. The interface you build to is agreed (contract, or existing signatures plus the user's answer)
- [ ] 2. Existing helpers and modules searched before writing new ones; a new dependency checked to exist in the registry and asked for
- [ ] 3. Layers: handler validates, service holds the rule, data access only stores
- [ ] 4. Security (`../security-foundations/SKILL.md` for any trust boundary): every field validated; auth and authorization on every protected route; secrets from the environment; parameterized queries; rate-limited auth; explicit CORS; idempotent retries
- [ ] 5. Errors: no stack trace, query or secret in a response or log
- [ ] 6. Tests from the examples seen failing, then green; the suite run
```

## Start when

You know the interface you build to: an agreed contract, or the existing
signatures plus what the user confirmed. A shape a user or caller would see
that nobody agreed → settle it first (`api-contract`, in the same task); never
build against a shape you invented.

## Layered, so each part is testable

Never put business logic in a route handler. Layer it, each part with one job
and independently testable:

```
Route / controller  → parse the request, validate input, call the service
Service             → the business logic, orchestrates repositories
Repository          → database access only, no business logic
Model / schema      → data shapes and validation rules
```

## Security rules — always apply

- **Validate every field** on every endpoint, and reject early.
- **Auth on every protected route**, no exceptions; **authorization** too — check
  the authenticated user may access *this* resource (A must not reach B's data).
- **Secrets from the environment**, never hardcoded, never in a response or log.
- **Parameterized queries or the ORM**, never string-concatenated SQL.
- **Rate-limit** the auth endpoints (login, register, password reset).
- **CORS** set explicitly, never `*` in a production config.
- **Idempotency** for an unsafe method a client may retry — a retry that charges
  twice is not a bug the test suite will catch.

## Errors that do not leak

Return the exact errors the contract defines, by their code strings. Never return
a stack trace to a client: log the full error internally, return a safe message
externally. 4xx is a client error (bad input, auth failed, not found); 5xx is a
server error and needs an alert.

## Reuse before creation

Read the inventories, not a guess at directory names — the component inventory
(`design-system`) and the existing services, helpers and wrappers. Reuse or
extend what fits; add new only when nothing does.

## Prove it before done

Run the unit tests, the type check and the lint against your own code and keep
the real output — a static import or compile check is not test execution. A
failing test is diagnosed, not suppressed (`bug-report`, the honest-fail rule);
weakening it or skipping it to go green is the one move never allowed. Sweep your
own diff for what you removed and say why each removal is safe.

## Output

What was built, the endpoints and their layers, the migration applied, the tests
run with their real counts, and anything removed with why it is safe
(Communication, Report of finished work).
