# claude-code-setup

Source copy of the global Claude Code setup; `~/.claude` is the installed copy.
After editing here, install the changed files there and confirm `diff` is empty.

Test command: `python3 docs/trace.py && python3 -m unittest discover -s hooks && node --test project-kit/tests/trace-check.test.mjs project-kit/tests/mobile-run.test.mjs project-kit/tests/browser-run.test.mjs && .venv/bin/python -m unittest discover -s measurement -p 'test_*.py'`

The measurement tests run in `.venv`, because the A/B scenarios' hidden checks
run pytest. Set it up once: `python3 -m venv .venv && .venv/bin/pip install pytest`.
