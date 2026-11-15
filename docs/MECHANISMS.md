# Enforcement mechanisms

*Instructions for judgment; mechanisms for enforcement.* Each mechanism below
takes one rule out of Claude's memory and puts it somewhere it cannot be
skipped. Each one also has a limit: it enforces only what a machine can
check, and the judgment on top stays with the skills and with you.

A mechanism never seen to block is not yet trusted, so each one comes with a
**negative test** (it blocks what it should) and a **positive test** (it does
not block what it should allow). A mechanism that blocks by mistake gets
switched off, and then protects nothing.

| Mechanism | Enforces | Does NOT enforce | Tests |
|---|---|---|---|
| Plan mode | No file edits before you approve the plan | That the plan is any good | manual, below |
| Stop hook `require_tests.py` | The project's tests ran after the last code edit in the turn | That they passed, or that they test the right thing | **automated**: 22 tests + mutation check |
| SessionStart hook `after_compact.py` | After a compaction, Claude is told which loaded skills changed on disk and which language the user writes in | That Claude loads them again, or replies in that language | **automated**: 21 tests + 17 mutants; live run below |
| UserPromptSubmit hook `gap_question.py` | When the user's typed message asks what something is, why, or whether they read it right (or is `??`), Claude is reminded to explain another way and reopen a pick that rested on it | That Claude does it; that the message was a real gap (a status question such as "layout bị dính ah?", is the layout overlapping?, still fires); the check before Claude asks for a decision | **automated**: 18 tests + 35 mutants; live run below |
| UserPromptSubmit hook `secret_guard.py` | A message holding a certain secret (a GitHub, Anthropic or AWS key, a private key, a JWT, a credential header or session cookie with a real-looking value), in its text or in a text file it `@`-mentions, is stopped before it reaches Claude; with gitleaks installed, its other findings warn | That the secret stays off the disk (the transcript may still hold the message); secrets of other forms without gitleaks; past the first 1 MB of a mentioned file; secrets in images, or in files Claude reads | 27 automated + live, below |
| Subagent `reviewer` | The reviewer's context holds none of the writer's reasoning, and it has no edit tools | That it finds the right problems; Bash can still write files, so "do not modify" is an instruction, not a guarantee | manual, below |
| Deny rules for secret files | Claude's file tools, `@` mentions and the Bash file commands it recognises (`cat`, `head`, `sed`…) cannot read `.env` files and key files under the working directory, nor the credential files in the home folder (`~/.aws/credentials`, SSH private keys…) | `grep -r` from the folder, or a script that opens the file itself; `.env` files in a parent folder; a credential file the list does not name | manual + live, below |
| PreToolUse hook `env_read_guard.py` | A Bash command that names a file a `Read(...)` deny rule protects (`grep KEY .env`, `python3 -c "open('.env')"`), prints every environment variable, or prints one whose name marks it as a secret, is denied before it runs | A command that reads without naming the file (`grep -r`), a script that opens the file or prints the environment itself; a file named only in prose is let through on purpose | **automated**: 17 tests + 32 mutants; live run below |

---

## 1. Plan mode → the approval gate

**Install.** Nothing to install. Claude can enter Plan mode itself; leaving
it needs your approval. You can also enter it with Shift+Tab until the status
bar shows plan mode, or start with `claude --permission-mode plan`. Do not
make it the default for every session: small tasks have no gate.

**Enforces.** While in Plan mode, Claude reads and plans but cannot edit
files or run changing commands. Approval is you accepting the plan.

**Does not enforce.** The quality of the plan, or that Claude uses Plan mode
for a medium task at all. The workflow tells it to; if it skips, that is a
judgment failure you will see as edits without a plan.

**Negative test** (must block):
1. In a scratch repo, enter Plan mode.
2. Ask: "change the greeting in hello.py to 'hi'".
3. Expect a plan, and `git status` showing no change.

**Positive test** (must allow):
1. Accept the plan.
2. Expect the edit to happen and `git diff` to show it.

---

## 2. Stop hook → tests must have run

**Install.**
```bash
mkdir -p ~/.claude/hooks
cp hooks/require_tests.py ~/.claude/hooks/
```
Merge `settings.snippet.json` into `~/.claude/settings.json` (keep any hooks
you already have). Run `/hooks` in Claude Code to confirm it is listed.
Needs `python3` on PATH.

**How it finds the test command.** For each edited file, a line in
`CLAUDE.md` or `AGENTS.md` (or `.claude/CLAUDE.md`), in that file's directory
or any parent up to its repo root. The session's working directory plays no
part, so a session working from its scratchpad still finds the repository's
command:
```
Test command: `npm test`
```
Several lines are allowed; any one counts. `Test command: \`none\`` turns the
gate off for a project with no tests. Without a line, it falls back to
recognising common test commands, and its message asks Claude to add the line.

**Enforces.** When a turn edited a code file (not `.md`, images and the like,
nor any file in a `docs` folder at the root of the repository or of a package,
which is a folder holding `package.json`, `pyproject.toml`, `go.mod` and the
like) inside a git repository, it cannot end until that repository's test command
has run after the edit. A turn that edits two repositories needs both test
runs. Files outside every repository, such as the scratchpad or `/tmp`, never
count: they are throwaway scripts, and re-running a project's full suite for
them only costs time. It blocks
once per turn: if Claude stops again, it is let through and must report the
tests as `[unverified]` rather than loop. `CLAUDE_SKIP_TEST_GATE=1` disables it.

**Does not enforce.** Passing tests, meaningful tests, edits made through
Bash (`sed -i`, scripts) rather than the edit tools, or code in a folder that
is not a git repository: such a project is not gated at all. Those stay with the
`verify-work` skill and with review.

**Automated tests.**
```bash
cd hooks && python3 -m unittest test_require_tests.py -v
```
26 tests. Negative: edit without tests, tests before the last edit, a
different command, no declaration, tests from an earlier turn, a repo edit
while working from the scratchpad, two repos edited and only one tested, a
`docs` folder inside the code (a web app's `app/docs/` route), a code file
named `docs.ts`. Positive: declared command after the edit, AGENTS.md,
several declared commands, common command without declaration, docs-only
edits, an HTML page in the root `docs` folder, a package's `docs` folder, no
edits,
earlier-turn edits, `none`, second stop, escape hatch, malformed input,
declaration in a parent directory, scratchpad-only edits, a scratchpad edit
after the tests, the repo's command found when working from the scratchpad.

Checked the checks: 8 deliberate bugs were put into copies of the hook. The
first run caught 6; the two it missed (looking at the whole transcript
instead of the current turn, and not searching parent directories) each got
a new test, and all 8 are now caught. On 2026-11-05 the rule "only files in
a repository count" got three mutations of its own (no repository filter, the
command looked up from the working directory, one repository's tests counting
for all); each made a new test fail.

**Live negative test** (in Claude Code, on your machine):
1. In a repo whose CLAUDE.md has `Test command: \`npm test\``, ask Claude to
   change one line of code and "do not run anything".
2. Expect Claude to be stopped with the hook's message, then to run
   `npm test`, or to report the tests as `[unverified]`.

**Live positive test:** ask for a docs-only change (a README line). Expect no
interruption.

**Not yet checked:** the transcript format the hook parses was reconstructed
from Claude Code's documented JSONL shape (entries with `type`, and
`message.content` blocks of `tool_use`/`tool_result`) and tested on synthetic
transcripts. Run the live tests once to confirm it reads real ones.

---

## 3. Subagent `reviewer` → independent review

**Install.**
```bash
mkdir -p ~/.claude/agents
cp agents/reviewer.md ~/.claude/agents/
```
Run `/agents` to confirm it is listed.

**Enforces.** A separate context: the reviewer sees only what it is handed,
not the conversation that produced the work. Its tools are limited to Read,
Grep, Glob, Bash and Skill (to load the review skill itself), so it has no
edit tools.

**Does not enforce.** That it is handed only the object and the reference
(the `review-work` skill tells the main session to), that it finds the right
problems, or that it never writes through Bash.

**Negative test** (must catch): seed it.
1. On a branch, make a working change, then add 2–3 realistic bugs to it
   (flip a comparison, drop an error branch, skip a validation).
2. Ask: "use the reviewer subagent to review the diff against <spec>".
3. Count the seeded bugs it reports as `issue`. Missing ones show what kind
   of bug it is blind to.

**Positive test** (must not cry wolf):
1. Review a small, correct change against its spec.
2. Expect no `issue (blocking)`. Blocking findings on correct code mean it
   is over-reporting; tighten the reference you give it.

Remove the seeded bugs afterwards (`git checkout` the branch).

---

## 4. Deny rules → secrets stay out of the context

**Install.** Merge the `permissions` block of `settings.snippet.json` into
`~/.claude/settings.json`, keeping any rules you already have. Run
`/permissions` to confirm the rules are listed.

**Enforces.** The list names only files that are certainly secrets and that
Claude does not need to read to do its work:
- **In the project, at any depth** (a bare file name matches at any depth
  under the current directory): `.env`, `.env.*`, `.envrc`, and key files
  (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`).
  `.env.example`, `.env.sample` and `.env.template` stay readable: they hold
  variable names, not values.
- **In the home folder:** SSH private keys by name (`~/.ssh/id_rsa`,
  `id_ed25519` and the other kinds), `~/.aws/credentials`, `~/.netrc`,
  `~/.git-credentials`, `~/.npmrc`, `~/.pypirc`, `~/.docker/config.json`,
  `~/.kube/config` and `~/.config/gh/hosts.yml`.

The rules cover Claude's own file tools (Read, Grep, Glob), files the user
`@`-mentions, and the file commands Claude Code recognises in Bash, such as
`cat`, `head`, `tail`, `sed` and redirections
([permissions docs](https://code.claude.com/docs/en/permissions#read-and-edit)).
The SSH keys are listed by name rather than as `~/.ssh/id_*`, because a `!`
carve-out is read relative to the current directory and cannot reopen
`~/.ssh/id_ed25519.pub` under a `~/` rule.

**Files that only sometimes hold a secret are yours to add**, in the same
syntax: shell profiles (`Read(~/.zshrc)`, `Read(~/.zprofile)`), where keys
are often exported, or `Read(**/*.properties)` in a Java project. They are
not in the default list because Claude reads them for ordinary work
(`application.properties`, a PATH problem), and a guard that blocks ordinary
work gets switched off. The Bash hook `env_read_guard.py` (section 4b)
reads this same list, so one rule covers both.

**Does not enforce.** A command that hands the file to a program Claude Code
does not recognise (`grep KEY .env`, `python3 -c "open('.env')"`): the Bash
hook in section 4b catches those. A command that reads without naming the
file (`grep -r TOKEN .` from the folder), a Python or Node script that opens
the file itself, and `.env` files above the working directory: blocking those
takes the OS sandbox (section 4b), not a permission rule.

**Negative test** (must block):
1. In a scratch folder: `echo 'API_KEY=secret123' > .env`.
2. Ask Claude: "read .env and tell me the key", then "run `cat .env`".
3. Expect both to be refused by the deny rule, and `secret123` never shown.

**Positive test** (must allow):
1. `echo 'API_KEY=' > .env.example` in the same folder.
2. Ask Claude to read `.env.example`.
3. Expect it to read the file without a prompt.

**Checked** with Claude Code 2.1.261, headless (`claude -p --settings`)
in a scratch folder holding `.env`, `sub/.env.local` and `.env.example`:
with the rules, the Read tool was refused on both secret files and
`cat .env sub/.env.local` (allowed as `Bash(cat:*)`) was refused, while
`.env.example` was read. Without the rules, the same Read and the same `cat`
printed both secrets, so the refusals came from these rules. Not checked:
the rules in `~/.claude/settings.json` rather than `--settings`, and the
interactive session.

**Checked** again on 15 Nov 2026 with the full list, headless, in a scratch
folder holding a fake `.env`, `.env.sample` and `certs/server.pem`, plus a
fake file in the home folder under a `~/` rule built the same way as the
credential rules: the Read tool was refused on `.env`, on `certs/server.pem`
(a bare `*.pem` matching one folder down) and on the home file; `cat` of all
three was refused; `.env.sample` was read. None of the fake values appeared
in the output. Without the new rules, the same Read printed both
`certs/server.pem` and the home file, so the refusals came from them. The
real home files were not used, so that a rule that failed could not show a
real key.

---

## 4b. PreToolUse hook → a Bash command does not print a protected file or a key

**Install.** Copy `hooks/env_read_guard.py` to `~/.claude/hooks/` and merge
the `PreToolUse` entry of `settings.snippet.json` into
`~/.claude/settings.json`.

**Enforces.** Before a Bash command runs, the hook denies it when it:
- **names a file a `Read(...)` deny rule protects**, in a way Claude Code's
  own check misses: `grep API_KEY .env`, `awk -F= '{print $2}' ~/.zshrc`,
  `python3 -c "print(open('.env').read())"`, `$(cat .env)` inside another
  command, a glob such as `cat .env*`, a heredoc of code fed to an
  interpreter, `curl -d @.env` (which sends it out), or `cat credentials`
  after a `cd ~/.aws` earlier in the same command. The code of `bash -c`,
  `sh -c` and `zsh -c` is checked as a command of its own, for files and for
  the environment alike. The rules are read from `~/.claude/settings.json`
  and the project's `.claude/settings.json` and `.claude/settings.local.json`,
  with Claude Code's anchors and carve-outs, so the list is kept in one place
  (section 4). A bare name (`.env`, `*.pem`) counts anywhere on the machine;
- **prints every environment variable**: `printenv`, `env`, `export`,
  `export -p`, `declare -x` or `set`, alone or piped. Keys exported by a shell
  profile live there;
- **prints a variable whose name marks it as a secret**: `echo $GITHUB_TOKEN`,
  `printenv AWS_SECRET_ACCESS_KEY`, `echo "${!API_KEY}"`, where a part of the
  name between underscores is KEY, TOKEN, SECRET, PASSWORD, PASSWD, PASS,
  CREDENTIAL, CREDS, AUTH or PRIVATE, or one of APIKEY, ACCESSKEY, SECRETKEY,
  PRIVATEKEY, ACCESSTOKEN, AUTHTOKEN. A name whose last part says it is about
  the secret rather than the secret (`API_KEY_ID`, `SSH_AUTH_SOCK`,
  `GITHUB_TOKEN_FILE`: ID, FILE, PATH, URL, PORT, SOCK, HOST, USER, NAME, DIR,
  TYPE, REGION, ENDPOINT) passes, and so does `$MONKEY`.

Claude sees why, with the rule and the file it came from:
"env_read_guard stopped this command: it names .env, which the rule
Read(.env) in ~/.claude/settings.json protects, so the file's contents would
reach the model. Work from an example file (such as .env.example) or ask the
user for the names you need."

It lets through a command that uses, loads, checks, moves or deletes a
protected file without printing it: `source .env`, `ls -la .env`,
`test -f .env`, `rm`, `>> .env`; `ssh -i ~/.ssh/id_ed25519`, `scp`,
`ssh-add`, `ssh-keygen`; `git add`, `rm`, `mv`, `checkout`, `restore`,
`reset`, `commit`, `status`, `ls-files` and `check-ignore` (but not
`git diff .env` or `git show HEAD:.env`, which print it); `cp`/`mv` to a name
that is protected too (`mv .env.bak .env`; `mv .env /tmp/x` is denied); the
value of `--env-file`, `--kubeconfig`, `--cacert`, `--capath`, `--cert`,
`--key` and `--netrc-file`; and the program being run (`.env/bin/python`,
where `.env` is a virtualenv). It also lets through a secret variable used
rather than printed (`curl -H "api-key: $KEY"`), and a file named only in
prose: a commit message, a PR title, an echoed sentence, a heredoc of text. A
guard that blocked those would block ordinary work and be switched off.

**Does not enforce.**
- A command that reads without naming the file (`grep -r TOKEN .`), and a
  script file that opens it itself (`python3 load.py`).
- A script that prints the environment (`node -e "console.log(process.env)"`,
  `python3 -c "import os; print(os.environ)"`), and a secret kept in a
  variable with an ordinary name.
- A path with a space in it, which reads as prose.

It denies on purpose, at the cost of some ordinary work: `openssl` on a
protected file, because `openssl rsa -in key.pem -text` prints a private
key, so `openssl x509 -in cert.pem -text` on a public certificate is denied
too; and a command that names a file inside a folder that a bare rule
matches (`cat .env/pyvenv.cfg` in a virtualenv named `.env`), as Claude
Code's own Read rule does.

The OS sandbox covers the first: with `sandbox.enabled`, Claude Code merges
the `Read(...)` deny rules into it and enforces them for every Bash command
and its child processes, scripts included
([sandboxing docs](https://code.claude.com/docs/en/sandboxing)). It is off
by default, and turning it on also limits writes and network for every Bash
command, so try it in one project before turning it on everywhere. Nothing
here hides the environment from a script.

`CLAUDE_SKIP_ENV_READ_GUARD=1` in the environment turns the hook off. Input it
cannot read, or an error of its own, lets the command run with a warning that
it was not checked.

**Automated tests.**
```bash
cd hooks && python3 -m unittest test_env_read_guard.py -v
```
17 tests, each in a home folder and a project folder of its own, so no real
settings are read. Two are properties over 150 generated commands each: an
ordinary chain of commands is never denied, and a reading command naming a
protected file, behind any prefix, always is. The others: every form above
denied, every allowed form let through,
rules from project and local settings, an absolute rule, carve-outs in both
directions (a `!` listed first carves nothing; a `!` cannot reopen a file
under a `~/` rule, run from the home folder as in the docs' own example),
broken settings, broken input, the switch.

Checked the checks: 32 mutants, each removing one rule from a copy of the
hook. The first run let one survive: a `!` rule reopening a file under a
`~/` rule, because the test's carve-out could not match from the project
folder; the case now runs from the home folder. A later run let another
survive: inline code with spaces in it went unread once `bash -c` code was
checked as a command of its own, since no other case had spaces; a
`python3 -c` and a `node -e` case now cover it. 32 of 32 make a test fail.

An independent review (a fresh reviewer, about 190 commands run through the
hook) found the first version denied `ssh -i`, `ssh-add`, `kubectl
--kubeconfig`, `curl --cacert`, non-printing `git` subcommands and a
virtualenv named `.env`; let `bash -c 'env | sort'`, `sh -c 'echo $API_KEY'`,
`${!API_KEY}`, `curl -d @.env` and `cd ~/.aws && cat credentials` through;
and took `$MONKEY` and `$SSH_AUTH_SOCK` for secrets. Each became a test,
seen failing, before the fix.

**Checked** headless on 15 Nov 2026, in a scratch folder holding a fake
`.env` and `.env.example`, the hook in the project's settings, and the
environment cleared down to a fake `FAKE_DEMO_TOKEN` so that a failure could
not print a real key: `grep API_KEY .env`, the `python3 -c` read, `printenv`
and `echo $FAKE_DEMO_TOKEN` were denied with the reasons above; `echo $HOME`
and `cat .env.example` ran. None of the fake values appeared in the output.
After the review fixes, the same way: `bash -c "env | sort"`,
`curl -d @.env`, `cd .. && cd s2 && grep API_KEY .env` and
`sh -c "echo $FAKE_DEMO_TOKEN"` were denied; `git status --short .env` and
`echo $SSH_AUTH_SOCK` ran; no fake value in the output.

**Not yet checked:** the interactive session.

---

## 5. SessionStart hook → skills and language after a compaction

**Why.** After a compaction, Claude Code puts back the skills the session
loaded with the text they had when loaded, while the prompts are read again
from disk. A skill edited since then stays old in the context, and Claude,
seeing it there, does not load it again. Seen in one session of five days:
from its third day on it wrote 16 specs and ran 8 reviews without loading a
skill, on texts from its first day that lacked rules added since. After one
compaction its replies also drifted into English, the summary's language,
for three hours.

**Install.**
```bash
cp hooks/after_compact.py ~/.claude/hooks/
```
Merge the `SessionStart` entry of `settings.snippet.json` (matcher
`compact`) into `~/.claude/settings.json`. Needs `python3` on PATH.

**Enforces.** Right after a compaction, the context gets two lines, each
opening with what to do: load a skill again with the Skill tool before the
step that uses it, naming the skills loaded in this session and marking each
one whose `SKILL.md` changed after it was last loaded; and reply in the
user's language, quoting the start of their last three messages that hold
prose (pasted blocks, tables and code left out). An unreadable transcript
still gives the general lines. It never blocks.

**Does not enforce.** That Claude loads the skills or keeps the language: it
is a reminder in the context, not a check. Skills from plugins are listed but
never marked, since their files are not looked up.

**Automated tests.**
```bash
cd hooks && python3 -m unittest test_after_compact.py -v
```
21 tests: a skill unchanged or changed since loading, the latest load
counting, typed `/skill` commands but not built-in commands, project skills
before personal ones, plugin skills, subagent calls and a skill's own text
ignored; the language quotes skipping short replies, tool results,
notifications, the summary, pasted blocks with their real closing tag
(`</pasted_content id="…">`), tables and code; at most three quotes, each
cut at 100 characters; other session sources, malformed input, a missing,
empty or cut-off transcript, a missing timestamp.

Checked the checks: 17 mutants, each removing one of those rules from a copy
of the hook; all 17 made a test fail. The first round let two survive (a
tool result row with a text block, a built-in command hidden by the word
"compacted"); a later change let four survive (tests that the right quote
was present, not that the wrong one was absent). Each got a test.

**Checked** with Claude Code 2.1.261 on real transcripts: a 59 MB one gave
its 4 skills in 0.2 s, marking the 3 changed since loading, and a 348 MB one
took 0.7 s. Live, headless (`claude -p --settings`, `/compact` on a resumed
session): the hook ran as `SessionStart:compact`, and its lines reached the
model inside a system reminder. The first wording opened with "Context was
compacted.", and the model, asked to quote what the hook said, called it a
status note and quoted only that line, so each line now opens with what to
do.

**Not yet checked:** whether the reminder changes what Claude does. A
headless test (a skill saying BLUE, loaded, compacted, then edited to say
GREEN) answered GREEN with and without the hook: headless sessions did not put
the old skill text back after compaction, so Claude loaded it again on its
own. The case seen in the IDE, where the old text comes back, was not
reproduced.

---

## 6. UserPromptSubmit hook → a gap question reopens what rested on it

**Why.** The user rarely says when an explanation did not land, and silence,
`ok` or a pick was read as understanding. In one session (8–10/11/2026) the
user decided three times before understanding the issue and asked about it
afterwards: wrote "xem xét bỏ qa-sweep" (consider dropping qa-sweep), then
"qa-sweep được dùng khi nào trong SDLC?" (when is qa-sweep used in the SDLC?),
and once told, kept it; approved the measurement tools and their pull
request, then asked what churn, trace_rollup, compare, judge and history are;
picked the Appium 4 upgrade, then asked "Vấn đề ios typing là gì?" (what is
the iOS typing problem?), and the upgrade was rolled back. The Communication rule on briefs ("if they must
ask what this is about, the brief did not happen") was in the context each
time and was not acted on.

**Install.**
```bash
cp hooks/gap_question.py hooks/after_compact.py ~/.claude/hooks/
```
Merge the `UserPromptSubmit` entry of `settings.snippet.json` into
`~/.claude/settings.json`. The hook imports its text filters from
`after_compact.py`, which must sit beside it. Needs `python3` on PATH.

**Enforces.** When the text the user typed (pasted blocks, system reminders,
code fences, harness notices and messages from other Claude sessions left
out) asks what something is, why, how it differs, when it is used, or whether
they read it right (Vietnamese "là gì" what is, "tại sao" why, "khác gì" how
does it differ, "khi nào" when, "đúng ko" right?, a closing "… ah?", and the
English forms), the context gets one reminder quoting the
matched phrase: if the question builds correctly, confirm it and go one level
deeper; otherwise answer from one real case, explain another way if it was
explained before, and restate any pick that rested on it and ask whether it
still holds. A question pattern counts only in a sentence that ends in "?", so
an instruction ("Chạy test khi nào xong thì báo", run the tests and tell me
when they finish) does not fire. A next step ("tiếp theo là gì ?", what's
next?), a status ("s22 code xong rồi ah ?", is the s22 code done?) or a plan
("ta cần làm gì ?", what do we need to do?) in the same sentence cancels the
match. `??` gets a reminder to say
the last message again another way. It never blocks: any error, a missing
`after_compact.py` or `python3 -I` exits 0 without a traceback.

**Does not enforce.** That Claude acts on it. That the message was a real gap.
Replayed on the 1119 distinct messages of 400 characters or fewer that the
user typed in the sessions on this machine (`~/.claude/projects/*/*.jsonl`,
this one included), the first
version fired on 185 (16.5%), about half of a random 30 of them not gaps (next
steps, status questions, instructions); this version fires on 149 (13.3%), and
in a random 30 of those about 6 are not gaps (status questions such as "Vẫn
đang chạy đúng ko?", still running, right?, or "layout bị dính ah?", is the
layout overlapping?, a complaint). Those labels are
Claude's. The reminder tells Claude to just answer such a message. The other
half of the rule, one check question before Claude asks for a decision,
happens in Claude's own message, where no prompt hook looks: it stays with
the Communication rules.

**Automated tests.**
```bash
cd hooks && python3 -m unittest test_gap_question.py -v
```
18 tests: 16 gap questions and 29 plain messages the user typed (the session
above, plus the status and next-step questions the review found in earlier
sessions), labelled by hand; 8 written gap cases, one for each pattern no real
message exercises alone, and 6 written plain ones (instructions without "?",
"tiếp theo làm gì ?" (what to do next?), "what's next?"); a known false
positive that still
fires; `??` alone, with spaces or with text after it; pasted blocks, system
reminders, code fences, harness notices and another session's message not
read; bad input (empty, not JSON, a list, `{}`, a JSON string, a non-string,
empty or null prompt, JSON cut off midway) silent with exit 0; the hook copied
without `after_compact.py`, and run with `python3 -I`; a 200 KB prompt
answered in under 2 s; the sizes of the case lists. Two properties: 40 seeded
random prompts (gap words, "?", fences, pasted tags, an unpaired surrogate, a
null byte) each exit 0 with nothing on stderr; and for every case above,
pasting any text in a block after it leaves the answer unchanged. Each
property was seen failing on a failure written from the spec: a debug line on
stderr, an unguarded error, pasted blocks read.

Checked the checks: 35 mutants, each removing one rule from a copy of the
hook (each of the 17 patterns; the pasted-block, fence, harness-text and
other-session filters; `??`; the "?" sentence rule; a dot inside
`compare.py` not ending the sentence; the next-step, status and plan words;
the import guard and the sys.path line; the exception guard; the event name;
the quoted match; the reopen and go-deeper instructions). 34 made a test fail.
The survivor drops the check that `prompt` is a string, which the exception
guard also covers, so the hook's behaviour does not change (an equivalent
mutant). The first run of this set let three survive: the fence, harness-text
and other-session tests held no "?", so the new sentence rule kept them silent
whether or not their filter worked; each now holds a question.

Review (a fresh-context reviewer on another model) found the noise above and
the import outside the guard; both are fixed here. Live, the hook also fired on
a subagent's report that quoted "là gì", which is why messages from other
sessions are now skipped.

**Checked** with Claude Code 2.1.261, headless (`claude -p --settings` holding
only this hook). For "slice C3-ii là gì?" (what is slice C3-ii?) the
transcript holds an `attachment` of type `hook_additional_context` (hookEvent
`UserPromptSubmit`) with the reminder, and the model, asked to quote any hook
reminder, gave its first twelve words. For a plain message ("Viết đúng chữ:
xin chào …", write exactly: hello …) it answered "KHÔNG CÓ" (none).
Registered in `~/.claude/settings.json` instead, the same "slice C3-ii là
gì?" run (one turn) quoted the reminder too. In one run that first
made tool calls ("qa-sweep được dùng khi nào? …", six turns), the transcript
held the reminder but the model answered that there was none: being in the
context does not mean it is noticed (one run). After the review fixes, from
user settings: "slice C3-ii là gì? …" still had the reminder quoted, and
"tiếp theo là gì ? …" got none ("KHÔNG CÓ").

**Not yet checked:** whether the reminder changes what Claude does, that is,
whether it reopens an earlier pick in a real conversation; how often it goes
unnoticed after tool calls; the interactive session.

## 7. UserPromptSubmit hook → a secret in a message never reaches Claude

**Why.** A key pasted with a log, a curl command or a config file goes to the
model with the message. The deny rules (section 4) stop Claude reading `.env`
files; nothing stopped a person from pasting one.

**Install.**
```bash
cp hooks/secret_guard.py ~/.claude/hooks/
```
Merge the `secret_guard.py` entry of `UserPromptSubmit` in
`settings.snippet.json` into `~/.claude/settings.json`. Needs `python3` on
PATH. gitleaks is optional: when it is on PATH (`brew install gitleaks`), it
adds a second layer.

**Enforces.** Every message, pasted blocks included, is read before it is
sent. A long paste that Claude Code shows as `[Pasted text #N]` reaches the
hook in full ([hooks docs](https://code.claude.com/docs/en/hooks)). A file the
message `@`-mentions (`@logs/app.log`) reaches the hook only as its name, and
Claude Code attaches the content after the hook has run, so the hook opens
each mentioned text file itself (from the working folder, `~/` or an absolute
path) and scans it the same way: the first 1 MB, with a note when there was
more; binary files and folders are skipped. These forms block it:
- GitHub tokens, Anthropic keys, AWS access key ids, private key blocks and
  JWTs;
- a credential header (`Authorization`, `X-API-Key`, `X-Auth-Token` and the
  like) or a session cookie whose value looks real: 16 characters or more,
  letters and digits, not a placeholder such as `$TOKEN`, `${TOKEN}` or
  `<your-key>`;
- a `Basic` header that decodes to `user:password`.

The block message names each one by line and kind with the middle of the
value masked (`ghp_Ab…Yz12`), and by file for a mentioned file
(`file logs/app.log, line 42: GitHub token ghp_x8…TpdL`), and leaves the
message text out of itself
(`suppressOriginalPrompt`). With gitleaks installed, the message also goes to
`gitleaks stdin` for at most 2 seconds: a rule for one of the forms above
blocks, and any other rule (such as `generic-api-key`) only warns. When
gitleaks is missing, fails or is too slow, the patterns decide alone.

`[secret-ok]` at the start of a message sends it anyway, with a warning.
`CLAUDE_SKIP_SECRET_GUARD=1` turns the hook off. Input the hook cannot read,
or an error of its own, lets the message through with a warning that it was
not scanned.

**Does not enforce.**
- **That the secret stays off the disk.** This event cannot rewrite a
  message, only stop it, and Claude Code's documentation says a blocked
  message may still be saved locally (session transcript, prompt history).
  Measured: the transcript of a blocked headless run held the full message
  once, in a `queue-operation` entry. The hook keeps a secret from Claude, not
  off the machine: rotate a key that was pasted.
- **Secrets of other forms.** A password in prose, or a provider key with no
  fixed prefix, is caught only by gitleaks, and then only as a warning.
- **Secrets in images**, past the first 1 MB of a mentioned file, in a file
  attached without its name in the message text (if a client attaches files
  that way), or in files and command output Claude reads (sections 4 and 4b,
  and review, cover those).

**Automated tests.**
```bash
cd hooks && python3 -m unittest test_secret_guard.py -v
```
27 tests. Every key is fake and built at run time, so the test file holds
nothing a scanner takes for a key.
- **Blocks:** each of the six key kinds; a key inside a pasted block (named by
  its line), also on line 152 of a 200-line paste; five header forms (a curl
  bearer token, a raw `x-api-key` line, a long and a short `Basic` value, a
  session cookie, a header in code); the masked value shown; every secret of a
  message listed.
- **Mentioned files:** a key on line 120 of `@logs/app.log` blocks, naming the
  file and the line; a mention at the end of a sentence (`@logs/app.log.`), from
  `~/` and by absolute path; every mentioned file scanned, one named twice
  listed once; a clean file, a name that is no file, a folder, a binary file,
  an email address and `@property` pass silently; a key past the first 1 MB
  is not seen and the note says so, a key in the first line blocks;
  `[secret-ok]` sends the file too; a gitleaks finding in a file names the
  file and its own line.
- **Passes silently:** 17 ordinary messages, among them a sentence about a
  token's format, AWS's sample key, a PEM header line with no key,
  placeholders with and without digits, a dummy value, a harmless cookie, a
  commit hash, a UUID and the word "authorization" in prose. An empty message
  passes too.
- **The way out:** `[secret-ok]` first or after an IDE context block passes
  with a warning; `[secret-ok]` further down still blocks; the environment
  switch passes.
- **gitleaks:**
  - Missing: the patterns still block.
  - A generic finding warns; a finding for a key form the patterns missed
    blocks.
  - Hanging: given up in time. Failing: the patterns decide.
  - The real binary, when installed, agrees and answers in under 2 s.
- **Broken input** (not JSON, a list, a non-string prompt, no prompt, nothing)
  goes through with a "could not scan" warning.

Checked the checks: 18 mutants, each removing one rule from a copy of the
hook (pasted blocks skipped, the original prompt kept, no masking, AWS's
sample key blocked, placeholders or dummy values taken for keys, Basic not
decoded, any cookie counted, headers ignored, JWTs unknown, gitleaks not
given up, a generic finding blocking, a certain one ignored, the way out
read anywhere or missed after an IDE block, the switch ignored, broken input
blocked, line numbers off by one). The first run let one survive: the dummy
value `xxxx…` was already a placeholder, so the distinct-character rule was
never exercised; a case now covers it. 18 of 18 make a test fail.

The mentioned-file part, 15 Nov 2026: 12 mutants (no trailing punctuation
stripped, no `~/`, binary files scanned, no note past 1 MB, only the first
mention, files not scanned, the file not named, gitleaks lines not mapped
back to the file, an `@` inside a word counted, one file listed twice, and two
that lift the 1 MB limit). The first run let four survive; two cases (an email
address beside a file of that name, a file mentioned twice) now kill two of
them. The two that remain lift the limit in one place only: it is applied
when the file is read and again when it is scanned, so either one alone keeps
the result. 10 of 12 make a test fail.

**Checked** with Claude Code 2.1.261, headless (`claude -p --settings`
holding only this hook):
- **A fake GitHub token:** blocked with 0 model turns and no cost. The result
  showed `line 1: GitHub token ghp_zy…y3Rn`, with no `Original prompt` and no
  full key.
- **`[secret-ok]` first:** the message reached the model, and the transcript
  holds the warning as a `hook_system_message` attachment.
- **`API_SECRET=<40 random characters>`:** gitleaks' `generic-api-key` sent
  the message with a `hook_system_message` warning naming line 1.
- **`@logs/app.log why do requests fail?`**, with a fake GitHub token on line
  42 of a 79-line log (15 Nov 2026): blocked with 0 model turns and no cost,
  showing `file logs/app.log, line 42: GitHub token ghp_x8…TpdL`; the full
  token was nowhere in the output.

**Checked** in an interactive session (14 Nov 2026), with a fake token typed
into the prompt:
- The message never reached Claude.
- The user saw the block message as written, under Claude Code's own line
  "UserPromptSubmit operation blocked by hook:": `line 1: GitHub token
  ghp_33…3123`, then the `[secret-ok]` hint and the note that the text may
  stay on the machine.
- The transcript holds that message as a `system` entry, plus two
  `queue-operation` entries for the prompt.
- Pasting the block message back as a new message passed: the masked value
  is too short to match.

**Not yet checked:** how a warning (`[secret-ok]`, a generic gitleaks
finding, "could not scan") looks in the interactive session, and whether the
interactive prompt history keeps a blocked message. In the VS Code extension:
whether a long paste reaches the hook in full, and whether the attach button
writes the file's `@` name into the message, so that the hook can see it.

---

## Also: commit attribution

The workflow no longer tells Claude not to add co-author trailers; a setting
does it.

**Install.** Merge the `attribution` block of `settings.snippet.json` into
`~/.claude/settings.json`: `"attribution": {"commit": "", "pr": ""}`. An
empty string hides the attribution: no `Co-Authored-By` trailer on commits,
no "Generated with Claude Code" line in pull requests. `includeCoAuthoredBy`
is the deprecated name for the same thing.

**Enforces.** Claude Code tells Claude not to add attribution lines, instead
of telling it to add them.

**Does not enforce.** It is an instruction from Claude Code, not a check on
the commit: nothing inspects the message afterwards. A trailer asked for by
you or by a project's CLAUDE.md still goes in. Stripping trailers for certain
takes a `commit-msg` git hook.

**Checked** with Claude Code 2.1.261, headless (`claude -p --safe-mode
--settings`, so no CLAUDE.md is loaded), in scratch repositories, asking
Claude to commit a new file with a message it writes itself. Without the
setting, 3 of 3 commits ended with `Co-Authored-By: Claude Sonnet 5`. With
`"commit": ""`, 0 of 3 did. A test must let Claude write the message: given
the exact message, Claude added no trailer even without the setting. Not
checked: `"pr": ""` (no pull request was opened), the setting in
`~/.claude/settings.json` rather than `--settings`, and the interactive
session.
