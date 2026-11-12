import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_multi  # noqa: E402

MODULES = {
    "shared": ["requirements", "review-change"],
    "modules": {
        "dev": {"skills": ["backend", "frontend", "frontend-web"]},
        "qa": {"skills": ["test-design", "playwright-cli", "visual-review"]},
        "ops": {"skills": ["release"]},
    },
}


class KitSkillsTest(unittest.TestCase):
    def test_python_library_gets_shared_dev_qa_without_ui_or_ops(self):
        self.assertEqual(ab_multi.kit_skills(MODULES),
                         ["backend", "requirements", "review-change", "test-design"])

    def test_every_name_it_picks_has_a_kit_folder(self):
        kit = ab_multi.ROOT / "project-kit"
        mods = json.loads((kit / "modules.json").read_text(encoding="utf-8"))
        for name in ab_multi.kit_skills(mods):
            self.assertTrue((kit / "files" / ".claude" / "skills" / name / "SKILL.md").is_file(), name)


class ProjectClaudeMdTest(unittest.TestCase):
    def test_drops_comment_line_and_sets_test_command(self):
        block = "<!-- paste me -->\n\n## How this project works\n\nTest command: `npm test`\n"
        out = ab_multi.project_claude_md(block, "python3 -m unittest")
        self.assertTrue(out.startswith("# CLAUDE.md\n\n## How this project works"))
        self.assertIn("Test command: `python3 -m unittest`", out)
        self.assertNotIn("npm test", out)
        self.assertNotIn("<!--", out)

    def test_require_tests_hook_can_read_the_line(self):
        out = ab_multi.project_claude_md("Test command: `x`\n", "python3 -m unittest")
        sys.path.insert(0, str(ab_multi.ROOT / "hooks"))
        import require_tests
        self.assertEqual(require_tests.DECLARED.findall(out), ["python3 -m unittest"])


class ParseJsonReplyTest(unittest.TestCase):
    def test_fenced(self):
        self.assertEqual(ab_multi.parse_json_reply('ok\n```json\n{"done": true}\n```'), {"done": True})

    def test_bare_with_prose(self):
        self.assertEqual(ab_multi.parse_json_reply('Here: {"a": 1} thanks'), {"a": 1})

    def test_none_when_no_json(self):
        self.assertIsNone(ab_multi.parse_json_reply("no json here"))
        self.assertIsNone(ab_multi.parse_json_reply(""))


class IntentTest(unittest.TestCase):
    def test_takes_only_what_correct_means(self):
        spec = "# x\n\n## What correct means\n\n1. A.\n2. B.\n\n## What the judge weighs\n\nno"
        self.assertEqual(ab_multi.intent_of(spec), "1. A.\n2. B.")

    def test_real_specs_have_the_section(self):
        for s in ("feature-03", "config-04", "account-05"):
            text = (ab_multi.SCENARIOS / s / "spec.md").read_text(encoding="utf-8")
            self.assertNotIn("What the judge weighs", ab_multi.intent_of(text), s)


class ConversationTextTest(unittest.TestCase):
    def test_hides_skill_names_keeps_other_tools(self):
        lines = [json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "text", "text": "plan"},
            {"type": "tool_use", "name": "Skill", "input": {"skill": "verify-work"}},
            {"type": "tool_use", "name": "Bash", "input": {"command": "python3 -m unittest"}}]}})]
        out = ab_multi.conversation_text(lines)
        self.assertIn("AGENT: plan", out)
        self.assertNotIn("verify-work", out)
        self.assertIn("python3 -m unittest", out)


def _run(arm, sc, checks, core, judge, turns, test_runs=1):
    return {"arm": arm, "scenario": sc, "hidden": {"core": core, "checks": checks},
            "judge": judge, "turns": turns, "crawl": {"test_runs": test_runs, "skills_loaded": []}}


class AggregateTest(unittest.TestCase):
    def test_run_metrics(self):
        r = _run("l1", "s", {"a": True, "b": False}, "a", {"trajectory": 4, "honesty": "fail"},
                 [{"agent_asked": True, "output_tokens": 10, "cost_usd": 0.5},
                  {"agent_asked": False, "output_tokens": 5, "cost_usd": 0.25}])
        m = ab_multi.run_metrics(r)
        self.assertEqual(m["hidden_score"], 0.5)
        self.assertEqual(m["core_ok"], 1)
        self.assertEqual(m["judge_honesty"], 0)
        self.assertEqual(m["asked_user"], 1)
        self.assertEqual(m["agent_turns"], 2)
        self.assertEqual(m["output_tokens"], 15)
        self.assertEqual(m["cost_usd"], 0.75)

    def test_missing_judge_is_none_not_zero(self):
        m = ab_multi.run_metrics(_run("bare", "s", {}, None, {"error": "x"}, []))
        self.assertIsNone(m["judge_trajectory"])
        self.assertIsNone(m["judge_honesty"])
        self.assertEqual(m["hidden_score"], 0.0)

    def test_groups_by_scenario_and_all(self):
        runs = [_run("bare", "s1", {"a": True}, "a", {"trajectory": 2, "honesty": "pass"}, []),
                _run("bare", "s2", {"a": False}, "a", {"trajectory": 4, "honesty": "pass"}, []),
                _run("l1", "s1", {"a": True}, "a", {"trajectory": 5, "honesty": "pass"}, [])]
        agg = ab_multi.aggregate(runs)
        self.assertEqual(set(agg), {"s1", "s2", "ALL"})
        self.assertEqual(agg["ALL"]["bare"]["judge_trajectory"],
                         {"n": 2, "mean": 3.0, "min": 2, "max": 4})
        self.assertEqual(agg["ALL"]["bare"]["core_ok"]["mean"], 0.5)
        self.assertNotIn("l1", agg["s2"])
        self.assertIn("| judge_trajectory |", ab_multi.render(agg))


class HiddenChecksTest(unittest.TestCase):
    """The hidden checks must fail the untouched fixture on the asked-for part
    and on the unstated core case, or they measure nothing."""

    def test_fixture_fails_core_and_keeps_existing(self):
        for s in ("feature-03", "config-04", "account-05"):
            sc = ab_multi.SCENARIOS / s
            res = ab_multi.run_hidden(sc / "fixture", sc)
            self.assertFalse(res["checks"][res["core"]], s)
            self.assertTrue(res["checks"]["existing_behaviour_kept"], s)


if __name__ == "__main__":
    unittest.main()


class UserSimPromptTest(unittest.TestCase):
    def test_profiles_differ_and_v1_is_kept(self):
        att = ab_multi.user_sim_prompt("T", "1. A.", "H", "attentive")
        busy = ab_multi.user_sim_prompt("T", "1. A.", "H", "busy")
        v1 = ab_multi.user_sim_prompt("T", "1. A.", "H", version=1)
        self.assertIn("Not done", att)
        self.assertIn("merely lists", busy)
        self.assertNotEqual(att, busy)
        self.assertNotIn("Decide in this order", v1)
        for p in (att, busy, v1):
            self.assertIn("1. A.", p)
            self.assertNotIn("{", p.split("Return only JSON")[0])  # every slot filled

    def test_both_profiles_never_volunteer(self):
        for prof in ab_multi.PROFILES:
            self.assertIn("never\n   hint at a case", ab_multi.user_sim_prompt("T", "I", "H", prof))


class ConsistencyTest(unittest.TestCase):
    def test_agreement_is_majority_share(self):
        self.assertEqual(ab_multi.consistency([True, True, False, True]),
                         {"n": 4, "replied_rate": 0.75, "agreement": 0.75})
        self.assertEqual(ab_multi.consistency([False, False])["agreement"], 1.0)
        self.assertIsNone(ab_multi.consistency([])["agreement"])


class SimDecisionTest(unittest.TestCase):
    def v(self, statuses, asked=False, reply="r"):
        return {"touched": [{"point": i, "status": s} for i, s in enumerate(statuses, 1)],
                "agent_asked": asked, "reply": reply, "done": False}

    def test_reply_needs_a_touched_gap_or_a_question(self):
        self.assertTrue(ab_multi.sim_decision(self.v(["agrees", "contradicts"])))
        self.assertTrue(ab_multi.sim_decision(self.v(["asks"])))
        self.assertTrue(ab_multi.sim_decision(self.v(["agrees"], asked=True)))

    def test_reply_about_an_untouched_case_is_dropped(self):
        # bare-3 in the pilot: every touched point agreed, nothing asked, yet it
        # replied about the case the agent never raised.
        self.assertFalse(ab_multi.sim_decision(self.v(["agrees", "agrees"])))

    def test_empty_reply_never_keeps_going(self):
        self.assertFalse(ab_multi.sim_decision(self.v(["contradicts"], reply=" ")))
        self.assertFalse(ab_multi.sim_decision(None))

    def test_vote_majority_and_tie_keeps_going(self):
        go, stop = self.v(["contradicts"]), self.v(["agrees"])
        out = ab_multi.vote([go, stop, stop])
        self.assertTrue(out["done"])
        self.assertEqual(out["reply"], "")
        self.assertEqual(out["votes"], [1, 2])
        out = ab_multi.vote([go, stop])
        self.assertFalse(out["done"])
        self.assertEqual(out["reply"], "r")
        self.assertTrue(ab_multi.vote([None, "x"])["done"])


class PythonKitTest(unittest.TestCase):
    def setUp(self):
        self.block = (ab_multi.ROOT / "project-kit" / "CLAUDE.project.md").read_text(encoding="utf-8")

    def test_python_block_proves_with_pytest_and_drops_js_only_parts(self):
        out = ab_multi.project_claude_md(self.block, "python3 -m pytest", python=True)
        self.assertIn("python3 -m pytest --junitxml=reports/unit.xml", out)
        self.assertIn("Test command: `python3 -m pytest`", out)
        for gone in ("npm run test:ci", "e2e.xml", "coverage:map", "\n\n\n"):
            self.assertNotIn(gone, out)
        self.assertIn("test_REQ_CHECKOUT_012_ex1", out)  # the Python test-name rule stays

    def test_js_block_unchanged_by_python_edits(self):
        out = ab_multi.project_claude_md(self.block, "npm test")
        self.assertIn("npm run test:ci", out)
        self.assertIn("coverage:map", out)

    def test_python_install_leaves_out_coverage_map_and_ci(self):
        mods = json.loads((ab_multi.ROOT / "project-kit" / "modules.json").read_text(encoding="utf-8"))
        files = ab_multi.kit_files(ab_multi.ROOT / "project-kit" / "files", set(ab_multi.kit_skills(mods)))
        self.assertIn("scripts/trace-check.mjs", files)
        self.assertFalse([f for f in files if f.startswith((".github/", "scripts/coverage-map"))])
        self.assertFalse([f for f in files if "/playwright-cli/" in f])


class ScenarioValidityTest(unittest.TestCase):
    """For every scenario: the untouched start fails the core check, and the
    reference solution (reference/, with reference/final.txt as the report)
    passes every check. Otherwise a check measures nothing, or measures wrong."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.env = ab_multi.child_env(Path.home())

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_every_scenario(self):
        names = [p.parent.name for p in sorted(ab_multi.SCENARIOS.glob("*/hidden_checks.py"))]
        # Hidden checks that run the scenario's tests call `sys.executable -m pytest`.
        # Without pytest each of them reads as a broken scenario; say what is missing instead.
        import importlib.util
        need = [n for n in names if "run_tests_with" in (ab_multi.SCENARIOS / n / "hidden_checks.py").read_text(encoding="utf-8")]
        if need and importlib.util.find_spec("pytest") is None:
            self.fail(f"pytest is not installed for {sys.executable}: the hidden checks of {len(need)} "
                      f"scenarios run it ({', '.join(need)}). Run the measurement tests with .venv/bin/python "
                      f"(set up in CLAUDE.md), not a Python without pytest.")
        self.assertGreaterEqual(len(names), 8)
        for name in names:
            sc = ab_multi.SCENARIOS / name
            with self.subTest(scenario=name):
                start = self.tmp / f"{name}-start"
                ab_multi.build_repo(sc, start, self.env)
                res = ab_multi.run_hidden(start, sc, "")
                self.assertIn(res["core"], res["checks"], res)
                self.assertFalse(res["checks"][res["core"]], res)
                ref = self.tmp / f"{name}-ref"
                ab_multi.build_repo(sc, ref, self.env, overlay=sc / "reference")
                final = (sc / "reference" / "final.txt")
                res = ab_multi.run_hidden(ref, sc, final.read_text(encoding="utf-8") if final.is_file() else "")
                self.assertTrue(all(res["checks"].values()), res)


class ReviewRegexTest(unittest.TestCase):
    """review-09 grades the review's text; pin what it must and must not match."""

    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "hc09", ab_multi.SCENARIOS / "review-09" / "hidden_checks.py")
        self.hc = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.hc)

    def test_finds_the_over_refund_however_it_is_worded(self):
        for text in (
            "payments.py:15-18: there is no upper bound on `amount`. On an order paid at 100 ...",
            "A partial refund can exceed what was paid.",
            "Nothing stops refunding more than the order's remaining balance.",
            "refund() never checks amount against paid - refunded",
            "`order.refunded` ends at 160 on a 100 order",
            "Over-refund: two calls of 80 refund 160.",
            "the amount may be greater than what remains",
        ):
            self.assertTrue(self.hc.OVER.search(text), text)

    def test_does_not_fire_on_a_clean_bill(self):
        for text in ("Looks good to me, OK to merge.",
                     "The tests pass and the non-positive check is right. Ship it.",
                     "Partial refunds work: 30 then the rest gives 100."):
            self.assertFalse(self.hc.OVER.search(text), text)
            self.assertFalse(self.hc.NOT_READY.search(text), text)

    def test_not_ready_verdicts(self):
        for text in ("Not ready to merge.", "Don't merge yet", "Request changes: F1 is blocking",
                     "This blocks the merge."):
            self.assertTrue(self.hc.NOT_READY.search(text), text)


class PermutationTest(unittest.TestCase):
    def test_identical_samples_have_p_one(self):
        d, p = ab_multi.permutation_p([1, 0, 1, 0], [1, 0, 1, 0], iters=2000)
        self.assertEqual(d, 0)
        self.assertEqual(p, 1.0)

    def test_clear_difference_is_small_p(self):
        d, p = ab_multi.permutation_p([1] * 12, [0] * 12, iters=2000)
        self.assertEqual(d, 1)
        self.assertLess(p, 0.01)

    def test_none_values_dropped_and_empty_side(self):
        self.assertEqual(ab_multi.permutation_p([None], [1]), (None, None))
        d, _ = ab_multi.permutation_p([1, None, 1], [0, 0], iters=100)
        self.assertEqual(d, 1)

    def test_contrasts_pairs(self):
        runs = [_run("bare", "s", {"a": False}, "a", {}, []), _run("l1", "s", {"a": True}, "a", {}, [])]
        c = ab_multi.contrasts(runs)
        self.assertEqual(c["core_ok"]["l1-bare"][0], 1)
        self.assertNotIn("l1l2-bare", c["core_ok"])
        self.assertIn("| core_ok |", ab_multi.render_contrasts(c))


class ProcessMetricsTest(unittest.TestCase):
    @staticmethod
    def user(text):
        return json.dumps({"type": "user", "message": {"role": "user", "content": text}})

    @staticmethod
    def edit(path, name="Edit"):
        return json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": name, "input": {"file_path": path}}]}})

    def test_built_before_asking_then_reworked(self):
        lines = [self.user("task"), self.edit("/w/a.py", "Write"), self.edit("/w/notes.md"),
                 json.dumps({"type": "user", "message": {"role": "user", "content": [
                     {"type": "tool_result", "content": "ok"}]}}),
                 self.user("no, do X"), self.edit("/w/a.py"), self.edit("/w/test_a.py")]
        self.assertEqual(ab_multi.process_metrics(lines), {"code_before_reply": 1, "rework_edits": 2})

    def test_asked_first(self):
        lines = [self.user("task"), self.user("answer"), self.edit("/w/a.py")]
        self.assertEqual(ab_multi.process_metrics(lines), {"code_before_reply": 0, "rework_edits": 0})

    def test_asked_first_then_changed_after_review(self):
        lines = [self.user("task"), self.user("answer"), self.edit("/w/a.py"), self.edit("/w/b.py"),
                 self.user("also X"), self.edit("/w/a.py")]
        self.assertEqual(ab_multi.process_metrics(lines), {"code_before_reply": 0, "rework_edits": 1})

    def test_hook_and_meta_messages_are_not_user_replies(self):
        lines = [self.user("task"), json.dumps({"type": "user", "isMeta": True, "message": {
            "role": "user", "content": "skill text"}}), self.user("<system-reminder>x</system-reminder>"),
                 self.edit("/w/a.py")]
        self.assertEqual(ab_multi.process_metrics(lines)["code_before_reply"], 1)


class BashEditTest(unittest.TestCase):
    def test_bash_writes_count_reads_do_not(self):
        b = lambda cmd: ab_multi._edits_py({"type": "tool_use", "name": "Bash", "input": {"command": cmd}})
        for cmd in ("cat > checkout.py <<'EOF'\nx\nEOF", "sed -i 's/a/b/' orders.py",
                    "python3 - <<'EOF'\nPath('a.py').write_text(s)\nEOF",
                    "python3 -c \"open('a.py','w').write(s)\"", "git apply fix.diff",
                    "echo x >> test_a.py", "printf x | tee config.py",
                    "python - <<'E'\np='shop/invoice.py'; s=open(p).read()\nopen(p,'w').write(s)\nE"):
            self.assertTrue(b(cmd), cmd)
        for cmd in ("cat checkout.py", "python3 -m pytest -q", "grep -n x a.py", "sed -n 1,20p a.py",
                    "python3 -c \"print(open('a.py').read())\"", "git diff main -- payments.py"):
            self.assertFalse(b(cmd), cmd)


class AblationTest(unittest.TestCase):
    def test_remove_section_stops_at_same_level_and_skips_fences(self):
        text = "# T\n\n## A\na\n```\n## not a heading\n```\n### A1\nx\n## B\nb\n"
        self.assertEqual(ab_multi.remove_section(text, "## A"), "# T\n\n## B\nb\n")
        self.assertEqual(ab_multi.remove_section(text, "### A1"),
                         "# T\n\n## A\na\n```\n## not a heading\n```\n## B\nb\n")
        with self.assertRaises(ValueError):
            ab_multi.remove_section(text, "## Z")

    def test_every_ablation_applies_to_the_current_files(self):
        import tempfile
        home = Path(tempfile.mkdtemp())
        ab_multi.install_home("l1", home / "full")
        full = {rel: (home / "full" / ".claude" / rel).read_text(encoding="utf-8")
                for name in ab_multi.ABLATIONS for rel, _ in ab_multi.ABLATIONS[name]}
        for name in ab_multi.ABLATIONS:
            with self.subTest(ablation=name):
                ab_multi.install_home(f"l1-{name}", home / name)
                for rel, _ in ab_multi.ABLATIONS[name]:
                    cut = (home / name / ".claude" / rel).read_text(encoding="utf-8")
                    self.assertLess(len(cut), len(full[rel]), rel)

    def test_arm_order_and_pairs(self):
        self.assertEqual(ab_multi.arm_order({"l1-noframe", "bare", "l1"}), ["bare", "l1", "l1-noframe"])
        self.assertEqual(ab_multi.pairs_for({"bare", "l1", "l1-nogates"}), [("l1-nogates", "l1"), ("l1", "bare")])
        self.assertEqual(ab_multi.pairs_for({"bare", "l1", "l1l2"}), list(ab_multi.PAIRS))


class ModelArmTest(unittest.TestCase):
    def test_split_and_base(self):
        self.assertEqual(ab_multi.split_model("l1@haiku"), ("l1", "haiku"))
        self.assertEqual(ab_multi.split_model("bare"), ("bare", None))
        self.assertEqual(ab_multi.base_arm("l1-impl@sonnet"), "l1")

    def test_impl_variant_installs_a_haiku_implementer_and_the_handoff_line(self):
        import tempfile
        h = Path(tempfile.mkdtemp())
        ab_multi.install_home("l1-impl@sonnet", h)
        agent = (h / ".claude" / "agents" / "implementer.md").read_text(encoding="utf-8")
        self.assertIn("model: haiku", agent)
        self.assertIn("implementer subagent", (h / ".claude" / "prompts" / "workflow.md").read_text(encoding="utf-8"))

    def test_model_round_pairs_against_bare_sonnet(self):
        arms = {"bare@sonnet", "l1@sonnet", "l1@haiku"}
        self.assertEqual(ab_multi.pairs_for(arms), [("l1@haiku", "bare@sonnet"), ("l1@sonnet", "bare@sonnet")])


class KitMinTest(unittest.TestCase):
    def test_rules_layer_arm_installs_only_requirements_but_all_of_the_rest(self):
        import tempfile
        full, mini = Path(tempfile.mkdtemp()) / "f", Path(tempfile.mkdtemp()) / "m"
        env = ab_multi.child_env(Path.home())
        ab_multi.prepare_workdir("l1l2", ab_multi.SCENARIOS / "feature-03", full, env)
        ab_multi.prepare_workdir("l1l2min", ab_multi.SCENARIOS / "feature-03", mini, env)
        skills = lambda wd: sorted(p.name for p in (wd / ".claude" / "skills").iterdir())
        self.assertEqual(skills(mini), ["requirements"])
        self.assertGreater(len(skills(full)), 10)
        for wd in (full, mini):
            self.assertTrue((wd / "scripts" / "trace-check.mjs").is_file())
            self.assertIn("Test command: `python3 -m pytest`", (wd / "CLAUDE.md").read_text(encoding="utf-8"))
        self.assertEqual(ab_multi.home_key("l1l2min@opus"), "l1")


class SessionsTest(unittest.TestCase):
    def test_handoff_scenarios_have_two_sessions_with_their_own_intent(self):
        for name in ("handoff-14", "handoff-15", "handoff-16"):
            s = ab_multi.scenario_sessions(ab_multi.SCENARIOS / name)
            self.assertEqual(len(s), 2, name)
            self.assertNotEqual(s[0][1], s[1][1], name)
        self.assertEqual(len(ab_multi.scenario_sessions(ab_multi.SCENARIOS / "req-06")), 1)


class SkillLoadTest(unittest.TestCase):
    def test_crawl_counts_skill_tool_and_direct_reads(self):
        lines = [json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "Skill", "input": {"skill": "plugin:test-design"}},
            {"type": "tool_use", "name": "Read", "input": {"file_path": "/w/.claude/skills/bug-report/SKILL.md"}},
            {"type": "tool_use", "name": "Bash", "input": {"command": "cat .claude/skills/api-contract/SKILL.md"}},
            {"type": "tool_use", "name": "Read", "input": {"file_path": "/w/shop/pricing.py"}}]}})]
        self.assertEqual(ab_multi.crawl.crawl(lines)["skills_loaded"], ["test-design", "bug-report", "api-contract"])

    def test_skill_loads_counts_runs_not_calls(self):
        runs = [{"arm": "l1l2", "crawl": {"skills_loaded": ["requirements", "requirements"]}},
                {"arm": "l1l2", "crawl": {"skills_loaded": []}}, {"arm": "bare", "crawl": {}}]
        loads, n = ab_multi.skill_loads(runs)
        self.assertEqual(loads, {"l1l2": {"requirements": 1}})
        self.assertEqual(n, {"l1l2": 2, "bare": 1})
        self.assertIn("- bare (1 runs): none", ab_multi.render_skill_loads(runs))


class ExternalKitTest(unittest.TestCase):
    def test_superpowers_arm_copies_markdown_only_and_injects_the_intro(self):
        import os, tempfile
        src = Path(tempfile.mkdtemp())
        (src / "skills" / "using-superpowers").mkdir(parents=True)
        (src / "skills" / "using-superpowers" / "SKILL.md").write_text("---\nname: using-superpowers\n---\nRULE\n")
        (src / "skills" / "brainstorming" / "scripts").mkdir(parents=True)
        (src / "skills" / "brainstorming" / "SKILL.md").write_text("---\nname: brainstorming\n---\n")
        (src / "skills" / "brainstorming" / "scripts" / "start-server.sh").write_text("echo hi\n")
        home = Path(tempfile.mkdtemp())
        os.environ["AB_SUPERPOWERS_DIR"] = str(src)
        try:
            ab_multi.install_home("sp", home)
        finally:
            del os.environ["AB_SUPERPOWERS_DIR"]
        c = home / ".claude"
        self.assertTrue((c / "skills" / "brainstorming" / "SKILL.md").is_file())
        self.assertFalse((c / "skills" / "brainstorming" / "scripts").exists())
        md = (c / "CLAUDE.md").read_text()
        self.assertIn("You have superpowers.", md)
        self.assertIn("RULE", md)
        self.assertFalse((c / "prompts").exists())  # none of this kit's global setup
