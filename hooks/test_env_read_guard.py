"""
Tests for env_read_guard.py, the PreToolUse hook that stops a Bash command
which would print a protected file or a secret environment variable. Run:
    python3 -m unittest test_env_read_guard.py -v

Each test runs the hook as Claude Code does: JSON on stdin, a home folder and
a project folder of its own, so no real settings or files are read.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(os.environ.get("ENV_READ_GUARD_HOOK") or Path(__file__).with_name("env_read_guard.py"))

USER_RULES = [
    "Read(.env)", "Read(.env.*)", "Read(!.env.example)", "Read(!.env.sample)",
    "Read(*.pem)", "Read(~/.zshrc)", "Read(~/.aws/credentials)",
]


class EnvReadGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.home = root / "home"
        self.project = root / "project"
        (self.home / ".claude").mkdir(parents=True)
        (self.project / ".claude").mkdir(parents=True)
        self.write_settings(self.home / ".claude" / "settings.json", USER_RULES)

    def tearDown(self):
        self.tmp.cleanup()

    def write_settings(self, path, deny):
        path.write_text(json.dumps({"permissions": {"deny": deny}}))

    def run_hook(self, command=None, raw=None, env=None, tool="Bash", cwd=None):
        stdin = raw if raw is not None else json.dumps({
            "hook_event_name": "PreToolUse", "session_id": "s", "cwd": str(cwd or self.project),
            "transcript_path": "/nowhere.jsonl", "permission_mode": "default",
            "tool_name": tool, "tool_input": {"command": command, "description": "d"}})
        full_env = {k: v for k, v in os.environ.items()
                    if k not in ("CLAUDE_SKIP_ENV_READ_GUARD", "CLAUDE_PROJECT_DIR")}
        full_env["HOME"] = str(self.home)
        full_env.update(env or {})
        p = subprocess.run([sys.executable, str(HOOK)], input=stdin, text=True,
                           capture_output=True, env=full_env, timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)  # it never fails the call: denying is in the JSON
        self.assertEqual(p.stderr.strip(), "")
        return json.loads(p.stdout) if p.stdout.strip() else None

    def assert_denied(self, command, *words):
        out = self.run_hook(command)
        self.assertIsNotNone(out, f"expected a deny, {command!r} went through")
        hso = out.get("hookSpecificOutput", {})
        self.assertEqual(hso.get("hookEventName"), "PreToolUse", out)
        self.assertEqual(hso.get("permissionDecision"), "deny", out)
        reason = hso.get("permissionDecisionReason", "")
        self.assertIn("env_read_guard", reason)
        for w in words:
            self.assertIn(w, reason)
        return reason

    def assert_allowed(self, command):
        self.assertIsNone(self.run_hook(command), f"{command!r} should go through silently")

    # ---- a protected file named in the command ----

    def test_denies_a_command_that_names_a_protected_file(self):
        cases = {
            "grep API_KEY .env": ".env",
            "python3 -c \"print(open('.env').read())\"": ".env",
            "awk -F= '{print $2}' ~/.zshrc": ".zshrc",
            'sort "$HOME/.zshrc"': ".zshrc",
            "less ${HOME}/.aws/credentials": "credentials",
            "head -1 services/api/.env.local": ".env.local",
            "openssl x509 -in certs/server.pem -noout -text": "server.pem",
            "cat < .env": ".env",
            "cp .env /tmp/backup": ".env",
            "echo $(grep KEY .env)": ".env",
            "echo `cut -d= -f2 .env`": ".env",
            "npm test && grep -c = .env": ".env",
            'grep "KEY .env': ".env",  # an unclosed quote is still read
        }
        (self.project / ".env").write_text("A=1\n")
        cases["cat .env*"] = ".env"  # a glob is expanded against the folder
        cases['bash -c "grep KEY .env"'] = ".env"
        cases['echo "key=$(cat .env)"'] = ".env"
        cases["python3 - <<'EOF'\nprint(open('.env').read())\nEOF"] = ".env"  # a heredoc of code is read
        for command, name in cases.items():
            with self.subTest(command):
                reason = self.assert_denied(command, name)
                self.assertIn("Read(", reason)  # names the rule that protects it

    def test_rules_from_project_settings_and_local_settings_count(self):
        self.write_settings(self.project / ".claude" / "settings.json", ["Read(config/prod.yml)"])
        self.write_settings(self.project / ".claude" / "settings.local.json", ["Read(**/*.properties)"])
        self.assert_denied("grep password config/prod.yml", "prod.yml")
        self.assert_denied("awk 1 src/main/resources/application.properties", "application.properties")
        self.assert_allowed("grep password config/dev.yml")

    def test_an_absolute_rule_counts(self):
        vault = Path(self.tmp.name) / "vault"
        self.write_settings(self.project / ".claude" / "settings.json", [f"Read(/{vault}/**)"])
        self.assert_denied(f"grep x {vault}/notes/a.txt", "a.txt")

    def test_carve_outs_follow_claude_codes_rules(self):
        self.assert_allowed("cat .env.example")
        self.assert_allowed("grep KEY .env.sample")
        # a carve-out listed before the rule carves nothing out
        self.write_settings(self.home / ".claude" / "settings.json", ["Read(!.env.example)", "Read(.env.*)"])
        self.assert_denied("cat .env.example", ".env.example")
        # nor can a carve-out reopen a file under a ~/ rule, even from the home folder
        # (the docs' own case: Read(!~/notes/public/**) carves nothing out of Read(~/notes/**))
        self.write_settings(self.home / ".claude" / "settings.json", ["Read(~/notes/**)", "Read(!~/notes/public/**)"])
        out = self.run_hook("grep x notes/public/a.md", cwd=self.home)
        self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny", out)
        self.write_settings(self.home / ".claude" / "settings.json", ["Read(~/.ssh/id_*)", "Read(!~/.ssh/*.pub)"])
        self.assert_denied("ssh-keygen -lf ~/.ssh/id_ed25519.pub", "id_ed25519.pub")

    def test_loading_or_checking_a_protected_file_goes_through(self):
        for command in [
            "source .env && npm test",
            ". ./.env; pytest",
            "ls -la .env",
            "test -f .env && echo present",
            "[ -f .env ] || cp .env.example .env",
            "cp .env.example .env",
            'echo "DEBUG=1" >> .env',
            "sort names.txt > .env.local",
            "node --env-file=.env app.js",
            "docker compose --env-file .env up -d",
            "rm .env.local",
        ]:
            with self.subTest(command):
                self.assert_allowed(command)

    def test_a_file_name_in_prose_is_not_a_read(self):
        # commit messages, titles, echoed text and heredocs of text only mention the file
        for command in [
            'git commit -m "Ignore .env files"',
            'gh pr create --title "Stop reading .env" --body "x"',
            "git commit -m \"$(cat <<'EOF'\nKeep .env out of git\nEOF\n)\"",
            "cat > README.md <<'EOF'\nCopy .env.example to .env\nEOF",
            'echo "add API_KEY to .env"',
        ]:
            with self.subTest(command):
                self.assert_allowed(command)

    def test_known_gaps_go_through(self):
        # a command that reads without naming the file, and a script that opens it:
        # documented as the sandbox's job
        self.assert_allowed("grep -r TOKEN .")
        self.assert_allowed("python3 scripts/load.py")

    # ---- the environment ----

    def test_denies_a_command_that_prints_every_variable(self):
        for command in ["printenv", "env", "env | sort", "export", "export -p", "declare -x",
                        "set", "env FOO=1 printenv", "npm test; printenv | grep -i key"]:
            with self.subTest(command):
                self.assert_denied(command, "every")

    def test_denies_printing_a_variable_named_as_a_secret(self):
        cases = {
            "echo $DEVTO_API_KEY": "DEVTO_API_KEY",
            'echo "token is ${GITHUB_TOKEN}"': "GITHUB_TOKEN",
            "printenv GITHUB_TOKEN": "GITHUB_TOKEN",
            "printf '%s\\n' \"$AWS_SECRET_ACCESS_KEY\"": "AWS_SECRET_ACCESS_KEY",
            "echo $db_password": "db_password",
        }
        for command, name in cases.items():
            with self.subTest(command):
                self.assert_denied(command, name)

    def test_ordinary_variables_and_using_a_secret_go_through(self):
        for command in [
            "echo $HOME",
            "printenv PATH",
            "echo $GIT_AUTHOR_NAME",
            "env FOO=1 npm test",
            "export FOO=bar",
            "set -euo pipefail",
            'curl -H "api-key: $DEVTO_API_KEY" https://dev.to/api/articles/me/all',
            "git status",
            "npm test",
        ]:
            with self.subTest(command):
                self.assert_allowed(command)

    # ---- the way out and broken input ----

    def test_the_environment_switch_turns_it_off(self):
        self.assertIsNone(self.run_hook("grep API_KEY .env", env={"CLAUDE_SKIP_ENV_READ_GUARD": "1"}))

    def test_other_tools_and_empty_commands_are_left_alone(self):
        self.assertIsNone(self.run_hook("grep API_KEY .env", tool="Read"))
        self.assertIsNone(self.run_hook(""))

    def test_broken_settings_leave_the_other_rules_and_the_environment_checks(self):
        (self.home / ".claude" / "settings.json").write_text("{not json")
        self.write_settings(self.project / ".claude" / "settings.json", ["Read(.env)"])
        self.assert_denied("grep KEY .env", ".env")
        (self.project / ".claude" / "settings.json").write_text(json.dumps({"permissions": {"deny": "Read(.env)"}}))
        self.assert_allowed("grep KEY .env")  # no usable rule names it
        self.assert_denied("printenv", "every")

    def test_broken_input_goes_through_with_a_warning(self):
        for raw in ["not json", "[]", json.dumps({"tool_name": "Bash", "tool_input": "x"}), ""]:
            with self.subTest(raw=raw):
                out = self.run_hook(raw=raw)
                self.assertIsNotNone(out)
                self.assertNotIn("hookSpecificOutput", out)
                self.assertIn("env_read_guard could not check", out.get("systemMessage", ""))


if __name__ == "__main__":
    unittest.main()
