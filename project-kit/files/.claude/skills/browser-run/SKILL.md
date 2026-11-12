---
name: browser-run
description: Execute a browser scenario on any running site and produce the four-artifact evidence bundle - screenshot, video, console log, network HAR - plus a per-scenario report. Drives a given scenario end to end, or explores from a goal when no script exists (no prior knowledge of the feature). Site-agnostic; works with or without feature context. Use when a QA task must drive a real browser and hand back reproducible evidence. Sits on top of the playwright-cli adapter; for a non-Playwright stack write a sibling.
---

# browser-run — execute browser actions, capture the evidence

Drive a real browser through a scenario and hand back **evidence**, not claims:
for every scenario, always a screenshot, a video, the console log and the
network HAR, plus a report of what each step and assertion did. It is the
*executor* on top of the low-level `../playwright-cli/SKILL.md` adapter and the
locator discipline in `../qa-foundations/SKILL.md`. It does not design cases or
classify failures — that is the phase skills' job; it runs what it is given (or
explores toward a goal) and records what happened.

The harness is `run.cjs` (its pure parts, tested without a browser, in
`lib.cjs`); it knows only the scenario it is handed, so it works
on any site, with or without knowledge of the feature.

## Workflow

```
Run a scenario, or explore toward a goal:
- [ ] 1. Pick the target (test/local app, not production) and confirm it is safe to drive
- [ ] 2. Execute mode — write the scenario JSON, each write action paired with an assertion
         Explore mode — start with `goto`, run with `--explore`, read snapshot.json, append one step, repeat
- [ ] 3. Run `run.cjs` with NODE_PATH set to the app's playwright; one `--out` folder per scenario
- [ ] 4. Read report.md: steps and assertions (expected vs actual), alerts, console errors, network failures
- [ ] 5. Hand the evidence folder (screenshot, video, console, network, report) back to the asking skill
```

## Start when

A QA task must see what the running UI actually does and leave reproducible
evidence: run a known scenario, reproduce a bug, smoke a flow, or explore a
feature you have no prior knowledge of. Needs a running app (test/local, never
production without the `test-execution` confirm gate) and `@playwright/test`
resolvable (use the app's own install via `NODE_PATH`, below).

## Two modes

**Execute** — you have the steps. Write the scenario JSON, run it, read the
report. Every write action is paired with an assertion (an unverified action
tested nothing).

**Explore** — you have only a goal and no prior knowledge of the feature. Grow
the scenario one step at a time:

1. Start a scenario with `goto` the entry URL.
2. Run it with `--explore`; the harness snapshots the landed page's
   affordances (`snapshot.json`: headings, buttons, inputs, links with their
   accessible names/placeholders/test-ids).
3. Read the snapshot, decide the next action, **append** it to the scenario.
4. Re-run (the whole scenario replays from a clean state, so no hidden state).
5. Repeat until the goal is reached or the feature is understood; then run once
   more without `--explore` for the clean evidence bundle.

Replaying the whole scenario each step keeps it deterministic and needs no
persistent browser daemon.

## Running it

```
NODE_PATH=<app>/node_modules \
  node <skill>/run.cjs <scenario.json> [--out DIR] [--explore] [--headed] [--keep-on-pass]
```

- `NODE_PATH` points at a project that has `@playwright/test` (the app under
  test usually does); browsers come from the shared `ms-playwright` cache.
- `--out` defaults to `browser-run-out/<scenario-slug>/`. One folder per
  scenario holds all artifacts and the report.
- Exit code: 0 pass · 1 a critical assertion failed · 2 usage (any flag
  other than the ones above) · 3 the run could not finish: a step whose action
  failed (`aborted` in report.json names it), `@playwright/test` not loadable,
  or a scenario that cannot be read or cannot run as written (these exit
  before the browser starts; see the scenario format). A run that aborts is
  `error` even when an assertion failed before the abort: report.json lists
  both.

## Scenario format

```json
{
  "name": "login then explore",
  "baseUrl": "http://localhost:3000",
  "vars": { "id": "user@example.com", "pw": "change-me" },
  "device": "iPhone 13",
  "steps": [
    { "action": "goto", "url": "/login" },
    { "action": "fill", "locator": {"css": "input[name='identifier']"}, "value": "${id}" },
    { "action": "click", "locator": {"role": "button", "name": "Sign in"} },
    { "action": "waitFor", "state": "hidden", "locator": {"css": "input[name='password']"} },
    { "action": "assert", "type": "no_errors" }
  ]
}
```

- **actions**: `goto` (url relative to baseUrl or absolute), `fill`, `click`,
  `press` (key), `select` (value), `waitFor` (locator+state, or url),
  `assert`. `${var}` interpolates from `vars` in step fields (`goto` urls
  included), not in `baseUrl`.
- **checked before the run**: the run stops with exit 3, before the browser
  starts, on a scenario that is not an object with a `steps` list, an unknown
  action or assert type, a step that needs a locator and has none or has one
  the harness cannot map, a `vars` value that is not a string, number or
  boolean, or a `${name}` in any step field that `vars` does not define
  (never an empty string; a literal `${…}` cannot be written).
- **locators**, best first (same priority as `../qa-foundations/SKILL.md`):
  `{"testid":…}` · `{"role":…,"name":…}` · `{"label":…}` · `{"placeholder":…}` ·
  `{"text":…}` · `{"css":…}` (last resort). A bare string is a raw selector.
  Never XPath, positional or generated-class selectors.
- **assert types**: `url` (`contains`/`matches`), `visible`/`hidden` (locator),
  `text` (locator+`contains`), `alert_observed` (`text`, optional `alertType`
  success/error/info — uses the injected interceptor), `no_errors` (no error
  alert, no console error). Each may set `severity` (`critical` default |
  `warning`); only a critical failure fails the run. Assertions never abort the
  run — every one is checked.

## The evidence (every scenario that starts the browser)

One folder per scenario: `final.png` (full-page; plus `failure.png` if a step
threw), `video/*.webm`, `console.jsonl` (console + page errors + failed
requests), `network.har` (every request/response), `report.json` + `report.md`,
and `snapshot.json` in explore mode. The report surfaces the signals a reader
acts on: steps and assertions with expected vs actual, alerts observed, console
errors, and **network failures** (status ≤ 0 or ≥ 400) — these catch silent
breakage a green flow would hide.

**The folder can hold secrets.** `network.har` embeds every request and
response, headers and bodies included: session cookies, tokens, and what was
typed into forms (a password too). The video and screenshots show the screen.
It defaults to `./browser-run-out/` in the current folder: add that to
`.gitignore`, and read it before attaching it anywhere others can see.

Artifacts are captured even on pass (the brief is evidence per scenario, not
only on failure). Use `--keep-on-pass` semantics by retention policy, not by
skipping capture.

## Discipline

- **Site-agnostic.** The harness and the skill assume nothing about the app's
  framework or CSS. The alert interceptor watches ARIA/overlay/console, not
  class names. Do not hard-code one site's selectors into the skill.
- **Verify, don't invent.** In explore mode, read the real affordance from
  `snapshot.json`; never guess a `data-testid`. A locator that does not resolve
  live is a gap to surface.
- **Observe output, not source.** Drive the running app; do not read its source
  to decide what to assert (`../qa-foundations/SKILL.md`).
- **Ask before side effects.** A flow that logs out, deletes, pays or writes to
  a shared environment has consequences — confirm first (`../playwright-cli`).

## Mobile (next)

Set `"device": "<name>"` to run under a Playwright device descriptor (viewport,
user-agent, touch) — e.g. `"iPhone 13"`, `"Pixel 7"`. That covers responsive /
mobile-web checks today. Driving a real device or a native app (Appium / a
mobile driver) is a sibling adapter, the same role as `playwright-cli` for web,
and is out of scope here.

## Output

The per-scenario evidence folder, handed back to the asking skill
(`bug-report`, `test-execution`, `qa-sweep`). The report is the summary; the
four artifacts are the proof.
