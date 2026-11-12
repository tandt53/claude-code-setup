"""
Tests for gap_question.py. Run:  python3 -m unittest test_gap_question.py -v

GAP and PLAIN are real messages one user typed in one session (2026-11-08 to
10), labelled by hand: a gap question asks what something is, why, or whether
they read it right.
GAP_HOOK=<path> runs the tests against another copy (used for mutants).
"""

import importlib.util
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HOOK = Path(os.environ.get("GAP_HOOK") or Path(__file__).with_name("gap_question.py"))

GAP = [
    "slice C3-ii là gì?",
    "review-change thì sẽ làm gì ?",
    "api-contract có phải là solution archiecture ko?",
    "api-contract khác gì so với backend ?",
    "tại sao api-contract lại hands to design system?",
    "qa-sweep được dùng khi nào trong SDLC?",
    "các metrics này đo theo global hay là đo theo project?",
    "các command kia được run khi nào ?",
    "vậy là các command sẽ tự động collect các thông số trong 1 session đúng ko ?",
    "churn, trace_rollup, compare, judge, history -> các cái này là cái gì ?",
    "3. compare.py — dùng cái này khi nào trong dự án thật ?",
    "Vấn đề ios typing là gì?",
    "Nếu lên appium 4 thì lại ko hợp với android ah?",
    "tại sao phải launch ios ở headless ?",
    "nếu tôi có máy thật thì bạn có thể test thử được đúng ko ?",
    "→ quay về requirements trước. nếu ko có requirement skills, thì AI sẽ tự viết requirement đúng ko?",
]

# Patterns no real message above exercises alone: one written case each, so
# that removing any pattern makes a test fail.
WRITTEN = [
    "cái này là sao?",
    "tôi chưa hiểu phần headless",
    "what is a peer dependency?",
    "why headless?",
    "difference between churn and compare?",
    "when should I use compare.py?",
    "is this the same as solution architecture?",
    "I don't get the iOS part",
]

PLAIN = [
    # status and next-step questions the review found firing (real, from other sessions)
    "Bạn merge xong rồi ah?",
    "s22 code xong rồi ah ?",
    "ok, giờ bộ test đã ổn rồi đúng ko ?",
    "tiếp theo là gì ?",
    "việc tiếp theo nên là gì ?",
    "tôi đã commit rồi, những việc còn lại là gì",
    "sau khi crawl dữ liệu ta cần làm gì ?",
    "ok",
    "go",
    "a",
    "A - c - b",
    "Tiếp",
    "D1+2+3",
    "web + mobile",
    "móc vào hook đi",
    "bạn tự chạy hết đi",
    "Tạo pr chưa?",
    "Đã merge",
    "pull latest trên main",
    "Pull latest trên main",
    "Ios typing",
    "Merge trc đu",
    "Android driver có nên nâng ko? Flutter drivers nữa",
    "ok note lại cái này, thử flutter trước nhé. hãy lấy sample app và tự chạy nhé",
    "rename backend-implementation thành backend là đủ rồi",
    "Vậy có thể chạy nó bây giờ ko?",
    "clarify-requirements: đổi lại là requirement-review được ko ?",
    "mở rộng width nữa ra.  các mũi tên đang bị vỡ kìa",
    "bỏ git repo riêng ở global project-kit đi, vì ta có project này rồi mà",
]

# Written cases for the rules that keep a pattern quiet, one each, so removing
# any of them makes a test fail.
WRITTEN_PLAIN = [
    "Check what is in the file and fix it",       # no question: an instruction
    "explain why the test fails, then fix",
    "Chạy test khi nào xong thì báo",
    "Update the docs when to use the hook",
    "tiếp theo làm gì ?",                          # next step, not a gap
    "what's next?",
]

# Seen in review: a status question with the gap ending ("… ah?") that still
# fires, because it has no "xong" or "rồi". The reminder says to just answer it.
KNOWN_FALSE_POSITIVE = "layout bị dính ah?"

# Each text below would fire if its filter were gone: it holds a gap question
# in a clause ending in "?".
AGENT_MESSAGE = ('Another Claude session sent a message:\n<agent-message from="a1">'
                 'The user asked: slice C3-ii là gì? Then they picked O2.</agent-message>')

GAP_MARK = "rarely say when an explanation did not land"
AGAIN_MARK = "your last message did not land"


def run(stdin: str, timeout=10):
    p = subprocess.run([sys.executable, str(HOOK)], input=stdin, capture_output=True,
                       text=True, timeout=timeout)
    return p.returncode, p.stdout.strip()


def event(prompt):
    return json.dumps({"session_id": "s1", "transcript_path": "/nowhere.jsonl", "cwd": "/tmp",
                       "hook_event_name": "UserPromptSubmit", "prompt": prompt})


def load_hook():
    spec = importlib.util.spec_from_file_location("gap_question_under_test", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def context(stdout: str):
    if not stdout:
        return None
    out = json.loads(stdout)["hookSpecificOutput"]
    assert out["hookEventName"] == "UserPromptSubmit", out
    return out["additionalContext"]


class GapQuestionTest(unittest.TestCase):
    def assertFires(self, prompt, mark=GAP_MARK):
        code, out = run(event(prompt))
        self.assertEqual(code, 0)
        ctx = context(out)
        self.assertIsNotNone(ctx, f"no reminder for {prompt!r}")
        self.assertIn(mark, ctx)
        return ctx

    def assertSilent(self, stdin):
        code, out = run(stdin)
        self.assertEqual(code, 0)
        self.assertEqual(out, "", f"unexpected output for {stdin[:80]!r}")

    def test_real_gap_questions_fire(self):
        for m in GAP:
            with self.subTest(m=m):
                self.assertFires(m)

    def test_written_cases_fire(self):
        for m in WRITTEN:
            with self.subTest(m=m):
                self.assertFires(m)

    def test_real_plain_messages_are_silent(self):
        for m in PLAIN:
            with self.subTest(m=m):
                self.assertSilent(event(m))

    def test_written_plain_cases_are_silent(self):
        for m in WRITTEN_PLAIN:
            with self.subTest(m=m):
                self.assertSilent(event(m))

    def test_known_false_positive_fires(self):
        self.assertFires(KNOWN_FALSE_POSITIVE)

    def test_message_from_another_session_is_not_read(self):
        self.assertSilent(event(AGENT_MESSAGE))

    def test_reminder_quotes_the_match_and_says_what_to_do(self):
        ctx = self.assertFires("Vấn đề ios typing là gì?")
        self.assertIn('"là gì"', ctx)
        self.assertIn("restate that decision with what they now know", ctx)
        self.assertIn("another way", ctx)
        self.assertIn("confirm it in one line and go one level deeper", ctx)

    def test_runs_without_its_neighbour_and_in_isolated_mode(self):
        # Copied alone (after_compact.py missing): silent, exit 0, nothing on stderr.
        with tempfile.TemporaryDirectory() as d:
            alone = Path(d) / "gap_question.py"
            shutil.copy(HOOK, alone)
            p = subprocess.run([sys.executable, str(alone)], input=event("là gì?"),
                               capture_output=True, text=True, timeout=10)
            self.assertEqual((p.returncode, p.stdout, p.stderr), (0, "", ""))
        # python3 -I drops the script's folder from sys.path: still works.
        p = subprocess.run([sys.executable, "-I", str(HOOK)], input=event("Vấn đề ios typing là gì?"),
                           capture_output=True, text=True, timeout=10)
        self.assertEqual((p.returncode, p.stderr), (0, ""))
        self.assertIn(GAP_MARK, context(p.stdout.strip()))

    def test_double_question_mark_asks_to_explain_again(self):
        for m in ["??", "  ??  ", "??? ", "?? phần headless"]:
            with self.subTest(m=m):
                ctx = self.assertFires(m, AGAIN_MARK)
                self.assertNotIn(GAP_MARK, ctx)

    def test_pasted_block_is_not_read(self):
        pasted = '<pasted_content id="f1">Traceback: what is this? là gì</pasted_content id="f1">'
        self.assertSilent(event("fix it\n" + pasted))
        self.assertFires("là gì?\n" + pasted)

    def test_system_reminder_is_not_read(self):
        self.assertSilent(event("<system-reminder>why is this here</system-reminder>\nok"))

    def test_code_fence_is_not_read(self):
        self.assertSilent(event("```\nwhy = compute()  # là gì? \n```\nchạy lại"))

    def test_harness_text_is_not_read(self):
        self.assertSilent(event("<task-notification>\nwhy did it fail? \n</task-notification>"))
        self.assertSilent(event("Stop hook feedback:\nwhy were tests not run?"))

    def test_bad_input_is_silent(self):
        for stdin in ["", "not json", "[]", "{}", '"là gì"', json.dumps({"prompt": 5}),
                      json.dumps({"prompt": ""}), json.dumps({"prompt": None}),
                      '{"prompt": "slice C3-ii là gì']:  # cut off midway
            with self.subTest(stdin=stdin):
                self.assertSilent(stdin)

    def test_case_lists_have_their_size(self):
        # The loops above pass on an empty list: pin what they iterate over.
        self.assertEqual((len(GAP), len(WRITTEN), len(PLAIN), len(WRITTEN_PLAIN)), (16, 8, 29, 6))

    def test_property_any_input_exits_0_with_nothing_on_stderr(self):
        # Spec: any input, any error → exit 0, nothing on stderr; stdout empty or one JSON reminder.
        rng = random.Random(11)
        words = ["là gì", "tại sao", "?", "??", ".", " ", "\n", "```", "đúng ko", "ah?", "rồi",
                 '<pasted_content id="p">', "</pasted_content>", "<system-reminder>", "why",
                 "\ud800", "\x00", "{", '"', "compare.py", "tiếp theo", "x" * 50]
        for i in range(40):
            prompt = "".join(rng.choice(words) for _ in range(rng.randint(0, 30)))
            with self.subTest(i=i):
                p = subprocess.run([sys.executable, str(HOOK)], input=event(prompt),
                                   capture_output=True, text=True, timeout=10)
                self.assertEqual((p.returncode, p.stderr), (0, ""))
                if p.stdout.strip():
                    self.assertTrue(context(p.stdout.strip()))

    def test_property_pasted_text_never_changes_the_answer(self):
        # Metamorphic: whatever is pasted inside a block, the result is that of the typed part.
        hook = load_hook()
        rng = random.Random(5)
        fillers = ["what is this? là gì? why?", "tại sao lỗi? đúng ko?", "??", "ok"]
        for base in GAP + PLAIN + WRITTEN + WRITTEN_PLAIN:
            pasted = f'{base}\n<pasted_content id="p">{rng.choice(fillers)}</pasted_content id="p">'
            with self.subTest(base=base):
                self.assertEqual(hook.reminder(pasted), hook.reminder(base))

    def test_long_prompt_is_fast(self):
        start = time.monotonic()
        self.assertFires("x " * 100_000 + "là gì?")
        self.assertLess(time.monotonic() - start, 2.0)


if __name__ == "__main__":
    unittest.main()
