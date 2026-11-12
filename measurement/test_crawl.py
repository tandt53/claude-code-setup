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
                           "input": {"command": "python3 docs/trace.py && git commit -m x"}}]}}),
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


if __name__ == "__main__":
    unittest.main()
