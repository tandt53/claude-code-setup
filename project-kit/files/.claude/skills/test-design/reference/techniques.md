# Test design techniques, in depth

## Contents
- The techniques in depth (one worked case each)
- Writing the test code (fixtures, locators, waits, data)

## The techniques in depth

One concrete case each; derive the rest the same way.

- **Equivalence partitioning** — group inputs that behave the same, test one
  per class. Password length min 8 max 72 → classes `<8`, `8–72`, `>72`; three
  cases (5, 20, 100), not hundreds.
- **Boundary values** — bugs cluster at edges. "8–72 chars" → 7 rejected, 8
  accepted, 72 accepted, 73 rejected. Off-by-one is the most common production
  defect; every bounded value gets at least two boundary cases.
- **Decision tables** — N conditions → build the table, cover every reachable
  row. Login × `valid password` × `account status (active/locked/suspended)` ×
  `remember me` = 9 rows; without the table you write 4 and miss the
  locked + remember-me interaction.
- **State transition** — test every valid transition and every invalid
  attempt. Reset token `pending → used | expired`: valid (pending→used,
  pending→expired) plus invalid (used→used, expired→used). The invalid ones
  catch replay attacks.
- **Error-path coverage** — every error state an example calls out gets a case
  that triggers it (bad password, locked user, repeated submits, a backend
  5xx). A missing error-state case fails the AC-coverage gate.
- **Negative testing** — for every positive assertion write the negation:
  empty/null/missing, wrong type, wrong format, too long/short, duplicate,
  unauthorized, unexpected characters (SQL metachars, HTML, emoji, null bytes).
- **Pairwise** — N×M×K combinations → cover every *pair* of values, not every
  combination. 3 browsers × 3 locales × 2 themes × 4 sizes = 72 → ~16 pairwise
  cases catch ~80% of interaction bugs. Call out the reduction in your report.
- **Security-adjacent** — for anything touching auth, authorization or data
  access: horizontal privilege (can A see B's data?), vertical privilege (can a
  user do an admin action?), enumeration (does the error reveal a resource
  exists?), brute-force path, audit logging. These are P1 cases, not bonuses.
- **Bug-signal sweep** — tests are bug detectors, not success validators. For
  each feature sweep seven signals and write at least one case per applicable
  one: behavioural correctness, error handling, boundaries, concurrency/timing,
  security, data integrity (persisted state matches what the user saw),
  contract conformance. Ask of every green test: could this pass for the wrong
  reason? (`status == 200` passes on an empty body.)

## Writing the test code

- Reuse the project's fixtures, helpers and page objects before writing new
  ones. Search for them first; extend, don't fork.
- Find UI elements the way a user does or by a test id: role, label,
  `data-testid`. Never by position (`nth-child`, absolute XPath). The full
  locator priority and the forbidden anti-patterns are in `../../qa-foundations/SKILL.md`.
- No fixed waits (`sleep`, `waitForTimeout`). Wait for the condition the
  test needs.
- Each test creates its own data and passes alone and in any order. Namespace
  mutable data so each case owns its state (`../../qa-foundations/SKILL.md`, test data).
- A red test changes only when the example it proves changed. Never loosen
  an assertion, change an expected value or skip a test to make the run
  green. The Stop hook makes tests run, not pass, and a weakened test passes
  every time. If the test looks wrong, say why with evidence and leave it
  red.
