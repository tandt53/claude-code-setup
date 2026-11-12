"""Tests for history.py append/upsert."""
import unittest

from history import append


class HistoryTest(unittest.TestCase):
    def test_append_new_date_sorted(self):
        h = [{"date": "2026-11-01", "proven_pct": 0.5}]
        out = append(h, {"date": "2026-11-03", "proven_pct": 0.7})
        self.assertEqual([r["date"] for r in out], ["2026-11-01", "2026-11-03"])

    def test_out_of_order_insert_is_sorted(self):
        h = [{"date": "2026-11-05", "x": 1}]
        out = append(h, {"date": "2026-11-02", "x": 2})
        self.assertEqual([r["date"] for r in out], ["2026-11-02", "2026-11-05"])

    def test_same_date_replaces_not_duplicates(self):
        h = [{"date": "2026-11-01", "proven_pct": 0.5}]
        out = append(h, {"date": "2026-11-01", "proven_pct": 0.9})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["proven_pct"], 0.9)

    def test_snapshot_without_date_raises(self):
        with self.assertRaises(ValueError):
            append([], {"proven_pct": 0.5})


if __name__ == "__main__":
    unittest.main()
