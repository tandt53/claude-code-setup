"""Tests for compare.py on synthetic crawl-style run maps."""
import unittest

from compare import compare

A = {
    "run1": {"cost": 100, "turns": 10, "label": "x", "ok": True},
    "run2": {"cost": 120, "turns": 8},
}
B = {
    "run1": {"cost": 200, "turns": 20},
}


class CompareTest(unittest.TestCase):
    def setUp(self):
        self.rows = compare(A, B)

    def test_numeric_keys_only(self):
        # string "label" and bool "ok" are not metrics
        self.assertEqual(set(self.rows), {"cost", "turns"})

    def test_means_and_delta(self):
        cost = self.rows["cost"]
        self.assertEqual(cost["a"]["n"], 2)
        self.assertEqual(cost["a"]["mean"], 110)
        self.assertEqual(cost["a"]["min"], 100)
        self.assertEqual(cost["a"]["max"], 120)
        self.assertEqual(cost["b"]["n"], 1)
        self.assertEqual(cost["b"]["mean"], 200)
        self.assertEqual(cost["delta"], -90)

    def test_turns_delta(self):
        self.assertEqual(self.rows["turns"]["delta"], -11)  # 9 - 20

    def test_missing_side_delta_is_none(self):
        rows = compare(A, {})
        self.assertIsNone(rows["cost"]["delta"])
        self.assertEqual(rows["cost"]["b"]["n"], 0)


if __name__ == "__main__":
    unittest.main()
