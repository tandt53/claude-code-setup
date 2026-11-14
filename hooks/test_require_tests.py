"""
Tests for require_tests.py: positive cases (must NOT block) and negative
cases (must block). Run:  python3 -m unittest test_require_tests.py -v
Transcripts are synthetic, shaped like Claude Code's JSONL transcript.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).with_name("require_tests.py")


def prompt(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def tool(name, **inp):
    return {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": "t", "name": name, "input": inp}]}}


def result():
    return {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t", "content": "ok"}]}}


def edit(path):
    return [tool("Edit", file_path=path, old_string="a", new_string="b"), result()]


def bash(cmd):
    return [tool("Bash", command=cmd), result()]


class HookTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        (self.root / ".git").mkdir()

    def tearDown(self):
        self.dir.cleanup()

    def run_hook(self, entries, claude_md=None, agents_md=None, active=False, env=None):
        if claude_md is not None:
            (self.root / "CLAUDE.md").write_text(claude_md)
        if agents_md is not None:
            (self.root / "AGENTS.md").write_text(agents_md)
        tp = self.root / "t.jsonl"
        tp.write_text("\n".join(json.dumps(e) for e in entries))
        event = {"hook_event_name": "Stop", "transcript_path": str(tp), "cwd": str(self.root),
                 "stop_hook_active": active, "session_id": "s"}
        p = subprocess.run([sys.executable, str(HOOK)], input=json.dumps(event), text=True,
                           capture_output=True, env={**os.environ, **(env or {})})
        return p.returncode, p.stderr

    # ---- negative: must block ----

    def test_blocks_edit_without_tests(self):
        code, msg = self.run_hook([prompt("fix it"), *edit("src/a.ts")], claude_md="Test command: `npm test`\n")
        self.assertEqual(code, 2)
        self.assertIn("`npm test`", msg)
        self.assertIn("[unverified]", msg)

    def test_blocks_when_tests_ran_before_the_last_edit(self):
        entries = [prompt("fix"), *edit("src/a.ts"), *bash("npm test"), *edit("src/b.ts")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `npm test`")[0], 2)

    def test_blocks_when_a_different_command_ran(self):
        entries = [prompt("fix"), *edit("app.py"), *bash("python3 app.py")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `pytest -q`")[0], 2)

    def test_blocks_without_declaration_and_asks_for_the_line(self):
        code, msg = self.run_hook([prompt("fix"), *edit("main.go")])
        self.assertEqual(code, 2)
        self.assertIn("Test command:", msg)

    def test_blocks_a_docs_folder_that_is_part_of_the_code(self):
        # A web app can serve app/docs/page.tsx at /docs: app/ is no package root.
        entries = [prompt("fix the docs page"), *edit("app/docs/page.tsx")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `npm test`")[0], 2)

    def test_blocks_a_code_file_named_docs(self):
        entries = [prompt("fix"), *edit("src/docs.ts")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `npm test`")[0], 2)

    def test_earlier_turn_tests_do_not_count(self):
        entries = [prompt("one"), *edit("a.ts"), *bash("npm test"), prompt("two"), *edit("a.ts")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `npm test`")[0], 2)

    # ---- positive: must not block ----

    def test_allows_declared_command_after_last_edit(self):
        entries = [prompt("fix"), *edit("src/a.ts"), *bash("cd web && npm test -- --run")]
        self.assertEqual(self.run_hook(entries, claude_md="- Test command: `npm test`")[0], 0)

    def test_reads_agents_md(self):
        entries = [prompt("fix"), *edit("lib.rs"), *bash("cargo test")]
        self.assertEqual(self.run_hook(entries, agents_md="Test command: `cargo test`")[0], 0)

    def test_any_of_several_declared_commands(self):
        md = "Test command: `npm test`\nTest command: `uv run pytest`\n"
        entries = [prompt("fix"), *edit("x.py"), *bash("uv run pytest tests/x_test.py")]
        self.assertEqual(self.run_hook(entries, claude_md=md)[0], 0)

    def test_allows_common_command_without_declaration(self):
        entries = [prompt("fix"), *edit("x.py"), *bash("python3 -m pytest -q")]
        self.assertEqual(self.run_hook(entries)[0], 0)

    def test_allows_docs_only_edits(self):
        entries = [prompt("docs"), *edit("README.md"), *edit("docs/guide.md")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `npm test`")[0], 0)

    def test_allows_any_file_in_the_docs_folder_at_the_repo_root(self):
        # Release notes kept as an HTML page are documentation, whatever the suffix.
        entries = [prompt("update the release notes"), *edit("docs/releases/notes.html")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `npm test`")[0], 0)

    def test_allows_the_docs_folder_of_a_package(self):
        pkg = self.root / "packages" / "web"
        pkg.mkdir(parents=True)
        (pkg / "package.json").write_text("{}")
        entries = [prompt("docs"), *edit("packages/web/docs/api.html")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `npm test`")[0], 0)

    def test_allows_turn_without_edits(self):
        self.assertEqual(self.run_hook([prompt("explain"), *bash("ls")])[0], 0)

    def test_declared_none_switches_it_off(self):
        entries = [prompt("fix"), *edit("a.ts")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `none`")[0], 0)

    def test_second_stop_is_let_through(self):
        entries = [prompt("fix"), *edit("a.ts")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `npm test`", active=True)[0], 0)

    def test_env_escape_hatch(self):
        entries = [prompt("fix"), *edit("a.ts")]
        self.assertEqual(self.run_hook(entries, env={"CLAUDE_SKIP_TEST_GATE": "1"})[0], 0)

    def test_malformed_event_never_blocks(self):
        p = subprocess.run([sys.executable, str(HOOK)], input="not json", text=True, capture_output=True)
        self.assertEqual(p.returncode, 0)

    def test_edits_from_an_earlier_turn_do_not_count(self):
        entries = [prompt("one"), *edit("a.ts"), prompt("two: explain"), *bash("ls")]
        self.assertEqual(self.run_hook(entries, claude_md="Test command: `npm test`")[0], 0)

    def test_declaration_found_in_parent_directory(self):
        # a command no heuristic would recognise, so only the declaration can allow it
        (self.root / "CLAUDE.md").write_text("Test command: `./scripts/check.sh`")
        sub = self.root / "pkg" / "inner"
        sub.mkdir(parents=True)
        tp = self.root / "t.jsonl"
        tp.write_text("\n".join(json.dumps(e) for e in [prompt("fix"), *edit("a.c"), *bash("./scripts/check.sh")]))
        event = {"transcript_path": str(tp), "cwd": str(sub), "stop_hook_active": False}
        p = subprocess.run([sys.executable, str(HOOK)], input=json.dumps(event), text=True, capture_output=True)
        self.assertEqual(p.returncode, 0)


class OutsideRepoTest(unittest.TestCase):
    """Only files inside a git work tree count; the test command is found from
    the edited file's repository, not from the session's working directory."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name)
        self.repo = base / "repo"
        (self.repo / ".git").mkdir(parents=True)
        (self.repo / "src").mkdir()
        (self.repo / "CLAUDE.md").write_text("Test command: `./scripts/check.sh`\n")
        self.scratch = base / "scratchpad"  # no .git anywhere above it inside base
        self.scratch.mkdir()

    def tearDown(self):
        self.dir.cleanup()

    def run_hook(self, entries, cwd):
        tp = Path(self.dir.name) / "t.jsonl"
        tp.write_text("\n".join(json.dumps(e) for e in entries))
        event = {"transcript_path": str(tp), "cwd": str(cwd), "stop_hook_active": False}
        p = subprocess.run([sys.executable, str(HOOK)], input=json.dumps(event), text=True, capture_output=True)
        return p.returncode, p.stderr

    # (a) a turn that only edits scratchpad files is let through
    def test_scratchpad_only_edits_are_ignored(self):
        entries = [prompt("analyse"), *edit(str(self.scratch / "count.cjs")), *edit(str(self.scratch / "plot.py"))]
        self.assertEqual(self.run_hook(entries, cwd=self.scratch)[0], 0)
        self.assertEqual(self.run_hook(entries, cwd=self.repo)[0], 0)

    # (b) an edit in the repo without its tests still blocks
    def test_repo_edit_without_tests_blocks(self):
        code, msg = self.run_hook([prompt("fix"), *edit(str(self.repo / "src" / "a.ts"))], cwd=self.repo)
        self.assertEqual(code, 2)
        self.assertIn("`./scripts/check.sh`", msg)

    # (c) cwd is the scratchpad, the edit is in the repo: the repo's command is found
    def test_repo_command_found_when_cwd_is_scratchpad(self):
        repo_file = str(self.repo / "src" / "a.ts")
        code, msg = self.run_hook([prompt("fix"), *edit(repo_file)], cwd=self.scratch)
        self.assertEqual(code, 2)
        self.assertIn("`./scripts/check.sh`", msg)
        ran = [prompt("fix"), *edit(repo_file), *bash(f"cd {self.repo} && ./scripts/check.sh")]
        self.assertEqual(self.run_hook(ran, cwd=self.scratch)[0], 0)

    def test_scratchpad_edit_after_the_tests_does_not_rearm_the_gate(self):
        entries = [prompt("fix"), *edit(str(self.repo / "src" / "a.ts")), *bash("./scripts/check.sh"),
                   *edit(str(self.scratch / "proof.cjs"))]
        self.assertEqual(self.run_hook(entries, cwd=self.repo)[0], 0)

    def test_each_repo_edited_needs_its_own_tests(self):
        other = Path(self.dir.name) / "other"
        (other / ".git").mkdir(parents=True)
        (other / "CLAUDE.md").write_text("Test command: `make verify`\n")
        entries = [prompt("fix"), *edit(str(self.repo / "src" / "a.ts")), *edit(str(other / "b.go")),
                   *bash("./scripts/check.sh")]
        code, msg = self.run_hook(entries, cwd=self.repo)
        self.assertEqual(code, 2)
        self.assertIn("`make verify`", msg)
        self.assertNotIn("a.ts", msg)


if __name__ == "__main__":
    unittest.main()
