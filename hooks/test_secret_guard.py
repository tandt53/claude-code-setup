"""
Tests for secret_guard.py, the UserPromptSubmit hook that stops a message
holding a secret before it reaches Claude. Run:
    python3 -m unittest test_secret_guard.py -v

Every key here is fake, built from pieces at run time, so this file holds no
string a secret scanner would take for a key.
"""

import base64
import json
import os
import random
import shutil
import string
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HOOK = Path(os.environ.get("SECRET_GUARD_HOOK") or Path(__file__).with_name("secret_guard.py"))
REAL_GITLEAKS = shutil.which("gitleaks")

_r = random.Random(20261114)
ALNUM = string.ascii_letters + string.digits


def rnd(n, alphabet=ALNUM):
    return "".join(_r.choice(alphabet) for _ in range(n))


def b64url(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


GITHUB = "gh" + "p_" + rnd(36)
GITHUB_FINE = "github" + "_pat_" + rnd(22) + "_" + rnd(59)
ANTHROPIC = "sk-" + "ant-api03-" + rnd(93, ALNUM + "-_") + "AA"
AWS = "AK" + "IA" + rnd(16, string.ascii_uppercase + "234567")
PEM = ("-----BEGIN RSA " + "PRIVATE KEY-----\n" + "\n".join(rnd(64, ALNUM + "+/") for _ in range(4))
       + "\n-----END RSA " + "PRIVATE KEY-----")
JWT = b64url({"alg": "HS256", "typ": "JWT"}) + "." + b64url({"sub": rnd(8), "iat": 1700000000}) + "." + rnd(43, ALNUM + "-_")

KEYS = {
    "GitHub token": GITHUB,
    "GitHub token (fine-grained)": GITHUB_FINE,
    "Anthropic API key": ANTHROPIC,
    "AWS access key id": AWS,
    "private key": PEM,
    "JWT": JWT,
}

BEARER = rnd(40)
API_KEY = rnd(32)
BASIC = base64.b64encode(("admin:" + rnd(14)).encode()).decode()
SHORT_BASIC = base64.b64encode(b"ci:pa55wd").decode()   # too short to look random
SESSION = rnd(48)
AUTH_TOKEN = rnd(36)
HEADERS = {
    "curl with a bearer token": f'curl -H "Authorization: Bearer {BEARER}" https://api.example.com/v1/items',
    "raw x-api-key header": f"GET /v1/items HTTP/1.1\nHost: api.example.com\nx-api-key: {API_KEY}",
    "basic auth header": f"Authorization: Basic {BASIC}",
    "short basic auth header": f"curl -H 'Authorization: Basic {SHORT_BASIC}' https://ci.example.com",
    "session cookie": f"Cookie: _ga=GA1.2.1234567890.1700000000; session_id={SESSION}",
    "auth header in code": f'headers = {{"X-Auth-Token": "{AUTH_TOKEN}"}}',
}

PLAIN = [
    "please add pagination to the orders list",
    "a GitHub token is ghp_ followed by 36 letters and digits",
    "AWS documents AKIAIOSFODNN7EXAMPLE as its sample access key id",
    "a PEM file starts with -----BEGIN RSA PRIVATE KEY----- on its own line",
    'curl -H "Authorization: Bearer $API_TOKEN" https://api.example.com',
    'curl -H "Authorization: Bearer ${TOKEN}" https://api.example.com',
    "x-api-key: <your-api-key>",
    # placeholders long enough, and with digits, to look like a key but for their form
    'curl -H "Authorization: Bearer ${GITHUB_TOKEN_2024_V2}" https://api.example.com',
    "x-api-key: <your-api-key-from-step-3>",
    "Authorization: Bearer xxxxxxxxxxxxxxxxxxxxxxxx",
    "Authorization: Bearer ab12ab12ab12ab12ab12",   # a dummy: too few distinct characters
    "X-Auth-Token: process.env.AUTH_TOKEN_V2",
    'fetch(url, {headers: {"Authorization": `Bearer ${process.env.TOKEN}`}})',
    "Cookie: _ga=GA1.2.1234567890.1700000000; theme=dark",
    "git show 9f8a7c6b5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a",
    "the request id was 3f2b8c1e-9d4a-4e6b-8f7c-1a2b3c4d5e6f",
    "authorization: the step where the server checks what a user may do",
]


def fake_gitleaks(directory, body):
    """A `gitleaks` executable in directory whose behaviour is the Python body.

    It is run once before it is returned. macOS can take seconds over the first
    run of a new executable (measured: 0.03 s to 3.06 s under load, then 0.02 s),
    and that first run must not land inside the hook's 2-second limit."""
    exe = Path(directory) / "gitleaks"
    exe.write_text(f"#!{sys.executable}\nimport json, os, sys, time\n"
                   f"if os.environ.get('FAKE_GITLEAKS_WARMUP'): sys.exit(0)\n"
                   f"sys.stdin.read()\n{body}\n")
    exe.chmod(0o755)
    subprocess.run([str(exe)], env={**os.environ, "FAKE_GITLEAKS_WARMUP": "1"}, timeout=30, check=True)
    return exe


class SecretGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.bin = Path(self.tmp.name) / "bin"   # PATH for the hook: no gitleaks unless a test adds one
        self.bin.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, prompt=None, raw=None, env=None, path=None):
        stdin = raw if raw is not None else json.dumps({
            "hook_event_name": "UserPromptSubmit", "session_id": "s", "cwd": self.tmp.name,
            "transcript_path": "/nowhere.jsonl", "prompt": prompt})
        full_env = {k: v for k, v in os.environ.items() if k != "CLAUDE_SKIP_SECRET_GUARD"}
        full_env["PATH"] = str(path or self.bin)
        full_env.update(env or {})
        start = time.monotonic()
        p = subprocess.run([sys.executable, str(HOOK)], input=stdin, text=True, capture_output=True,
                           env=full_env, timeout=30)
        self.elapsed = time.monotonic() - start
        self.assertEqual(p.returncode, 0, p.stderr)   # it never fails the event: blocking is in the JSON
        self.assertEqual(p.stderr.strip(), "")
        return json.loads(p.stdout) if p.stdout.strip() else None

    def assert_blocked(self, out, kind, line, secret):
        self.assertIsNotNone(out, "expected a block, the message went through silently")
        self.assertEqual(out.get("decision"), "block", out)
        self.assertTrue(out["hookSpecificOutput"]["suppressOriginalPrompt"])
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")
        reason = out["reason"]
        self.assertIn(kind, reason)
        self.assertIn(f"line {line}", reason)
        self.assertIn("[secret-ok]", reason)
        self.assertNotIn(secret, reason)                 # never the whole secret
        self.assertNotIn(secret[6:-4], json.dumps(out))  # nor its middle

    def assert_warned(self, out, *words):
        self.assertIsNotNone(out, "expected a warning, got nothing")
        self.assertNotEqual(out.get("decision"), "block", out)
        for w in words:
            self.assertIn(w, out.get("systemMessage", ""))

    # ---- blocks ----

    def test_blocks_each_certain_kind_of_key(self):
        for kind, key in KEYS.items():
            with self.subTest(kind):
                out = self.run_hook(f"can you check why this fails\nthe key is {key}")
                self.assert_blocked(out, kind, 2, key)

    def test_blocks_a_key_inside_a_pasted_block(self):
        prompt = ("here is the log\n<pasted_content id=\"7\">\nINFO start\n"
                  f"TOKEN={GITHUB}\nINFO done\n</pasted_content id=\"7\">")
        self.assert_blocked(self.run_hook(prompt), "GitHub token", 4, GITHUB)

    def test_blocks_a_credential_header_with_a_real_looking_value(self):
        secrets = {"curl with a bearer token": BEARER, "raw x-api-key header": API_KEY,
                   "basic auth header": BASIC, "short basic auth header": SHORT_BASIC, "session cookie": SESSION, "auth header in code": AUTH_TOKEN}
        for name, text in HEADERS.items():
            with self.subTest(name):
                line = text[: text.index(secrets[name])].count("\n") + 1
                out = self.run_hook(text)
                kind = "session cookie" if "cookie" in name else "credential header"
                self.assert_blocked(out, kind, line, secrets[name])

    def test_shows_the_masked_value(self):
        out = self.run_hook(GITHUB)
        self.assertIsNotNone(out, "expected a block, the message went through silently")
        reason = out["reason"]
        self.assertIn(GITHUB[:6] + "…" + GITHUB[-4:], reason)

    def test_every_secret_in_the_message_is_listed(self):
        out = self.run_hook(f"{GITHUB}\nand\n{AWS}")
        self.assertIsNotNone(out, "expected a block, the message went through silently")
        reason = out["reason"]
        self.assertIn("line 1", reason)
        self.assertIn("line 3", reason)

    # ---- lets through ----

    def test_lets_ordinary_messages_through_silently(self):
        for text in PLAIN:
            with self.subTest(text):
                self.assertIsNone(self.run_hook(text))

    def test_an_empty_message_goes_through_silently(self):
        self.assertIsNone(self.run_hook(""))

    # ---- the way out ----

    def test_secret_ok_on_the_first_line_sends_it_with_a_warning(self):
        self.assert_warned(self.run_hook(f"[secret-ok]\nthe key is {GITHUB}"), "[secret-ok]")

    def test_secret_ok_after_an_ide_context_block_still_counts(self):
        prompt = f"<ide_opened_file>The user opened a.py</ide_opened_file>\n[secret-ok] {GITHUB}"
        self.assert_warned(self.run_hook(prompt), "[secret-ok]")

    def test_secret_ok_further_down_does_not_count(self):
        self.assert_blocked(self.run_hook(f"the key is {GITHUB}\n[secret-ok]"), "GitHub token", 1, GITHUB)

    def test_the_environment_switch_turns_it_off(self):
        self.assertIsNone(self.run_hook(GITHUB, env={"CLAUDE_SKIP_SECRET_GUARD": "1"}))

    # ---- gitleaks, the second layer ----

    def test_without_gitleaks_the_patterns_still_block(self):
        self.assert_blocked(self.run_hook(GITHUB), "GitHub token", 1, GITHUB)

    def test_a_generic_gitleaks_finding_only_warns(self):
        fake_gitleaks(self.bin, 'print(json.dumps([{"RuleID": "generic-api-key", "StartLine": 2}])); sys.exit(1)')
        self.assert_warned(self.run_hook("deploy notes\ndb_secret = 'hunter2hunter2'"),
                           "generic-api-key", "line 2")

    def test_a_certain_gitleaks_finding_the_patterns_missed_blocks(self):
        fake_gitleaks(self.bin, 'print(json.dumps([{"RuleID": "github-pat", "StartLine": 1}])); sys.exit(1)')
        out = self.run_hook("an unusual token shape only gitleaks knows")
        self.assertIsNotNone(out, "expected a block, the message went through silently")
        self.assertEqual(out.get("decision"), "block", out)
        self.assertIn("github-pat", out["reason"])

    def test_gitleaks_that_hangs_is_given_up_after_two_seconds(self):
        fake_gitleaks(self.bin, "time.sleep(10)")
        self.assertIsNone(self.run_hook("please add pagination"))
        self.assertLess(self.elapsed, 5)
        self.assert_blocked(self.run_hook(GITHUB), "GitHub token", 1, GITHUB)

    def test_gitleaks_that_fails_leaves_the_patterns_verdict(self):
        fake_gitleaks(self.bin, 'print("not json"); sys.exit(2)')
        self.assertIsNone(self.run_hook("please add pagination"))
        self.assert_blocked(self.run_hook(GITHUB), "GitHub token", 1, GITHUB)

    @unittest.skipUnless(REAL_GITLEAKS, "gitleaks is not installed")
    def test_real_gitleaks_agrees_and_answers_quickly(self):
        path = os.pathsep.join([str(self.bin), str(Path(REAL_GITLEAKS).parent)])
        self.assertIsNone(self.run_hook("please add pagination to the orders list", path=path))
        self.assert_blocked(self.run_hook(f"x\n{GITHUB}", path=path), "GitHub token", 2, GITHUB)
        self.assertLess(self.elapsed, 2)

    # ---- broken input: let it through, say it was not scanned ----

    def test_broken_input_goes_through_with_a_warning(self):
        for raw in ["not json", "[1, 2]", json.dumps({"prompt": 42}), json.dumps({"no_prompt": True}), ""]:
            with self.subTest(raw):
                self.assert_warned(self.run_hook(raw=raw), "could not scan")


if __name__ == "__main__":
    unittest.main()
