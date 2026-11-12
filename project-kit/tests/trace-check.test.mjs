// node --test tests/trace-check.test.mjs   (from project-kit/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRequirements, extractRefs, parseJUnit, parseManual, readScope, buildStatus, run } from "../files/scripts/trace-check.mjs";

const REQS = `# Checkout

## REQ-CHECKOUT-005 · At most two coupons per order
Status: active
Rule: an order accepts up to two coupons.
- ex1: two valid coupons → both applied
- ex2 \`assumed\`: a third coupon → error TOO_MANY_COUPONS

## REQ-CHECKOUT-012 · Stacked percentages multiply
- ex1: 100,000 VND, 10% + 5% → 85,500 VND
- ex2: one of two coupons expired → only the valid one applies

## REQ-CHECKOUT-001 · Old single-coupon rule
Status: deprecated
- ex1: one coupon only

## Notes
- ex9: not a requirement example
`;

const junit = (cases) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites><testsuite name="s">${cases.map(([name, kind]) =>
  kind === "pass" ? `<testcase classname="checkout" name="${name}" time="0.01"/>`
  : kind === "fail" ? `<testcase classname="checkout" name="${name}"><failure message="x">boom</failure></testcase>`
  : `<testcase classname="checkout" name="${name}"><skipped/></testcase>`).join("")}</testsuite></testsuites>`;

function project({ reqs = REQS, unit, e2e, manual, spec } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tc-"));
  mkdirSync(join(dir, "docs/product/requirements"), { recursive: true });
  writeFileSync(join(dir, "docs/product/requirements/checkout.md"), reqs);
  writeFileSync(join(dir, "docs/product/requirements/_template.md"), "## REQ-TEMPLATE-000 · ignored\n- ex1: x\n");
  mkdirSync(join(dir, "reports"));
  if (unit) writeFileSync(join(dir, "reports/unit.xml"), junit(unit));
  if (e2e) writeFileSync(join(dir, "reports/e2e.xml"), junit(e2e));
  if (manual) { mkdirSync(join(dir, ".work/test-runs"), { recursive: true }); writeFileSync(join(dir, ".work/test-runs/m.json"), JSON.stringify(manual)); }
  if (spec) { mkdirSync(join(dir, ".work/tasks/t1"), { recursive: true }); writeFileSync(join(dir, ".work/tasks/t1/spec.md"), spec); }
  return dir;
}

const ALL_PASS = [
  ["REQ-CHECKOUT-005 ex1: two coupons", "pass"],
  ["REQ-CHECKOUT-005 ex2: third coupon rejected", "pass"],
  ["REQ_CHECKOUT_012_ex1 multiplies", "pass"],
  ["REQ-CHECKOUT-012 ex2: expired one ignored", "pass"],
];

// ---- parsing

test("requirements: ids, titles, examples, deprecated status; other headings end a section", () => {
  const r = parseRequirements(REQS, "checkout.md");
  assert.deepEqual(r.map(x => x.id), ["REQ-CHECKOUT-005", "REQ-CHECKOUT-012", "REQ-CHECKOUT-001"]);
  assert.equal(r[0].title, "At most two coupons per order");
  assert.deepEqual(r[0].examples.map(e => e.id), ["ex1", "ex2"]);
  assert.equal(r[2].status, "deprecated");
  assert.ok(!r.some(x => x.examples.some(e => e.id === "ex9")));
});

test("refs: dash and underscore forms, several per title, missing example", () => {
  assert.deepEqual(extractRefs("REQ-CHECKOUT-012 ex1 and REQ_CHECKOUT_005_ex2"),
    [{ req: "REQ-CHECKOUT-012", ex: "ex1" }, { req: "REQ-CHECKOUT-005", ex: "ex2" }]);
  assert.deepEqual(extractRefs("covers REQ-PAY-003 generally"), [{ req: "REQ-PAY-003", ex: null }]);
  assert.deepEqual(extractRefs("no reference here"), []);
});

test("junit: pass, failure, error, skipped, self-closing, entities", () => {
  const xml = `<testsuite><testcase name="a &amp; b"/><testcase name="f"><failure/></testcase>
    <testcase name="e"><error message="x"/></testcase><testcase name="s"><skipped/></testcase></testsuite>`;
  assert.deepEqual(parseJUnit(xml, "unit").map(c => [c.name, c.outcome]),
    [["a & b", "pass"], ["f", "fail"], ["e", "fail"], ["s", "skipped"]]);
  assert.throws(() => parseJUnit("<html></html>"), /not a JUnit/);
});

test("manual: a pass without evidence is not a pass", () => {
  const m = parseManual([
    { ref: "REQ-CHECKOUT-012 ex1", status: "pass", by: "Lan", date: "2026-10-01", evidence: "shots/ex1.png" },
    { ref: "REQ-CHECKOUT-012 ex2", status: "pass", by: "Lan", date: "2026-10-01" },
    { ref: "REQ-CHECKOUT-012", status: "pass", by: "Lan", date: "2026-10-01", evidence: "x" },
  ], "m.json");
  assert.deepEqual(m.cases.map(c => c.outcome), ["pass", "skipped"]);
  assert.equal(m.problems.length, 2);
  assert.match(m.problems[0], /needs "evidence"/);
  assert.match(m.problems[1], /must name one example/);
});

test("scope: REQ ids under ## Changes only", () => {
  const spec = "# T\n## Goal\nREQ-OTHER-001 mentioned\n## Changes\n- REQ-CHECKOUT-005 (changed)\n- REQ-CHECKOUT-012 (new)\n## Done when\nREQ-X-999\n";
  assert.deepEqual(readScope(spec), ["REQ-CHECKOUT-005", "REQ-CHECKOUT-012"]);
});

// ---- status: must pass (positive)

test("all examples proven → ok, levels recorded", () => {
  const dir = project({ unit: ALL_PASS, e2e: [["REQ-CHECKOUT-012 ex1 checkout flow", "pass"]] });
  const r = run(["--results", "unit=reports/unit.xml", "--results", "e2e=reports/e2e.xml", "--out", "status.json"], { cwd: dir, now: "T" });
  assert.equal(r.code, 0, r.text);
  const st = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
  assert.deepEqual(st.requirements["REQ-CHECKOUT-012"].examples.ex1.levels, ["unit", "e2e"]);
  assert.equal(st.summary.pass, 4);
  assert.ok(!("REQ-CHECKOUT-001" in st.requirements), "deprecated not in scope");
  assert.ok(!("REQ-TEMPLATE-000" in st.requirements), "_template ignored");
});

test("manual records with evidence count as a level", () => {
  const dir = project({
    unit: ALL_PASS.filter(([n]) => !n.includes("012 ex2")),
    manual: [{ ref: "REQ-CHECKOUT-012 ex2", status: "pass", by: "Lan", date: "2026-10-01", evidence: "rec.mp4" }],
  });
  const r = run(["--results", "unit=reports/unit.xml", "--manual", ".work/test-runs/m.json"], { cwd: dir });
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.status.requirements["REQ-CHECKOUT-012"].examples.ex2.levels, ["manual"]);
});

test("--task scopes to the spec's Changes and writes status.json beside it", () => {
  const dir = project({
    unit: [["REQ-CHECKOUT-012 ex1", "pass"], ["REQ-CHECKOUT-012 ex2", "pass"]],
    spec: "## Changes\n- REQ-CHECKOUT-012 (new)\n",
  });
  const r = run(["--results", "unit=reports/unit.xml", "--task", ".work/tasks/t1"], { cwd: dir });
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.status.scope, ["REQ-CHECKOUT-012"]);
  assert.ok(existsSync(join(dir, ".work/tasks/t1/status.json")));
});

// ---- status: must block (negative)

test("a failing test fails its example even if another level passes", () => {
  const dir = project({ unit: ALL_PASS, e2e: [["REQ-CHECKOUT-012 ex1", "fail"]] });
  const r = run(["--results", "unit=reports/unit.xml", "--results", "e2e=reports/e2e.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.status.requirements["REQ-CHECKOUT-012"].examples.ex1.status, "fail");
  assert.match(r.text, /REQ-CHECKOUT-012 ex1: fail/);
});

test("an example with no test blocks", () => {
  const dir = project({ unit: ALL_PASS.slice(0, 3) });
  const r = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.status.requirements["REQ-CHECKOUT-012"].examples.ex2.status, "no test");
});

test("only skipped tests do not prove an example", () => {
  const dir = project({ unit: [...ALL_PASS.slice(0, 3), ["REQ-CHECKOUT-012 ex2", "skipped"]] });
  const r = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.status.requirements["REQ-CHECKOUT-012"].examples.ex2.status, "skipped");
});

test("a test pointing at a deprecated or unknown example is an orphan and blocks", () => {
  const dir = project({ unit: [...ALL_PASS, ["REQ-CHECKOUT-001 ex1 old rule", "pass"], ["REQ-CHECKOUT-012 ex7", "pass"]] });
  const r = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.status.orphans.length, 2);
});

test("a manual pass without evidence blocks", () => {
  const dir = project({
    unit: ALL_PASS.filter(([n]) => !n.includes("012 ex2")),
    manual: [{ ref: "REQ-CHECKOUT-012 ex2", status: "pass", by: "Lan", date: "2026-10-01" }],
  });
  const r = run(["--results", "reports/unit.xml", "--manual", ".work/test-runs/m.json"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.status.requirements["REQ-CHECKOUT-012"].examples.ex2.status, "skipped");
});

test("a requirement with no examples, or a duplicate id, is a problem", () => {
  const dir = project({ reqs: REQS + "\n## REQ-CHECKOUT-005 · dup\n- ex1: x\n\n## REQ-CHECKOUT-020 · no examples\nRule: something\n", unit: ALL_PASS });
  const r = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.ok(r.status.problems.some(p => /defined twice/.test(p)));
  assert.ok(r.status.problems.some(p => /REQ-CHECKOUT-020 has no examples/.test(p)));
});

test("no results given blocks, even when nothing is in scope", () => {
  const dir = project({ reqs: "## REQ-OLD-001 · gone\nStatus: deprecated\n- ex1: x\n" });
  const r = run([], { cwd: dir });
  assert.equal(r.code, 1);
  assert.ok(r.status.problems.some(p => /no test results given/.test(p)));
});

test("a missing results file blocks, even when the other files prove everything", () => {
  const dir = project({ unit: ALL_PASS });
  const r = run(["--results", "unit=reports/unit.xml", "--results", "e2e=reports/missing.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.ok(r.status.problems.some(p => /results file not found: reports\/missing.xml/.test(p)));
});

test("levels list only the levels whose tests passed", () => {
  const dir = project({ unit: ALL_PASS, e2e: [["REQ-CHECKOUT-005 ex1 flow", "skipped"]] });
  const r = run(["--results", "unit=reports/unit.xml", "--results", "e2e=reports/e2e.xml"], { cwd: dir });
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.status.requirements["REQ-CHECKOUT-005"].examples.ex1.levels, ["unit"]);
});

test("scope naming an unknown REQ blocks", () => {
  const dir = project({ unit: ALL_PASS });
  const r = run(["--results", "reports/unit.xml", "--scope", "REQ-CHECKOUT-012,REQ-NOPE-001"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.ok(r.status.problems.some(p => /REQ-NOPE-001/.test(p)));
});

test("assumed examples are listed; --strict blocks on them", () => {
  const dir = project({ unit: ALL_PASS });
  const loose = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(loose.code, 0, loose.text);
  assert.deepEqual(loose.status.assumed, ["REQ-CHECKOUT-005 ex2"]);
  assert.equal(loose.status.requirements["REQ-CHECKOUT-005"].examples.ex1.assumed, undefined);
  const strict = run(["--results", "reports/unit.xml", "--strict"], { cwd: dir });
  assert.equal(strict.code, 1);
  assert.match(strict.text, /REQ-CHECKOUT-005 ex2 is still assumed/);
});

test("a removed example leaves the scope; tests still naming it are orphans", () => {
  const reqs = REQS.replace("- ex2: one of two coupons expired", "- ex3 (removed 2026-10-02: replaced by ex2): old wording\n- ex2: one of two coupons expired");
  const dir = project({ reqs, unit: ALL_PASS });
  const ok = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(ok.code, 0, ok.text);
  assert.ok(!("ex3" in ok.status.requirements["REQ-CHECKOUT-012"].examples));
  writeFileSync(join(dir, "reports/old.xml"), junit([["REQ-CHECKOUT-012 ex3 old", "pass"]]));
  const r = run(["--results", "reports/unit.xml", "--results", "reports/old.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.status.orphans[0], /REQ-CHECKOUT-012 ex3/);
});

test("a requirement whose examples are all removed has nothing to prove it", () => {
  const dir = project({ reqs: "## REQ-A-001 · x\n- ex1 (removed 2026-10-02: wrong)\n", unit: [["x", "pass"]] });
  const r = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.ok(r.status.problems.some(p => /REQ-A-001 has no examples/.test(p)));
});

test("a failing test that names no requirement still blocks; a passing one is ignored", () => {
  const dir = project({ unit: [...ALL_PASS, ["formats dates", "pass"]] });
  assert.equal(run(["--results", "reports/unit.xml"], { cwd: dir }).code, 0);
  writeFileSync(join(dir, "reports/other.xml"), junit([["formats dates", "fail"]]));
  const r = run(["--results", "reports/unit.xml", "--results", "reports/other.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.text, /"checkout › formats dates" failed/);
  assert.equal(r.status.problems.filter(p => /formats dates/.test(p)).length, 1, r.text);
});

test("a failing test inside the scope is reported once, under its example", () => {
  const dir = project({ unit: ALL_PASS.map(([n, k]) => n.startsWith("REQ-CHECKOUT-012 ex2") ? [n, "fail"] : [n, k]) });
  const r = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.status.requirements["REQ-CHECKOUT-012"].examples.ex2.status, "fail");
  assert.equal(r.status.problems.length, 0, r.text);
});

test("a failing test for a requirement outside the task still blocks; a passing one does not", () => {
  const spec = "## Changes\n- REQ-CHECKOUT-012 (new)\n";
  const mine = [["REQ-CHECKOUT-012 ex1", "pass"], ["REQ-CHECKOUT-012 ex2", "pass"]];
  const green = project({ unit: [...mine, ["REQ-CHECKOUT-005 ex1: two coupons", "pass"]], spec });
  const ok = run(["--results", "reports/unit.xml", "--task", ".work/tasks/t1"], { cwd: green });
  assert.equal(ok.code, 0, ok.text);
  const red = project({ unit: [...mine, ["REQ-CHECKOUT-005 ex1: two coupons", "fail"]], spec });
  const r = run(["--results", "reports/unit.xml", "--task", ".work/tasks/t1"], { cwd: red });
  assert.equal(r.code, 1);
  assert.deepEqual(r.status.scope, ["REQ-CHECKOUT-012"]);
  assert.match(r.text, /"checkout › REQ-CHECKOUT-005 ex1: two coupons" failed/);
});

test("a failing test that names a requirement but no example still blocks", () => {
  const dir = project({ unit: [...ALL_PASS, ["REQ-CHECKOUT-005 rejects bad codes", "fail"]] });
  const r = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.text, /"checkout › REQ-CHECKOUT-005 rejects bad codes" failed/);
});

test("a failing orphan is reported once, as an orphan", () => {
  const dir = project({ unit: [...ALL_PASS, ["REQ-CHECKOUT-012 ex7", "fail"]] });
  const r = run(["--results", "reports/unit.xml"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.status.orphans.length, 1);
  assert.ok(!r.status.problems.some(p => /REQ-CHECKOUT-012 ex7/.test(p)), r.text);
});

test("example text drops the assumed marker", () => {
  const [r] = parseRequirements("## REQ-A-001 · x\n- ex1 `assumed`: one coupon expired → valid one applies\n");
  assert.equal(r.examples[0].text, "one coupon expired → valid one applies");
  assert.equal(r.examples[0].assumed, true);
});

test("pytest JUnit: a Python function name proves its example by the underscore form", () => {
  // pytest writes classname="test_checkout.CheckoutTest" name="test_REQ_..._ex1_...";
  // a Python name cannot hold "-", so the underscore form is the only one it can use.
  const xml = `<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" tests="2">
<testcase classname="test_checkout.CheckoutTest" name="test_REQ_CHECKOUT_012_ex1_stacked_coupons" time="0.001" />
<testcase classname="test_checkout" name="test_REQ_CHECKOUT_012_ex2_expired_coupon" time="0.001"><failure message="AssertionError">x</failure></testcase>
</testsuite></testsuites>`;
  const cases = parseJUnit(xml, "unit");
  assert.equal(cases.length, 2);
  assert.deepEqual(extractRefs(cases[0].name), [{ req: "REQ-CHECKOUT-012", ex: "ex1" }]);
  assert.deepEqual(extractRefs(cases[1].name), [{ req: "REQ-CHECKOUT-012", ex: "ex2" }]);
  assert.equal(cases[1].outcome, "fail");
});
