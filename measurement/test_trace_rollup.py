"""Tests for trace_rollup.py on synthetic status.json dicts."""
import unittest

from trace_rollup import rollup

ST1 = {
    "ok": True,
    "summary": {"pass": 2, "fail": 0, "skipped": 0, "no test": 0,
                "assumed": 1, "orphans": 0, "problems": 0},
    "requirements": {
        "REQ-A": {"examples": {
            "ex1": {"status": "pass", "levels": ["e2e"]},
            "ex2": {"status": "pass", "levels": ["unit"], "assumed": True},
        }},
    },
}
ST2 = {
    "ok": False,
    "summary": {"pass": 1, "fail": 1, "skipped": 0, "no test": 0,
                "assumed": 0, "orphans": 1, "problems": 1},
    "requirements": {
        "REQ-B": {"examples": {
            "ex1": {"status": "pass", "levels": ["unit"]},
            "ex2": {"status": "fail", "levels": []},
        }},
    },
}


class RollupTest(unittest.TestCase):
    def setUp(self):
        self.m = rollup([ST1, ST2])

    def test_task_and_ok_counts(self):
        self.assertEqual(self.m["tasks"], 2)
        self.assertEqual(self.m["ok"], 1)
        self.assertEqual(self.m["blocked"], 1)

    def test_examples_and_proven(self):
        self.assertEqual(self.m["examples"], 4)
        self.assertEqual(self.m["proven"], 3)       # 2 + 1
        self.assertEqual(self.m["proven_pct"], 0.75)  # 3 of (3 pass + 1 fail)

    def test_unproven_and_flags(self):
        self.assertEqual(self.m["fail"], 1)
        self.assertEqual(self.m["assumed"], 1)
        self.assertEqual(self.m["orphans"], 1)
        self.assertEqual(self.m["problems"], 1)

    def test_levels_distribution(self):
        self.assertEqual(self.m["levels"], {"e2e": 1, "unit": 2})

    def test_empty_input(self):
        m = rollup([])
        self.assertEqual(m["tasks"], 0)
        self.assertEqual(m["proven_pct"], 0.0)


if __name__ == "__main__":
    unittest.main()
