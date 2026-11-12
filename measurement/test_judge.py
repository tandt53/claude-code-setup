"""Tests for judge.py: prep, score, calibrate."""
import json
import unittest

from judge import prep, score, calibrate


def line(obj):
    return json.dumps(obj)


TRANSCRIPT = [
    line({"type": "user", "message": {"role": "user", "content": "do the thing"}}),
    line({"type": "assistant",
          "message": {"role": "assistant", "usage": {"output_tokens": 10},
                      "content": [
                          {"type": "text", "text": "DONE | 1 step for you\nHere is the result."},
                          {"type": "tool_use", "name": "Bash",
                           "input": {"command": "python3 -m unittest"}}]}}),
]


class PrepTest(unittest.TestCase):
    def test_prep_extracts_metrics_and_done_claims(self):
        b = prep(TRANSCRIPT)
        self.assertEqual(b["metrics"]["user_prompts"], 1)
        self.assertEqual(b["metrics"]["test_runs"], 1)
        self.assertEqual(b["done_claims"], ["DONE | 1 step for you"])


class ScoreTest(unittest.TestCase):
    def test_score_rolls_up_list(self):
        v = [
            {"task": "t1", "trajectory": 5, "honesty": "pass", "gate_value": 4},
            {"task": "t2", "trajectory": 3, "honesty": "fail", "gate_value": 2},
        ]
        s = score(v)
        self.assertEqual(s["tasks"], 2)
        self.assertEqual(s["trajectory_mean"], 4.0)
        self.assertEqual(s["honesty_pass_rate"], 0.5)
        self.assertEqual(s["honesty_fails"], 1)
        self.assertEqual(s["gate_value_mean"], 3.0)

    def test_score_accepts_map_and_ignores_na_gate(self):
        v = {"t1": {"trajectory": 4, "honesty": "pass", "gate_value": "na"}}
        s = score(v)
        self.assertEqual(s["tasks"], 1)
        self.assertIsNone(s["gate_value_mean"])  # "na" is not numeric


class CalibrateTest(unittest.TestCase):
    def test_agreement_on_matched_tasks(self):
        judge = [
            {"task": "t1", "trajectory": 5, "honesty": "pass"},
            {"task": "t2", "trajectory": 2, "honesty": "pass"},
            {"task": "t3", "trajectory": 4, "honesty": "fail"},  # not in human
        ]
        human = [
            {"task": "t1", "trajectory": 5, "honesty": "pass"},
            {"task": "t2", "trajectory": 4, "honesty": "fail"},
        ]
        c = calibrate(judge, human)
        self.assertEqual(c["matched"], 2)
        self.assertEqual(c["honesty_agreement"], 0.5)   # t1 agree, t2 disagree
        self.assertEqual(c["trajectory_mae"], 1.0)      # |5-5| + |2-4| = 2 over 2


if __name__ == "__main__":
    unittest.main()
