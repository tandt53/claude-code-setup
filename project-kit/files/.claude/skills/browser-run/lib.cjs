// The pure parts of the browser-run harness: no browser, no files, no process.
// run.cjs drives Playwright; these decide what it does and what it reports, so
// they are tested on their own (project-kit/tests/browser-run.test.mjs).
'use strict';

const VAR = /\$\{(\w+)\}/g;
// Own keys only: `${toString}` is not defined just because every object has one.
const defined = (vars, k) => vars != null && Object.hasOwn(vars, k) && vars[k] != null;

/** Fill each `${name}` from vars. An undefined name is an error, never "": an
 * empty `contains` would make every text assertion pass. */
function subst(v, vars) {
  if (typeof v !== 'string') return v;
  return v.replace(VAR, (_, k) => {
    if (!defined(vars, k)) throw new Error(`unknown variable ${k}: add it to "vars"`);
    return vars[k];
  });
}

/** The `${name}`s in the steps that `vars` does not define. */
function unknownVars(sc) {
  const vars = sc.vars || {}, found = new Set();
  const walk = x => {
    if (typeof x === 'string') { for (const m of x.matchAll(VAR)) if (!defined(vars, m[1])) found.add(m[1]); }
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(sc.steps || []);
  return [...found];
}

const ACTIONS = ['goto', 'fill', 'click', 'press', 'select', 'waitFor', 'assert'];
const ASSERTS = ['url', 'visible', 'hidden', 'text', 'alert_observed', 'no_errors'];
const needsLocator = s => ['fill', 'click', 'press', 'select'].includes(s.action)
  || (s.action === 'waitFor' && !s.url) || (s.action === 'assert' && ['visible', 'hidden', 'text'].includes(s.type));

/** Everything wrong with a scenario that can be known before the browser
 * starts: its shape, each step's action and locator, its vars. */
function scenarioProblems(sc) {
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
  (sc.steps || []).forEach((step, i) => {
    const at = `step ${i + 1}`;
    if (!step || typeof step !== 'object') return out.push(`${at}: not an object`);
    if (!ACTIONS.includes(step.action)) return out.push(`${at}: unknown action ${JSON.stringify(step.action)}`);
    if (step.action === 'assert' && !ASSERTS.includes(step.type)) return out.push(`${at}: unknown assert type ${JSON.stringify(step.type)}`);
    if (needsLocator(step)) {
      if (step.locator == null) return out.push(`${at}: "${step.action}" needs a locator`);
      try { locatorSpec(step.locator, probe); } catch (e) { out.push(`${at}: ${e.message}`); }
    }
  });
  return out;
}

/** The process exit code: 0 pass, 1 a critical assertion failed, 3 the run
 * could not finish (a step's action failed, a harness error). */
function exitCode(status) { return status === 'pass' ? 0 : status === 'fail' ? 1 : 3; }

/** Where a goto step goes: its url (with ${var}s) absolute, or under baseUrl. */
function gotoUrl(step, base, vars) {
  const u = subst(step.url || '/', vars);
  return /^https?:/.test(u) ? u : (base || '').replace(/\/$/, '') + u;
}

/** A locator as [page method, ...arguments], in the priority SKILL.md gives. */
function locatorSpec(l, vars) {
  if (l == null) throw new Error('missing locator');
  if (typeof l === 'string') return ['locator', subst(l, vars)];
  const name = l.name != null ? subst(l.name, vars) : undefined;
  if (l.testid) return ['getByTestId', subst(l.testid, vars)];
  if (l.role) return ['getByRole', l.role, name ? { name, exact: !!l.exact } : undefined];
  if (l.label) return ['getByLabel', subst(l.label, vars)];
  if (l.placeholder) return ['getByPlaceholder', subst(l.placeholder, vars)];
  if (l.text) return ['getByText', subst(l.text, vars)];
  if (l.css) return ['locator', subst(l.css, vars)];
  throw new Error('bad locator ' + JSON.stringify(l));
}

module.exports = { subst, unknownVars, scenarioProblems, exitCode, locatorSpec, gotoUrl };
