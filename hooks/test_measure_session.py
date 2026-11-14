"""Tests for the measure_session Stop hook: it crawls a transcript and writes
one snapshot per session, never raising into the session."""
import json
import os
import tempfile
import unittest
from pathlib import Path

import measure_session


def _transcript(dir_path: Path, session_id: str) -> Path:
    """A tiny but realistic transcript: one prompt, one assistant turn that
    loads a skill, commits, runs a test, and flags something [unverified]."""
    proj = dir_path / "my-proj"
    proj.mkdir()
    lines = [
        {"type": "user", "gitBranch": "feat/x", "timestamp": "2026-11-08T01:00:00Z",
         "message": {"role": "user", "content": [{"type": "text", "text": "do it"}]}},
        {"type": "user", "gitBranch": "feat/x",  # a tool-result turn is not a prompt
         "message": {"role": "user", "content": [{"type": "tool_result", "content": "ok"}]}},
        {"type": "assistant", "gitBranch": "feat/x", "timestamp": "2026-11-08T01:05:00Z",
         "message": {"role": "assistant", "usage": {"output_tokens": 10, "cache_read_input_tokens": 5},
                     "content": [
                         {"type": "text", "text": "[unverified] still checking"},
                         {"type": "tool_use", "name": "Skill", "input": {"skill": "verify-work"}},
                         {"type": "tool_use", "name": "Bash", "input": {"command": "git commit -m x"}},
                         {"type": "tool_use", "name": "Bash", "input": {"command": "python3 -m unittest discover"}},
                     ]}},
    ]
    f = proj / f"{session_id}.jsonl"
    f.write_text("\n".join(json.dumps(x) for x in lines), encoding="utf-8")
    return f


class MeasureSessionTest(unittest.TestCase):
    def test_writes_snapshot_with_metrics(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            tp = _transcript(d, "sess123")
            out = d / "sessions"
            path = measure_session.run(
                {"transcript_path": str(tp), "session_id": "sess123", "cwd": "/work/my-proj"},
                out_dir=out,
            )
            self.assertEqual(path, out / "sess123.json")
            snap = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(snap["session_id"], "sess123")
            self.assertEqual(snap["project"], "my-proj")
            self.assertEqual(snap["cwd"], "/work/my-proj")
            self.assertEqual(snap["git_branch"], "feat/x")
            m = snap["metrics"]
            self.assertEqual(m["user_prompts"], 1)       # tool-result turn excluded
            self.assertEqual(m["assistant_responses"], 1)
            self.assertEqual(m["tool_calls"], 3)
            self.assertEqual(m["skills_loaded"], ["verify-work"])
            self.assertEqual(m["commits"], 1)
            self.assertEqual(m["test_runs"], 1)
            self.assertEqual(m["unverified_flags"], 1)

    def test_counts_the_projects_declared_test_command(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            repo = d / "repo"
            (repo / ".git").mkdir(parents=True)
            (repo / "CLAUDE.md").write_text("Test command: `make verify`\n", encoding="utf-8")
            tp = d / "proj" / "s.jsonl"
            tp.parent.mkdir()
            tp.write_text(json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "tool_use", "name": "Bash", "input": {"command": "make verify"}}]}}), encoding="utf-8")
            path = measure_session.run(
                {"transcript_path": str(tp), "session_id": "s", "cwd": str(repo)}, out_dir=d / "out")
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["metrics"]["test_runs"], 1)

    def test_session_id_falls_back_to_filename(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            tp = _transcript(d, "fromfile")
            out = d / "sessions"
            path = measure_session.run({"transcript_path": str(tp)}, out_dir=out)
            self.assertEqual(path, out / "fromfile.json")

    def test_no_transcript_returns_none(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "sessions"
            self.assertIsNone(measure_session.run({"transcript_path": "/no/such.jsonl"}, out_dir=out))
            self.assertIsNone(measure_session.run({}, out_dir=out))
            self.assertFalse(out.exists())

    def test_crawl_unavailable_returns_none(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            tp = _transcript(d, "s")
            out = d / "sessions"
            orig = measure_session._load_crawl
            measure_session._load_crawl = lambda: None
            try:
                self.assertIsNone(measure_session.run({"transcript_path": str(tp)}, out_dir=out))
            finally:
                measure_session._load_crawl = orig

    def test_write_is_atomic_no_tmp_left(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            tp = _transcript(d, "s")
            out = d / "sessions"
            measure_session.run({"transcript_path": str(tp), "session_id": "s"}, out_dir=out)
            leftovers = [p.name for p in out.iterdir() if p.name.startswith(".tmp-")]
            self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
