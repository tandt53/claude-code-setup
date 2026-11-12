// Tests for the mobile-run harness that need no Appium: the pure functions in
// files/.claude/skills/mobile-run/lib.mjs, and run.mjs's handling of bad input
// and of a server that is not there (it exits before any device is touched).
// The live runs that prove the device side are in the skill's SKILL.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as lib from '../files/.claude/skills/mobile-run/lib.mjs'
const { subst, unknownVars, exitCode, using, ffind } = lib
const problems = (sc) => (lib.scenarioProblems ? lib.scenarioProblems(sc) : [])

const RUN = fileURLToPath(new URL('../files/.claude/skills/mobile-run/run.mjs', import.meta.url))

test('a ${name} the scenario does not define is found in any step field', () => {
  const sc = {
    vars: { expected: '7', empty: '' },
    steps: [
      { action: 'assert', type: 'text', locator: { accessibilityId: 'Answer' }, contains: '${expectd}' },
      { action: 'tap', locator: { text: 'Hello ${who}' } },
      { action: 'type', locator: { id: 'f' }, value: '${expected}${empty}' },
      { action: 'context', name: 'WEBVIEW_${pkg}' },
    ],
  }
  assert.deepEqual(unknownVars(sc).sort(), ['expectd', 'pkg', 'who'])
})

test('a scenario whose variables are all defined, or that has none, has no unknown ones', () => {
  assert.deepEqual(unknownVars({ vars: { a: '3' }, steps: [{ action: 'type', value: '${a}' }] }), [])
  assert.deepEqual(unknownVars({ steps: [{ action: 'back' }] }), [])
  assert.deepEqual(unknownVars({ steps: [{ action: 'type', value: '${a}' }] }), ['a'])
})

test('subst fills a defined variable, an empty one too, and refuses an unknown one', () => {
  assert.equal(subst('${a}+${b}', { a: '3', b: '' }), '3+')
  assert.throws(() => subst('${expectd}', { expected: '7' }), /unknown variable expectd/)
})

test('the exit code tells an assertion failure (1) from a run that could not finish (3)', () => {
  assert.equal(exitCode('pass'), 0)
  assert.equal(exitCode('fail'), 1)
  assert.equal(exitCode('error'), 3)
})

test('a text locator with a double quote or a backslash stays one valid string', () => {
  assert.deepEqual(using({ text: 'Say "hi"' }, 'android', {}), ['-android uiautomator', 'new UiSelector().text("Say \\"hi\\"")'])
  assert.deepEqual(using({ text: 'a\\b' }, 'android', {}), ['-android uiautomator', 'new UiSelector().text("a\\\\b")'])
  assert.deepEqual(using({ text: 'Say "hi"' }, 'ios', {}), [
    '-ios predicate string',
    'label == "Say \\"hi\\"" OR name == "Say \\"hi\\"" OR value == "Say \\"hi\\""',
  ])
  assert.deepEqual(using({ text: "it's" }, 'android', {}), ['-android uiautomator', `new UiSelector().text("it's")`])
})

test('a css locator is sent as the W3C css selector, for a webview context', () => {
  assert.deepEqual(using({ css: 'button.primary' }, 'android', {}), ['css selector', 'button.primary'])
})

test('the Flutter finder is the one appium-flutter-finder serialises (unchanged)', () => {
  const [strategy, value] = ffind({ flutterKey: 'name_field' }, {})
  assert.equal(strategy, 'key')
  assert.deepEqual(JSON.parse(Buffer.from(value, 'base64url').toString()), {
    finderType: 'ByValueKey', keyValueString: 'name_field', keyValueType: 'String',
  })
  assert.deepEqual(using({ flutterKey: 'name_field' }, 'android', {}, true), [strategy, value])
})

test('a name inherited from Object (toString, constructor) is not a defined variable', () => {
  assert.deepEqual(unknownVars({ vars: {}, steps: [{ action: 'type', value: '${toString}${constructor}' }] }).sort(), ['constructor', 'toString'])
  assert.throws(() => subst('${toString}', {}), /unknown variable toString/)
})

test('each locator maps to its documented strategy', () => {
  const cases = [
    [{ accessibilityId: 'Views' }, ['accessibility id', 'Views']],
    [{ id: 'com.app:id/ok' }, ['id', 'com.app:id/ok']],
    [{ uiautomator: 'new UiSelector().index(0)' }, ['-android uiautomator', 'new UiSelector().index(0)']],
    [{ predicate: 'name == "x"' }, ['-ios predicate string', 'name == "x"']],
    [{ className: 'android.widget.Button' }, ['class name', 'android.widget.Button']],
    [{ xpath: '//a' }, ['xpath', '//a']],
    ['//b', ['xpath', '//b']],
  ]
  for (const [l, want] of cases) assert.deepEqual(using(l, 'android', {}), want, JSON.stringify(l))
})

test('a scenario that is not one is rejected before any device is touched, each problem named', () => {
  const ok = { platform: 'Android', vars: { a: '1' }, steps: [{ action: 'tap', locator: { id: '${a}' } }, { action: 'back' }] }
  assert.deepEqual(problems(ok), [])
  assert.match(problems(null).join(), /not a scenario object/)
  assert.match(problems([]).join(), /not a scenario object/)
  assert.match(problems({ steps: 'tap' }).join(), /"steps" must be a list/)
  assert.match(problems({ steps: [{ action: 'swipe' }] }).join(), /step 1: unknown action "swipe"/)
  assert.match(problems({ steps: [{ action: 'assert', type: 'equals', locator: { id: 'a' } }] }).join(), /step 1: unknown assert type "equals"/)
  assert.match(problems({ steps: [{ action: 'back' }, { action: 'assert', type: 'present', locator: { foo: 1 } }] }).join(), /step 2: bad locator/)
  assert.match(problems({ steps: [{ action: 'tap' }] }).join(), /step 1: "tap" needs a locator/)
  assert.match(problems({ vars: { o: { x: 1 } }, steps: [] }).join(), /var "o" must be a string, number or boolean/)
  const both = problems({ steps: [{ action: 'tap', locator: { text: '${nope}' } }, { action: 'tap', locator: { foo: 1 } }] }).join()
  assert.match(both, /\$\{nope\}/)
  assert.match(both, /step 2: bad locator/)
})

// ---- run.mjs on bad input: one line on stderr, the documented code, no device touched
const NO_SERVER = { ...process.env, APPIUM_URL: 'http://127.0.0.1:1' }
function run(args, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mobile-run-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  const r = spawnSync(process.execPath, [RUN, ...args.map((a) => a.replace('$DIR', dir))], { env: NO_SERVER, cwd: dir, encoding: 'utf8', timeout: 20000 })
  return { ...r, dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}
const OK_SCENARIO = JSON.stringify({ name: 'x', platform: 'Android', automationName: 'UiAutomator2', steps: [{ action: 'back' }] })

test('malformed scenario JSON exits 3 with one line naming the file, not a stack trace', () => {
  const r = run(['$DIR/bad.json', '--out', '$DIR/out'], { 'bad.json': '{ "name": ' })
  try {
    assert.equal(r.status, 3, r.stderr)
    assert.match(r.stderr, /bad\.json/)
    assert.doesNotMatch(r.stderr, /\n\s+at /)
  } finally { r.done() }
})

test('a scenario file that does not exist exits 3', () => {
  const r = run(['$DIR/missing.json', '--out', '$DIR/out'])
  try {
    assert.equal(r.status, 3, r.stderr)
    assert.match(r.stderr, /missing\.json/)
  } finally { r.done() }
})

test('--out with no folder after it is a usage error (2)', () => {
  const r = run(['$DIR/s.json', '--out'], { 's.json': OK_SCENARIO })
  try {
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /usage/)
  } finally { r.done() }
})

test('an unknown variable stops the run before any session, exit 3, naming it', () => {
  const sc = JSON.parse(OK_SCENARIO)
  sc.vars = { expected: '7' }
  sc.steps = [{ action: 'assert', type: 'text', locator: { id: 'a' }, contains: '${expectd}' }]
  const r = run(['$DIR/s.json', '--out', '$DIR/out'], { 's.json': JSON.stringify(sc) })
  try {
    assert.equal(r.status, 3, r.stderr)
    assert.match(r.stderr, /expectd/)
    assert.equal(existsSync(join(r.dir, 'out', 'report.json')), false, 'no run, so no report')
  } finally { r.done() }
})

test('no Appium server: status error in the report, exit 3', () => {
  const r = run(['$DIR/s.json', '--out', '$DIR/out'], { 's.json': OK_SCENARIO })
  try {
    assert.equal(r.status, 3, r.stderr + r.stdout)
    assert.equal(JSON.parse(readFileSync(join(r.dir, 'out', 'report.json'), 'utf8')).status, 'error')
  } finally { r.done() }
})

test('valid JSON that is not a scenario object (null) exits 3 with one line', () => {
  const r = run(['$DIR/n.json', '--out', '$DIR/out'], { 'n.json': 'null' })
  try {
    assert.equal(r.status, 3, r.stderr)
    assert.match(r.stderr, /not a scenario object/)
    assert.doesNotMatch(r.stderr, /\n\s+at /)
  } finally { r.done() }
})

test('a bad locator in an assert stops the run before any session (3), not as a failed assertion', () => {
  const sc = JSON.parse(OK_SCENARIO)
  sc.steps = [{ action: 'assert', type: 'present', locator: { foo: 1 } }]
  const r = run(['$DIR/s.json', '--out', '$DIR/out'], { 's.json': JSON.stringify(sc) })
  try {
    assert.equal(r.status, 3, r.stderr)
    assert.match(r.stderr, /bad locator/)
    assert.equal(existsSync(join(r.dir, 'out', 'report.json')), false, 'rejected before the run')
  } finally { r.done() }
})

test('an unknown flag such as --out=DIR is a usage error (2), so evidence never lands in a folder by surprise', () => {
  const r = run(['$DIR/s.json', '--out=$DIR/out'], { 's.json': OK_SCENARIO })
  try {
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /usage/)
  } finally { r.done() }
})
