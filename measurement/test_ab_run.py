"""Tests for ab_run: the pure plan, the cwd-slug, and a collect pass over a
fabricated baseline run (no agent launched)."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import ab_run

SCENARIO = Path(__file__).resolve().parent / "ab" / "scenarios" / "slug-01"

GOOD = '''import re
def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower().strip()).strip("-")
'''


class PlanTest(unittest.TestCase):
    def test_two_sides_n_each(self):
        specs = ab_run.plan(runs=3, workroot="/tmp/wr")
        self.assertEqual(len(specs), 6)
        self.assertEqual(sum(s["is_baseline"] for s in specs), 3)
        self.assertEqual({s["name"] for s in specs if not s["is_baseline"]},
                         {"with-kit-1", "with-kit-2", "with-kit-3"})

    def test_workdir_under_root(self):
        specs = ab_run.plan(runs=1, workroot="/tmp/wr")
        self.assertEqual(specs[0]["workdir"], "/tmp/wr/with-kit-1")

    def test_slug_and_transcript_path(self):
        self.assertEqual(ab_run._slug("/Users/x/My.Proj"), "-Users-x-My-Proj")
        tp = ab_run.transcript_path("/cfg", "/tmp/wr/baseline-1", "SID")
        self.assertTrue(str(tp).startswith("/cfg/projects/"))
        self.assertTrue(str(tp).endswith("/SID.jsonl"))


class CollectTest(unittest.TestCase):
    def test_collect_grades_a_fabricated_baseline_run(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            cfg = d / "cfg"
            work = d / "runs" / "work"
            specs = ab_run.plan(runs=1, workroot=work)
            # build the baseline-1 run: a good fix + an added test
            wd = Path(next(s["workdir"] for s in specs if s["is_baseline"]))
            wd.mkdir(parents=True)
            (wd / "slugify.py").write_text(GOOD, encoding="utf-8")
            (wd / "test_slugify.py").write_text(
                "def test_a():\n    pass\ndef test_b():\n    pass\n", encoding="utf-8")
            (wd / "result.json").write_text(json.dumps({"session_id": "SID"}), encoding="utf-8")
            # a minimal crawlable transcript where ab_run expects it
            tp = ab_run.transcript_path(str(cfg), wd, "SID")
            tp.parent.mkdir(parents=True)
            tp.write_text(json.dumps(
                {"type": "assistant", "message": {"role": "assistant",
                 "content": [{"type": "text", "text": "done"}]}}) + "\n", encoding="utf-8")

            buf = io.StringIO()
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                sides = ab_run.collect(SCENARIO, specs, str(cfg), d / "out")
            run = sides["baseline"]["baseline-1"]
            self.assertEqual(run["grade_pass"], 1)
            self.assertEqual(run["grade_score"], 3)   # bug + edges + a test added
            self.assertEqual(run["assistant_responses"], 1)
            self.assertNotIn("with-kit-1", sides["with-kit"])  # not produced


if __name__ == "__main__":
    unittest.main()
