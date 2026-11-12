---
name: mobile-run
description: Execute a scenario against a mobile app through Appium and produce the evidence bundle - screenshot, video, device log - plus a per-scenario report. Framework-agnostic across native (Android/Kotlin, iOS/Swift), hybrid/webview, React Native and Flutter, chosen by the scenario's automationName. Drives a given scenario or explores from a goal with no prior knowledge of the app. Use when a QA task must drive a real mobile app and hand back reproducible evidence. The mobile sibling of browser-run; network capture needs a proxy (see below).
---

# mobile-run — execute mobile actions, capture the evidence

Drive a real mobile app through a scenario and hand back **evidence**: for every
scenario, a screenshot, a screen-recording video and the device log, plus a
report of what each step and assertion did. It is the mobile sibling of
`../browser-run/SKILL.md`, and the executor on top of an Appium driver the way
browser-run sits on `../playwright-cli/SKILL.md`. It does not design cases — it
runs what it is given (or explores toward a goal) and records what happened.

The harness is `run.mjs` (its pure parts, tested without a device, in
`lib.mjs`); it talks raw W3C/HTTP to a running Appium server, so it
needs no client library. It knows only the scenario, so it works on any app.

## Workflow

```
Run a scenario, or explore toward a goal:
- [ ] 1. Appium server up; a device/emulator/simulator booted; the driver installed; the app build at hand
- [ ] 2. Set the scenario's platform + automationName for the app's framework (table below)
- [ ] 3. Execute mode — write the scenario (each write action paired with an assertion)
         Explore mode — launch with `--explore`, read snapshot.json affordances, append one step, repeat
         (each run is a new session: the app starts over and every step runs again;
         snapshot.json lists the first 60 elements)
- [ ] 4. Run `run.mjs`; read report.md: steps and assertions, then the device log for errors
- [ ] 5. Hand the evidence folder (screenshot, video, device log, report) back to the asking skill
```

## Start when

A QA task must drive a real mobile app and leave reproducible evidence: run a
known scenario, reproduce a bug, smoke a flow, or explore an app with no prior
knowledge of it. Needs Appium running, a booted device/emulator/simulator, the
matching driver installed, and the app build. No Appium or device → this adapter
does not apply.

## The framework → driver + locator map

A mobile app's framework decides the driver and how elements are addressed. The
skill is framework-agnostic because it chooses per the app, not per one stack.

| App framework | `automationName` | Locators (best first) | Notes |
|---|---|---|---|
| Native Android, **Kotlin**/Java | `UiAutomator2` | `{accessibilityId}` (content-desc) · `{id}` (resource-id) · `{uiautomator}` · `{text}` | |
| Native iOS, Swift/ObjC | `XCUITest` | `{accessibilityId}` (name) · `{predicate}` (`-ios predicate string`) · `{className}` | text entry: see the iOS note |
| **Hybrid / webview** (Cordova, Capacitor, Ionic) | `UiAutomator2` / `XCUITest` | first `{"action":"context","name":"WEBVIEW_…"}`, then `{css}` or `{xpath}` (`{text}` is native-only) | **not validated live yet**. Android needs a matching chromedriver; switch back to `NATIVE_APP` after |
| **React Native** | `UiAutomator2` / `XCUITest` | `{accessibilityId}` — set `testID`/`accessibilityLabel` in the app (RN renders to native views) | **not validated live yet**; no special driver |
| **Flutter** — app exposes Semantics (preferred) | `UiAutomator2` / `XCUITest` | `{accessibilityId}` (the Semantics label) · `{xpath}` over content-desc | Flutter's Semantics tree surfaces as the native accessibility tree, so **no special driver** — drive it like a native app. Validated this way (see notes). |
| **Flutter** — no Semantics | `Flutter` (appium-flutter-driver) | `{flutterKey}` (ValueKey) · `{text}` · semantics label | Only when the app exposes **no** Semantics. Flutter then paints to a bare canvas with no native tree, and the Flutter driver is required — but it needs a **driver-instrumented build** (`enableFlutterDriverExtension()`), not a plain release build |

Use `{accessibilityId}` first on every stack: it is the one locator the app
controls and that survives redesigns. `{xpath}` works on mobile but is brittle —
last resort, with a comment.

## Running it

```
# Appium must be running (default 127.0.0.1:4723); a device/emulator/sim booted.
node <skill>/run.mjs <scenario.json> [--out DIR] [--explore]
```

- `APPIUM_URL` overrides the server (default `http://127.0.0.1:4723`).
- `--out` defaults to `mobile-run-out/<scenario-slug>/` — one folder per scenario.
- Exit code: 0 pass · 1 a critical assertion failed · 2 usage · 3 the run
  could not finish: no session (Appium down, bad caps), a step whose action
  failed (`aborted` in report.json names it), or a scenario that cannot be
  read or cannot run as written (these exit before any device is touched;
  see the scenario format). A run that aborts is `error` even when an
  assertion failed before the abort: report.json lists both.
  Any flag other than `--out DIR` and `--explore` is a usage error.

### Defaults that act on the device

The harness sets `appium:autoGrantPermissions: true` (every runtime permission
is granted without its dialog) and `appium:newCommandTimeout: 120`, and caps
the screen recording at 300 s. Appium's own `noReset` default (false) clears
the app's data when the session starts, which on a real device wipes what the
app held. Anything in the scenario's `caps` wins: set
`"appium:autoGrantPermissions": false` to test a permission flow, and
`"appium:noReset": true` to keep the app's data.

## Scenario format

```json
{
  "name": "apidemos views to buttons",
  "platform": "Android",
  "automationName": "UiAutomator2",
  "app": "/abs/path/ApiDemos-debug.apk",
  "deviceName": "emulator-5554",
  "udid": "…(iOS sim/device)…",
  "caps": { "appium:isHeadless": true },
  "vars": { "a": "3" },
  "steps": [
    { "action": "tap", "locator": {"text": "Views"} },
    { "action": "type", "locator": {"accessibilityId": "IntegerA"}, "value": "${a}" },
    { "action": "waitFor", "locator": {"className": "android.widget.Button"} },
    { "action": "context", "name": "WEBVIEW_com.app" },
    { "action": "assert", "type": "text", "locator": {"accessibilityId": "Answer"}, "contains": "7" }
  ]
}
```

- **actions**: `tap`, `type` (focuses then enters), `waitFor` (polls a locator),
  `context` (switch native ↔ webview), `back`, `pause`, `assert`. `${var}`
  interpolates from `vars` in step fields (not in `app`, `caps` or the device
  fields).
- **checked before the run**: the run stops with exit 3, before any device is
  touched, on a scenario that is not an object with a `steps` list, an
  unknown action or assert type, a step that needs a locator and has none or
  has one the harness cannot map, a `vars` value that is not a string, number
  or boolean, or a `${name}` in any step field that `vars` does not define
  (never an empty string; a literal `${…}` cannot be written).
- **locators**: `{accessibilityId}` · `{id}` · `{uiautomator}` · `{predicate}` ·
  `{className}` · `{text}` (mapped to the platform idiom, quotes escaped) ·
  `{css}` (in a webview context) · `{xpath}` (last resort). A bare string is
  xpath. **Flutter driver only** (`automationName:
  Flutter`): `{flutterKey}` (ValueKey) · `{text}` · `{semanticsLabel}` ·
  `{flutterType}` — the harness serialises these to the driver's base64 finder,
  and a bare string is then matched as text.
- **assert types**: `present` (element exists), `visible` (displayed), `text`
  (element text `contains`). `severity` `critical` (default) | `warning`; only a
  critical failure fails the run. Assertions never abort the run.

## The evidence (every scenario that gets a session)

One folder per scenario: `final.png`, `recording.mp4` (Appium screen recording),
`device.log` (logcat on Android, syslog on iOS — the "console"), `source.xml`
(the native tree) + `snapshot.json` in explore mode, and `report.json` +
`report.md`. The device log is where a crash or a silent error surfaces.
Each capture is best-effort: read `artifacts` in report.json, where a missing
one is `null`. With no session there is only the report, and the classic
Flutter driver gives the report only (see the notes).

**The folder can hold secrets.** `device.log` is the whole device's log, every
app on it, not only the one under test; the video, screenshot and source.xml
show what was on screen, typed values included. It defaults to
`./mobile-run-out/` in the current folder: add that to `.gitignore`, and read
it before attaching it anywhere others can see.

## Network (needs a proxy — not in the bundle yet)

Unlike the web (where Playwright records a HAR), a mobile app's traffic is not
visible to the UI driver. Capturing it needs a man-in-the-middle proxy
(mitmproxy, Charles) in front of the device with its CA trusted, exported as a
HAR. That is a sibling step; this bundle delivers screenshot + video + device
log today, and names the proxy path as the next addition rather than pretending
the four-artifact web parity already holds.

## Discipline

- **App-framework-agnostic.** Pick the driver and locators from the app's
  framework (table), never hard-code one stack. Prefer `accessibilityId`.
- **Verify, don't invent.** In explore mode read the real affordance from
  `snapshot.json`; never guess an id. A locator that does not resolve is a gap.
- **Observe output, not source.** Drive the running app; read the native tree,
  screenshots and logs, not the app's source, to decide assertions.
- **Ask before side effects.** A flow that pays, deletes or writes to a shared
  backend has consequences — confirm first.

## Notes from first validation

- **iOS text entry needs the right Appium/Xcode pairing.** Measured on **Xcode
  27** (which removed the standalone `Simulator.app`) with `appium@3` and
  `xcuitest` 10.x: no GUI simulator opens (the app is gone), and on a headless
  one taps, reads, screenshots and video all work but text entry silently
  no-ops (the field stays empty).
  Not tried yet: `xcuitest` 11.x and 12.x still run on Appium 3 (their npm peer
  dependency is `appium ^3.0.0-rc.2`; checked 2026-11-12), so 12.x is the next
  thing to try. 13.x needs `appium ^4.0.0-beta.6`, and Appium 4 is still beta
  (npm `latest` 3.9.0, `beta` 4.0.0-beta.7); moving to it means `uiautomator2`
  9.x, and the newest `appium-flutter-driver` (4.1.0) still requires Appium 3,
  so the Flutter-driver path would stop. Until one of these is shown to
  type, drive iOS typing on Xcode ≤ 26 or on a real device; everything else on
  iOS, and all of Android, works on the Appium-3 stack. Always verify a field's
  value after `type` on first setup.
- **Flutter — two paths, both validated live on Android; prefer the native one.**
  - *Via Semantics (preferred):* a Flutter app that exposes Semantics labels
    (`com.example.appium_testing_app`, a plain `app-debug.apk`) was driven through
    **UiAutomator2 + `accessibilityId`** with no Flutter driver — login→samples→back
    (6/6) and a typing proof (a wrong username → "Invalid Credentials", i.e. the
    keystrokes registered) both passed **with the full evidence bundle**. **Start such a
    scenario with a `waitFor`** on the first element: Flutter's Semantics tree populates a
    few seconds after launch (measured ~4s), so a bare first assert can run before it exists.
  - *Via appium-flutter-driver (`automationName: Flutter`):* an instrumented app
    (built with `enableFlutterDriverExtension()`, Flutter 3.35.1 ↔ driver 3.0.1)
    was driven by `{flutterKey}`/`{text}`/`{semanticsLabel}`/`{flutterType}` —
    find-by-ValueKey, `type` (through `flutter:enterText`), tap and a text
    assertion all passed (echo read back "Hello Rebecca"). The harness serialises
    these to the base64 finder the driver expects; there is **no find step** (the
    finder is the element ref) and presence uses `flutter:waitFor`.
    **Limitation (measured):** the classic Flutter driver implements **none** of
    the native evidence endpoints — screenshot (500), source (405), screen
    recording (405) and logcat (500) all fail — so this path yields a step report
    **but no screenshot/video/log bundle**.
  - **So:** use the native driver + `accessibilityId` whenever the app has
    Semantics (interaction **and** full evidence); fall back to
    `appium-flutter-driver` (`{flutterKey}`) only for an app with no Semantics,
    knowing it needs an `enableFlutterDriverExtension()` build and gives a
    report-only result (no artifact bundle).

## Output

The per-scenario evidence folder, handed back to the asking skill (`bug-report`,
`test-execution`). The report is the summary; the artifacts are the proof.
