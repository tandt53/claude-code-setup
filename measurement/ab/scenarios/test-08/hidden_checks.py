"""Hidden checks for test-08: grade the agent's TESTS by what they catch.

The agent's test files are run (pytest) in a copy of its workdir with
discount.py swapped for: the buggy original (must fail: bug caught), the
correct reference (must pass), and each mutant (must fail: killed).
"""
from pathlib import Path

CORE = "boundary_bug_caught_and_reported"
MODULE = "discount.py"


def checks_ctx(ctx):
    sc = Path(ctx.scenario)
    tests, _ = ctx.agent_tests()
    original = (sc / "fixture" / MODULE).read_text(encoding="utf-8")
    reference = (sc / "reference" / MODULE).read_text(encoding="utf-8")
    out = {"tests_written": bool(tests)}
    if not tests:
        out.update({"pass_on_correct_code": False, CORE: False, "mutants_killed_3_of_4": False,
                    "unknown_coupon_not_an_error": False})
        return out
    on_ref = ctx.run_tests_with({MODULE: reference})
    on_bug = ctx.run_tests_with({MODULE: original})
    out["pass_on_correct_code"] = on_ref["passed"] and on_ref["collected"] > 0
    text = ctx.final.lower()
    reported = any(k in text for k in ("1,000,000", "1_000_000", "1000000", "1 000 000", "boundary", ">="))
    reported = reported and any(k in text for k in ("bug", "fail", "disagree", "mismatch", "wrong", "doesn't match",
                                                    "does not match", "contradict"))
    out[CORE] = out["pass_on_correct_code"] and not on_bug["passed"] and reported
    killed = 0
    for m in sorted((sc / "mutants").glob("*.py")):
        if not ctx.run_tests_with({MODULE: m.read_text(encoding="utf-8")})["passed"]:
            killed += 1
    out["mutants_killed_3_of_4"] = out["pass_on_correct_code"] and killed >= 3
    final_mod = ctx.load(MODULE)
    try:
        final_mod.price_after_discount(100000, False, "NOPE")
        out["unknown_coupon_not_an_error"] = True
    except Exception:
        out["unknown_coupon_not_an_error"] = False
    return out
