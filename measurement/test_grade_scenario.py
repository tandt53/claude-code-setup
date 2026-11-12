"""Tests for grade_scenario: the pure verdict and the real checks on a good
and a bad run of the slug-01 scenario."""
import tempfile
import unittest
from pathlib import Path

from grade_scenario import grade, run_checks

SCENARIO = Path(__file__).resolve().parent / "ab" / "scenarios" / "slug-01"
ROUND = Path(__file__).resolve().parent / "ab" / "scenarios" / "round-02"

GOOD_ROUND = '''import math
def round_half_up(x, digits=0):
    f = 10 ** digits
    return math.floor(abs(x) * f + 0.5) / f * (1 if x >= 0 else -1)
'''

# passes the positive bug but gets negatives wrong: -2.5 -> -2, not -3
NAIVE_ROUND = '''import math
def round_half_up(x, digits=0):
    f = 10 ** digits
    return math.floor(x * f + 0.5) / f
'''

GOOD = '''import re
def slugify(text):
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")
'''

# fixes the named bug but drops a character on internal punctuation, so edges fail
NAIVE = '''import re
def slugify(text):
    text = text.lower().strip().rstrip("!,.")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text
'''


def _workdir(d: Path, code: str, extra_test: bool) -> Path:
    wd = d / "run"
    wd.mkdir()
    (wd / "slugify.py").write_text(code, encoding="utf-8")
    (wd / "test_slugify.py").write_text(
        "import unittest\nfrom slugify import slugify\n"
        "class T(unittest.TestCase):\n"
        "    def test_punctuation_no_trailing_dash(self):\n"
        "        self.assertEqual(slugify('Hello, World!'), 'hello-world')\n"
        + ("    def test_empty(self):\n        self.assertEqual(slugify('@#$'), '')\n" if extra_test else ""),
        encoding="utf-8",
    )
    return wd


class GradePureTest(unittest.TestCase):
    def test_pass_needs_bug_and_edges(self):
        v = grade({"bug_fixed": True, "edges_ok": True, "regression_test_added": False})
        self.assertTrue(v["pass"])
        self.assertEqual(v["score"], 2)

    def test_edges_fail_is_not_pass(self):
        v = grade({"bug_fixed": True, "edges_ok": False, "regression_test_added": True})
        self.assertFalse(v["pass"])
        self.assertEqual(v["score"], 2)

    def test_all_three(self):
        v = grade({"bug_fixed": True, "edges_ok": True, "regression_test_added": True})
        self.assertTrue(v["pass"])
        self.assertEqual(v["score"], 3)


class RunChecksTest(unittest.TestCase):
    def test_good_run_passes_all(self):
        with tempfile.TemporaryDirectory() as d:
            wd = _workdir(Path(d), GOOD, extra_test=True)
            c = run_checks(wd, SCENARIO)
            self.assertTrue(c["bug_fixed"])
            self.assertTrue(c["edges_ok"])
            self.assertTrue(c["regression_test_added"])
            self.assertTrue(grade(c)["pass"])

    def test_naive_fix_passes_bug_but_fails_edges(self):
        with tempfile.TemporaryDirectory() as d:
            wd = _workdir(Path(d), NAIVE, extra_test=False)
            c = run_checks(wd, SCENARIO)
            self.assertTrue(c["bug_fixed"])        # the named bug is gone
            self.assertFalse(c["edges_ok"])        # but "!!!Wow" (leading punct) breaks
            self.assertFalse(c["regression_test_added"])
            self.assertFalse(grade(c)["pass"])


class RoundScenarioTest(unittest.TestCase):
    def _run(self, d: Path, code: str) -> Path:
        wd = d / "run"
        wd.mkdir()
        (wd / "round_half_up.py").write_text(code, encoding="utf-8")
        (wd / "test_round_half_up.py").write_text(
            "def test_x():\n    pass\n", encoding="utf-8")
        return wd

    def test_correct_impl_passes_negatives_and_digits(self):
        with tempfile.TemporaryDirectory() as d:
            c = run_checks(self._run(Path(d), GOOD_ROUND), ROUND)
            self.assertTrue(c["bug_fixed"])
            self.assertTrue(c["edges_ok"])      # -2.5 -> -3, 2.25@1 -> 2.3
            self.assertTrue(grade(c)["pass"])

    def test_naive_fix_passes_bug_but_fails_negatives(self):
        with tempfile.TemporaryDirectory() as d:
            c = run_checks(self._run(Path(d), NAIVE_ROUND), ROUND)
            self.assertTrue(c["bug_fixed"])     # 2.5 -> 3
            self.assertFalse(c["edges_ok"])     # -2.5 -> -2, wrong
            self.assertFalse(grade(c)["pass"])


if __name__ == "__main__":
    unittest.main()
