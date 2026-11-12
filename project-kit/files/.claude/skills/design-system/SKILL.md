---
name: design-system
description: Own the shared visual contract an interface is built to - design tokens, a component inventory with every state, the one place a user-facing sentence lives, and the stable test-ids QA binds to. Use when a project grows a UI, before building screens, and when a feature needs a token, component or state that does not exist.
---

# Design system

The shared contract the UI is built to: implementers build from it, QA tests
against it (`test-authoring` binds locators to its test-ids, `visual-review`
measures against its states and sizes). Keep it one source of truth, so a value
or a sentence is defined once and asserted everywhere.

## Start when

A project has or is growing a UI, and a requirement names the screens, states or
components in play. No UI, or a one-off throwaway screen → the token and component
discipline is overkill; skip it.

## Design tokens — the single source of visual values

Colour, spacing, radius, font, shadow, and the tappable minimum target per
platform (web 40, iOS 44, Android 48 px). **Every value an implementer uses for
one of these comes from the tokens file** — a hardcoded colour or pixel is a
defect. Adding a token is a deliberate act: it goes in the tokens file, not
inlined in a component. A feature that needs a value the file lacks adds it there
first, then references it. The min-target token is the one checked against a
render, not the source — `visual-review` fails a control smaller than it.

## Component inventory

Each component: its name, its variants, and **every state** — default, hover,
focused, disabled, loading, error, empty. Missing the empty and error states is
how a screen ships that was never drawn for real data. Implementers use the
project's declared component library; a raw element where a library component
exists (a bare `<button>` instead of the `Button`) is a defect. Reuse or extend
an existing component before adding a new one.

## One owner for the words a user reads

The copy for a component's states — the message under a field, the empty-list
invitation, the retry prompt — lives in the component inventory and nowhere else.
A mockup shows it, an implementer renders it, QA asserts it verbatim, and it can
be asserted verbatim only because one file owns it. The API contract owns the
machine-readable error (`field`, `code`); the requirement says what must be
*true* of the sentence ("it names the field"); this file holds the actual words.
The same message written three ways in three files is a message no test can
assert.

## Stable test-id contracts

The test-ids (and accessible roles/names) are a contract: `test-authoring`'s
locators and `visual-review`'s measurements bind to them. They are
author-controlled and stable; changing one is changing a contract that tests
depend on, not a cosmetic edit. Expose a stable test identity for anything a test
must find.

## Output

The tokens, the component inventory with states, and in the chat: the tokens or
components added or changed, the states covered, and any test-id a feature now
needs. Pairs with `api-contract` (the machine-readable error), `test-authoring`
and `visual-review` (Communication, Report of finished work).
