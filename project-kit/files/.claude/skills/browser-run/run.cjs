#!/usr/bin/env node
/**
 * browser-run harness: execute one scenario against any running site and
 * produce the four-artifact bundle (screenshot, video, console, network) plus a
 * per-scenario report. Site-agnostic: it knows only the scenario it is given.
 *
 *   node run.cjs <scenario.json> [--out DIR] [--explore] [--headed] [--keep-on-pass]
 *
 * It is a tool surface, not a test designer: the AI (the browser-run skill)
 * decides what steps and assertions to run; this executes them and captures the
 * evidence. Needs @playwright/test resolvable (NODE_PATH to a project that has
 * it, e.g. the app under test). See SKILL.md.
 */
const fs = require('fs');
const path = require('path');
const { subst, scenarioProblems, exitCode, locatorSpec, gotoUrl } = require('./lib.cjs');

const FLAGS = ['--explore', '--headed', '--keep-on-pass'];
const usage = () => { console.error('usage: node run.cjs <scenario.json> [--out DIR] [--explore] [--headed] [--keep-on-pass]'); process.exit(2); };
function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const scenarioPath = process.argv[2];
if (!scenarioPath || scenarioPath.startsWith('--')) usage();
// --out needs a folder; any other flag (a typo, --out=DIR) is refused, so the
// evidence never lands in the default folder by surprise.
for (let i = 3; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--out') { if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--')) usage(); i++; }
  else if (!FLAGS.includes(a)) usage();
}
// Exit 3 before the browser starts: a scenario that cannot be read, or one that
// cannot run as written (its shape, an action, a locator, a ${name}).
const fail3 = msg => { console.error('browser-run: ' + msg); process.exit(3); };
let sc;
try { sc = JSON.parse(fs.readFileSync(scenarioPath, 'utf8')); } catch (e) { fail3(`cannot read scenario ${scenarioPath}: ${String(e.message).split('\n')[0]}`); }
const problems = scenarioProblems(sc);
if (problems.length) fail3(`${scenarioPath}: ${problems.join('; ')}`);
let chromium, devices;
try { ({ chromium, devices } = require('@playwright/test')); } catch (e) { fail3('cannot load @playwright/test: set NODE_PATH to a project that has it (see SKILL.md)'); }
const EXPLORE = process.argv.includes('--explore');
const HEADED = process.argv.includes('--headed');
const KEEP_ON_PASS = process.argv.includes('--keep-on-pass');
const OUT = path.resolve(arg('--out', path.join(process.cwd(), 'browser-run-out', slug(sc.name || 'scenario'))));

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }

function loc(page, l, vars) { const [method, ...args] = locatorSpec(l, vars); return page[method](...args); }

async function snapshot(page) {
  return page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const txt = el => (el.innerText || el.textContent || el.value || '').trim().slice(0, 80);
    const pick = (sel, kind) => Array.from(document.querySelectorAll(sel)).filter(vis).slice(0, 25).map(el => ({
      kind, text: txt(el),
      role: el.getAttribute('role') || undefined,
      name: el.getAttribute('aria-label') || el.getAttribute('name') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      testid: el.getAttribute('data-testid') || undefined,
      type: el.getAttribute('type') || undefined,
      href: el.getAttribute('href') || undefined,
    }));
    return {
      title: document.title, url: location.href,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).filter(vis).slice(0, 10).map(txt),
      buttons: pick('button,[role=button],input[type=submit],a[role=button]', 'button'),
      inputs: pick('input:not([type=hidden]),textarea,select', 'input'),
      links: pick('a[href]', 'link'),
    };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const consoleLog = [];
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    recordVideo: { dir: path.join(OUT, 'video') },
    recordHar: { path: path.join(OUT, 'network.har'), content: 'embed' },
    viewport: sc.viewport || { width: 1280, height: 800 },
    ...(sc.device && devices[sc.device] ? devices[sc.device] : {}),
  });
  await context.addInitScript({ path: path.join(__dirname, 'alert-interceptor.js') });
  const page = await context.newPage();
  page.on('console', m => consoleLog.push({ t: Date.now(), type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLog.push({ t: Date.now(), type: 'pageerror', text: String(e).split('\n')[0] }));
  page.on('requestfailed', r => consoleLog.push({ t: Date.now(), type: 'requestfailed', text: (r.url() + ' ' + (r.failure() && r.failure().errorText || '')).slice(0, 200) }));

  const vars = sc.vars || {};
  const base = (sc.baseUrl || '').replace(/\/$/, '');
  const results = [];
  let finalSnapshot = null, aborted = null;

  const readAlerts = () => page.evaluate(() => (window.__qaReadAlerts ? window.__qaReadAlerts() : [])).catch(() => []);

  async function doAssert(step) {
    const type = step.type;
    if (type === 'url') { const u = page.url(); const ok = step.contains ? u.includes(subst(step.contains, vars)) : new RegExp(step.matches).test(u); return { ok, actual: u }; }
    if (type === 'visible') { const ok = await loc(page, step.locator, vars).isVisible().catch(() => false); return { ok, actual: ok }; }
    if (type === 'hidden') { const ok = await loc(page, step.locator, vars).isHidden().catch(() => false); return { ok, actual: ok }; }
    if (type === 'text') { const t = await loc(page, step.locator, vars).innerText().catch(() => ''); const ok = t.includes(subst(step.contains, vars)); return { ok, actual: t.slice(0, 120) }; }
    if (type === 'alert_observed') { const a = await readAlerts(); const want = subst(step.text || '', vars).toLowerCase(); const hit = a.find(x => x.text.toLowerCase().includes(want) && (!step.alertType || x.type === step.alertType)); return { ok: !!hit, actual: a.map(x => `${x.type}:${x.text}`).slice(0, 5) }; }
    if (type === 'no_errors') { const a = await readAlerts(); const errAlerts = a.filter(x => x.type === 'error'); const errConsole = consoleLog.filter(x => x.type === 'error' || x.type === 'pageerror'); const ok = errAlerts.length === 0 && errConsole.length === 0; return { ok, actual: { errorAlerts: errAlerts.length, consoleErrors: errConsole.length } }; }
    return { ok: false, actual: 'unknown assertion type: ' + type };
  }

  for (const step of (sc.steps || [])) {
    const started = Date.now();
    const rec = { step: step.action + (step.type ? ':' + step.type : ''), ok: true };
    try {
      switch (step.action) {
        case 'goto': await page.goto(gotoUrl(step, base, vars), { waitUntil: step.waitUntil || 'domcontentloaded' }); break;
        case 'fill': await loc(page, step.locator, vars).fill(subst(step.value, vars)); break;
        case 'click': await loc(page, step.locator, vars).click({ timeout: step.timeout || 8000 }); break;
        case 'press': await loc(page, step.locator, vars).press(step.key); break;
        case 'select': await loc(page, step.locator, vars).selectOption(subst(step.value, vars)); break;
        case 'waitFor': if (step.url) await page.waitForURL(u => u.href.includes(subst(step.url, vars)), { timeout: step.timeout || 8000 }); else await loc(page, step.locator, vars).waitFor({ state: step.state || 'visible', timeout: step.timeout || 8000 }); break;
        case 'assert': { const r = await doAssert(step); rec.ok = r.ok; rec.expected = step.contains || step.text || step.type; rec.actual = r.actual; rec.severity = step.severity || 'critical'; break; }
        default: rec.ok = false; rec.actual = 'unknown action: ' + step.action;
      }
    } catch (e) { rec.ok = false; rec.error = String(e).split('\n')[0]; }
    rec.ms = Date.now() - started;
    results.push(rec);
    if (!rec.ok && step.action !== 'assert') { aborted = rec.step; await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {}); break; }
  }

  try { finalSnapshot = EXPLORE ? await snapshot(page) : null; } catch (e) {}
  const alerts = await readAlerts();
  await page.screenshot({ path: path.join(OUT, 'final.png'), fullPage: true }).catch(() => {});
  const videoPath = await (page.video() ? page.video().path() : Promise.resolve(null)).catch(() => null);
  await context.close(); await browser.close();

  fs.writeFileSync(path.join(OUT, 'console.jsonl'), consoleLog.map(JSON.stringify).join('\n'));
  if (finalSnapshot) fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(finalSnapshot, null, 2));

  // network failures from the HAR
  let netFail = [];
  try { const har = JSON.parse(fs.readFileSync(path.join(OUT, 'network.har'), 'utf8')); netFail = har.log.entries.filter(e => e.response.status <= 0 || e.response.status >= 400).map(e => ({ status: e.response.status, method: e.request.method, url: e.request.url.slice(0, 120) })); } catch (e) {}

  const critFails = results.filter(r => !r.ok && (r.severity || 'critical') === 'critical');
  const status = aborted ? 'error' : (critFails.length ? 'fail' : 'pass');
  const consoleErrors = consoleLog.filter(x => x.type === 'error' || x.type === 'pageerror');
  const report = {
    name: sc.name, baseUrl: sc.baseUrl, status, aborted,
    steps: results, alerts, consoleErrors: consoleErrors.length, networkFailures: netFail,
    artifacts: { screenshot: 'final.png', video: videoPath ? path.join('video', path.basename(videoPath)) : null, console: 'console.jsonl', network: 'network.har', snapshot: finalSnapshot ? 'snapshot.json' : null },
    out: OUT,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.md'), renderMd(report, consoleErrors));
  console.log(JSON.stringify({ status, out: OUT, steps: results.length, critFails: critFails.length, consoleErrors: consoleErrors.length, networkFailures: netFail.length, alerts: alerts.length }, null, 2));
  process.exit(exitCode(status));
})().catch(e => { console.error('FATAL', e); process.exit(3); });

function renderMd(r, consoleErrors) {
  const L = [];
  L.push(`# ${r.name || 'scenario'} — ${r.status.toUpperCase()}`);
  L.push(`\nTarget: ${r.baseUrl}`);
  if (r.aborted) L.push(`\n**Aborted at:** ${r.aborted}`);
  L.push('\n## Steps');
  for (const s of r.steps) L.push(`- ${s.ok ? '✓' : '✗'} \`${s.step}\` (${s.ms}ms)` + (s.expected ? ` — expected \`${s.expected}\`, actual \`${JSON.stringify(s.actual)}\`` : '') + (s.error ? ` — ${s.error}` : ''));
  L.push('\n## Signals');
  L.push(`- alerts observed: ${r.alerts.length}` + (r.alerts.length ? ' — ' + r.alerts.map(a => `${a.type}:"${a.text}"`).slice(0, 5).join(', ') : ''));
  L.push(`- console errors: ${r.consoleErrors}` + (consoleErrors.length ? ' — ' + consoleErrors.slice(0, 5).map(e => e.text).join(' | ') : ''));
  L.push(`- network failures: ${r.networkFailures.length}` + (r.networkFailures.length ? '\n' + r.networkFailures.slice(0, 10).map(f => `    - ${f.status} ${f.method} ${f.url}`).join('\n') : ''));
  L.push('\n## Artifacts');
  for (const [k, v] of Object.entries(r.artifacts)) if (v) L.push(`- ${k}: \`${v}\``);
  return L.join('\n') + '\n';
}
