# Project kit (layer 2) · TypeScript / JavaScript, Python

Adds the SDLC/STLC layer to one repository: seven project skills, the
product/work folders with templates, `trace-check` (which requirement
examples are proven by which tests), the coverage map (one page: every
requirement, its examples and the tests naming them), and a CI workflow.
Needs layer 1 installed globally (`../README.md`).

```
files/                                   copy into the repository root
├─ .claude/skills/
│  ├─ requirements/        one analysis, two lenses (build, test) → examples
│  ├─ test-design/         techniques → cases → level; cases map to examples
│  ├─ test-plan/           risk, levels, entry/exit criteria (.work/test-plans)
│  ├─ bug-report/          reproducible report → failing test on an example
│  ├─ design-decision/     criteria first, options + do nothing, ADR
│  ├─ release/             trace-check --strict, dry run, backup, rollback, approval
│  └─ incident/            mitigate reversibly, timeline, cause, blameless postmortem
├─ docs/product/           the product: requirements, test-cases, architecture, decisions
│  └─ */_template.md       templates (ignored by trace-check)
├─ .work/                  the work: tasks, test-plans, test-runs, releases, incidents, lessons.md
├─ scripts/trace-check.mjs no dependencies, Node 18+
├─ scripts/coverage-map.mjs the coverage map; needs typescript
├─ scripts/coverage-map/   its page's script and styles
├─ .github/workflows/trace.yml
└─ gitignore.append        lines for .gitignore
CLAUDE.project.md          block to paste into the project's CLAUDE.md
tests/                     the kit's own tests, kept out of files/
package.json               what those tests need (npm install, npm test)
```

## Install

The `project-init` skill (layer 1) does the steps below for you: it detects
the runner, Playwright, the package manager and the files already there,
asks only what is left, writes after you approve, then runs the tests once.
Run `/project-init` in the repository.

By hand, from the repository root (adjust the path to this kit):

```bash
KIT=path/to/project-kit
cp -rn $KIT/files/. .                      # -n: never overwrite existing files
cat gitignore.append >> .gitignore && rm gitignore.append
```

Then:

1. Paste `CLAUDE.project.md` into the project's `CLAUDE.md` and set
   `Test command:` to the real command.
2. Make the unit tests write JUnit XML. Add to `package.json` scripts:
   - Vitest: `"test:ci": "vitest run --reporter=default --reporter=junit --outputFile.junit=reports/unit.xml"`
   - Jest: install `jest-junit`, then
     `"test:ci": "JEST_JUNIT_OUTPUT_FILE=reports/unit.xml jest --ci --reporters=default --reporters=jest-junit"`
   - Playwright (e2e): `PLAYWRIGHT_JUNIT_OUTPUT_FILE=reports/e2e.xml npx playwright test --reporter=junit`
   - Node's own runner: `"test:ci": "mkdir -p reports && node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=reports/unit.xml"`, plus the file pattern of the project's `test` script if it has one. Node does not create `reports/`, and without the `spec` reporter a failing test prints nothing
3. Add `"trace": "node scripts/trace-check.mjs --results unit=reports/unit.xml"`
   (plus `--results e2e=reports/e2e.xml` when there are e2e tests).
4. Add `"coverage:map": "node scripts/coverage-map.mjs"`, and TypeScript 5 to
   devDependencies if it is not there (`npm install -D typescript@5`).
5. In `.github/workflows/trace.yml`, pick Vitest or Jest and enable the e2e
   step if needed.
6. Delete the skills this project will not use.

**Python** (pytest, or `unittest` tests that pytest runs). There is no
`package.json`, so steps 2–4 become one command in `CLAUDE.md`'s "Proving a
task": `python3 -m pytest --junitxml=reports/unit.xml`, then
`node scripts/trace-check.mjs --results unit=reports/unit.xml`. Install pytest
as a dev dependency if the project lacks it. trace-check still needs Node 18+.
A test proves an example by its function name, `test_REQ_CHECKOUT_012_ex1_…`
(trace-check matches the underscore form). Leave out `scripts/coverage-map*`:
the coverage map parses TypeScript and JavaScript test files only. The CI
workflow ships for Node runners; for Python, replace its unit step with the
pytest line above, or leave `.github/` out.

## How one change flows

```
request ──► requirements skill ──► docs/product/requirements/checkout.md
               (REQ-CHECKOUT-012, ex1..ex3, one `assumed`)
        ──► task-spec (layer 1) ──► .work/tasks/2026-10-01-coupon-stacking/spec.md
               ## Changes: - REQ-CHECKOUT-012 (new)
        ──► test-design ──► docs/product/test-cases/checkout.md
               + tests titled "REQ-CHECKOUT-012 ex1: …", seen failing
        ──► code ──► npm run test:ci ──► reports/unit.xml
        ──► trace-check --task .work/tasks/… ──► status.json · exit 0 = proven
        ──► PR: CI fails on any red test, then runs trace-check for every
            task spec the PR touches
        ──► release skill: trace-check --strict (no `assumed` left)
```

## What trace-check blocks on

Exit 1 when, in scope: an example fails at any level, has no test, or only
skipped tests; a test names an example that does not exist, was removed or is
deprecated (orphan); a manual pass has no evidence; a requirement has no
examples or is defined twice; a results file is missing; any test failed,
even one naming no requirement or only requirements outside the scope;
with `--strict`, an example is still `assumed`. Exit 2 on bad arguments or
unreadable input.

It checks that each example is **linked** to passing tests. It cannot check
that a test really tests what its title claims: that is the job of
`test-design` (see each test fail first) and review.

## Coverage map

`npm run coverage:map` writes `docs/coverage/COVERAGE-MAP.html`, one page
that opens from the disk: the requirement tree on the left; for each node
the share of examples with a test, the examples the code does differently
(`Code:` lines) and those still `assumed`; under each example, the tests
whose title (or a `describe` around it) names it. A Code drift view groups
the differences by recommendation, P0 first, and its tab shows how many P0
code fixes are open (`Recommend: fix code (P0) — <why>`); a Tests view lists the tests that name no
requirement, or one that does not exist. The console prints the totals:

```
1 requirements, 3 ACs, 1 tested, 0 differ from code; 1 tests scanned, 0 linked to no requirement
```

The Map view (`#map`, "Map" in the top bar) draws the same tree as a graph,
left to right: the project (`project` in the config, else "Project"), its
areas, the features under them and, opened, each requirement with a dot per
example. Each node is coloured by its share of examples with a test, with
its numbers on it. Drag to move it; scroll or pinch to zoom (15% to 250%),
or use `+`, `-`, `0` (Fit) and the arrows. "+n" on a node opens its branch,
and Show (Areas, Features, Everything) opens it to a depth. A click on a node
opens its numbers and a link to its page. It needs nothing outside the page,
so it works opened as a file.

A test marked as failing (`test.failing` or `it.failing` in Jest, `.each`
included; `test.fail(title, fn)` in Playwright) names an example the code
does not meet yet: a known gap. It counts as a test, carries "known gap" on
the page, and its example counts as differing from the code, with or without
a `Code:` line, until the mark is taken out of the test. A `test.fail()`
called inside a test's body is not seen, since the script does not run the
code.

It reads the test files, it does not run them: the page says whether a test
exists, trace-check (or `--results`, below) whether it passes. It parses them with the compiler
API of TypeScript 5, the project's own `typescript` package. TypeScript 7
has no such API: with it, or with none installed, the script stops with exit
2 and one line saying so (`npm i -D typescript@5`). The optional lines it
reads in a requirement file are in `_template.md`; trace-check ignores them.

`scripts/coverage-map/app.js` runs in the browser, not in Node. If the
project's lint, format or `tsc --checkJs` covers `scripts/`, add
`scripts/coverage-map/` to its ignore list (`.eslintignore` or `ignores` in
`eslint.config.*`, `.prettierignore`, `exclude` in `tsconfig.json`).

With no config it scans every `*.test.*` and `*.spec.*` file (ts, tsx, js,
jsx, mjs, cjs), and each requirement file with no `Tree:` line is a root of
the tree, named by its `#` heading less a last "requirements"
(`# Checkout requirements` → Checkout), or by its file name in capitals when
it has no heading. It never enters `node_modules` or a folder whose name starts with
`.` (`.git`, `.next`, copies of the project in `.claude/worktrees`), except
the folder a pattern itself starts in. The default `exclude` leaves out build
output, and it matches those folder names at any depth: a test in
`src/features/coverage/` or `src/build/` is left out too. The console then
says how many (`2 test files left out by exclude`) and the Tests view lists
them.

To change any of that, add `coverage-map.config.json` at the repository
root. Every key is optional. A list set there replaces the default whole: to
scan `src/features/coverage/` while still leaving out build output at the
root, write `"exclude": ["dist/**", "build/**", "coverage/**", "out/**"]`.

| Key | Default | Sets |
|---|---|---|
| `project` | none | a name after "Coverage map" in the top bar |
| `requirements` | `"docs/product/requirements"` | the requirement files' folder (names starting with `_` are skipped) |
| `tests` | `["**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}"]` | the test files scanned |
| `exclude` | `["**/dist/**", "**/build/**", "**/coverage/**", "**/out/**"]` | files never scanned; a list given replaces this one |
| `levels` | `[]` | `{ "match", "level" }` each: a test file's level (letters, digits, `-`, `_`), the first match wins, none is `unit`; tests are listed in this order, the first level highlighted |
| `order` | `[]` | tree labels in this order; the others follow, alphabetically |
| `last` | `[]` | labels always last among their siblings |
| `groups` | `{ "feature": {} }` | the tags a file can name in `Group by:` |
| `breakdowns` | `[]` | `{ "rows", "detail", "columns", "title", "noun" }` each: a table, a row per value of the `rows` tag, a column per value of a group |
| `tagRows` | `[]` | `{ "label", "tags" }` each: a line on the requirement showing those tags |
| `notes` | `"docs/coverage/test-notes.json"` | `{ "<test file>": "<note>" }`, shown on the Tests view |
| `output` | `"docs/coverage/COVERAGE-MAP.html"` | the page written |
| `results` | `["reports/unit.xml", "reports/e2e.xml"]` | the JUnit files of the last test run, read only with `--results` |
| `resultsOutput` | `"reports/coverage-map.html"` | the page written with `--results` |

A group with `values` is ordered: in a file with `Group by: priority`, each
requirement sits under the node of its `priority` tag, nodes in the values'
order, and the page draws a heatmap with a column per value. A group's other
keys are `label` (default: the tag), `plural` (default: label + "s"),
`labels` (value → node label) and `rowNoun` (what a heatmap row is, default
`["branch", "branches"]`). A group without `values` (like `feature`) gives
each value a node, in tree order. In `breakdowns`, `columns` names a group
with values, `detail` a tag shown beside each row, `noun` what a row is.

```json
{
  "levels": [{ "match": "e2e/**", "level": "e2e" }],
  "groups": {
    "priority": {
      "values": ["must", "should", "could"],
      "labels": { "must": "Must", "should": "Should", "could": "Could" }
    },
    "feature": {}
  }
}
```

Patterns are paths from the repository root, never starting with `./`: `**`
is any number of folders, `*` anything within one folder or file name, `?`
one character, `{a,b}` either. A config that is not JSON, has an unknown key
or a value of the wrong kind stops the script with exit 2 and the reason; the
page from the last run stays as it was. A missing requirements folder is
not an error: the page says so under "Data problems".

`npm run coverage:map -- --results` also reads the JUnit files of the last
test run (`results`, the files `npm run test:ci` writes) and draws the page
with them: a mark on each test (✓ passed, ✗ failed, ○ not in the run,
– skipped), each example's state (Passing, Failing, Known gap, Not run), a "Failing
ACs" tile and filter, the first lines of each failure under its test, and a
"Last test run" card with each file's time and counts, as the file writes
them. A result goes to a test when its name is the test's describes and
title joined by `" "` (jest-junit), `" › "` (Playwright) or `" > "` (Vitest),
alone or at the end of the name, and, if the result names a file, the test
is in that file. A result names a file by a `file` attribute (a path from
the repository root, a shorter one, or an absolute one), or by a classname
or suite name with no space ending in `.test.<ext>` or `.spec.<ext>`. A
result that no test of its file names that way (Node's runner keeps the
describes out of the name) goes to the tests whose title its name ends
with; a test that has results by its chain takes only those. A `${…}` in a
title or a describe, and in `.each` titles `%s`, `%d`, `%i`, `%f`, `%j`,
`%o`, `%p`, `%#`, `$name` and `$name.field`, match any text that is not
empty. For Jest, add `JEST_JUNIT_ADD_FILE_ATTRIBUTE=true` to `test:ci`;
without it two tests of the same name in different files share their
results. The card counts the results that match no test, to show when a
name could not be matched. A missing or unreadable results file is shown as
such; with no file to read, the script stops with exit 2. The committed page
(`output`) never carries pass/fail, since it changes with every run: that
page is written to `resultsOutput` instead, under `reports/`, which
`gitignore.append` keeps out of git, and a config that sets the two to the
same file stops with exit 2.

A known-gap test passes when it fails as expected. An example whose
known-gap test passed is Known gap, not Passing, and not counted among the
failing; a plain test that passed makes it Passing. A known-gap test that
fails (it passed, so the code now meets the example) makes the example
Failing: take out the mark and the `Code:` line together. An example with a
`Code:` line, a plain test that passed and none that failed is marked "Code:
line may be stale": the code may now do what the example says, so read the
line again. The Code drift tab counts those examples ("2 stale"), shown
only when there are some.

## Checked here

- `npm install`, then `npm test` (`node --test tests/*.test.mjs`):
  trace-check's tests, positive and negative, and coverage-map's. A few
  coverage-map tests skip here because they read files of the project the map
  was first built in; the runner names them. The tests live outside `files/`
  so they are never copied into a project: Vitest collects every
  `*.test.mjs`, finds no Vitest suite in a file written for Node's runner,
  fails it, and trace-check then blocks.
- Mutation check on copies: 33 deliberate bugs in trace-check, each caught
  by at least one test.
- Dry run in a throwaway git repository with real JUnit output from Node's
  test runner: untested example blocks; manual run with evidence proves it;
  `--strict` blocks on `assumed`; an unrelated failing test blocks; the PR
  step finds the task from the diff; `status.json` is ignored by git.

Not checked here (no package registry in the build sandbox): the exact JUnit
output of Vitest, Jest and Playwright, and the workflow on GitHub itself.
Run it once on a real pull request, one that must fail (an example without a
test) and one that must pass, before relying on it.
