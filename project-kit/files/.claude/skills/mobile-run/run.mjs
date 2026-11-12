#!/usr/bin/env node
/**
 * mobile-run harness: execute one scenario against a mobile app through Appium
 * and produce the evidence bundle (screenshot, video, device log) plus a
 * per-scenario report; the pure parts (locators, variables, exit codes) are in
 * lib.mjs. Framework-agnostic: native, hybrid, React Native, Kotlin
 * (= native Android) and Flutter, chosen by the scenario's automationName.
 *
 *   node run.mjs <scenario.json> [--out DIR] [--explore]
 *
 * Talks raw HTTP/W3C to a running Appium server (default 127.0.0.1:4723), so it
 * needs no webdriverio. A device/emulator/simulator and the app build must
 * exist; the driver (uiautomator2 / xcuitest / flutter) must be installed.
 * Network capture is NOT here (mobile needs a proxy; see SKILL.md). See SKILL.md.
 */
import fs from 'fs';
import path from 'path';
import { subst, scenarioProblems, exitCode, using as usingFor, parseSource, renderMd } from './lib.mjs';

const APPIUM = (process.env.APPIUM_URL || 'http://127.0.0.1:4723').replace(/\/$/, '');
const scPath = process.argv[2];
const outArg = process.argv.indexOf('--out');
const usage = () => { console.error('usage: node run.mjs <scenario.json> [--out DIR] [--explore]'); process.exit(2); };
if (!scPath || scPath.startsWith('--')) usage();
if (outArg >= 0 && (!process.argv[outArg + 1] || process.argv[outArg + 1].startsWith('--'))) usage();
// Any other flag (a typo, --out=DIR) is refused: evidence must not land in the default folder by surprise.
for (let i = 3; i < process.argv.length; i++) { const a = process.argv[i]; if (a === '--out') i++; else if (a !== '--explore') usage(); }
// Exit 3 before any device is touched: a scenario that cannot be read, or one
// that cannot run as written (its shape, an action, a locator, a ${name}).
const fail3 = msg => { console.error('mobile-run: ' + msg); process.exit(3); };
let sc;
try { sc = JSON.parse(fs.readFileSync(scPath, 'utf8')); } catch (e) { fail3(`cannot read scenario ${scPath}: ${String(e.message).split('\n')[0]}`); }
const problems = scenarioProblems(sc);
if (problems.length) fail3(`${scPath}: ${problems.join('; ')}`);
const EXPLORE = process.argv.includes('--explore');
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const OUT = path.resolve(outArg >= 0 ? process.argv[outArg + 1] : path.join(process.cwd(), 'mobile-run-out', slug(sc.name || 'scenario')));

async function w3c(method, pathname, body) {
  const res = await fetch(APPIUM + pathname, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || (json && json.value && json.value.error)) throw new Error(`${method} ${pathname} -> ${res.status} ${(json.value && (json.value.message || json.value.error)) || text.slice(0, 160)}`);
  return json.value;
}

const FLUTTER = (sc.automationName || '').toLowerCase() === 'flutter';
const using = (l, platform, vars) => usingFor(l, platform, vars, FLUTTER);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const platform = (sc.platform || '').toLowerCase();
  const caps = {
    platformName: sc.platform,
    'appium:automationName': sc.automationName,
    'appium:app': sc.app,
    'appium:deviceName': sc.deviceName,
    'appium:newCommandTimeout': 120,
    'appium:autoGrantPermissions': true,
    ...(sc.platformVersion ? { 'appium:platformVersion': sc.platformVersion } : {}),
    ...(sc.udid ? { 'appium:udid': sc.udid } : {}),
    ...(sc.caps || {}),
  };
  const vars = sc.vars || {};
  const results = [];
  let sid = null, recording = false, finalSource = null, aborted = null;

  const W3C_EL = 'element-6066-11e4-a52e-4f735466cecf';
  // The Flutter driver has no find endpoint: the base64 finder IS the element ref,
  // passed straight to click/value/text; presence is checked with flutter:waitFor.
  async function el(l) { const [u, v] = using(l, platform, vars); if (FLUTTER) return { ELEMENT: v, [W3C_EL]: v }; return w3c('POST', `/session/${sid}/element`, { using: u, value: v }); }
  async function flutterWaitFor(l, timeout) { return w3c('POST', `/session/${sid}/execute/sync`, { script: 'flutter:waitFor', args: [using(l, platform, vars)[1], timeout || 10000] }); }
  async function doAssert(step) {
    if (step.type === 'visible') { if (FLUTTER) { try { await flutterWaitFor(step.locator, step.timeout); return { ok: true, actual: 'present' }; } catch { return { ok: false, actual: 'not found' }; } } try { const e = await el(step.locator); const d = await w3c('GET', `/session/${sid}/element/${e.ELEMENT || e['element-6066-11e4-a52e-4f735466cecf']}/displayed`); return { ok: d === true || d === 'true', actual: d }; } catch (e) { return { ok: false, actual: 'not found' }; } }
    if (step.type === 'text') { try { const e = await el(step.locator); const id = e.ELEMENT || e['element-6066-11e4-a52e-4f735466cecf']; const t = await w3c('GET', `/session/${sid}/element/${id}/text`); return { ok: String(t).includes(subst(step.contains, vars)), actual: String(t).slice(0, 120) }; } catch (e) { return { ok: false, actual: 'not found' }; } }
    if (step.type === 'present') { if (FLUTTER) { try { await flutterWaitFor(step.locator, step.timeout); return { ok: true, actual: true }; } catch { return { ok: false, actual: false }; } } try { await el(step.locator); return { ok: true, actual: true }; } catch { return { ok: false, actual: false }; } }
    return { ok: false, actual: 'unknown assert ' + step.type };
  }

  try {
    sid = (await w3c('POST', '/session', { capabilities: { alwaysMatch: caps, firstMatch: [{}] } })).sessionId
      || (await (async () => { throw new Error('no session'); })());
    // start screen recording (best-effort; some drivers/sims may not support it)
    try { await w3c('POST', `/session/${sid}/appium/start_recording_screen`, { options: { timeLimit: 300 } }); recording = true; } catch (e) { results.push({ step: 'start_recording', ok: false, severity: 'warning', error: String(e.message).slice(0, 120) }); }

    for (const step of (sc.steps || [])) {
      const started = Date.now();
      const rec = { step: step.action + (step.type ? ':' + step.type : ''), ok: true };
      try {
        switch (step.action) {
          case 'tap': { const e = await el(step.locator); await w3c('POST', `/session/${sid}/element/${e.ELEMENT || e['element-6066-11e4-a52e-4f735466cecf']}/click`); break; }
          case 'type': { const e = await el(step.locator); const eid = e.ELEMENT || e['element-6066-11e4-a52e-4f735466cecf']; await w3c('POST', `/session/${sid}/element/${eid}/click`).catch(() => {}); { const val = subst(step.value, vars); await w3c('POST', `/session/${sid}/element/${eid}/value`, { text: val, value: Array.from(val) }); } break; }
          case 'waitFor': { if (FLUTTER) { await flutterWaitFor(step.locator, step.timeout); break; } const until = Date.now() + (step.timeout || 10000); let ok = false; while (Date.now() < until) { try { await el(step.locator); ok = true; break; } catch { await new Promise(r => setTimeout(r, 400)); } } if (!ok) throw new Error('waitFor timed out'); break; }
          case 'context': { await w3c('POST', `/session/${sid}/context`, { name: subst(step.name, vars) }); break; }
          case 'back': { await w3c('POST', `/session/${sid}/back`).catch(async () => { await w3c('POST', `/session/${sid}/appium/device/press_keycode`, { keycode: 4 }); }); break; }
          case 'pause': await new Promise(r => setTimeout(r, step.ms || 1000)); break;
          case 'assert': { const r = await doAssert(step); rec.ok = r.ok; rec.expected = step.contains || step.type; rec.actual = r.actual; rec.severity = step.severity || 'critical'; break; }
          default: rec.ok = false; rec.actual = 'unknown action ' + step.action;
        }
      } catch (e) { rec.ok = false; rec.error = String(e.message || e).split('\n')[0].slice(0, 160); }
      rec.ms = Date.now() - started;
      results.push(rec);
      if (!rec.ok && step.action !== 'assert') { aborted = rec.step; break; }
    }

    // evidence
    const shot = await w3c('GET', `/session/${sid}/screenshot`).catch(() => null);
    if (shot) fs.writeFileSync(path.join(OUT, 'final.png'), Buffer.from(shot, 'base64'));
    const source = await w3c('GET', `/session/${sid}/source`).catch(() => null);
    if (source) { fs.writeFileSync(path.join(OUT, 'source.xml'), source); if (EXPLORE) { finalSource = source; fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(parseSource(source, platform), null, 2)); } }
    // device log (= "console")
    const logType = platform === 'android' ? 'logcat' : 'syslog';
    const logs = await w3c('POST', `/session/${sid}/log`, { type: logType }).catch(() => null);
    if (logs) fs.writeFileSync(path.join(OUT, 'device.log'), logs.map(l => (l.message || l)).join('\n'));
  } catch (e) {
    aborted = aborted || 'session';
    results.push({ step: 'fatal', ok: false, error: String(e.message || e).slice(0, 200) });
  } finally {
    if (sid && recording) { try { const mp4 = await w3c('POST', `/session/${sid}/appium/stop_recording_screen`, {}); if (mp4) fs.writeFileSync(path.join(OUT, 'recording.mp4'), Buffer.from(mp4, 'base64')); } catch (e) {} }
    if (sid) { try { await w3c('DELETE', `/session/${sid}`); } catch (e) {} }
  }

  const critFails = results.filter(r => !r.ok && (r.severity || 'critical') === 'critical');
  const status = aborted ? 'error' : (critFails.length ? 'fail' : 'pass');
  const report = {
    name: sc.name, platform: sc.platform, automationName: sc.automationName, app: sc.app, status, aborted,
    steps: results,
    artifacts: {
      screenshot: fs.existsSync(path.join(OUT, 'final.png')) ? 'final.png' : null,
      video: fs.existsSync(path.join(OUT, 'recording.mp4')) ? 'recording.mp4' : null,
      deviceLog: fs.existsSync(path.join(OUT, 'device.log')) ? 'device.log' : null,
      source: fs.existsSync(path.join(OUT, 'source.xml')) ? 'source.xml' : null,
      snapshot: fs.existsSync(path.join(OUT, 'snapshot.json')) ? 'snapshot.json' : null,
    },
    out: OUT,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.md'), renderMd(report));
  console.log(JSON.stringify({ status, out: OUT, steps: results.length, critFails: critFails.length, artifacts: Object.fromEntries(Object.entries(report.artifacts).filter(([, v]) => v)) }, null, 2));
  process.exit(exitCode(status));
})().catch(e => { console.error('FATAL', e); process.exit(3); });

