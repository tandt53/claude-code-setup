// Tests for the browser-run harness that need no browser: the pure functions in
// files/.claude/skills/browser-run/lib.cjs, and run.cjs's handling of bad input
// (it exits before Playwright is even loaded). The live runs are in SKILL.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lib = createRequire(import.meta.url)('../files/.claude/skills/browser-run/lib.cjs')
const { subst, unknownVars, scenarioProblems, exitCode, locatorSpec } = lib
const gotoUrl = (step, base, vars) => (lib.gotoUrl ? lib.gotoUrl(step, base, vars) : null)
const RUN = fileURLToPath(new URL('../files/.claude/skills/browser-run/run.cjs', import.meta.url))

test('subst fills a defined variable, an empty one too, and refuses an unknown or inherited one', () => {
  assert.equal(subst('${a}+${b}', { a: '3', b: '' }), '3+')
  assert.throws(() => subst('${expectd}', { expected: '7' }), /unknown variable expectd/)
  assert.throws(() => subst('${toString}', {}), /unknown variable toString/)
})

test('a ${name} the scenario does not define is found in any step field', () => {
  const sc = {
    vars: { id: 'u@example.com' },
    steps: [
      { action: 'fill', locator: { label: 'Email' }, value: '${id}' },
      { action: 'assert', type: 'text', locator: { css: 'h1' }, contains: '${welcom}' },
      { action: 'goto', url: '/users/${uid}' },
      { action: 'click', locator: { role: 'button', name: '${toString}' } },
    ],
  }
  assert.deepEqual(unknownVars(sc).sort(), ['toString', 'uid', 'welcom'])
})

test('the exit code tells an assertion failure (1) from a run that could not finish (3)', () => {
  assert.equal(exitCode('pass'), 0)
  assert.equal(exitCode('fail'), 1)
  assert.equal(exitCode('error'), 3)
})

test('each locator maps to its Playwright method, in the documented priority', () => {
  const cases = [
    [{ testid: 'save' }, ['getByTestId', 'save']],
    [{ role: 'button', name: 'Sign in' }, ['getByRole', 'button', { name: 'Sign in', exact: false }]],
    [{ role: 'link' }, ['getByRole', 'link', undefined]],
    [{ label: 'Email' }, ['getByLabel', 'Email']],
    [{ placeholder: 'Search' }, ['getByPlaceholder', 'Search']],
    [{ text: 'Welcome' }, ['getByText', 'Welcome']],
    [{ css: 'h1' }, ['locator', 'h1']],
    ['#raw', ['locator', '#raw']],
    [{ testid: 'a', css: 'b' }, ['getByTestId', 'a']],
  ]
  for (const [l, want] of cases) assert.deepEqual(locatorSpec(l, {}), want, JSON.stringify(l))
  assert.throws(() => locatorSpec({ xpath: '//a' }, {}), /bad locator/)
})

test('goto takes ${var}s in its url, relative to baseUrl or absolute', () => {
  assert.equal(gotoUrl({ url: '/users/${id}' }, 'http://localhost:3000', { id: '7' }), 'http://localhost:3000/users/7')
  assert.equal(gotoUrl({ url: 'https://example.com/${id}' }, 'http://localhost:3000', { id: '7' }), 'https://example.com/7')
  assert.equal(gotoUrl({}, 'http://localhost:3000', {}), 'http://localhost:3000/')
})

test('a scenario that is not one is rejected before the browser starts, each problem named', () => {
  const ok = { vars: { a: '1' }, steps: [{ action: 'goto', url: '/' }, { action: 'waitFor', url: '/home' }, { action: 'assert', type: 'url', contains: '${a}' }, { action: 'assert', type: 'no_errors' }] }
  assert.deepEqual(scenarioProblems(ok), [])
  assert.match(scenarioProblems(null).join(), /not a scenario object/)
  assert.match(scenarioProblems({ steps: {} }).join(), /"steps" must be a list/)
  assert.match(scenarioProblems({ steps: [{ action: 'hover' }] }).join(), /step 1: unknown action "hover"/)
  assert.match(scenarioProblems({ steps: [{ action: 'assert', type: 'equals' }] }).join(), /step 1: unknown assert type "equals"/)
  assert.match(scenarioProblems({ steps: [{ action: 'fill', value: 'x' }] }).join(), /step 1: "fill" needs a locator/)
  assert.match(scenarioProblems({ steps: [{ action: 'goto' }, { action: 'assert', type: 'visible', locator: { xpath: '//a' } }] }).join(), /step 2: bad locator/)
  assert.match(scenarioProblems({ vars: { o: [1] }, steps: [] }).join(), /var "o" must be a string, number or boolean/)
})

// ---- run.cjs on bad input: one line on stderr, the documented code, no browser
const NO_PLAYWRIGHT = { ...process.env, NODE_PATH: '' }
function run(args, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'browser-run-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  const r = spawnSync(process.execPath, [RUN, ...args.map((a) => a.replace('$DIR', dir))], { env: NO_PLAYWRIGHT, cwd: dir, encoding: 'utf8', timeout: 20000 })
  return { ...r, dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}
const OK = JSON.stringify({ name: 'x', baseUrl: 'http://127.0.0.1:1', steps: [{ action: 'goto', url: '/' }] })
const noStack = (r) => assert.doesNotMatch(r.stderr, /\n\s+at /)

test('malformed JSON, a missing file, or JSON that is not a scenario exits 3 with one line', () => {
  for (const [files, name, want] of [
    [{ 'bad.json': '{ "name": ' }, 'bad.json', /bad\.json/],
    [{}, 'missing.json', /missing\.json/],
    [{ 'n.json': 'null' }, 'n.json', /not a scenario object/],
  ]) {
    const r = run([`$DIR/${name}`, '--out', '$DIR/out'], files)
    try { assert.equal(r.status, 3, name + ': ' + r.stderr); assert.match(r.stderr, want); noStack(r) } finally { r.done() }
  }
})

test('--out with no folder, or an unknown flag such as --out=DIR, is a usage error (2)', () => {
  for (const args of [['$DIR/s.json', '--out'], ['$DIR/s.json', '--out=$DIR/out'], ['$DIR/s.json', '--headles']]) {
    const r = run(args, { 's.json': OK })
    try { assert.equal(r.status, 2, args.join(' ') + ': ' + r.stderr); assert.match(r.stderr, /usage/) } finally { r.done() }
  }
})

test('an unknown variable or a bad locator stops the run before the browser, exit 3, naming it', () => {
  const sc = JSON.parse(OK)
  sc.steps = [{ action: 'assert', type: 'text', locator: { css: 'h1' }, contains: '${welcom}' }, { action: 'assert', type: 'visible', locator: { xpath: '//a' } }]
  const r = run(['$DIR/s.json', '--out', '$DIR/out'], { 's.json': JSON.stringify(sc) })
  try {
    assert.equal(r.status, 3, r.stderr)
    assert.match(r.stderr, /welcom/)
    assert.match(r.stderr, /bad locator/)
    assert.equal(existsSync(join(r.dir, 'out', 'report.json')), false, 'rejected before the run')
  } finally { r.done() }
})

test('no @playwright/test to load exits 3 with one line that says to set NODE_PATH', () => {
  const r = run(['$DIR/s.json', '--out', '$DIR/out'], { 's.json': OK })
  try {
    assert.equal(r.status, 3, r.stderr)
    assert.match(r.stderr, /@playwright\/test/)
    assert.match(r.stderr, /NODE_PATH/)
    noStack(r)
  } finally { r.done() }
})
