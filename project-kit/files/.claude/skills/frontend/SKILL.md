---
name: frontend
description: Implements a UI to the design system and the API contract - every state rendered, values from their source not literals, typed and handled API calls, no secret in the client, accessibility met; the web and mobile deltas live in frontend-web and frontend-mobile. Use when building or changing a screen, a component, or a client-side call to an API.
when_to_use: build the screen, add a component, the page should, UI, form, client call to the API, render, frontend
---

# Frontend implementation

Build the UI to the `design-system` (its tokens, components and test-ids) and the
`api-contract`. This skill holds the craft shared across platforms; the
platform-specific deltas are in `frontend-web` and `frontend-mobile`, and a
project loads only the one it targets — so a web screen never carries the mobile
rules, and the reverse. It is the frontend counterpart of
`backend`; `visual-review` checks the result.

## Workflow

```
Frontend <screen>:
- [ ] 1. Contracts in hand: design system and API contract (missing → agree first)
- [ ] 2. Every state rendered: loading, empty, error, success, partial, disabled
- [ ] 3. Tokens, library components and copy from their source, no literals
- [ ] 4. API calls typed; every error handled visibly
- [ ] 5. Security (`../security-foundations/SKILL.md`): no secret in the bundle; user data escaped; token stored safely; hidden ≠ authorized; transport security on
- [ ] 6. Accessibility: keyboard, labels, contrast, focus
- [ ] 7. Platform delta applied (frontend-web or frontend-mobile); proven in the running app
```

## Start when

The visual contract (`design-system`) and the data contract (`api-contract`) for
the screen exist — however produced — and the states to render are known (a
requirement, or the request). A contract missing → agree it first, in the same
task; building against an invented shape or token is the failure this skill
prevents.

## Render every state

Implement every state the component inventory lists — default, loading, empty,
error — not just the happy path. A screen with no empty and no error state is one
that was never built for real data, and the bug surfaces the first time a list is
empty or a call fails.

## Values from the source, never a literal

- **Tokens from the tokens file** (`design-system`): a hardcoded colour or pixel
  is a defect; import the token or use the project's token-bound class/variable.
- **A library component**, never a raw element where one exists (a bare
  `<button>` instead of the `Button`).
- **User-facing copy from the component inventory**, so QA asserts it verbatim —
  do not reword it in the component.

## API calls — typed and handled

Wrap every call; handle every error code the contract lists; leave no unhandled
rejection. Each contract error maps to the state the design shows for it — the
error is rendered, not swallowed.

## Security — the client is a public artifact

A web build and an app bundle are both public; anything in them is readable off
any browser or device.

- **No secret in the client.** A key compiled into the bundle is a key every user
  has. A key the client seems to need goes behind a server route; if the feature
  truly needs the client to hold it, that is a decision to surface
  (`api-contract` / `design-decision`), not one to take. The exact public
  prefixes and secret stores are per platform (`frontend-web`, `frontend-mobile`).
- **Escape anything rendered from user data or an API response** — an unescaped
  sink is an injection.
- **Store an auth token where another script or app cannot read it** — the *where*
  is per platform.
- **Hiding a control is not access control.** A control the user may not use is
  removed from the UI *and* the server rejects the call; never gate a destructive
  action on client state alone.
- **Transport security stays on** — never weaken it to make a request pass in a
  test.
- Every env var added is recorded with its public/secret split.

## Accessibility

An accessible name and role, a live region for content that updates; keyboard
support — tab order, enter/space on controls, escape closes a modal; a touch
target at least 44×44.

## The platform delta

Load `frontend-web` for a web target or `frontend-mobile` for a mobile target —
each adds only its deltas (the escaping sinks and secret stores, navigation,
offline, platform patterns). On a web task the mobile rules are not in context,
so they cannot be applied by mistake, and the reverse.

## Prove it

Run the tests, the type check and the lint; check the states by eye with
`visual-review`. A failing test is diagnosed, not weakened to go green
(`bug-report`, the honest-fail rule).

## Output

The screens and components built, the states covered, the contract errors
handled, and any client secret or permission that had to be surfaced
(Communication, Report of finished work).
