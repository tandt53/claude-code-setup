# <Area> requirements

<!-- One file per area; the file name in capitals is the AREA in REQ-<AREA>-NNN.
     Files starting with "_" are ignored by trace-check.
     Never reuse a number. Never delete: set Status: deprecated.
     Lines after an "optional" note are read only by the coverage map
     (npm run coverage:map); trace-check ignores them. Delete those you do
     not need. -->

<!-- optional: where this file sits in the map's tree, parts split by › (no < or > in names); without it, a root named by the # heading above, less "requirements" -->
Tree: Shop › Checkout
<!-- optional: none keeps the requirements on that node; feature gives each Tags: feature=… value a child node; or a group named in coverage-map.config.json -->
Group by: none
<!-- optional: when the examples were last compared with the code; shown under the tree -->
Code checked: <date>, <by reading the code | by running it>

## REQ-<AREA>-001 · <the rule in a few words>
Status: active
Source: <who asked, date> · <ticket>
Rule: <one sentence, in the user's words>
<!-- optional: key=value,value pairs; Group by and coverage-map.config.json read them -->
Tags: feature=<name>
<!-- optional: other tree paths it concerns; listed there, counted only here; * is any one node -->
Applies to: Shop › *, Accounts
- ex1: <given, with real values> → <result, with real values>
  <!-- optional, when the code does something else: what it does, and which
       side to change: "fix code — <why>" keeps the example, "fix AC — <why>"
       changes it; an optional (P0)–(P3) says how soon: P0 fix now, P1 soon,
       P2 when free, P3 later (the requirements skill defines each); the map
       counts and lists it as code drift, P0 first -->
  <!-- name the file, not a line: lines move with every edit. Its test, titled
       with this example, is marked test.failing (Jest) or test.fail(title, fn)
       (Playwright) until the code is fixed -->
  Code: <what the code does instead> (<file>)
  Recommend: fix code (P1) — <why the example is right>
  <!-- optional: another document that says otherwise; shown, not counted -->
  Other doc: <document, section> says <what>
- ex2 `assumed`: <an answer inferred, not yet confirmed by the owner>
- ex3 (removed <date>: <why>): <kept for history; tests naming it become orphans>
Changed: <date> <what> (task <yyyy-mm-dd-name>)
