"""Tests for crawl.py, on a synthetic transcript built in-test.

Run: python3 -m unittest discover -s measurement -p 'test_*.py'
"""
import json
import unittest

from crawl import crawl


def line(obj):
    return json.dumps(obj)


# A synthetic transcript: a real prompt, a tool-result (not a prompt), two
# assistant responses (one driving a Bash test+commit with a Fixed: and an
# [unverified], one loading a skill), a system line, and a broken line.
FIXTURE = [
    line({"type": "user", "timestamp": "2026-11-08T01:00:00Z",
          "message": {"role": "user", "content": "please run the gate"}}),
    line({"type": "user",
          "message": {"role": "user", "content": [
              {"type": "tool_result", "content": "ok"},
              {"type": "text", "text": "incidental text beside a tool result"}]}}),  # not a prompt
    line({"type": "assistant", "timestamp": "2026-11-08T01:01:00Z",
          "message": {"role": "assistant",
                      "usage": {"output_tokens": 120, "cache_read_input_tokens": 9000},
                      "content": [
                          {"type": "text", "text": "Fixed: a typo. Result [unverified] until CI."},
                          {"type": "tool_use", "name": "Bash",
                           "input": {"command": "python3 -m unittest discover -s hooks && git commit -m x"}}]}}),
    line({"type": "assistant", "timestamp": "2026-11-08T01:02:00Z",
          "message": {"role": "assistant",
                      "usage": {"output_tokens": 30},
                      "content": [
                          {"type": "tool_use", "name": "Skill",
                           "input": {"skill": "verify-work"}}]}}),
    line({"type": "system", "message": {"role": "system", "content": "noise"}}),
    "{ this is not valid json",
]


class CrawlTest(unittest.TestCase):
    def setUp(self):
        self.m = crawl(FIXTURE)

    def test_user_prompts_exclude_tool_results(self):
        # Two user lines, but the tool-result one is not a prompt.
        self.assertEqual(self.m["user_prompts"], 1)

    def test_assistant_responses_counted(self):
        self.assertEqual(self.m["assistant_responses"], 2)

    def test_tool_calls_and_breakdown(self):
        self.assertEqual(self.m["tool_calls"], 2)
        self.assertEqual(self.m["tools"], {"Bash": 1, "Skill": 1})

    def test_skills_loaded(self):
        self.assertEqual(self.m["skills_loaded"], ["verify-work"])

    def test_test_run_and_commit_detected_from_bash(self):
        self.assertEqual(self.m["test_runs"], 1)
        self.assertEqual(self.m["commits"], 1)

    def test_self_correction_and_honesty_flags(self):
        self.assertEqual(self.m["self_corrections"], 1)
        self.assertEqual(self.m["unverified_flags"], 1)
        self.assertEqual(self.m["todo_flags"], 0)

    def test_tokens_summed(self):
        self.assertEqual(self.m["output_tokens"], 150)
        self.assertEqual(self.m["cache_read_tokens"], 9000)

    def test_timestamps_span(self):
        self.assertEqual(self.m["first_ts"], "2026-11-08T01:00:00Z")
        self.assertEqual(self.m["last_ts"], "2026-11-08T01:02:00Z")

    def test_broken_line_is_skipped_not_fatal(self):
        # The invalid json line did not raise; metrics still computed.
        self.assertIsInstance(self.m, dict)


def user(text, **flags):
    return line({"type": "user", **flags, "message": {"role": "user", "content": text}})


def queued(text, kind):
    mode = "prompt" if kind in ("human", "peer") else "task-notification"
    return line({"type": "attachment", "attachment": {
        "type": "queued_command", "prompt": text, "commandMode": mode, "origin": {"kind": kind}}})


def bash(cmd):
    return line({"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "tool_use", "name": "Bash", "input": {"command": cmd}}]}})


class UserPromptsTest(unittest.TestCase):
    def test_only_messages_a_person_typed_count(self):
        lines = [
            user("please fix the login"),                        # typed
            user("<command-name>/clear</command-name>"),         # a slash command, typed
            queued("and update the docs too", "human"),          # typed while Claude worked
            user("text of a skill loaded into the context", isMeta=True),
            user("<task-notification><task-id>a1</task-id></task-notification>"),
            user("<local-command-stdout>cleared</local-command-stdout>"),
            user("This session is being continued from a previous conversation",
                 isCompactSummary=True),
            user("[Request interrupted by user for tool use]"),
            queued("a message from another Claude session", "peer"),
            queued("<task-notification><task-id>a2</task-id></task-notification>",
                   "task-notification"),
        ]
        self.assertEqual(crawl(lines)["user_prompts"], 3)


class TestRunsTest(unittest.TestCase):
    def test_common_runners_count_and_other_commands_do_not(self):
        lines = [
            bash("npm run test:unit 2>&1 | tail -15"),
            bash("npx jest src/cart.test.ts"),
            bash("cd web && yarn test"),
            bash("go test ./..."),
            bash("npm run build"),
            bash("git commit -m 'add a test for the cart'"),
            bash("ls tests/"),
        ]
        self.assertEqual(crawl(lines)["test_runs"], 4)

    def test_the_projects_declared_command_counts(self):
        lines = [bash("make verify"), bash("make build")]
        self.assertEqual(crawl(lines, test_commands=["make verify"])["test_runs"], 1)

    def test_one_command_counts_once(self):
        self.assertEqual(crawl([bash("npm test && npx jest src/a.test.ts")])["test_runs"], 1)


if __name__ == "__main__":
    unittest.main()
