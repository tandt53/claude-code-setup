#!/usr/bin/env node
/**
 * trace-check: which approved requirement examples are proven by a test run.
 *
 * Reads
 *   - requirements:  docs/product/requirements/*.md  (REQ ids and their examples)
 *   - test results:  JUnit XML from any level (unit, integration, e2e, API)
 *   - manual runs:   JSON records of tests done by hand, each with evidence
 * Writes
 *   - status.json:   per example, pass | fail | skipped | no test, and by which levels
 * Exits
 *   0 every example in scope passes and nothing is broken
 *   1 something in scope is not proven (fail, skipped, no test, orphan, bad record),
 *     or any test failed, even one that names no requirement or only
 *     requirements outside the scope
 *   2 usage or parse error
 *
 * Conventions (see the project's CLAUDE.md):
 *   requirement heading   ## REQ-CHECKOUT-012 · Stacked coupons multiply
 *   status line           Status: active | deprecated          (default active)
 *   example line          - ex1: <given> → <when> → <result>
 *                         - ex2 `assumed`: …   (not yet confirmed by the owner)
 *                         - ex3 (removed 2026-10-02: why) …   (kept for history; its tests become orphans)
 *   test title            "REQ-CHECKOUT-012 ex1: 10% + 5% → 85,500"
 *                         (REQ_CHECKOUT_012_ex1 also matches)
 *
 * Usage
 *   node scripts/trace-check.mjs \
 *     --results unit=reports/unit.xml --results e2e=reports/e2e.xml \
 *     --manual .work/test-runs/checkout.json \
 *     --task .work/tasks/2026-10-01-coupon-stacking
 *   Scope: --task reads the REQ ids under "## Changes" in its spec.md;
 *          --scope REQ-A-001,REQ-B-002 names them; otherwise every active REQ.
 *   Output: <task>/status.json with --task, else --out, else stdout only.
 *   --strict: examples still marked `assumed` block (use before a release).
 *
 * No dependencies. Node 18+.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REQ_ID = /^REQ-[A-Z0-9]+-\d{3}$/;

// ---------------------------------------------------------------- parsing

/** Requirements from one markdown file. */
export function parseRequirements(text, file = "") {
  const reqs = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const h = raw.match(/^#{2,3}\s+(REQ-[A-Z0-9]+-\d{3})\b\s*[·:\-–—]?\s*(.*)$/);
    if (h) {
      cur = { id: h[1], title: h[2].trim(), file, status: "active", examples: [] };
      reqs.push(cur);
      continue;
    }
    if (/^#{1,3}\s/.test(raw)) { cur = null; continue; }   // any other heading ends the section
    if (!cur) continue;
    const st = raw.match(/^\s*\**Status\**\s*:\s*\**\s*([A-Za-z]+)/i);
    if (st) { cur.status = st[1].toLowerCase(); continue; }
    const ex = raw.match(/^\s*[-*]\s+\**(ex\d+)\b\**(.*)$/i);
    if (ex) cur.examples.push({ id: ex[1].toLowerCase(), removed: /\(removed\b/i.test(ex[2]), assumed: /`assumed`|\bassumed\b:/i.test(ex[2]), text: ex[2].replace(/^\s*`assumed`/i, "").replace(/^[\s:·`\-–—]*/, "").trim() });
  }
  return reqs;
}

/** REQ references in a test title: [{ req, ex }] */
export function extractRefs(title) {
  const refs = [];
  const re = /REQ[-_]([A-Z0-9]+)[-_](\d{3})(?:[\s_:·.,\-–—]*?(ex\d+))?/gi;
  let m;
  while ((m = re.exec(title))) {
    refs.push({ req: `REQ-${m[1].toUpperCase()}-${m[2]}`, ex: m[3] ? m[3].toLowerCase() : null });
  }
  return refs;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function attrs(s) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = decodeXml(m[2] ?? m[3] ?? "");
  return out;
}

/** Test cases from a JUnit XML report: [{ level, name, outcome }] */
export function parseJUnit(xml, level = "test") {
  if (!/<testsuites?\b|<testcase\b/.test(xml)) throw new Error("not a JUnit XML report");
  const cases = [];
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = attrs(m[1]);
    const body = m[2] ?? "";
    const outcome = /<(failure|error)\b/.test(body) ? "fail" : /<skipped\b/.test(body) ? "skipped" : "pass";
    const name = [a.classname, a.name].filter(Boolean).join(" › ");
    cases.push({ level, name, outcome });
  }
  return cases;
}

/**
 * Manual test records. Each: { ref: "REQ-X-001 ex1", status, by, date, evidence }.
 * A pass without evidence is not a pass: it becomes a problem.
 */
export function parseManual(json, source = "") {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (!Array.isArray(data)) throw new Error(`${source}: expected a JSON array of records`);
  const cases = [];
  const problems = [];
  data.forEach((r, i) => {
    const where = `${source}[${i}]`;
    const refs = extractRefs(String(r?.ref ?? ""));
    const status = String(r?.status ?? "").toLowerCase();
    if (refs.length !== 1 || !refs[0].ex) { problems.push(`${where}: "ref" must name one example, e.g. "REQ-CHECKOUT-012 ex1"`); return; }
    if (!["pass", "fail", "skipped"].includes(status)) { problems.push(`${where}: "status" must be pass, fail or skipped`); return; }
    if (!r.by || !r.date) { problems.push(`${where}: "by" and "date" are required`); return; }
    if (status === "pass" && !String(r.evidence ?? "").trim()) {
      problems.push(`${where}: a manual pass needs "evidence" (a screenshot path, a log, a recording)`);
      cases.push({ level: "manual", name: `${r.ref} (by ${r.by}, ${r.date}, no evidence)`, outcome: "skipped" });
      return;
    }
    cases.push({ level: "manual", name: `${r.ref} (by ${r.by}, ${r.date})`, outcome: status, evidence: r.evidence });
  });
  return { cases, problems };
}

/** REQ ids listed under "## Changes" in a task spec. */
export function readScope(specText) {
  const ids = [];
  let inChanges = false;
  for (const line of specText.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) { inChanges = /^##\s+Changes\b/i.test(line); continue; }
    if (!inChanges) continue;
    for (const m of line.matchAll(/REQ-[A-Z0-9]+-\d{3}/g)) if (!ids.includes(m[0])) ids.push(m[0]);
  }
  return ids;
}

// ---------------------------------------------------------------- status

export function buildStatus({ requirements, cases, scope = null, problems = [], now = new Date().toISOString(), inputs = [], strict = false }) {
  const allProblems = [...problems];
  const byId = new Map();
  for (const r of requirements) {
    if (byId.has(r.id)) allProblems.push(`${r.id} is defined twice (${byId.get(r.id).file}, ${r.file})`);
    else byId.set(r.id, r);
    const seen = new Set();
    for (const e of r.examples) {
      if (seen.has(e.id)) allProblems.push(`${r.id} ${e.id} is defined twice`);
      seen.add(e.id);
    }
  }

  const active = [...byId.values()].filter(r => r.status !== "deprecated");
  let inScope;
  if (scope && scope.length) {
    inScope = [];
    for (const id of scope) {
      const r = byId.get(id);
      if (!r) allProblems.push(`${id} is in scope but not in any requirements file`);
      else if (r.status === "deprecated") allProblems.push(`${id} is in scope but deprecated`);
      else inScope.push(r);
    }
  } else inScope = active;

  for (const r of inScope) if (!r.examples.some(e => !e.removed)) allProblems.push(`${r.id} has no examples, so nothing can prove it`);

  // index test results by example
  const hits = new Map();          // "REQ ex" -> [{level, name, outcome}]
  const orphans = [];
  const loose = [];
  const inScopeIds = new Set(inScope.map(r => r.id));
  for (const c of cases) {
    const refs = extractRefs(c.name);
    if (refs.length === 0 && c.outcome === "fail") allProblems.push(`${c.level}: "${c.name}" failed (it names no requirement, but a failing test still blocks)`);
    let counted = false, orphaned = false;
    for (const ref of refs) {
      if (!ref.ex) { loose.push(`${c.level}: "${c.name}" names ${ref.req} but no example (exN)`); continue; }
      const r = byId.get(ref.req);
      const known = r && r.status !== "deprecated" && r.examples.some(e => e.id === ref.ex && !e.removed);
      if (!known) { orphaned = true; orphans.push(`${c.level}: "${c.name}" → ${ref.req} ${ref.ex} does not exist, was removed, or is deprecated`); continue; }
      if (inScopeIds.has(ref.req)) counted = true;
      const key = `${ref.req} ${ref.ex}`;
      if (!hits.has(key)) hits.set(key, []);
      hits.get(key).push({ level: c.level, name: c.name, outcome: c.outcome, ...(c.evidence ? { evidence: c.evidence } : {}) });
    }
    // A failing test whose examples are all outside the scope (or that names a
    // requirement but no example) is counted nowhere above, yet still blocks.
    if (refs.length > 0 && c.outcome === "fail" && !counted && !orphaned) allProblems.push(`${c.level}: "${c.name}" failed (it names nothing in this scope, but a failing test still blocks)`);
  }

  const summary = { pass: 0, fail: 0, skipped: 0, "no test": 0 };
  const assumed = [];
  const out = {};
  for (const r of inScope) {
    const examples = {};
    for (const e of r.examples) {
      if (e.removed) continue;
      const tests = hits.get(`${r.id} ${e.id}`) ?? [];
      const status = tests.some(t => t.outcome === "fail") ? "fail"
        : tests.some(t => t.outcome === "pass") ? "pass"
        : tests.length ? "skipped" : "no test";
      const levels = [...new Set(tests.filter(t => t.outcome === "pass").map(t => t.level))];
      summary[status]++;
      if (e.assumed) assumed.push(`${r.id} ${e.id}`);
      examples[e.id] = { status, levels, ...(e.assumed ? { assumed: true } : {}), text: e.text, tests };
    }
    out[r.id] = { title: r.title, file: r.file, examples };
  }

  if (strict) for (const a of assumed) allProblems.push(`${a} is still assumed: confirm it with the requirement owner before release`);

  const ok = summary.fail === 0 && summary.skipped === 0 && summary["no test"] === 0
    && orphans.length === 0 && allProblems.length === 0;
  return {
    generated: now,
    ok,
    scope: inScope.map(r => r.id),
    inputs,
    strict,
    summary: { ...summary, assumed: assumed.length, orphans: orphans.length, problems: allProblems.length },
    requirements: out,
    assumed,
    orphans,
    loose,
    problems: allProblems,
  };
}

export function formatSummary(st) {
  const lines = [];
  const s = st.summary;
  lines.push(`trace-check: ${st.ok ? "OK" : "NOT PROVEN"} · ${s.pass} pass · ${s.fail} fail · ${s.skipped} skipped · ${s["no test"]} no test · ${s.assumed} assumed · ${s.orphans} orphan · ${s.problems} problem`);
  for (const [id, r] of Object.entries(st.requirements)) {
    for (const [ex, e] of Object.entries(r.examples)) {
      if (e.status !== "pass") lines.push(`  ✗ ${id} ${ex}: ${e.status}${e.text ? ` — ${e.text}` : ""}`);
    }
  }
  for (const o of st.orphans) lines.push(`  ✗ orphan ${o}`);
  for (const p of st.problems) lines.push(`  ✗ ${p}`);
  for (const l of st.loose) lines.push(`  ! ${l}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const a = { results: [], manual: [], requirements: "docs/product/requirements", scope: null, task: null, out: null, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    const need = () => { if (v === undefined) throw new Error(`${k} needs a value`); i++; return v; };
    if (k === "--results") a.results.push(need());
    else if (k === "--manual") a.manual.push(need());
    else if (k === "--requirements") a.requirements = need();
    else if (k === "--scope") a.scope = need().split(",").map(s => s.trim()).filter(Boolean);
    else if (k === "--task") a.task = need();
    else if (k === "--out") a.out = need();
    else if (k === "--strict") a.strict = true;
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

export function run(argv, { cwd = process.cwd(), now } = {}) {
  const a = parseArgs(argv);
  if (a.help) return { code: 0, text: "see the header of scripts/trace-check.mjs" };
  const p = (x) => (x.startsWith("/") ? x : join(cwd, x));

  const reqDir = p(a.requirements);
  if (!existsSync(reqDir) || !statSync(reqDir).isDirectory()) throw new Error(`requirements folder not found: ${a.requirements}`);
  const requirements = readdirSync(reqDir)
    .filter(f => f.endsWith(".md") && !f.startsWith("_"))
    .sort()
    .flatMap(f => parseRequirements(readFileSync(join(reqDir, f), "utf8"), join(a.requirements, f)));

  const cases = [];
  const problems = [];
  const inputs = [];
  if (a.results.length === 0 && a.manual.length === 0) problems.push("no test results given (--results or --manual)");
  for (const spec of a.results) {
    const eq = spec.indexOf("=");
    const [level, file] = eq > 0 && !spec.slice(0, eq).includes("/") ? [spec.slice(0, eq), spec.slice(eq + 1)] : ["test", spec];
    if (!existsSync(p(file))) { problems.push(`results file not found: ${file} (${level})`); continue; }
    cases.push(...parseJUnit(readFileSync(p(file), "utf8"), level));
    inputs.push({ level, file });
  }
  for (const file of a.manual) {
    if (!existsSync(p(file))) { problems.push(`manual records not found: ${file}`); continue; }
    const m = parseManual(readFileSync(p(file), "utf8"), file);
    cases.push(...m.cases);
    problems.push(...m.problems);
    inputs.push({ level: "manual", file });
  }

  let scope = a.scope;
  if (!scope && a.task) {
    const spec = join(p(a.task), "spec.md");
    if (!existsSync(spec)) throw new Error(`no spec.md in ${a.task}`);
    scope = readScope(readFileSync(spec, "utf8"));
    if (scope.length === 0) problems.push(`${a.task}/spec.md has no REQ ids under "## Changes"`);
  }

  const status = buildStatus({ requirements, cases, scope, problems, inputs, strict: a.strict, ...(now ? { now } : {}) });
  const outFile = a.task ? join(p(a.task), "status.json") : a.out ? p(a.out) : null;
  if (outFile) writeFileSync(outFile, JSON.stringify(status, null, 2) + "\n");
  return { code: status.ok ? 0 : 1, text: formatSummary(status), status, outFile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = run(process.argv.slice(2));
    console.log(r.text);
    if (r.outFile) console.log(`wrote ${r.outFile}`);
    process.exit(r.code);
  } catch (e) {
    console.error(`trace-check: ${e.message}`);
    process.exit(2);
  }
}
