// The pure parts of the mobile-run harness: no Appium, no files, no process.
// run.mjs drives the device; these decide what it sends and what it reports,
// so they are tested on their own (project-kit/tests/mobile-run.test.mjs).

const VAR = /\$\{(\w+)\}/g;
// Own keys only: `${toString}` is not defined just because every object has one.
const defined = (vars, k) => vars != null && Object.hasOwn(vars, k) && vars[k] != null;

/** Fill each `${name}` from vars. An undefined name is an error, never "": an
 * empty `contains` would make every text assertion pass. */
export function subst(v, vars) {
  if (typeof v !== 'string') return v;
  return v.replace(VAR, (_, k) => {
    if (!defined(vars, k)) throw new Error(`unknown variable ${k}: add it to "vars"`);
    return vars[k];
  });
}

/** The `${name}`s in the steps that `vars` does not define, checked before a
 * session starts so a typo costs no device time. */
export function unknownVars(sc) {
  const vars = sc.vars || {}, found = new Set();
  const walk = x => {
    if (typeof x === 'string') { for (const m of x.matchAll(VAR)) if (!defined(vars, m[1])) found.add(m[1]); }
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(sc.steps || []);
  return [...found];
}

const ACTIONS = ['tap', 'type', 'waitFor', 'context', 'back', 'pause', 'assert'];
const NEEDS_LOCATOR = ['tap', 'type', 'waitFor', 'assert'];
const ASSERTS = ['present', 'visible', 'text'];

/** Everything wrong with a scenario that can be known before a session starts:
 * its shape, each step's action and locator, its vars. Empty when it can run. */
export function scenarioProblems(sc) {
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return ['not a scenario object (expected {"steps": [...]})'];
  const out = [];
  const vars = sc.vars ?? {};
  if (typeof vars !== 'object' || Array.isArray(vars)) out.push('"vars" must be an object');
  else for (const [k, v] of Object.entries(vars)) if (!['string', 'number', 'boolean'].includes(typeof v)) out.push(`var "${k}" must be a string, number or boolean`);
  if (sc.steps != null && !Array.isArray(sc.steps)) return [...out, '"steps" must be a list'];
  const missing = unknownVars(sc);
  if (missing.length) out.push(`uses ${missing.map(n => '${' + n + '}').join(', ')}, which "vars" does not define`);
  // Locators are checked with the missing names filled in, so both problems show.
  const probe = { ...vars, ...Object.fromEntries(missing.map(n => [n, 'x'])) };
  const platform = (sc.platform || '').toLowerCase(), flutter = (sc.automationName || '').toLowerCase() === 'flutter';
  (sc.steps || []).forEach((step, i) => {
    const at = `step ${i + 1}`;
    if (!step || typeof step !== 'object') return out.push(`${at}: not an object`);
    if (!ACTIONS.includes(step.action)) return out.push(`${at}: unknown action ${JSON.stringify(step.action)}`);
    if (step.action === 'assert' && !ASSERTS.includes(step.type)) out.push(`${at}: unknown assert type ${JSON.stringify(step.type)}`);
    if (NEEDS_LOCATOR.includes(step.action)) {
      if (step.locator == null) return out.push(`${at}: "${step.action}" needs a locator`);
      try { using(step.locator, platform, probe, flutter); } catch (e) { out.push(`${at}: ${e.message}`); }
    }
  });
  return out;
}

/** The process exit code: 0 pass, 1 a critical assertion failed, 3 the run
 * could not finish (no session, a step's action failed, a harness error). */
export function exitCode(status) { return status === 'pass' ? 0 : status === 'fail' ? 1 : 3; }

/** A value inside a double-quoted UiSelector or NSPredicate string. */
const quoted = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// The Flutter driver (automationName=Flutter) finds widgets by a base64url-encoded
// finder, not a raw string — appium-flutter-finder's serialization, strategy 'key'.
const fenc = obj => ['key', Buffer.from(JSON.stringify(obj)).toString('base64url')];
export function ffind(l, vars) {
  if (typeof l === 'string') return fenc({ finderType: 'ByText', text: subst(l, vars) });
  if (l.flutterKey != null) return fenc({ finderType: 'ByValueKey', keyValueString: subst(l.flutterKey, vars), keyValueType: 'String' });
  if (l.semanticsLabel != null) return fenc({ finderType: 'BySemanticsLabel', isRegExp: false, label: subst(l.semanticsLabel, vars) });
  if (l.flutterType != null) return fenc({ finderType: 'ByType', type: subst(l.flutterType, vars) });
  if (l.text != null) return fenc({ finderType: 'ByText', text: subst(l.text, vars) });
  throw new Error('flutter locator needs flutterKey/text/semanticsLabel/flutterType: ' + JSON.stringify(l));
}

// locator -> [using, value], framework-agnostic (per SKILL.md priority)
export function using(l, platform, vars, flutter) {
  if (flutter) return ffind(l, vars);
  if (typeof l === 'string') return ['xpath', subst(l, vars)];
  if (l.accessibilityId != null) return ['accessibility id', subst(l.accessibilityId, vars)];
  if (l.id != null) return ['id', subst(l.id, vars)];
  if (l.uiautomator != null) return ['-android uiautomator', subst(l.uiautomator, vars)];
  if (l.predicate != null) return ['-ios predicate string', subst(l.predicate, vars)];
  if (l.className != null) return ['class name', subst(l.className, vars)];
  if (l.flutterKey != null) return ['key', subst(l.flutterKey, vars)];            // flutter driver
  if (l.css != null) return ['css selector', subst(l.css, vars)];                  // webview context
  if (l.text != null) {                                                            // text -> platform idiom
    const t = quoted(subst(l.text, vars));
    if (platform === 'android') return ['-android uiautomator', `new UiSelector().text("${t}")`];
    if (platform === 'ios') return ['-ios predicate string', `label == "${t}" OR name == "${t}" OR value == "${t}"`];
    return ['text', t]; // flutter
  }
  if (l.xpath != null) return ['xpath', subst(l.xpath, vars)];
  throw new Error('bad locator ' + JSON.stringify(l));
}

// Parse the Appium XML source into interactive affordances for explore mode.
export function parseSource(xml, platform) {
  const els = [];
  const re = /<([\w.]+)\b([^>]*)\/?>/g; let m;
  while ((m = re.exec(xml)) && els.length < 60) {
    const attrs = {}; let a; const ar = /([\w-]+)="([^"]*)"/g;
    while ((a = ar.exec(m[2]))) attrs[a[1]] = a[2];
    const name = attrs['content-desc'] || attrs['name'] || attrs['accessibility-id'];
    const text = attrs['text'] || attrs['label'] || attrs['value'];
    const clickable = attrs['clickable'] === 'true' || /Button|TextField|SecureTextField|Cell|Switch/.test(m[1]);
    if (name || text) els.push({ class: m[1], accessibilityId: name || undefined, text: text || undefined, clickable: clickable || undefined, resourceId: attrs['resource-id'] || undefined });
  }
  return { count: els.length, elements: els };
}

export function renderMd(r) {
  const L = [`# ${r.name || 'scenario'} — ${r.status.toUpperCase()}`, `\nApp: ${r.app}`, `Platform: ${r.platform} (${r.automationName})`];
  if (r.aborted) L.push(`\n**Aborted at:** ${r.aborted}`);
  L.push('\n## Steps');
  for (const s of r.steps) L.push(`- ${s.ok ? '✓' : (s.severity === 'warning' ? '⚠' : '✗')} \`${s.step}\`` + (s.ms != null ? ` (${s.ms}ms)` : '') + (s.expected ? ` — expected \`${s.expected}\`, actual \`${JSON.stringify(s.actual)}\`` : '') + (s.error ? ` — ${s.error}` : ''));
  L.push('\n## Artifacts');
  for (const [k, v] of Object.entries(r.artifacts)) if (v) L.push(`- ${k}: \`${v}\``);
  L.push('\n(network capture needs a proxy — not in this bundle; see SKILL.md)');
  return L.join('\n') + '\n';
}
