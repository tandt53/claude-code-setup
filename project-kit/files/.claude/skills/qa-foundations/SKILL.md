---
name: qa-foundations
description: The QA discipline the QA skills share - read the system's output, never its source; trust by source and purpose; audit mode read-only; reuse before creation; locator priority; the P0-P3 priority rubric; the AC quality spectrum; rationalizations to refuse. A reference the QA skills read by path; not invoked on its own.
disable-model-invocation: true
---

# QA foundations

The craft every QA skill in this kit builds on, regardless of stack. A phase
skill (`requirements`, `test-design`, `test-authoring`, `test-execution`,
`bug-report`) names *what* to do; this file names *how to think* while doing
it. Where a phase skill's rule conflicts with this file, the phase skill wins
and the conflict is surfaced.

Paths here are named by **role**, never hard-coded. The project's CLAUDE.md
declares where each artifact lives, and it wins over the kit's defaults; the
defaults are `docs/product/requirements`, `docs/product/test-cases`, and the
bug store
the project names. Read the role, fall back to the default, follow neighbours.

## Contents

1. What counts as reading the system · 2. Source trust · 3. Audit mode ·
4. Reuse before creation · 5. Locators · 6. Priority rubric (P0–P3) ·
7. AC quality spectrum · 8. Test case types and test data ·
9. Rationalizations to refuse · 10. Red flags

## Start when

Not invoked on its own, and not in the skill listing: the QA skills read this
file by path (`../qa-foundations/SKILL.md`) when they need the section named.

## The QA stance

- **Spec-first, not code-first.** You validate behaviour against the spec, not
  against the implementation. No test case without a requirement example to
  prove; no helper, fixture or page-object method without a test that calls it;
  no bug without a failing test or reproducible steps. Tests written from the
  spec catch the implementer's bugs; tests written from the code inherit them.
- **Describe what IS, not what SHOULD be.** A requirement records behaviour as
  it exists (or, for new work, as it must exist on shipment). "We should add",
  "could be improved" is conversation, not specification. If reality and spec
  disagree, surface the gap as a question or bug — never paper over it.
- **Verify before claiming.** Never mark a case implemented without reading the
  cited `path` to confirm the code exists; never claim a test passes on
  reasoning — run it; never call a failure "pre-existing" without checking the
  base first (Workflow, Hard rules).
- **The latest run is the source of truth.** No date stamps on matrix rows;
  they go stale. The latest test run says what passes today. No recent run →
  block rather than guess.
- **No invented contracts.** Every selector comes from the project's existing
  page object or test-id, every endpoint from an existing wrapper — never
  guessed from a URL or training memory. Missing contract → stop and ask.
- **Never assume environment, region or test data.** Staging vs prod, locale,
  variant — read the project's config and the requirement; if unspecified, ask.
  Never hard-code credentials or environment URLs; pull from the project's
  fixtures or env config.

## 1. What counts as reading the system

You may read the product's **output**; you may not read its **source**.

| Allowed | Not allowed |
|---|---|
| Calling a running test API and inspecting the response | Opening the handler file to see what it returns |
| Loading a running page in a real browser, reading the rendered DOM | Grepping the component source for which test-ids exist |
| Responses, snapshots, screenshots, traces, harness output | Any source file outside the project's declared test-helper layer |
| The specs the project ships (requirements, mockups, API contracts) | The production source an implementer wrote |

The running system is output and output is fair game; source code is input and
input is off-limits. The one reuse exception is the project's own test-helper
layer (page objects, API-service wrappers, fixtures) — that is yours to read
and extend.

## 2. Source trust: explore, then trust by purpose

Canonical input exists and is complete → use it; do not explore alternatives.
Missing or incomplete → **explore before declaring blocked**: search the repo
for alternative sources (existing tests, informal docs, design exports, README)
and, when files are insufficient, observe the running product. Only then, if
still unresolved, block.

Trust depends on **what you are deriving** — spec intent (ACs, expected
outcomes, business rules) versus implementation detail (selectors, current
state). The same source carries different trust for each:

| Source | Spec intent | Impl detail |
|---|---|---|
| Canonical artifact the project declares (requirement, test-case authored upstream) | HIGHEST | HIGHEST |
| User's live answer this session | HIGH | HIGH |
| A passing automated test for the same feature | MEDIUM-HIGH | MEDIUM-HIGH |
| A manual test-case document | MEDIUM-HIGH | MEDIUM |
| Other files (old tests, related-feature, README, design exports) | MEDIUM | MEDIUM-LOW |
| Live observation (UI / API / device) | LOW | MEDIUM-HIGH |
| Product source code | FORBIDDEN | FORBIDDEN |

**Provenance.** Every derived item carries where it came from —
`(canonical: requirements/F-042 §AC-3)`, `(user, 2026-05-17)`,
`(passing test login.spec:42)`, `(observed live 2026-05-17, login error state)`.
It is the audit trail, independent of confirm level.

**Confirm by source × purpose:**
- **Auto-trust** (no confirm): canonical or user sources; live reading of a plain
  fact ("the button is labelled Login", "the endpoint returned 422"); a
  neighbour used only for convention.
- **Provisional** (batch-confirm before done): anything derived from a
  non-canonical file, or from live observation beyond a plain fact. Mark it
  `provisional`; before done, surface the batch (canonical available /
  non-canonical used with provenance / which items are provisional) and let the
  user confirm.
- **Stop mid-flow**: spec intent derived from live observation (bug-vs-feature is
  the user's call, not yours); two sources disagree on one fact; a high-impact
  item where canonical is absent and every source is medium-trust or below.

**Live observation is purpose-aware.** Never as a spec source ("what it should
do"); audit-only for spec verification (flag drift, do not codify it); as needed
for implementation detail; always for bug reproduction. When purpose is unclear,
do not reach for live — ask. This bias prevents spec drift.

**When sources conflict, you surface, the user decides.** Canonical is
preliminary truth; the user's answer overrides for the session; updating the
canonical artifact makes it durable. Present both candidates with provenance;
never arbitrate truth yourself.

## 3. Audit mode (verifying an existing artifact)

`requirements` and `test-design` can run in audit mode — checking an existing
artifact against current sources rather than producing a new one. Shared shape:

1. Diff the artifact against current sources of truth (file-based, then live).
2. Flag gaps into the phase's gap classes; **do not auto-modify** the artifact.
3. Surface a gap report, each finding with provenance.
4. Await user direction per finding (update / add / accept / defer / route back).
   Even an "obviously right" change is the user's call.
5. On authorisation, switch to the phase's normal reasoning for approved items.

Audit mode is read-only on the artifact until the user directs; only the gap
report is produced.

## 4. Reuse before creation

Before writing any new test artifact — a helper, a fixture, a page-object
method, a step definition, a test entry — search for an existing equivalent and
reuse or extend it. Four `login` helpers, three subtly broken, is how a suite
rots.

1. **Grep first** for the phrase or helper you are about to write.
2. **Read the neighbours** in the project's helper layer; scan for what you can
   reuse.
3. **Extend, don't fork.** Almost-right abstraction → add the parameter or
   method (with permission); a sibling `LoginPage2` is permanent drift.

No match → write a new one at the right scope (feature-local vs shared), and say
so in your report. This is not an excuse to skip a test ("there's already a
login TC" ≠ this AC is covered), nor to keep a broken helper (file it as a bug).

## 5. Locators: priority and forbidden anti-patterns

When authoring or extending UI tests, every selector resolves at a defined
priority. No exceptions for UI stacks; API-only stacks skip this and apply
endpoint + assertion discipline instead.

**Priority (top first):** (1) stable test-id attribute (`data-testid`);
(2) accessibility role + accessible name; (3) label / placeholder association;
(4) unique visible text (brittle on i18n — last before CSS); (5) CSS / `#id`
(last resort, document why in a comment).

**Forbidden, no exceptions:**

| Anti-pattern | Why |
|---|---|
| XPath (any form) | couples the test to DOM structure; breaks on benign markup changes |
| Positional selectors (`nth-child`, `:first-of-type`, sibling combinators) | encodes "the 3rd thing under X"; breaks when order shifts |
| Generated/obfuscated class names (`.css-1a2b3c`) | build output, regenerates every build |
| Fixed-delay sleeps (`waitForTimeout`, `sleep`, `Thread.sleep`) | hide races; flaky under load, deceptively green on a fast machine |
| Inventing selectors/endpoints from training | the existing page object / wrapper is the source; surface the gap |

Use the framework's auto-waited assertion on the specific condition. Cannot name
the condition to wait for → the test is not ready; return partial with the flake
surfaced. The concrete per-stack locator API lives in the stack's driver skill
(e.g. `playwright-cli`).

## 6. Priority rubric (P0 / P1 / P2 / P3)

| Priority | Meaning | Runs in |
|---|---|---|
| P0 | Merge gate — must pass to ship (auth, data integrity, security-adjacent, any shipping-blocker AC) | every regression, release, smoke |
| P1 | Standard — every AC needs ≥1 P1 case | every regression, release |
| P2 | Defensive — edge cases, rare paths | full regression |
| P3 | Exploratory — documents intent | on demand |

Risk sets priority: AC weakness, security-adjacent paths, error states and
boundaries outrank happy paths. Effort is "test what risk dictates", not "test
everything". Merge-gate rules: every AC has ≥1 P1 case; every P0 passes; missing
P0/P1 coverage is a hard fail. These levels are closed — do not redefine per
project.

## 7. AC quality spectrum

Most AI-written ACs prove code runs, not that users benefit. Grade each AC and
flag the weak ones:

| Level | Proves | Action |
|---|---|---|
| Code existence — "POST /login returns 200" | an endpoint is reachable, nothing more | **always flag** |
| Feature presence — "login button is visible" | the component renders | **flag** |
| Behaviour — "valid creds → session token + redirect" | the minimum useful test | **acceptable** |
| User outcome — "sign in within 3s on 3G, reach dashboard, name shown" | real user value | **target** |

Weak AC → don't silently accept it: note it in your report, write the case at
the highest level the AC supports, flag the weakness for the requirement owner.
Rewriting the AC is the `requirements` skill's job, not yours.

## 8. Test case types and test data

**Types** (open list; a project extends it in its own schema): `happy`,
`negative`, `boundary`, `security`, `performance`, `accessibility`, `edge`,
`regression`. A project adds its own (`responsive`, `biometric`,
`rate-limit-headers`) in its schema file, not by editing this one.

**Data isolation.** Namespace mutable test data so each case owns its state and
can find its own artifacts (`tc-07@qa.example.com` or the project's
discriminator) — emails, entity IDs, tokens, uploaded files. Shared read-only
seed data is fine. Unscoped destructive operations ("delete all users", "clear
the cache") are forbidden in parallel — scope them to the case's namespace, or
mark the case not-parallel-safe so it runs after the batch.

## 9. Rationalizations a QA task must refuse

General ones (untested = undone, "close enough", "fix it later", weakening an
assertion) are in the global rules (Workflow, Hard rules) and the verify-work
skill. These are the
QA-specific ones on top:

| Rationalization | What to do instead |
|---|---|
| "I'll peek at the source to see what to assert." | Derive only from requirements, design, and the running system. The product's source is off-limits (section 1). |
| "The implementer says my test is wrong." | The spec is the source, not the implementer. Re-read the AC: it agrees → file the bug; it's ambiguous → block for clarification. |
| "The test failed, I'll weaken the assertion to match reality." | Never. Either the test was wrong (fix it fully, re-derive from the AC) or the product is wrong (file the bug). "Slightly looser" is the same sin smaller. |
| "I'll `.skip` / comment out the failing test for now." | "Temporarily" is the most expensive word in QA. Triage, don't hide. If it genuinely no longer applies, delete the row with a commit message. |
| "I'll add a fixed-delay sleep to kill the flake." | Diagnose the real wait condition; use the auto-waited assertion. Can't name it → the test isn't ready. |
| "Live passed, spec fails on re-run — just flake." | A reliable re-run failure is the opposite of flake. Re-run 3×; 3/3 fail → debug the spec's encoding, report partial. |
| "The user is pressuring me to skip the block." | The pressure is what the rule exists for. Refuse explicitly, name the risk, then report blocked. |

## 10. Red flags — not done if any is true

- You opened the product source to decide what to test or assert.
- A test-case file you wrote has no AC id in its metadata.
- You filed a bug without the isolation re-run.
- You weakened an assertion, or skipped / commented out a failing test, to go green.
- You tested only the happy path for auth, authorization or data access.
- A case asserts `status == 200` with no body / shape / state assertion.
- An error state the requirement calls out has no matching case.
- You ran an unscoped destructive operation.

Each independently blocks "done". Fix it, or report blocked / failed.

## What this file does NOT cover

Technique detail lives in the phase skills: test-design techniques (equivalence,
boundary, decision tables, state, pairwise, …) and matrix discipline in
`test-design`; the triage taxonomy and bug-report reasoning in `bug-report`;
execution discipline in `test-execution`. Framework-specific mechanics (how to
structure a page object, which wait primitive) live in the project's own code
and its driver skill — read the neighbours to learn the conventions. Report
results in the global Report shape (Communication, Report of finished work),
not a tool-specific envelope.
