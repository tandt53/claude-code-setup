#!/usr/bin/env python3
"""
Traceability audit: every idea of the original 214-line workflow.md must have
a destination in the new set of files. Each row names the idea, the file it
now lives in, and a phrase that must appear there (whitespace-insensitive).
It also fails when a path from the table in prompts/places.md, or a skill or
subagent name, appears anywhere else in the layer-1 files, and when a cross-reference
uses a section number or a file name, or names a heading that does not exist:
references read "(Communication, Report of finished work)".

  python3 docs/trace.py            check, print a table, exit 1 on any miss
  python3 docs/trace.py --md       also write docs/TRACEABILITY.md
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

W, C, PL = "prompts/workflow.md", "prompts/communication.md", "prompts/places.md"
SP, VE, RE = "skills/task-spec/SKILL.md", "skills/verify-work/SKILL.md", "skills/review-work/SKILL.md"
AG, HK, MX = "agents/reviewer.md", "hooks/require_tests.py", "docs/MECHANISMS.md"
GQ = "hooks/gap_question.py"
TSH, TSR = "skills/task-spec/shapes.md", "skills/task-spec/references.md"
MS = "prompts/message-shapes.md"
EX = "agents/Explore.md"
RT, PI = "skills/retro/SKILL.md", "skills/project-init/SKILL.md"
PA = "skills/parallel-agents/SKILL.md"
PK, TC = "project-kit/files/.claude/skills/", "project-kit/files/scripts/trace-check.mjs"

# (original section, idea, destination, phrase that must be present)
ROWS = [
    ("intro", "How to write lives in communication.md", W, "How to write about work is set in the Communication rules"),
    ("intro", "The loop: context → size → spec → plan → steps → verify → review", W, "## Steps"),
    ("§1", "Map wide and shallow", W, "Map wide and shallow"),
    ("§1", "Use a subagent for a large map", W, "Use a subagent when the map needs many files"),
    ("§1", "Rank by cost × likelihood of being wrong", W, "cost of being wrong × likelihood of being wrong"),
    ("§1", "Go deep on one path, in data-flow order", W, "Go deep on the top item"),
    ("§1", "Look wide again at each point on the path", W, "look wide again"),
    ("§1", "Stop when reading no longer changes the conclusion", W, "no longer changes the conclusion"),
    ("§2", "No gate says yes: do it directly", W, "No yes: do the work and report"),
    ("§2", "When to split into steps", W, "Will it take more than one logical change, so more than one commit?"),
    ("§2", "Splitting a simple task only adds stops", W, "Each yes adds one stop or one file"),
    ("§3", "Spec is self-contained (fresh session can build and prove it)", SP, "A fresh session that reads only the spec"),
    ("§3", "Spec contents: goal, scope, files, rules, examples, decisions, check", TSH, "one check that can be run or looked at"),
    ("§3", "Interview for what request and code do not answer", SP, "Interview the user only for what the request and the sources do not answer"),
    ("§3", "Save as a file; chat is not memory", SP, "Chat is not memory"),
    ("§3", "Fresh-session test for gaps", SP, "Fresh-session test"),
    ("§3", "Present and wait for approval", SP, "wait for approval"),
    ("§3", "Approved examples are the reference for everything after", SP, "what every later check is judged against"),
    ("§3", "User review time is best spent on the examples", SP, "Time the user spends here"),
    ("§3", "Decision record for architectural decisions", TSR, "## Decision records"),
    ("§3", "Spec shape", TSH, "### Spec"),
    ("§3 unclear", "Never fill a gap silently; assumptions become examples", W, "Never fill a requirement gap silently"),
    ("§3 unclear", "Mark assumptions `assumed`", SP, "marked `assumed`"),
    ("§3 unclear", "Confirming examples is cheaper than writing a spec", SP, "Confirming examples is cheaper"),
    ("§3 unclear", "Reversible assumptions proceed, irreversible wait", SP, "Reversible assumptions may proceed"),
    ("§3 unclear", "Reference: current behaviour", TSR, "characterization tests"),
    ("§3 unclear", "Reference: another implementation", TSR, "differential testing"),
    ("§3 unclear", "Reference: properties", TSR, "property-based testing"),
    ("§3 unclear", "Reference: metamorphic relations", TSR, "metamorphic testing"),
    ("§3 unclear", "Reference: existing code, docs, tickets", TSR, "existing code, docs or tickets"),
    ("§3 unclear", "Reference: a draft the user judges", TSR, "a quick draft"),
    ("§3 unclear", "No reference → [unverified: no reference]", W, "[unverified: no reference]"),
    ("§4", "Plan, then wait; no code before approval", W, "No code before the approvals the gates call for"),
    ("§4", "Approval gate is Plan mode", MX, "Plan mode → the approval gate"),
    ("§4", "Each step leaves the code working", W, "The code works after every step"),
    ("§4", "Riskiest step first", W, "Riskiest step first"),
    ("§4", "Tests from examples first, watch them fail", W, "tests from the acceptance examples first, seen failing"),
    ("§4", "Stop before a step only for an unsettled decision", W, "stop before a step only if it holds a decision the plan did not settle"),
    ("§4", "Report each step in one line, no stop", W, "report each step in one line"),
    ("§4", "Plan wrong: stop, present revised plan", W, "The plan turns out wrong"),
    ("§5", "Decide alone what is reversible and invisible", W, "Decide alone what is reversible and invisible"),
    ("§5", "Ask for visible, data-model or expensive changes", W, "Ask before anything user-visible"),
    ("§5", "Questions batched per approval point; one at a time only if linked", W, "one at a time only when the first changes what the second means"),
    ("§6", "Deliver what was asked, at the scope asked", W, "Stay in scope"),
    ("§6", "Something broken is a report, not a licence", W, "is a report, not a licence"),
    ("§7", "Definition of done", VE, "Done is when the acceptance examples written at Agree"),
    ("§7", "Show evidence, do not assert", VE, "never assert"),
    ("§7", "Independence: a check is as independent as its reference", VE, "A check is only as independent as its reference"),
    # Retired 2026-11-09: the rule never fired (0 of 9 T3 runs); the ledger records why.
    ("§7", "Tests written in a separate context on large tasks (retired)", "docs/rule-ledger.md", "Retired 2026-11-09: deleted from the verify skill"),
    ("§7", "Property tests break the self-deception cycle", VE, "Add property tests"),
    ("§7", "Run the real thing", VE, "Reality shares no one's assumptions"),
    ("§7", "Check the checks: 5 steps", VE, "A check never seen to fail is not yet trusted"),
    ("§7", "Inject failures on a copy or branch", VE, "Work on a copy or a branch"),
    ("§7", "Mutation testing tools", VE, "Stryker"),
    ("§7", "Mutate only where being wrong is expensive", VE, "where being wrong is expensive"),
    ("§7", "Do not chase the score; equivalent mutants", VE, "Do not chase the score"),
    ("§7", "Never claim a test passes without running it", W, "Never claim a check passed without running it"),
    ("§7", "Tests must have run: enforced", HK, "Test command"),
    ("§7", "Never call a failure pre-existing unchecked", VE, "Never call a failure pre-existing"),
    ("§7", "A check that could not run did not pass", W, "One that could not run is `[unverified]`"),
    ("§7", "Know why a check is green", VE, "Know why a check is green"),
    ("§7", "Check 'not done' against the final code", W, "Check \"not done\" against the final code"),
    ("§7", "Commit one change; message says why and what was rejected", W, "the message says why and what was rejected"),
    ("§8", "Four framing questions", RE, "## Four framing questions"),
    ("§8", "Four framing questions, in the reviewer itself", AG, "Before reviewing, state four things"),
    ("§8", "No reference: reconstruct and confirm", RE, "have it confirmed first when the review is expensive"),
    ("§8", "Zoom: work at the level of the question", RE, "go one level down only to prove a finding"),
    ("§8", "Costliest failure order; style to tools", RE, "Leave style to tools"),
    ("§8", "Gather evidence breadth then depth", RE, "Gather evidence breadth-first to map"),
    ("§8", "Fresh context, result and reference only", RE, "never the reasoning that produced the work"),
    ("§8", "Fresh context: enforced by a subagent", MX, "Subagent `reviewer` → independent review"),
    ("§8", "Ask to refute, not confirm", RE, "ask it to **refute** the result"),
    ("§8", "Report only what matters; avoid over-engineering", RE, "chasing every\none leads to over-engineering"),
    ("§8", "Say what was not checked", RE, "Say what was not\nchecked"),
    ("§8", "Seed bugs to calibrate the reviewer", RE, "## Calibrating the reviewer"),
    ("§8", "Findings shape", RE, "## Review: <object> against <reference>"),
    ("§9", "A repeat is a missing check", W, "A mistake seen twice is a missing check"),
    ("§9", "Prefer checks that run over rules to remember", W, "one\n  that runs before one that must be remembered"),
    ("§9", "Show a new check failing before trusting it", W, "Show it failing on the mistake before trusting it"),
    ("§10", "A slice runs from its spec file (suggesting a new session dropped, user 2026-11-11)", W, "A slice runs from its spec file"),
    ("§10", "Steps restart from spec and plan files", W, "files carry context, conversations do not"),
    ("§10", "Two failed corrections: stop and say what the attempts taught (no new session, user 2026-11-11)", W, "Two corrections on one issue failed"),
    ("new: frame", "Four framing questions for any task", W, "answer four questions"),
    ("new: frame", "Purpose: deliver, learn, restore, decide", W, "deliver a change · learn something · restore a broken system · reach a decision"),
    ("new: frame", "Frame silently; say it when not Deliver", W, "Frame silently"),
    ("new: frame", "Learn: timebox, answer with evidence, no tests for throwaway code", W, "throwaway code needs no tests"),
    ("new: frame", "Restore: mitigate reversibly first, then hypothesis loop", W, "mitigate first with a reversible action"),
    ("new: frame", "Decide: brief, then decision record", W, "the output is a decision brief"),
    ("new: frame", "Judged on sight: draft early, iterate", W, "show a draft early"),
    ("new: frame", "Irreversible: dry run, backup, rollback, ask", W, "dry run on a copy, backup, rollback plan"),
    ("new: frame", "No one to approve: reversible only, stop before the rest", W, "do only what is reversible"),
    # added in v4: task files, generic spec, learning loop
    ("new: files", "Task spec is one task's contract, references lasting requirements", SP, "references** them and never renumbers them"),
    ("new: files", "Task files live in .work/tasks/<date>-<name>/", PL, "`<work folder>/tasks/<yyyy-mm-dd>-<name>/`"),
    ("new: files", "Files only for multi-session or unattended work", W, "Work that ends in this session needs no files"),
    ("new: files", "Generated status files are read, never hand-written", W, "never write them by hand"),
    ("new: files", ".work is hidden: read by path", W, "read and write it by path"),
    ("new: files", "Spec shape is generic: examples or a reference", TSH, "## What correct means"),
    ("new: files", "Projects may extend the spec shape", TSH, "A project may extend this shape in its own CLAUDE.md"),
    ("new: learn", "Lesson entry shape with tags and count", RT, "## Lesson entry"),
    ("new: learn", "Two lessons files: project and Claude", RT, "the personal lessons (about how Claude works)"),
    ("new: learn", "Context phase reads matching lessons by path", W, "the lessons whose tags match the task"),
    ("new: learn", "Repeats noticed through lessons files", W, "The lessons files are how a repeat is noticed across sessions"),
    ("new: learn", "Retro keeps only surprises", RT, "Only surprises"),
    ("new: learn", "Retro: repeat raises count, two or more proposes promotion", RT, "At two or more, **propose a promotion**"),
    ("new: learn", "Promotion prefers what runs over what must be remembered", RT, "preferring what runs over what must be remembered"),
    ("new: learn", "Promotion waits for approval", RT, "so it waits for approval"),
    ("new: learn", "Retro is delegated at task end, incident, correction", W, "or when asked, run the retro skill"),
    # v5: layer 2 (project-kit), the SDLC/STLC decisions made in conversation
    ("v5 L2", "One requirement analysis, two lenses, shared by SDLC and STLC", PK+"requirements/SKILL.md", "One analysis, read through two lenses"),
    ("v5 L2", "Domain-forced questions (money rounding, combination order)", PK+"requirements/SKILL.md", "Ask the questions that the domain forces"),
    ("v5 L2", "REQ ids never reused; deprecate, never delete", PK+"requirements/SKILL.md", "Never reuse a number"),
    ("v5 L2", "Changed example meaning gets a new number", PK+"requirements/SKILL.md", "give it a new number"),
    ("v5 L2", "Owner confirms examples; release blocks on assumed", PK+"requirements/SKILL.md", "a release may not"),
    ("v5 L2", "Every test case proves an example; new case → requirement first", PK+"test-design/SKILL.md", "Every test case proves a requirement example"),
    ("v5 L2", "Level = lowest level that can see the failure", PK+"test-design/SKILL.md", "the lowest level that can see the failure"),
    ("v5 L2", "Tests seen failing before the code exists", PK+"test-design/SKILL.md", "A test that passes before the change proves nothing"),
    ("v5 L2", "Exit criteria decided in advance", PK+"test-plan/SKILL.md", "Exit criteria"),
    ("v5 L2", "Bug → example → failing test → fix", PK+"bug-report/SKILL.md", "Write the failing test"),
    ("v5 L2", "Criteria agreed before comparing options", PK+"design-decision/SKILL.md", "Agree the criteria first"),
    ("v5 L2", "Decision records append-only; supersede by new record", PK+"design-decision/SKILL.md", "Records are only added, never edited"),
    ("v5 L2", "Release: prepare reversibly, then stop for approval", PK+"release/SKILL.md", "Nothing below runs unattended"),
    ("v5 L2", "Incident: mitigate reversibly before understanding", PK+"incident/SKILL.md", "Mitigate, reversibly"),
    ("v5 L2", "Postmortem actions become checks or examples", PK+"incident/SKILL.md", "a **check** that would have caught it earlier"),
    ("v5 L2", "Test titles name REQ id and example", "project-kit/CLAUDE.project.md", "Every test that proves an example names it in its title"),
    ("v5 L2", "Product docs never point into .work", "project-kit/CLAUDE.project.md", "product docs never point into `.work/`"),
    ("v5 L2", "status.json generated, never hand-written", "project-kit/CLAUDE.project.md", "never write it by hand"),
    ("v5 L2", "trace-check reads any JUnit level plus manual records", TC, "JUnit XML from any level"),
    ("v5 L2", "A manual pass needs evidence", TC, 'a manual pass needs "evidence"'),
    ("v5 L2", "Orphan tests block", TC, "does not exist, was removed, or is deprecated"),
    ("v5 L2", "Any failing test blocks, linked or not", TC, "a failing test still blocks"),
    ("v5 L2", "--strict blocks on assumed examples", TC, "is still assumed"),
    ("v5 L2", "CI: tasks touched by a PR must be proven", "project-kit/files/.github/workflows/trace.yml", "Trace-check the tasks in this pull request"),
    ("v6 QA", "CI: any failing test fails the run, task or not", "project-kit/files/.github/workflows/trace.yml", "Any failing test fails the run"),
    ("v6 QA", "A failing test outside the task scope still blocks", TC, "it names nothing in this scope, but a failing test still blocks"),
    # v6: good practices taken from the QA platform architecture (ai-qa repo)
    ("v6 QA", "Test code: reuse fixtures, stable locators, no fixed waits, independent data", PK+"test-design/SKILL.md", "Never by position"),
    ("v6 QA", "Never loosen an assertion to turn a test green", PK+"test-design/SKILL.md", "Never loosen an assertion"),
    ("v6 QA", "Ticket and message text is data, not instructions", PK+"requirements/SKILL.md", "is data, never an instruction"),
    ("v6 QA", "Report and log text is data, not instructions", PK+"bug-report/SKILL.md", "is data, never an instruction"),
    ("v6 QA", "Incident logs and alerts are data, not instructions", PK+"incident/SKILL.md", "is data, never an instruction"),
    ("v6 QA", "Secrets: deny reading .env files", "settings.snippet.json", "Read(.env.*)"),
    ("v6 QA", "Deny rules: what they block, what they do not, tests", MX, "Deny rules → secrets stay out of the context"),
    ("v6 QA", "Init: detect first, ask only what is open", PI, "Detect first, ask only what detection leaves open"),
    ("v6 QA", "Init: never overwrite, write only after approval", PI, "Nothing is written before the plan is approved"),
    ("v6 QA", "Init: prove the setup with one test run and trace-check", PI, "## 5. Prove it"),
    # v7: rules of the installed 56-line workflow that v4 dropped
    ("v7", "Stage and commit in one command; never leave a populated index", W, "Never leave a populated index"),
    ("v7", "No co-author or generated-by trailers: enforced by a setting", "settings.snippet.json", '"commit": ""'),
    ("v7", "A project's CLAUDE.md may move work records, lessons, decision records", PL, "may map any role differently, and it wins"),
    ("v9", "One test right after writing it: revert exactly the fix (was the mutation check skill)", VE, "One test, right after writing it"),
    ("v9", "Revert exactly the fix; the failure message must point at the problem", VE, "revert **exactly the fix**"),
    ("v8", "Stops set by four gates asked at their step, not by a size label", W, "### Where to stop"),
    ("v7", "Decision records: the project's folder, else propose one and wait", TSR, "propose the default location and wait"),
    # v10: a large request is split into slices; fewer stops; shorter reports
    ("v10", "A large request becomes a map of slices, approved once", W, "a map of slices"),
    ("v10", "A slice: one user-visible behaviour, at most three steps", W, "one user-visible behaviour and at most three steps"),
    ("v10", "G1 narrows to values a user would see", W, "Did a value a user would see"),
    ("v10", "Questions batched at an approval point, each with a recommended pick", W, "each with a recommended pick"),
    ("v10", "Work outside the map stops like a wrong plan", W, "or the work reaches outside the map"),
    ("v10", "Map shape", TSH, "### Map"),
    ("v10", "Map lives beside its slices' task folders", PL, "`<task folder>/map.md`"),
    ("v10", "A report's first line says what the reader must do", C, "DONE | ASK n | BLOCKED"),
    ("v10", "Before/after lines by default; a diagram only when the path branches", MS, "a diagram only when the path branches"),
    ("v10", "A slice spec names its place in the map", SP, "its place in the map"),
    ("v10", "Reply codes: ok, Q2 b, S3 drop", C, "Accept every recommended pick"),
    # v11: unify kit + Loop into the module skills; the new QA craft and skills
    ("v11", "qa-foundations: running system is output, source is input", PK+"qa-foundations/SKILL.md", "output is fair game"),
    ("v11", "qa-foundations: trust is purpose-aware", PK+"qa-foundations/SKILL.md", "Trust depends on"),
    ("v11", "qa-foundations: audit mode is read-only until the user directs", PK+"qa-foundations/SKILL.md", "read-only on the artifact"),
    ("v11", "bug-report: honest-fail, a failing test is a signal", PK+"bug-report/SKILL.md", "a signal, not an obstacle"),
    ("v11", "bug-report: classify before fixing (4-class taxonomy)", PK+"bug-report/SKILL.md", "Classify before fixing"),
    ("v11", "test-execution: flaky only when 3x isolation comes back mixed", PK+"test-execution/SKILL.md", "comes back mixed"),
    ("v11", "test-authoring: never invent a selector or endpoint", PK+"test-authoring/SKILL.md", "never invent a selector"),
    ("v11", "test-design: the nine techniques in depth", PK+"test-design/reference/techniques.md", "The techniques in depth"),
    ("v11", "requirements: design and audit modes", PK+"requirements/SKILL.md", "## Modes"),
    ("v11", "requirement-review: one criterion, one claim", PK+"requirement-review/SKILL.md", "One criterion, one claim"),
    ("v11", "requirement-review: ready only if both could work without inventing", PK+"requirement-review/SKILL.md", "without inventing anything"),
    ("v11", "review-change: which of my tests pass while being wrong", PK+"review-change/SKILL.md", "pass while being wrong"),
    ("v11", "playwright-cli: interactive-ui-driver adapter for Playwright", PK+"playwright-cli/SKILL.md", "interactive-ui-driver adapter"),
    ("v11", "visual-review: a suspicion becomes a measurement, never an estimate", PK+"visual-review/SKILL.md", "Turn each suspicion into a measurement"),
    # v12: the dev module, distilled from project-starter's dev agents
    ("v12", "solution-architecture: name the clients a change you cannot see breaks", PK+"solution-architecture/SKILL.md", "The clients you cannot see"),
    ("v12", "api-contract: the contract is the single source, no invented shapes", PK+"api-contract/SKILL.md", "no one invents a shape"),
    ("v12", "design-system: tokens are the single source of visual values", PK+"design-system/SKILL.md", "single source of visual values"),
    ("v12", "backend: auth on every protected route", PK+"backend/SKILL.md", "Auth on every protected route"),
    ("v12", "frontend: hiding a control is not access control", PK+"frontend/SKILL.md", "Hiding a control is not access control"),
    ("v12", "frontend-web: no secret in a browser bundle, sanitise HTML sinks", PK+"frontend-web/SKILL.md", "Security in a browser bundle"),
    ("v12", "frontend-mobile: secrets in Keychain or Keystore, not plain storage", PK+"frontend-mobile/SKILL.md", "Keychain (iOS) or Keystore"),
    ("v13", "qa-sweep moved from L1 to the L2 QA module: measure the app, not the source", PK+"qa-sweep/SKILL.md", "measure the app, do not read it"),
    # v14: silence or ok is not understanding (2026-11-10)
    ("v14", "A typed 'what is / why' message reminds Claude to reopen the pick that rested on it", GQ, "restate that decision with what they now know"),
    ("v14", "The gap-question hook reads only what the user typed", GQ, "pasted blocks, system reminders, code fences and harness text left out"),
    ("v14", "The gap-question hook never blocks a message", GQ, "Always exit 0: a reminder must never stop a message"),
    ("v14", "The gap-question hook is documented with its limits and tests", MX, "UserPromptSubmit hook → a gap question reopens what rested on it"),
    ("v14", "Silence, ok and a pick approve; they do not show understanding", C, "They do not show that the user understood"),
    ("v14", "Before a decision resting on something new: one prediction check per batch, never 'is that clear?'", C, "a question that predicts a concrete result of the pick"),
    ("v14", "A gap message: answer from a real case, change the approach, reopen the pick", C, "restate it with what they now know and ask whether it still holds"),
    ("v14", "Depth is set within the conversation, one level at a time", C, "go one level deeper next time, a gap means one level simpler"),
    ("v14", "More depth when asked, or when a message shows a gap (no longer only on demand)", C, "more depth when asked, or when a message shows a gap"),
    ("v14", "Alias ?? asks for the last point again another way", C, "say it again another way"),
    # v14, from PR #13 (another session, same request): gap signs and how to change the form
    ("v14", "Gap signs: the same question reworded, an answer to a question not asked, saying they are lost", C, "the same question reworded, an answer to a question you did not ask"),
    ("v14", "When it did not land, change the form, not the volume", C, "change the form, not the volume"),
    ("v14", "A term is explained the first time it matters to the reader, even if used earlier", C, "even if it appeared earlier in your own messages"),
    # v15: cheaper always-loaded and on-demand text (2026-11-11)
    ("v15", "task-spec: the shapes sit beside the skill and are read before writing one", SP, "shapes are in `shapes.md` beside this file"),
    ("v15", "task-spec: other references and decision records are read on demand", SP, "as described in `references.md` beside this file"),
    ("v15", "task-spec: reversible assumptions proceed, irreversible ones wait", SP, "Irreversible ones wait for the user"),
    ("v15", "A skill loads once in a session, again only when its file changed", W, "once in a session, and again only when its file changed after it was loaded"),
    ("v15", "The full T1+ report shape is read on demand from the message-shapes file", C, "read its full shape and rules in the message-shapes file"),
    ("v15", "A diagram's rules are read on demand", C, "read when one is worth it in the message-shapes file"),
    ("v15", "The message-shapes file has a place", PL, "message shapes"),
    ("v15", "When a diagram is worth it: the reader holds several pieces at once", MS, "ASCII boxes, vertical first, real names, no Mermaid"),
    ("v15", "The T1+ report's first line says what the reader must do", MS, "The first line says what the reader must do"),
    ("v15", "Explore, the search agent, runs on Haiku: a user agent of that name overrides the built-in", EX, "model: haiku"),
    ("v15", "Explore changes nothing: read-only commands only", EX, "You change nothing"),
]


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


# Every default path lives in one table, in places.md. Outside it, the
# layer-1 files name a place by its role; a literal path there is a hard-code.
# A skill or subagent name appears only in its own frontmatter.
NAMED = [W, C, MS, SP, TSH, TSR, VE, RE, RT, PI, PA, AG, EX]

# Layer-2 kit skills get the cross-reference check (bad_refs) like layer-1 -
# a §-number or a doc filename is a rot-prone reference, and a (Doc, Heading)
# must name a real heading. They do NOT get hard_coded/not_generic: a kit
# skill legitimately names docs/product and .work paths as its conventions.
PK_SKILLS = sorted(str(p.relative_to(ROOT)) for p in (ROOT / PK).glob("*/SKILL.md"))


def literals() -> tuple[set[str], set[str]]:
    paths = {"~/.claude/"}
    for row in re.findall(r"^\|[^|]+\|(.+)\|$", (ROOT / PL).read_text(encoding="utf-8"), flags=re.M):
        for lit in re.findall(r"`([^`]+)`", row):
            if not lit.startswith("<"):  # `<task folder>/spec.md` is a role, not a path
                paths.add(lit.rstrip("/"))
    names = set()
    for f in [*sorted((ROOT / "skills").glob("*/SKILL.md")), *sorted((ROOT / "agents").glob("*.md"))]:
        if m := re.search(r"^name:\s*(\S+)", f.read_text(encoding="utf-8"), flags=re.M):
            names.add(f"`{m.group(1)}`")
    return paths, names


def hard_coded() -> list[str]:
    """Each line, outside places.md and frontmatter, that holds a path or a name."""
    paths, names = literals()
    hits = []
    for dest in NAMED:
        lines = (ROOT / dest).read_text(encoding="utf-8").splitlines()
        front = lines[0] == "---"
        for n, line in enumerate(lines, 1):
            if front:
                front = not (n > 1 and line == "---")
                continue  # frontmatter: a skill states its own name
            for lit in sorted(paths | names):
                if lit in line:
                    hits.append(f"HARD-CODED  {dest}:{n}  {lit}")
    return hits


# Cross-references name a section, never a number or a file:
# "(Communication, Report of finished work)". Each must match a heading of that document.
DOCS = {"Workflow": W, "Communication": C, "Places": PL}


def headings(dest: str) -> set[str]:
    titles, fence = set(), False
    for line in (ROOT / dest).read_text(encoding="utf-8").splitlines():
        if line.startswith("```"):
            fence = not fence  # template headings inside a shape are not sections
        elif not fence and (m := re.match(r"#{1,4} (?:\d+\. )?(.+?)(?: \(.*\))?$", line)):
            titles.add(m.group(1))
    return titles


def bad_refs() -> list[str]:
    titles = {doc: headings(dest) for doc, dest in DOCS.items()}
    found = []
    for dest in NAMED + PK_SKILLS:
        text = (ROOT / dest).read_text(encoding="utf-8")
        line = lambda m: text.count("\n", 0, m.start()) + 1
        for m in re.finditer(r"§\d+|\b(?:workflow|communication|places)\.md\b", text):
            found.append(f"NUMBERED-REF  {dest}:{line(m)}  {m.group(0)}")
        for m in re.finditer(r"\((Workflow|Communication|Places),\s+([^)]+?)\)", text):
            if norm(m.group(2)) not in titles[m.group(1)]:
                found.append(f"BROKEN-REF  {dest}:{line(m)}  {norm(m.group(0))}")
    return found


# The workflow is a guide: no file name, no path, no skill or subagent name.
FILE_NAME = r"\b[\w.-]+\.(?:md|py|json|mjs|js|ts|yml|yaml|sh|txt)\b"


def not_generic() -> list[str]:
    _, names = literals()
    bare = sorted(n.strip("`") for n in names if "-" in n)  # `retro` is also a plain word
    found = []
    for n, line in enumerate((ROOT / W).read_text(encoding="utf-8").splitlines(), 1):
        tokens = re.findall(FILE_NAME, line)
        tokens += [t for t in re.findall(r"`([^`]+)`", line) if "/" in t or t.startswith((".", "~"))]
        tokens += [b for b in bare if re.search(rf"\b{re.escape(b)}\b", line)]
        found += [f"NOT-GENERIC  {W}:{n}  {t}" for t in tokens]
    return found


# project-init installs by module: every kit skill must belong to exactly one
# module (or `shared`) in modules.json, or it silently never installs; every
# name in modules.json must have a skill folder, or the copy SKIP breaks.
def modules_cover() -> list[str]:
    m = json.loads((ROOT / "project-kit" / "modules.json").read_text(encoding="utf-8"))
    mapped = set(m["shared"])
    for v in m["modules"].values():
        mapped |= set(v["skills"])
    folders = {p.name for p in (ROOT / PK).glob("*/") if (p / "SKILL.md").exists()}
    return [f"MODULE-NO-SKILL  modules.json names '{n}', no skill folder" for n in sorted(mapped - folders)] + [
        f"SKILL-NO-MODULE  skill '{n}' is in no module, would never install" for n in sorted(folders - mapped)
    ]


# Skill shape (docs/skill-authoring.md): frontmatter that parses, a description
# within its limits, and for a rewritten project skill a workflow with a
# copyable checklist and a Start when. UI skills wait for a UI project;
# qa-foundations is a reference read by path, not a workflow.
SHAPE_EXEMPT = {"design-system", "visual-review", "qa-sweep", "playwright-cli", "qa-foundations"}


def frontmatter(text):
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end < 0:
        return None
    fields = {}
    for line in text[4:end].splitlines():
        if not line.strip():
            continue
        key, sep, value = line.partition(": ")
        if not sep:
            return None
        fields[key.strip()] = value.strip()
    return fields


def skill_shape() -> list[str]:
    found = []
    files = sorted((ROOT / "skills").glob("*/SKILL.md")) + sorted((ROOT / PK).glob("*/SKILL.md"))
    for f in files:
        rel, text = str(f.relative_to(ROOT)), f.read_text(encoding="utf-8")
        fm = frontmatter(text)
        if fm is None:
            found.append(f"SKILL-SHAPE  {rel}  frontmatter does not parse as key: value lines")
            continue
        desc, wtu = fm.get("description", ""), fm.get("when_to_use", "")
        if not desc or len(desc) > 1024:
            found.append(f"SKILL-SHAPE  {rel}  description empty or over 1,024 characters ({len(desc)})")
        if len(desc) + len(wtu) > 1536:
            found.append(f"SKILL-SHAPE  {rel}  description + when_to_use over the 1,536-character listing cap")
        for key in ("description", "when_to_use"):
            if ": " in fm.get(key, ""):
                found.append(f"SKILL-SHAPE  {rel}  '{key}' holds ': ', which YAML reads as a nested mapping")
        if text.count("\n") >= 500:
            found.append(f"SKILL-SHAPE  {rel}  500 lines or more")
        if rel.startswith(PK) and f.parent.name not in SHAPE_EXEMPT:
            if "## Workflow" not in text or "- [ ]" not in text:
                found.append(f"SKILL-SHAPE  {rel}  no '## Workflow' with a copyable checklist")
            if "## Start when" not in text:
                found.append(f"SKILL-SHAPE  {rel}  no '## Start when'")
    return found


def main() -> int:
    hits = hard_coded() + bad_refs() + not_generic() + modules_cover() + skill_shape()
    for h in hits:
        print(h)
    print(f"{len(hits)} hard-coded names or references")

    cache: dict[str, str] = {}
    misses = []
    for sec, idea, dest, phrase in ROWS:
        if dest not in cache:
            p = ROOT / dest
            cache[dest] = norm(p.read_text(encoding="utf-8")) if p.exists() else ""
        if norm(phrase) not in cache[dest]:
            misses.append((sec, idea, dest))
    for m in misses:
        print(f"MISSING  {m[0]:<10} {m[1]}  →  {m[2]}")
    print(f"{len(ROWS) - len(misses)}/{len(ROWS)} ideas traced")

    if "--md" in sys.argv and not misses:
        lines = [
            "# Traceability: the 214-line workflow → the new files",
            "",
            "Generated by `python3 docs/trace.py --md`. Each row is one idea of the original",
            "`archive/workflow-v1-long.md`, where it lives now, and the phrase the script",
            "checks for there. Re-run after editing any file: a missing phrase fails the check.",
            "",
            "| Original | Idea | Now in | Checked phrase |",
            "|---|---|---|---|",
        ]
        for sec, idea, dest, phrase in ROWS:
            lines.append(f"| {sec} | {idea} | `{dest}` | {norm(phrase).replace('|', '¦')} |")
        counts: dict[str, int] = {}
        for _, _, dest, _ in ROWS:
            counts[dest] = counts.get(dest, 0) + 1
        lines += ["", "## Ideas per destination", "", "| File | Ideas |", "|---|---|"]
        lines += [f"| `{d}` | {n} |" for d, n in sorted(counts.items(), key=lambda x: -x[1])]
        (ROOT / "docs" / "TRACEABILITY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("wrote docs/TRACEABILITY.md")
    return 1 if misses or hits else 0


if __name__ == "__main__":
    sys.exit(main())
