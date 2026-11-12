---
name: playwright-cli
description: The interactive-ui-driver adapter for the Playwright stack - drive a real browser live to verify a selector or behaviour before authoring, walk a manual test case, or reproduce a bug. Use when a QA task needs to see what the running UI actually does. For a non-Playwright stack, write a sibling adapter (cypress, selenium) instead of faking this one.
---

# Playwright driver (interactive-ui-driver adapter)

Drive a real browser to observe what the running system does — the one source
a QA task may read directly (the running system is output; its source code is
not, per `../qa-foundations/SKILL.md`). Reach for it to verify a selector or behaviour
before authoring a test, to walk a manual case, to disambiguate a bug, or to
check a live reference the user points at. It is a tool surface only: it does
not design cases, classify failures or author bodies — those are the phase
skills' jobs.

This is the adapter for the **Playwright** stack. A project on another stack
gets its own adapter (`cypress`, `selenium`, …) with the same role; never fake
a Playwright surface on a non-Playwright project.

## Start when

A task needs to see what the running UI actually does — verify a selector before
authoring, walk a manual case, reproduce a bug — and the app can be run against a
test or local environment. No running app, or a non-Playwright stack → this
adapter does not apply; use the stack's own driver.

## Running it

Use the project's own Playwright: `npx playwright test` for specs, and for live
ad-hoc driving either a short `node` script using `@playwright/test`'s
`chromium.launch()`, `npx playwright open <url>`, or the project's declared
driver command (CLAUDE.md `## Quick commands`). Discover the version and config
from the project, not from memory. Run against a test or local environment, not
production (`test-execution` confirm gates).

## Locators: the category → Playwright API mapping

The locator priority and the forbidden anti-patterns are in `../qa-foundations/SKILL.md`;
this is only how each category maps to Playwright, top (preferred) first:

| Category | Playwright |
|---|---|
| stable test-id | `page.getByTestId('submit')` (or `locator('[data-testid="submit"]')`) |
| role + accessible name | `page.getByRole('button', { name: 'Submit' })` |
| label / placeholder | `page.getByLabel('Email')` · `page.getByPlaceholder('you@…')` |
| unique visible text | `page.getByText('Order placed')` (brittle on i18n) |
| CSS / id (last resort) | `page.locator('#submit')` — add a comment saying why |

Forbidden (same as `../qa-foundations/SKILL.md`): XPath, positional selectors
(`nth-child`, sibling combinators), generated class names (`.css-1a2b3c`), and
fixed-delay sleeps. Synchronise with Playwright's auto-waiting assertions
(`await expect(locator).toBeVisible()`), never `waitForTimeout`.

## Discipline

- **Verify, don't invent.** When authoring needs a selector or endpoint, drive
  the live page and read the real one from the rendered DOM; never guess a
  plausible `data-testid`. A selector that does not resolve live is a gap to
  surface, not to fabricate.
- **Observe output, not source.** Read the rendered DOM, responses, screenshots
  and traces. Do not open the product's source to decide what to assert.
- **Live is not a spec.** What the page does is implementation detail, the
  current truth of selectors and state — never the source of an acceptance
  example. Codifying observed behaviour as a requirement is the spec-drift trap
  (`../qa-foundations/SKILL.md`, live observation is purpose-aware).
- **Ask before side effects.** A live walk that logs out, deletes, purchases or
  hits a shared environment can have observable consequences — confirm first.

## Output

What was observed (the real selector, the actual behaviour, the reproduction),
with where it was seen, handed back to the skill that asked (`test-authoring`,
`test-design`, `bug-report`). A screenshot or trace path when it carries the
evidence.
