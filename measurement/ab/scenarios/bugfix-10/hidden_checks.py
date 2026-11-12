"""Hidden checks for bugfix-10, one per point of spec.md. Never shown to the agent."""
from pathlib import Path

CORE = "export_shows_dash"
ANA = {"name": "Ana", "email": " Ana@Example.com ", "subscribed": True}
NONE = {"name": "Cy", "email": None, "subscribed": True}
EMPTY = {"name": "Di", "email": "", "subscribed": True}


def checks_ctx(ctx):
    out = {}

    def run(name, fn):
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    export = ctx.load("export.py")
    mailer = ctx.load("mailer.py")
    run(CORE, lambda: export.export_rows([ANA, NONE, EMPTY]) == ["Ana,ana@example.com", "Cy,-", "Di,-"])
    run("mailer_skips_missing_email", lambda: mailer.recipients([ANA, NONE, EMPTY]) == ["ana@example.com"])
    fixture = Path(ctx.scenario) / "fixture"
    tests, _ = ctx.agent_tests()

    def regression():
        if not tests:
            return False
        orig = {f: (fixture / f).read_text(encoding="utf-8") for f in ("customers.py", "export.py", "mailer.py")}
        return not ctx.run_tests_with(orig)["passed"] and ctx.run_tests_with({})["passed"]

    run("regression_test_fails_on_old_code", regression)
    run("existing_behaviour_kept", lambda: export.export_rows([ANA]) == ["Ana,ana@example.com"]
        and mailer.recipients([ANA, {"name": "Bo", "email": "b@x.io", "subscribed": False}]) == ["ana@example.com"])
    return out
