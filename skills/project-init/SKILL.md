---
name: project-init
description: Install the project kit (layer 2) into a repository, or repair an installed one - detect the stack and what is already there, ask only what detection leaves open, write the files after approval, run the tests once, and list what must be done by hand. Use when a repository should get requirements, test design and trace-check, or when the user asks to set up or update the kit in a repo.
---

# Project init

Detect first, ask only what detection leaves open, show the plan, then
write. Re-running it on a repository that already has the kit fills only
what is missing and never overwrites a file.

The kit lives in the project kit folder (copied there at install). If it is
not there, ask for the path to `project-kit/`. Its `README.md` is the
manual version of these steps: read it once, after step 1 and before the
plan. Where the two disagree on what to install or a script's value, follow
the README and say so. For copying files and `.gitignore` (steps 4.1 and
4.2) use this skill's commands: the README's `cp -rn` and `cat >>` are the
short form for a repository that has none of the kit yet.

## 1. Detect

Read only. Change nothing yet.

| What | How |
|---|---|
| Repository root, uncommitted changes | `git rev-parse --show-toplevel`, `git status --porcelain` |
| Git host | `git remote get-url origin`. The CI workflow is for GitHub Actions only. No `origin` remote: not GitHub |
| Language | `package.json` at the root: TypeScript/JavaScript. Otherwise `pyproject.toml`, `setup.py`, `setup.cfg`, a `requirements*.txt` or `test_*.py` files: Python, and the Python notes in steps 4 and 5 apply. Neither: stop and say the kit is for TypeScript/JavaScript and Python only |
| Python runner | Python only: `pytest` importable (`python3 -m pytest --version`) or declared in the project's dependencies. Missing: the plan installs it as a dev dependency, since `unittest` writes no JUnit report |
| Node | `node --version`, 18 or later: trace-check needs it in any language. Missing: the plan says trace-check cannot run until Node is installed |
| Package manager | lockfile: `package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn. No lockfile: npm |
| Unit runner | `vitest` or `jest` in `dependencies` or `devDependencies`, or `node --test` in `scripts.test` |
| E2E runner | `@playwright/test` in dependencies, or a `playwright.config.*` file |
| TypeScript | `typescript` in `dependencies` or `devDependencies`, and its version: `version` in `node_modules/typescript/package.json`, else the declared range. The coverage map parses test files with the TypeScript 5 compiler API |
| Scripts already there | `test`, `test:ci`, `trace`, `coverage:map` in `package.json` |
| Project instructions | `CLAUDE.md` or `AGENTS.md`, a `Test command:` line, the heading `## How this project works` |
| Kit files already present | each file under the kit's `files/` that already exists in the repository |
| Modules available | the capability modules and their skills in the kit's `modules.json` |
| Layer 1 | the Workflow, Communication and Places rules are loaded in this session |

## 2. Ask only what is open

One question at a time, as multiple choice with the recommended option
first. Skip every question that detection answered.

- Uncommitted changes: stop so the user can commit first (recommended: the
  install then shows as one diff), or continue.
- Unit runner: both Vitest and Jest found, or none of Vitest, Jest and
  `node --test`.
- E2E: Playwright found. Include its results in trace-check (recommended)
  or not.
- Modules: which capability modules to install, read from the kit's
  `modules.json` (for example a dev-only, a QA-only, or a dev-and-QA project);
  more than one may be chosen, recommended the ones the project is for. Each
  module installs its own skills plus the `shared` skills; a module not chosen
  has its skills left out. Choosing none installs no skills. List each module
  with its one-line description. A project that is neither dev nor QA takes no
  module, and the kit's scripts and layer-1 rules still apply.
- Frontend platform: when the dev module is chosen and the project has a UI,
  which platforms it targets, from `modules.json` `platforms` (for example web,
  mobile). Each chosen platform installs its delta skill; a platform not chosen
  has its delta left out, so the project never loads another platform's rules.
- An existing `test:ci`, `trace`, `coverage:map` or `Test command:` differs
  from what the kit would write: keep the project's (recommended) or replace
  it.

## 3. Show the plan, then wait

List every file to create, every file to change and how, every file skipped
because it exists, and every package to install, `typescript@5` as a dev
dependency among them when step 1 did not find `typescript`. An install also
creates `node_modules/` and, when the repository had no lockfile, the
package manager's lockfile: list both. When the project
has another major version of `typescript`, the plan leaves it as it is and
says that `coverage:map` needs the TypeScript 5 compiler API: with a version
that lacks it (typescript 7 has none) it exits 2 with a one-line message
until typescript 5 is installed. Nothing is written before the user approves.

## 4. Write

1. **Copy the kit files that do not exist yet,** from the repository root.
   `SKIP` is an extended regex
   of paths to leave out: `.github/` when the host is not GitHub, the skills of
   every module the user did not choose, and the platform delta skills
   (`modules.json` `platforms`) for platforms the project does not target (the
   `shared` skills, the chosen modules' skills and the chosen platforms' deltas
   are always kept) — read the folder names from `modules.json` and add each as
   `|^\./\.claude/skills/<name>/`. Python also leaves out
   `|^\./scripts/coverage-map` (the map parses TypeScript and JavaScript test
   files only) and `.github/` (the workflow ships for Node runners; list
   it under step 6 as a by-hand change). `'^$'` leaves
   nothing out. The example leaves out `.github/` only:
   ```bash
   KIT=…   # the project kit folder
   SKIP='^\./\.github/'
   (cd "$KIT/files" && find . -type f) | grep -Ev "$SKIP" | while IFS= read -r f; do
     [ -e "$f" ] || { mkdir -p "$(dirname "$f")"; cp "$KIT/files/$f" "$f"; }
   done
   ```
   Not `cp -rn`: its exit status on a skipped file differs between macOS and
   GNU coreutils.
2. **`.gitignore`:** append each line of `gitignore.append` that is not
   already there (no `.gitignore`: create it with those lines), then delete
   `gitignore.append`.
3. **`CLAUDE.md`** (or `AGENTS.md` if the project uses that): unless
   `## How this project works` is already there, append the kit's
   `CLAUDE.project.md` without its first comment line and the blank line
   after it, with `Test command:` set to the project's test command. Without
   e2e, drop the line `  --results e2e=reports/e2e.xml \` from its "Proving a
   task" command (keep the `--task` line), or that command fails on a missing
   results file. No file:
   create `CLAUDE.md` starting with the heading `# CLAUDE.md`, then the block.
   Python: in the block's "Proving a task", replace `npm run test:ci` with
   `python3 -m pytest --junitxml=reports/unit.xml`, drop the e2e line, and
   drop the coverage-map paragraph. `Test command:` is `python3 -m pytest`.
4. **`package.json` scripts** (TypeScript/JavaScript only: Python has no
   `package.json` and skips this step), with `npm pkg set` (it works whatever the
   package manager; on a one-line `package.json` it writes the file back
   compact, so run the project's formatter on it afterwards if it has one),
   for example
   `npm pkg set 'scripts.trace=node scripts/trace-check.mjs --results unit=reports/unit.xml'`.

   | Script | Value |
   |---|---|
   | `test:ci`, Vitest | `vitest run --reporter=default --reporter=junit --outputFile.junit=reports/unit.xml` |
   | `test:ci`, Jest | `JEST_JUNIT_OUTPUT_FILE=reports/unit.xml jest --ci --reporters=default --reporters=jest-junit`, and install `jest-junit` as a dev dependency |
   | `test:ci`, Node's runner | `mkdir -p reports && node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=reports/unit.xml`, plus the file pattern of the project's `test` script when it has one. Node does not create `reports/` (it is ignored by git, so it is missing in every fresh clone and in CI), and without the `spec` reporter a failing test prints nothing. With no pattern, Node finds the `*.test.*` files itself, `.ts` ones included from Node 22.18 |
   | `test:e2e`, with e2e | `PLAYWRIGHT_JUNIT_OUTPUT_FILE=reports/e2e.xml playwright test --reporter=junit` |
   | `trace` | `node scripts/trace-check.mjs --results unit=reports/unit.xml`, plus `--results e2e=reports/e2e.xml` with e2e |
   | `coverage:map` | `node scripts/coverage-map.mjs`, and when `typescript` is missing, install `typescript@5` as a dev dependency (`npm install -D typescript@5`, `pnpm add -D typescript@5`, `yarn add -D typescript@5`). Another major version already there is left as it is |

   A script the project already has stays as it is, unless the user chose
   to replace it in step 2.
5. **`.github/workflows/trace.yml`** (GitHub only). The unit step ships with
   Vitest. For Jest, swap in the commented Jest lines. For Node's runner,
   write its command. With e2e, uncomment the E2E step. With pnpm or yarn,
   change `cache:` and the `npm ci` step to that manager (pnpm also needs
   `pnpm/action-setup`).

## 5. Prove it

1. Run `test:ci`, and `test:e2e` if included, with the project's package
   manager (Python: `python3 -m pytest --junitxml=reports/unit.xml`). Check that `reports/unit.xml` (and `reports/e2e.xml`) exist and
   hold `<testcase` entries. For Vitest, Jest and Playwright this is the
   first check of that runner's JUnit output, which the kit README lists as
   not yet checked (Node's own runner was checked in the kit's dry run).
2. Run `trace` (Python: `node scripts/trace-check.mjs --results
   unit=reports/unit.xml`). In a repository with no requirements yet it exits 0 when
   every existing test passes. Exit 1 has two causes; its summary line says
   which. `N fail` above 0: an existing test failed (trace-check blocks on
   any failing test, even one that names no requirement); report the failing
   tests. `N no test` above 0 with 0 fail: the repository already had
   requirements and some examples have no test yet; report that line, it is
   not a failing test. Fixing either is not part of this task.
3. Run `coverage:map` with the project's package manager (not for Python,
   which has no coverage map). It must exit 0 and
   write `docs/coverage/COVERAGE-MAP.html` (the `output` of
   `coverage-map.config.json` if the project has one); check the file is
   there. Exit 2 means that config is broken, or the project's typescript has
   no TypeScript 5 compiler API: report its one-line message.
4. Report in the finished-work shape: files written, files skipped, test
   counts, trace-check's exit code with its summary line, and the coverage
   map's summary line.

## 6. Hand over what must be done by hand

- GitHub: require the `trace` check before merging (branch protection or a
  ruleset).
- No remote yet: say the gate needs a CI once the repository has a host, and
  give the commands below for then.
- Another host: its CI must run `test:ci`, then trace-check as the kit's
  `files/.github/workflows/trace.yml` does (that file was not copied). Read it
  there and give the commands.
- Layer 1 missing: install it first (the package README). The Stop hook and
  the spec skill the kit relies on live there.
- `typescript` of another major version than 5: `coverage:map` needs the
  TypeScript 5 compiler API, and exits 2 while the project's version lacks
  it (typescript 7 has none) until typescript 5 is installed
  (`npm i -D typescript@5`). Changing it is the project's decision.
- Before relying on the gate, open one pull request that must fail (an
  example with no test) and one that must pass.

## Rules

- Never overwrite or delete a file the project had before this run.
- Nothing is written before the plan is approved.
- A failing existing test is a report, not something to fix here.
