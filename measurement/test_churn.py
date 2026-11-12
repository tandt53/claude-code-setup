"""Tests for churn.py on a synthetic git-numstat text."""
import unittest

from churn import parse_numstat, rework

SEP = "\x1f"
# git emits newest-first: h3 (ts300), h2 (ts200), h1 (ts100).
# a.py is touched in h1 and again in h3 -> one rework within a wide window.
NUMSTAT = "\n".join([
    f"h3{SEP}300",
    "2\t1\ta.py",
    "",
    f"h2{SEP}200",
    "5\t0\tb.py",
    "",
    f"h1{SEP}100",
    "3\t2\ta.py",
    "-\t-\tbin.dat",
])


class ChurnTest(unittest.TestCase):
    def setUp(self):
        self.commits = parse_numstat(NUMSTAT)

    def test_parse_counts_and_binary(self):
        self.assertEqual(len(self.commits), 3)
        # binary file's -/- became 0/0
        h1 = [c for c in self.commits if c["hash"] == "h1"][0]
        self.assertIn((0, 0, "bin.dat"), h1["files"])

    def test_rework_within_window(self):
        m = rework(self.commits, window=5)
        self.assertEqual(m["total_touches"], 4)      # h1:2, h2:1, h3:1
        self.assertEqual(m["rework_touches"], 1)      # h3 a.py seen in h1
        self.assertEqual(m["rework_rate"], 0.25)
        self.assertEqual(m["churn_lines"], 13)        # 5 + 5 + 3
        self.assertEqual(m["files_touched"], 3)

    def test_window_narrows_rework(self):
        # window 1: h3's previous commit is h2 (b.py), so a.py is not recent.
        m = rework(self.commits, window=1)
        self.assertEqual(m["rework_touches"], 0)


if __name__ == "__main__":
    unittest.main()
