"""
Tests for after_compact.py. Run:  python3 -m unittest test_after_compact.py -v
Transcripts are synthetic, shaped like Claude Code's JSONL transcript.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

HOOK = Path(__file__).with_name("after_compact.py")
T0 = datetime(2026, 11, 3, 4, 0, tzinfo=timezone.utc)


def at(minutes):
    return datetime.fromtimestamp(T0.timestamp() + minutes * 60, tz=timezone.utc)


def stamp(minutes):
    return at(minutes).isoformat().replace("+00:00", "Z")


def skill_call(name, minutes, sidechain=False):
    row = {"type": "assistant", "timestamp": stamp(minutes), "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": "t", "name": "Skill", "input": {"skill": name}}]}}
    if sidechain:
        row["isSidechain"] = True
    return row


def user(text, minutes=0, **extra):
    return {"type": "user", "timestamp": stamp(minutes), "message": {"role": "user", "content": text}, **extra}


def tool_result(text, minutes=0):
    # Claude Code can append text blocks to a tool result row (a reminder, an
    # interrupt notice): they are not the user typing.
    return {"type": "user", "timestamp": stamp(minutes), "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t", "content": text},
        {"type": "text", "text": text}]}}


def listed(ctx):
    """The skill names in the hook's list, or [] when it printed none."""
    head = "Loaded in this session: "
    if head not in ctx:
        return []
    items = ctx.split(head, 1)[1].split("\n", 1)[0].rstrip(".")
    return [i.split(" (")[0] for i in items.split(", ")]


VI = "Kiểm tra giúp tôi vì sao học sinh không xem được ảnh trong bài luyện nghe"


class AfterCompactTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.home = self.root / "home"
        self.project = self.root / "project"
        self.project.mkdir()

    def tearDown(self):
        self.dir.cleanup()

    def skill(self, name, changed_minutes, project=False):
        base = (self.project if project else self.home) / ".claude" / "skills" / name
        base.mkdir(parents=True, exist_ok=True)
        f = base / "SKILL.md"
        f.write_text(f"# {name}\n")
        t = at(changed_minutes).timestamp()
        os.utime(f, (t, t))

    def run_hook(self, rows=None, raw=None, event=None, stdin=None):
        tp = self.root / "t.jsonl"
        if raw is not None:
            tp.write_text(raw)
        elif rows is not None:
            tp.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
        ev = {"hook_event_name": "SessionStart", "source": "compact", "session_id": "s",
              "transcript_path": str(tp), "cwd": str(self.project)}
        ev.update(event or {})
        p = subprocess.run([sys.executable, str(HOOK)], input=stdin if stdin is not None else json.dumps(ev),
                           text=True, capture_output=True, env={**os.environ, "HOME": str(self.home)})
        self.assertEqual(p.returncode, 0, p.stderr)
        if not p.stdout.strip():
            return None
        out = json.loads(p.stdout)
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "SessionStart")
        return out["hookSpecificOutput"]["additionalContext"]

    # --- skills ---------------------------------------------------------

    def test_skill_unchanged_since_load_is_listed_without_mark(self):
        self.skill("task-spec", changed_minutes=-60)
        ctx = self.run_hook([skill_call("task-spec", 0)])
        self.assertIn("task-spec", ctx)
        self.assertNotIn("changed", ctx)

    def test_skill_changed_after_load_is_marked(self):
        self.skill("task-spec", changed_minutes=+90)
        ctx = self.run_hook([skill_call("task-spec", 0)])
        self.assertIn("task-spec (its file changed after it was loaded at", ctx)

    def test_latest_load_counts(self):
        # changed at +30, loaded again at +60: the copy in context is current
        self.skill("review-work", changed_minutes=+30)
        ctx = self.run_hook([skill_call("review-work", 0), skill_call("review-work", 60)])
        self.assertIn("review-work", ctx)
        self.assertNotIn("changed", ctx)
        self.assertEqual(ctx.count("review-work"), 1)

    def test_typed_slash_command_counts_but_builtin_does_not(self):
        self.skill("retro", changed_minutes=+5)
        rows = [user("<command-name>/retro</command-name>\n<command-message>retro</command-message>", 0),
                user("<command-name>/compact</command-name>", 1)]
        ctx = self.run_hook(rows)
        self.assertIn("retro (its file changed", ctx)
        self.assertEqual(listed(ctx), ["retro"])

    def test_project_skill_wins_over_personal(self):
        self.skill("requirements", changed_minutes=-10)               # personal, old
        self.skill("requirements", changed_minutes=+10, project=True)  # project, newer
        ctx = self.run_hook([skill_call("requirements", 0)])
        self.assertIn("requirements (its file changed", ctx)

    def test_plugin_skill_listed_never_marked(self):
        ctx = self.run_hook([skill_call("anthropic-skills:docx", 0)])
        self.assertIn("anthropic-skills:docx", ctx)
        self.assertNotIn("changed", ctx)

    def test_subagent_skill_call_ignored(self):
        self.skill("verify-work", changed_minutes=+5)
        ctx = self.run_hook([skill_call("verify-work", 0, sidechain=True)])
        self.assertNotIn("verify-work", ctx)

    def test_skill_text_mentioning_a_command_is_not_a_load(self):
        self.skill("retro", changed_minutes=+5)
        rows = [user("Base directory for this skill: x\n<command-name>/retro</command-name>", 0, isMeta=True)]
        ctx = self.run_hook(rows)
        self.assertNotIn("retro", ctx)

    def test_no_skills_gives_general_reminder(self):
        ctx = self.run_hook([user(VI, 0)])
        self.assertIn("load it with the Skill tool, even if", ctx)

    # --- language ------------------------------------------------------

    def test_quotes_last_long_user_messages_newest_last(self):
        rows = [user("Write it in English please, the whole report", 0), user(VI, 5), user("ok", 9)]
        ctx = self.run_hook(rows)
        self.assertIn('began (newest last): "Write it in English please, the whole report" · '
                      f'"{VI[:100]}', ctx)
        self.assertNotIn('"ok"', ctx)

    def test_quotes_at_most_three(self):
        rows = [user(f"message number {n} with enough letters to count", n) for n in range(1, 5)]
        ctx = self.run_hook(rows)
        self.assertNotIn("message number 1 ", ctx)
        for n in (2, 3, 4):
            self.assertIn(f"message number {n} ", ctx)

    def test_ignores_tool_results_notifications_meta_and_summary(self):
        rows = [user(VI, 0),
                tool_result("A very long English tool output that is not from the user at all", 1),
                user("<task-notification>\n<task-id>x</task-id> finished with a long English summary</task-notification>", 2),
                user("Base directory for this skill: /x  # Retro  Each session starts", 3, isMeta=True),
                user("This session is being continued from a previous conversation that ran out", 4,
                     isCompactSummary=True)]
        ctx = self.run_hook(rows)
        self.assertIn(VI, ctx)
        for leaked in ("tool output", "long English summary", "Base directory", "continued from a previous"):
            self.assertNotIn(leaked, ctx)

    def test_pasted_content_does_not_count_as_language(self):
        rows = [user(VI, 0),
                user('<pasted_content id="f882">\nFailed to run sql query: ERROR: operator does not exist: text = uuid\n'
                     '</pasted_content id="f882">', 2)]
        ctx = self.run_hook(rows)
        self.assertIn(VI, ctx)
        self.assertNotIn("Failed to run sql", ctx)
        self.assertNotIn("pasted_content", ctx)

    def test_pasted_table_and_code_do_not_count_as_language(self):
        rows = [user(VI, 0),
                user("| rolname | rolbypassrls |\n| -------- | ------------ |\n| postgres | true |", 2),
                user("```\nFailed to run sql query: ERROR: operator does not exist\n```", 3)]
        ctx = self.run_hook(rows)
        self.assertIn(VI, ctx)
        self.assertNotIn("rolname", ctx)
        self.assertNotIn("operator does not exist", ctx)

    def test_long_message_is_cut(self):
        ctx = self.run_hook([user("chữ " * 200, 0)])
        quote = ctx.split('began (newest last): "')[1]
        self.assertLessEqual(len(quote), 100 + 2)
        self.assertTrue(quote.endswith('…"'))

    # --- inputs --------------------------------------------------------

    def test_other_sources_print_nothing(self):
        self.assertIsNone(self.run_hook([user(VI)], event={"source": "startup"}))

    def test_malformed_stdin_still_reminds(self):
        ctx = self.run_hook(stdin="not json")
        self.assertIn("load it with the Skill tool, even if", ctx)
        self.assertIn("Reply in the language the user writes in", ctx)

    def test_missing_transcript_still_reminds(self):
        ctx = self.run_hook(event={"transcript_path": str(self.root / "nope.jsonl")})
        self.assertIn("load it with the Skill tool, even if", ctx)

    def test_empty_transcript(self):
        ctx = self.run_hook(raw="")
        self.assertIn("load it with the Skill tool, even if", ctx)
        self.assertNotIn("Their last message", ctx)

    def test_line_cut_off_midway_is_skipped(self):
        self.skill("task-spec", changed_minutes=+90)
        raw = json.dumps(skill_call("task-spec", 0)) + "\n" + json.dumps(user(VI, 1))[:40]
        ctx = self.run_hook(raw=raw)
        self.assertIn("task-spec (its file changed", ctx)

    def test_missing_timestamp_is_not_marked(self):
        self.skill("task-spec", changed_minutes=+90)
        row = skill_call("task-spec", 0)
        del row["timestamp"]
        ctx = self.run_hook([row])
        self.assertIn("task-spec", ctx)
        self.assertNotIn("changed", ctx)


if __name__ == "__main__":
    unittest.main()
