// Tests for files/scripts/coverage-map.mjs, one per example of its specs
// ("What correct means"). Page examples run the page's own JavaScript in jsdom.
// The main fixture is a fictional travel product (Trips › Flights › Booking).
//
// The file also runs next to the module in a project (scripts/), so a project
// that installs the script can keep a copy of these tests.
// Run: npm test (kit), node --test scripts/coverage-map.test.mjs (a project)
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  cpSync,
  symlinkSync,
  existsSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, dirname, basename, sep } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

// The module: ./coverage-map.mjs in a project, ../files/scripts/coverage-map.mjs in
// the kit. Which place this is comes from the layout (a files/scripts/ folder
// beside this file's folder is the kit), not from where a module happens to
// be, so a stray copy of the module beside this file in the kit cannot make
// the kit-only tests skip. The namespace too: an export the module does not
// have yet fails its own tests instead of the whole file.
const IN_KIT = existsSync(
  fileURLToPath(new URL('../files/scripts/', import.meta.url))
)
const MODULE = new URL(
  IN_KIT ? '../files/scripts/coverage-map.mjs' : './coverage-map.mjs',
  import.meta.url
)
const coverageMap = await import(MODULE.href)
const { buildModel, renderHtml, levelOf, scanTests, readNotes, summary } =
  coverageMap
/** The folder holding scripts/: a project's root, or the kit's files/. */
const SOURCE = fileURLToPath(new URL('..', MODULE))
/** code-lines-touched.mjs (--since) is a project's own; the kit does not ship it. */
const HAS_TOUCHED = existsSync(join(SOURCE, 'scripts/code-lines-touched.mjs'))
/** The node_modules this file's own imports resolve from, as typescript is found. */
const NODE_MODULES = (() => {
  const main = fileURLToPath(import.meta.resolve('typescript'))
  return main.slice(0, main.lastIndexOf(`${sep}typescript${sep}`))
})()

// The travel config, as the model helpers below pass it (C4), written here so
// the tests need no config file.
const TRAVEL_RAW = JSON.parse(String.raw`{
  "requirements": "docs/product/requirements",
  "tests": ["src/__tests__/**/*.{test,spec}.{ts,tsx}", "e2e/**/*.{test,spec}.{ts,tsx}"],
  "levels": [
    { "match": "e2e/**", "level": "e2e" },
    { "match": "src/__tests__/integration/**/e2e-*", "level": "api-e2e" },
    { "match": "src/__tests__/integration/**", "level": "integration" },
    { "match": "src/__tests__/components/**", "level": "component" },
    { "match": "**", "level": "unit" }
  ],
  "order": ["Trips", "People & access", "Travel content", "Loyalty", "Reports & dashboards", "Cross-cutting", "Non-functional", "Flights", "Hotels", "Trains", "Cars", "Booking", "Booking & Seats", "Booking & Upgrades", "Meals", "Seats", "Luggage"],
  "last": ["Planned", "Shared"],
  "groups": {
    "stage": {
      "label": "stage", "plural": "stages",
      "values": ["author", "plan", "hold", "ticket", "result"],
      "labels": { "author": "Author", "plan": "Trips", "hold": "Hold", "ticket": "Ticketing", "result": "Result" },
      "rowNoun": ["route", "routes"]
    },
    "feature": {}
  },
  "breakdowns": [{ "rows": "fare", "detail": "variant", "columns": "stage", "title": "By fare type", "noun": ["type", "types"] }],
  "tagRows": [{ "label": "Fare type", "tags": ["fare", "variant"] }],
  "notes": "docs/coverage/test-notes.json",
  "output": "docs/coverage/COVERAGE-MAP.html",
  "results": ["reports/unit.xml", "reports/integration.xml", "reports/e2e.xml"]
}`)
// Until coverage-map.mjs knows the S3 key `results`, the model helpers resolve
// the travel config without it (no test before S3 reads results); any other
// error from resolveConfig still stops the file.
const TRAVEL = (() => {
  try {
    return coverageMap.resolveConfig?.(TRAVEL_RAW)
  } catch (err) {
    if (!/unknown key "results"/.test(err.message)) throw err
    const { results, ...before } = TRAVEL_RAW
    return coverageMap.resolveConfig(before)
  }
})()

const TICKETING = 'src/__tests__/unit/lib/ticketing.test.ts'
const BOOKING_HEAD =
  'Code checked: 2026-10-22, by reading the code, not by running it.\nTree: Trips › Flights › Booking\nGroup by: stage\n'

const REQ_004 = `# FLYB requirements

${BOOKING_HEAD}
## REQ-FLYB-004 · FLEX fare accepted or refused
Status: active
Tags: route=Flights leg=BOOKING stage=ticket fare=ECONOMY_FLEX
- ex1: "T" → 1 seat
- ex2: "F" → 0
`
const TICKET_NODE = 'Trips/Flights/Booking/Ticketing'

function model({
  reqs = [REQ_004],
  tests = {},
  notes = {},
  problems = [],
} = {}) {
  return buildModel({
    requirementFiles: reqs.map((text, i) => ({
      path: `docs/product/requirements/f${i}.md`,
      text,
    })),
    testFiles: Object.entries(tests).map(([path, text]) =>
      text instanceof Error ? { path, error: text.message } : { path, text }
    ),
    notes,
    problems,
    config: TRAVEL,
  })
}
const ex = (m, req, id) =>
  m.requirements.find((r) => r.id === req).examples.find((e) => e.id === id)
const stats = (m, key) => m.tree.nodes[key].stats

/**
 * The page in jsdom, opened at `hash`. jsdom lacks scrolling; those notices are dropped.
 * `opts` is added to renderHtml's options ({ commit: 'abc1234' }), e.g. { reread }.
 */
function page(m, hash = '', opts = {}) {
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => {
    if (!/Not implemented/.test(e.message)) errors.push(e.message)
  })
  const dom = new JSDOM(renderHtml(m, { commit: 'abc1234', ...opts }), {
    url: `https://coverage.test/${hash}`,
    runScripts: 'dangerously',
    virtualConsole: vc,
  })
  const doc = dom.window.document
  return {
    dom,
    doc,
    errors,
    // Not `body`: the page's own script sits there and holds every label.
    text: (sel = 'main') =>
      (doc.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' '),
    ac: (id) => doc.getElementById(id),
    wait: (ms = 0) => new Promise((r) => dom.window.setTimeout(r, ms)),
  }
}
const at = (key) => `#/${encodeURI(key)}`

test('E1: the test under ex1 shows its own name and where it lives; ex2 has none', () => {
  const m = model({
    tests: { [TICKETING]: `it('REQ-FLYB-004 ex1: "T" → 1 seat', () => {})` },
  })
  assert.deepEqual(
    ex(m, 'REQ-FLYB-004', 'ex1').tests.map((t) => [t.level, t.path, t.title]),
    [['unit', TICKETING, 'REQ-FLYB-004 ex1: "T" → 1 seat']]
  )
  const p = page(m, at(TICKET_NODE))
  const right = p.ac('REQ-FLYB-004-ex1').querySelector('.ac-r')
  assert.equal(right.querySelector('.ct-name').textContent, '"T" → 1 seat')
  assert.equal(right.querySelector('.lv').textContent, 'unit')
  assert.equal(right.querySelector('.ct-file').getAttribute('title'), TICKETING)
  assert.equal(right.querySelector('.ct-file').textContent, 'ticketing.test.ts:1')
  assert.equal(right.querySelector('details'), null)
  assert.ok(!right.textContent.includes('REQ-FLYB-004 ex1'))
  assert.ok(
    p
      .ac('REQ-FLYB-004-ex2')
      .querySelector('.ac-r')
      .textContent.includes('No test yet')
  )
  assert.deepEqual(p.errors, [])
})

test('E1b: more than three tests show three, the rest behind "N more tests"', () => {
  const five = [1, 2, 3, 4, 5]
    .map((i) => `it('REQ-FLYB-004 ex1: case ${i}', () => {})`)
    .join('\n')
  const p = page(model({ tests: { [TICKETING]: five } }), at(TICKET_NODE))
  const right = p.ac('REQ-FLYB-004-ex1').querySelector('.ac-r')
  assert.equal(right.querySelectorAll(':scope > .ctl > .ct').length, 3)
  assert.equal(
    right.querySelector('details.more summary').textContent,
    '2 more tests'
  )
  assert.equal(right.querySelectorAll('details.more .ct').length, 2)
})

test('E2: e2e gives ■ and is listed first, unit only gives ▣, none gives □', () => {
  const m = model({
    tests: {
      [TICKETING]: `it('REQ-FLYB-004 ex1: unit', () => {})`,
      'e2e/tests/booking-flex.spec.ts': `test('REQ-FLYB-004 ex1: browser', async () => {})`,
      // By path these would sort component before integration.
      'src/__tests__/components/flex.test.tsx': `it('REQ-FLYB-004 ex1: c', () => {})`,
      'src/__tests__/integration/api/flex.test.ts': `it('REQ-FLYB-004 ex1: i', () => {})`,
    },
  })
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex1').mark, '■')
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex2').mark, '□')
  const levels = [
    ...page(m, at(TICKET_NODE))
      .ac('REQ-FLYB-004-ex1')
      .querySelectorAll('.ac-r .lv'),
  ]
  assert.deepEqual(
    levels.map((l) => l.textContent),
    ['e2e', 'integration', 'component', 'unit']
  )
  const unitOnly = model({
    tests: { [TICKETING]: `it('REQ-FLYB-004 ex1: unit', () => {})` },
  })
  assert.equal(ex(unitOnly, 'REQ-FLYB-004', 'ex1').mark, '▣')
})

function reqWithAcs(
  n,
  stage = 'ticket',
  tree = 'Trips › Flights › Booking',
  id = '010',
  extra = ''
) {
  const lines = Array.from(
    { length: n },
    (_, i) => `- ex${i + 1}: case ${i + 1}`
  )
  return `# R requirements\n\nTree: ${tree}\nGroup by: stage\n\n## REQ-FLYB-${id} · many\nStatus: active\nTags: route=Flights leg=BOOKING stage=${stage} ${extra}\n${lines.join('\n')}\n`
}
function testsFor(ids, id = '010') {
  return ids.map((i) => `it('REQ-FLYB-${id} ex${i}: t', () => {})`).join('\n')
}
const cell = (p, label) =>
  [...p.doc.querySelectorAll('button.hc')].find((b) =>
    b.getAttribute('aria-label').startsWith(label)
  )

test('E3: a heat cell shows the share, a bar of that length in its band, and a tooltip', () => {
  const m = model({
    reqs: [
      reqWithAcs(8),
      reqWithAcs(2, 'author', 'Trips › Flights › Meals', '011'),
    ],
    tests: { [TICKETING]: testsFor([1, 2, 3, 4, 5]) },
  })
  const p = page(m, at('Trips'))
  const c = cell(p, 'Flights › Booking, Ticketing')
  assert.equal(
    c.getAttribute('aria-label'),
    'Flights › Booking, Ticketing: 63% of 8 ACs tested'
  )
  assert.ok(c.querySelector('.hv').textContent.startsWith('63%'))
  assert.equal(
    c.querySelector('.hbar i').getAttribute('style'),
    'width:63%;background:var(--warn)'
  )
  c.dispatchEvent(new p.dom.window.FocusEvent('focusin', { bubbles: true }))
  assert.ok(p.text('#tip').includes('5 of 8 ACs have a test'))
  // Booking has nothing at Author; Meals has.
  const readingRow = c.closest('tr')
  assert.equal(readingRow.querySelectorAll('.hc.empty').length, 1)
})

test('E3b: bands are under 50%, 50–79% and 80% and up', () => {
  const cases = [
    [49, 'bad', 'Under 50%'],
    [50, 'warn', '50–79%'],
    [79, 'warn', '50–79%'],
    [80, 'good', '80% and up'],
  ]
  for (const [k, key, name] of cases) {
    const m = model({
      reqs: [reqWithAcs(100)],
      tests: {
        [TICKETING]: testsFor(Array.from({ length: k }, (_, i) => i + 1)),
      },
    })
    const band = page(m, at('Trips')).doc.querySelector('.kpi .band')
    assert.ok(band.classList.contains(`band-${key}`), `${k}%`)
    assert.ok(band.textContent.includes(name), `${k}%`)
    assert.ok(band.querySelector('svg'), `${k}% has an icon`)
  }
  // 100% only when every AC has a test; 0% only when none has.
  for (const [n, k, shown] of [
    [200, 199, '99%'],
    [201, 1, '1%'],
  ]) {
    const m = model({
      reqs: [reqWithAcs(n)],
      tests: {
        [TICKETING]: testsFor(Array.from({ length: k }, (_, i) => i + 1)),
      },
    })
    const p = page(m, at('Trips'))
    assert.equal(p.doc.querySelector('.kpi .kv').firstChild.textContent, shown)
    assert.ok(p.text('.tree').includes(shown))
  }
})

test('E4: a requirement counts in the stage heatmap and in By fare type', () => {
  const m = model({
    tests: { [TICKETING]: `it('REQ-FLYB-004 ex1: a', () => {})` },
  })
  assert.equal(
    m.tree.nodes['Trips/Flights/Booking'].byGroup.stage.ticket.total,
    2
  )
  const p = page(m, at('Trips/Flights/Booking'))
  const qt = [...p.doc.querySelectorAll('section.card')].find((s) =>
    s.textContent.includes('By fare type')
  )
  const row = [...qt.querySelectorAll('tr')].find((r) =>
    r.textContent.includes('ECONOMY_FLEX')
  )
  assert.ok(row.querySelector('.hc').textContent.startsWith('50%'))
})

test('E5: an assumed AC is labelled unconfirmed and still counted', () => {
  const m = model({
    reqs: [REQ_004.replace('- ex2: "F"', '- ex2 `assumed`: "F"')],
  })
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex2').assumed, true)
  assert.equal(stats(m, 'Trips').total, 2)
  assert.equal(stats(m, 'Trips').unconfirmed, 1)
  const p = page(m, at(TICKET_NODE))
  const chip = p.ac('REQ-FLYB-004-ex2').querySelector('.chip-unconf')
  assert.equal(chip.textContent, 'unconfirmed')
  assert.match(chip.getAttribute('title'), /has not confirmed it/)
  assert.equal(p.ac('REQ-FLYB-004-ex1').querySelector('.chip-unconf'), null)
  const tiles = [...p.doc.querySelectorAll('.kpi .kv')].map((k) =>
    k.firstChild.textContent.trim()
  )
  assert.deepEqual(tiles, ['0%', '2', '0', '1'])
})

test('E6: removed AC and deprecated requirement are not counted; tests naming them show on the Tests view', () => {
  const removed = REQ_004.replace(
    '- ex2: "F" → 0',
    '- ex2 (removed 2026-10-01: wrong): "F" → 0'
  )
  const deprecated = `# D\n\n${BOOKING_HEAD}\n## REQ-FLYB-005 · old\nStatus: deprecated\nTags: stage=ticket\n- ex1: x\n`
  const m = model({
    reqs: [removed, deprecated],
    tests: {
      [TICKETING]: `it('REQ-FLYB-004 ex2: a', () => {})\nit('REQ-FLYB-005 ex1: b', () => {})`,
    },
  })
  assert.equal(stats(m, 'Trips').total, 1)
  assert.deepEqual(m.orphans.map((o) => [o.ref, o.reason]).sort(), [
    ['REQ-FLYB-004 ex2', 'removed'],
    ['REQ-FLYB-005 ex1', 'removed'],
  ])
  assert.ok(!m.tree.nodes[TICKET_NODE].reqIds.includes('REQ-FLYB-005'))
  assert.ok(page(m, '#tests').text().includes('Tests naming a removed AC'))
  const g = page(m, at(TICKET_NODE))
  assert.ok(g.ac('REQ-FLYB-004-ex1'))
  assert.equal(g.ac('REQ-FLYB-004-ex2'), null)
})

test('E7: a test naming an AC that does not exist covers nothing and shows on the Tests view', () => {
  const m = model({
    tests: { [TICKETING]: `it('REQ-FLYB-004 ex9: a', () => {})` },
  })
  assert.deepEqual(
    m.orphans.map((o) => [o.ref, o.reason]),
    [['REQ-FLYB-004 ex9', 'missing']]
  )
  assert.equal(stats(m, 'Trips').covered, 0)
  assert.ok(
    page(m, '#tests').text().includes('Tests naming an AC that does not exist')
  )
})

test('E8: a test naming only the requirement covers no AC and shows under it', () => {
  const m = model({
    tests: { [TICKETING]: `it('REQ-FLYB-004: general', () => {})` },
  })
  assert.equal(m.requirements[0].generalTests.length, 1)
  assert.equal(stats(m, 'Trips').covered, 0)
  const card = page(m, at(TICKET_NODE)).doc.querySelector(
    'details.req[data-req="REQ-FLYB-004"]'
  )
  assert.ok(card.textContent.includes('Tests naming no AC'))
  assert.ok(card.textContent.includes('general'))
  // The requirement on a describe, an AC on the test: linked to that AC only.
  const both = model({
    tests: {
      [TICKETING]:
        "describe('REQ-FLYB-004 · FLEX ticketing', () => {\n  it('REQ-FLYB-004 ex1: a', () => {})\n})",
    },
  })
  assert.equal(both.requirements[0].generalTests.length, 0)
  assert.equal(ex(both, 'REQ-FLYB-004', 'ex1').tests.length, 1)
})

test('E9: one test naming two ACs covers both', () => {
  const m = model({
    tests: {
      [TICKETING]: `it('REQ-FLYB-004 ex1, REQ-FLYB-004 ex2: both', () => {})`,
    },
  })
  assert.equal(stats(m, 'Trips').covered, 2)
})

test('E10: an ID on describe applies to every test inside it', () => {
  const src = `describe('REQ-FLYB-004 ex1: FLEX', () => {\n  it('seats T', () => {})\n  it('seats t', () => {})\n})`
  const m = model({ tests: { [TICKETING]: src } })
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex1').tests.length, 2)
  assert.equal(
    ex(m, 'REQ-FLYB-004', 'ex1').tests[0].title,
    'REQ-FLYB-004 ex1: FLEX › seats T'
  )
  // On the page: the test's own name, and the describe around it below.
  const first = page(m, at(TICKET_NODE))
    .ac('REQ-FLYB-004-ex1')
    .querySelector('.ct')
  assert.equal(first.querySelector('.ct-name').textContent, 'seats T')
  assert.equal(first.querySelector('.ct-ctx').textContent, 'FLEX')
})

test('E11: skipped tests do not cover an AC and say so', () => {
  for (const call of [
    "it.skip('REQ-FLYB-004 ex1: a', () => {})",
    "xit('REQ-FLYB-004 ex1: a', () => {})",
  ]) {
    const m = model({ tests: { [TICKETING]: call } })
    assert.equal(ex(m, 'REQ-FLYB-004', 'ex1').mark, '▫', call)
    assert.equal(stats(m, 'Trips').covered, 0, call)
  }
  const pw = model({
    tests: {
      'e2e/tests/a.spec.ts':
        "test.fixme('REQ-FLYB-004 ex1: a', async () => {})\ntest.describe.skip('REQ-FLYB-004 ex2: b', () => { test('c', async () => {}) })",
    },
  })
  assert.equal(ex(pw, 'REQ-FLYB-004', 'ex1').mark, '▫')
  assert.equal(ex(pw, 'REQ-FLYB-004', 'ex2').mark, '▫')
  const right = page(pw, at(TICKET_NODE))
    .ac('REQ-FLYB-004-ex1')
    .querySelector('.ac-r')
  assert.ok(right.textContent.includes('Only skipped tests'))
  assert.equal(right.querySelector('.ct .chip').textContent, 'skipped')
  // A live test comes before skipped ones, whatever their level.
  const order = model({
    tests: {
      'e2e/tests/a.spec.ts': [1, 2, 3]
        .map((i) => `test.skip('REQ-FLYB-004 ex1: s${i}', async () => {})`)
        .join('\n'),
      [TICKETING]: "it('REQ-FLYB-004 ex1: live', () => {})",
    },
  })
  assert.equal(
    ex(order, 'REQ-FLYB-004', 'ex1').tests[0].title,
    'REQ-FLYB-004 ex1: live'
  )
})

test('E11b: a conditional test.skip, in a body or a describe, is not a test', () => {
  const src =
    "test.describe('d', () => {\n  test.skip(isMobile, 'desktop only')\n  test('REQ-FLYB-004 ex1: a', async () => { test.skip(process.env.CI === '1', 'no CI') })\n})"
  const m = model({ tests: { 'e2e/tests/a.spec.ts': src } })
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex1').mark, '■')
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex1').tests.length, 1)
  assert.deepEqual(m.dynamic, [])
})

test('E12: a template title keeps its static ID; a title held in a variable is reported', () => {
  const src =
    "it(`REQ-FLYB-004 ex1: ${answer}`, () => {})\nit(name, () => {})\nit.each([[1]])('REQ-FLYB-004 ex2: %i', () => {})"
  const m = model({ tests: { [TICKETING]: src } })
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex1').tests.length, 1)
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex2').tests.length, 1)
  assert.deepEqual(
    m.dynamic.map((d) => `${d.path}:${d.line}`),
    [`${TICKETING}:2`]
  )
  const text = page(m, '#tests').text()
  assert.ok(text.includes('Tests whose name cannot be read statically'))
  assert.ok(text.includes(`${TICKETING}:2`))
})

test('E13: tests naming no requirement are listed by file with a total', () => {
  const m = model({
    tests: {
      [TICKETING]: "it('a', () => {})\nit('b', () => {})",
      'e2e/tests/x.spec.ts': "test('c', async () => {})",
    },
  })
  assert.deepEqual(
    m.unlinked.files.map((f) => [f.path, f.tests.length]),
    [
      ['e2e/tests/x.spec.ts', 1],
      [TICKETING, 2],
    ]
  )
  assert.equal(m.unlinked.total, 3)
  const p = page(m, '#tests')
  assert.ok(p.text().includes('3 tests in 2 files'))
  assert.equal(p.doc.querySelectorAll('details.file').length, 2)
  assert.ok(p.text('.tree').includes('3 tests scanned · 3 name no requirement'))
})

test('E14: no requirements still renders', () => {
  const p = page(model({ reqs: [] }))
  assert.ok(p.text().includes('No requirements yet'))
  assert.deepEqual(p.errors, [])
})

test('E15: a requirement with no AC and a duplicated ID are data problems, shown on every view', () => {
  const noEx = `# N\n\n${BOOKING_HEAD}\n## REQ-FLYB-006 · empty\nStatus: active\nTags: stage=ticket\n`
  const m = model({ reqs: [REQ_004, REQ_004, noEx] })
  assert.ok(
    m.problems.some(
      (p) => p.includes('REQ-FLYB-006') && p.includes('has no AC')
    )
  )
  assert.ok(
    m.problems.some(
      (p) => p.includes('REQ-FLYB-004') && p.includes('defined twice')
    )
  )
  // The first definition is the one placed and counted.
  assert.deepEqual(m.tree.nodes[TICKET_NODE].reqIds, [
    'REQ-FLYB-004',
    'REQ-FLYB-006',
  ])
  assert.equal(stats(m, 'Trips').total, 2)
  for (const hash of [at('Trips'), '#drift', '#tests']) {
    const box = page(m, hash).doc.querySelector('.problems')
    assert.ok(box && box.textContent.includes('Data problems'), hash)
    assert.ok(box.textContent.includes('REQ-FLYB-006 has no AC'), hash)
  }
  // The console line counts what the page counts.
  assert.equal(
    summary(m),
    '2 requirements, 2 ACs, 0 tested, 0 differ from code; 0 tests scanned, 0 linked to no requirement'
  )
  // The same AC ID twice in one requirement: the first counts, alone.
  const dupAc = `# D\n\n${BOOKING_HEAD}\n## REQ-FLYB-007 · dup\nStatus: active\nTags: stage=ticket\n- ex1: a → b\n- ex1: c → d\n  Code: differs.\n  Recommend: fix code — x.\n- ex2: e → f\n`
  const d = model({ reqs: [dupAc] })
  assert.ok(
    d.problems.includes(
      'REQ-FLYB-007 ex1 is defined twice (docs/product/requirements/f0.md)'
    )
  )
  assert.deepEqual(
    d.requirements[0].examples.map((e) => [e.id, e.text, e.code.length]),
    [
      ['ex1', 'a → b', 0],
      ['ex2', 'e → f', 0],
    ]
  )
  assert.equal(stats(d, 'Trips').total, 2)
  // A heading trace-check cannot read is reported, and the next requirement
  // keeps its own tags and Code lines.
  const odd = `# S\n\n${BOOKING_HEAD}\n## REQ-FLYB-002 · a b\nStatus: active\nTags: stage=author\n- ex1: a\n\n## REQ-FLYB-003 · c\nStatus: active\nTags: stage=ticket\n- ex1: c\n  Code: differs.\n  Recommend: fix code — y.\n`
  const s = model({ reqs: [odd] })
  const r3 = s.requirements.find((r) => r.id === 'REQ-FLYB-003')
  assert.deepEqual(r3.tags.stage, ['ticket'])
  assert.equal(r3.examples[0].code.length, 1)
  assert.ok(
    s.problems.includes(
      'REQ-FLYB-002: the heading could not be read; check it for unusual characters (docs/product/requirements/f0.md)'
    )
  )
})

test('E16: an unreadable test file is reported and skipped', () => {
  const m = model({
    tests: { 'e2e/tests/broken.spec.ts': new Error('EACCES') },
  })
  assert.ok(m.problems.some((p) => p.includes('e2e/tests/broken.spec.ts')))
})

test('E17: one self-contained file, the same on every run, fonts the only outside link', () => {
  const build = () =>
    renderHtml(
      model({ tests: { [TICKETING]: `it('REQ-FLYB-004 ex1: a', () => {})` } }),
      { commit: 'abc1234' }
    )
  // A day apart on the clock: nothing time-dependent may reach the page.
  mock.timers.enable({ apis: ['Date'], now: 0 })
  let a
  let b
  try {
    a = build()
    mock.timers.setTime(86_400_000)
    b = build()
  } finally {
    mock.timers.reset()
  }
  assert.equal(a, b)
  assert.doesNotMatch(a, /<script[^>]+src=/)
  const links = [...a.matchAll(/<link[^>]+href="([^"]+)"/g)].map((x) => x[1])
  assert.ok(links.length > 0)
  for (const href of links)
    assert.match(href, /^https:\/\/fonts\.(googleapis|gstatic)\.com\//)
  assert.match(a, /--font-ui:\s*["']IBM Plex Sans["'],\s*system-ui/)
  assert.ok(page(model()).text('header').includes('commit abc1234'))
})

const DRIFT = REQ_004.replace(
  '- ex2: "F" → 0',
  '- ex2: "F" → 0\n  Code: "F" books 1 (ticketing.ts:10).\n  Recommend: fix code — ticketing bug.\n- ex3: "Z" → 0\n  Code: "Z" books 1.\n  Recommend: fix AC — agents often abbreviate.\n- ex4: "x" → 0\n  Other doc: 08-ticketing says otherwise.'
)

test('E18: an AC with a Code line is marked, shown, and counted as drift', () => {
  const m = model({ reqs: [DRIFT] })
  assert.deepEqual(ex(m, 'REQ-FLYB-004', 'ex2').code, [
    '"F" books 1 (ticketing.ts:10).',
  ])
  assert.equal(stats(m, 'Trips').drift, 2)
  const p = page(m, at('Trips'))
  assert.ok(
    cell(p, 'Flights › Booking, Ticketing').querySelector('.hd').textContent ===
      '≠2'
  )
  const ac = page(m, at(TICKET_NODE)).ac('REQ-FLYB-004-ex2')
  assert.equal(ac.querySelector('.chip-drift').textContent, '≠ code')
  assert.ok(
    ac
      .querySelector('.callout')
      .textContent.includes('Code does"F" books 1 (ticketing.ts:10).')
  )
})

test('E19: a test on a drifting AC carries a warning', () => {
  const m = model({
    reqs: [DRIFT],
    tests: { [TICKETING]: `it('REQ-FLYB-004 ex2: a', () => {})` },
  })
  const right = page(m, at(TICKET_NODE))
    .ac('REQ-FLYB-004-ex2')
    .querySelector('.ac-r')
  assert.ok(
    right.textContent.includes(
      'The code differs from this AC, so this test is failing or does not test the real code'
    )
  )
})

test('E20: the tree foot shows when code was checked, or that it was not', () => {
  assert.ok(
    page(model(), at('Trips'))
      .text('.tree')
      .includes('2026-10-22, by reading the code, not by running it')
  )
  const none = model({ reqs: [REQ_004.replace(/Code checked:.*\n/, '')] })
  assert.ok(
    page(none, at('Trips')).text('.tree').includes('code not checked')
  )
  // An empty line reads as no line, not as the line after it.
  const empty = model({
    reqs: [REQ_004.replace(/Code checked:.*\n/, 'Code checked:\n')],
  })
  assert.ok(
    page(empty, at('Trips')).text('.tree').includes('code not checked')
  )
})

test('E21: another doc saying otherwise is shown but is not drift', () => {
  const m = model({ reqs: [DRIFT] })
  assert.deepEqual(ex(m, 'REQ-FLYB-004', 'ex4').otherDocs, [
    '08-ticketing says otherwise.',
  ])
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex4').code.length, 0)
  const ac = page(m, at(TICKET_NODE)).ac('REQ-FLYB-004-ex4')
  assert.ok(
    ac
      .querySelector('.other')
      .textContent.includes('08-ticketing says otherwise.')
  )
  assert.equal(ac.querySelector('.chip-drift'), null)
})

test('E22: the Code drift view groups every drifting AC by recommendation', () => {
  const m = model({ reqs: [DRIFT] })
  assert.deepEqual(
    m.drift.map((d) => [d.ref, d.stage]),
    [
      ['REQ-FLYB-004 ex2', 'ticket'],
      ['REQ-FLYB-004 ex3', 'ticket'],
    ]
  )
  const p = page(m, '#drift')
  const groups = [...p.doc.querySelectorAll('.dgroup')]
  assert.deepEqual(
    groups.map((g) =>
      g.querySelector('h3').textContent.replace(/\s+\(\d+\)$/, '')
    ),
    [
      'Recommend fixing the code — keep the AC, change the code',
      'Recommend fixing the AC — the code is better, change the document',
    ]
  )
  const first = groups[0].querySelector('.dcard')
  assert.ok(first.textContent.includes('REQ-FLYB-004 ex2'))
  assert.equal(first.querySelector('.chip').textContent, 'Ticketing')
  assert.ok(first.textContent.includes('ticketing bug.'))
  assert.equal(first.querySelector('a').getAttribute('data-go'), TICKET_NODE)
  // Opening it seats that AC, and only that one.
  first.querySelector('a').click()
  assert.equal(p.text('h1'), 'Ticketing')
  assert.deepEqual(
    [...p.doc.querySelectorAll('li.ac.hit')].map((li) => li.id),
    ['REQ-FLYB-004-ex2']
  )
  // A filter left on does not hide the AC a card opens.
  const f = page(m, at(TICKET_NODE))
  f.doc.getElementById('f-unconfirmed').click()
  assert.equal(f.doc.querySelectorAll('li.ac').length, 0)
  f.doc.querySelector('a[href="#drift"]').click()
  f.doc.querySelector('.dcard a').click()
  assert.ok(f.ac('REQ-FLYB-004-ex2').classList.contains('hit'))
  // Drift with no recommendation has its own group.
  const none = page(
    model({
      reqs: [
        REQ_004.replace('- ex2: "F" → 0', '- ex2: "F" → 0\n  Code: differs.'),
      ],
    }),
    '#drift'
  )
  const group = none.doc.querySelector('.dgroup')
  assert.equal(
    group.querySelector('h3').textContent,
    'No recommendation yet (1)'
  )
  assert.ok(group.textContent.includes('REQ-FLYB-004 ex2'))
})

test('E23: a note on a test file is shown on the Tests view', () => {
  const m = model({
    tests: {
      'src/__tests__/integration/plans-flow.integration.test.ts':
        "it('a', () => {})",
    },
    notes: {
      'src/__tests__/integration/plans-flow.integration.test.ts':
        'tickets with a copy of the ticketing code',
    },
  })
  assert.ok(
    page(m, '#tests').text().includes('tickets with a copy of the ticketing code')
  )
  // The notes file is read with care: a broken one is a data problem.
  assert.deepEqual(readNotes('{"a.test.ts": "n"}', 'notes.json'), {
    notes: { 'a.test.ts': 'n' },
    problems: [],
  })
  const bad = readNotes('{"a.test.ts": "n",}', 'notes.json')
  assert.deepEqual(bad.notes, {})
  assert.match(bad.problems[0], /^Cannot read notes\.json: /)
  const shown = model({ problems: bad.problems })
  assert.ok(shown.problems.includes(bad.problems[0]))
})

test('E24: recommendations are parsed, labelled and counted', () => {
  const m = model({ reqs: [DRIFT] })
  assert.deepEqual(ex(m, 'REQ-FLYB-004', 'ex2').recommend, {
    kind: 'code',
    priority: null,
    reason: 'ticketing bug.',
  })
  assert.deepEqual(ex(m, 'REQ-FLYB-004', 'ex3').recommend, {
    kind: 'ac',
    priority: null,
    reason: 'agents often abbreviate.',
  })
  assert.deepEqual(
    [stats(m, 'Trips').driftCode, stats(m, 'Trips').driftAc],
    [1, 1]
  )
  const p = page(m, at(TICKET_NODE))
  assert.ok(
    p.ac('REQ-FLYB-004-ex2').textContent.includes('Recommend: fix code')
  )
  assert.ok(
    p.ac('REQ-FLYB-004-ex3').textContent.includes('Recommend: fix AC')
  )
  const kpi = p.text('.kpis')
  assert.ok(kpi.includes('1 fix code') && kpi.includes('1 fix AC'))
})

test('E25: drift without a recommendation is a data problem', () => {
  const m = model({
    reqs: [
      REQ_004.replace('- ex2: "F" → 0', '- ex2: "F" → 0\n  Code: differs.'),
    ],
  })
  assert.ok(
    m.problems.some(
      (p) =>
        p.includes('REQ-FLYB-004 ex2') && p.includes('has no recommendation')
    )
  )
  const lone = model({
    reqs: [
      REQ_004.replace(
        '- ex2: "F" → 0',
        '- ex2: "F" → 0\n  Recommend: fix code — x.'
      ),
    ],
  })
  assert.ok(
    lone.problems.includes(
      'REQ-FLYB-004 ex2 has a recommendation but no Code line'
    )
  )
})

test('E26: a stage no requirement reaches is not drawn as a column', () => {
  const heads = (p) =>
    [...p.doc.querySelectorAll('section.card table')].map((t) =>
      [...t.querySelectorAll('thead th')].map((th) => th.textContent)
    )
  // One stage: no "All stages" either, it would repeat that column.
  assert.deepEqual(heads(page(model(), at('Trips/Flights/Booking'))), [
    ['', 'Ticketing'],
    ['', 'Ticketing'],
  ])
  const two = model({
    reqs: [
      REQ_004,
      reqWithAcs(2, 'author', 'Trips › Flights › Booking', '011'),
    ],
  })
  assert.deepEqual(heads(page(two, at('Trips/Flights/Booking'))), [
    ['', 'All stages', 'Author', 'Ticketing'],
    // Only REQ-FLYB-004 has a fare type, and it is at Ticketing only.
    ['', 'Ticketing'],
  ])
})

test('E27: cells, header links, Back, search and filters navigate in place', async () => {
  const m = model({
    reqs: [DRIFT],
    tests: { [TICKETING]: `it('REQ-FLYB-004 ex1: a', () => {})` },
  })
  const p = page(m, at('Trips'))
  cell(p, 'Flights › Booking, Ticketing').click()
  assert.equal(decodeURI(p.dom.window.location.hash), `#/${TICKET_NODE}`)
  assert.equal(p.doc.querySelector('.tn.active .tl').textContent, 'Ticketing')
  assert.equal(p.doc.querySelector('h1').textContent, 'Ticketing')
  p.dom.window.history.back()
  await p.wait(20)
  assert.equal(p.doc.querySelector('h1').textContent, 'Trips')
  p.doc.querySelector('a[href="#drift"]').click()
  assert.ok(p.text('h1').includes('ACs the code does differently'))
  p.doc.querySelector('a[href="#tests"]').click()
  assert.ok(p.text('h1').includes('Tests'))
  // Search across everything.
  const q = p.doc.getElementById('q')
  q.value = 'abbreviate'
  q.dispatchEvent(new p.dom.window.Event('input', { bubbles: true }))
  await p.wait(200)
  assert.ok(p.text('main').includes('0 requirements match'))
  q.value = 'FLEX'
  q.dispatchEvent(new p.dom.window.Event('input', { bubbles: true }))
  await p.wait(200)
  assert.ok(p.text('main').includes('1 requirement matches'))
  // By ID and by AC text too ("Z" in quotes is only in ex3's text).
  for (const term of ['flYB-004', '"Z"']) {
    q.value = term
    q.dispatchEvent(new p.dom.window.Event('input', { bubbles: true }))
    await p.wait(200)
    assert.ok(p.text('main').includes('1 requirement matches'), term)
  }
  // Back from search goes to the view the search started on, and clears the box.
  p.dom.window.history.back()
  await p.wait(20)
  assert.equal(p.text('h1'), 'Tests')
  assert.equal(q.value, '')
  // A hash naming no node opens the Project overview (OV5).
  const odd = page(m, '#/toString')
  assert.equal(odd.text('h1'), 'Project overview')
  assert.deepEqual(odd.errors, [])
  // Filters hide the ACs that do not match.
  const g = page(m, at(TICKET_NODE))
  assert.equal(g.doc.querySelectorAll('li.ac').length, 4)
  g.doc.getElementById('f-untested').click()
  assert.deepEqual(
    [...g.doc.querySelectorAll('li.ac')].map((li) => li.id),
    ['REQ-FLYB-004-ex2', 'REQ-FLYB-004-ex3', 'REQ-FLYB-004-ex4']
  )
  g.doc.getElementById('f-drift').click()
  assert.deepEqual(
    [...g.doc.querySelectorAll('li.ac')].map((li) => li.id),
    ['REQ-FLYB-004-ex2', 'REQ-FLYB-004-ex3']
  )
  const u = page(
    model({ reqs: [REQ_004.replace('- ex2: "F"', '- ex2 `assumed`: "F"')] }),
    at(TICKET_NODE)
  )
  u.doc.getElementById('f-unconfirmed').click()
  assert.deepEqual(
    [...u.doc.querySelectorAll('li.ac')].map((li) => li.id),
    ['REQ-FLYB-004-ex2']
  )
  assert.match(
    renderHtml(m, { commit: 'x' }),
    /<noscript>This page needs JavaScript<\/noscript>/
  )
  assert.deepEqual(p.errors, [])
})

test('E27b: the four summary tiles count the selected node only', () => {
  const m = model({
    reqs: [
      DRIFT,
      reqWithAcs(4, 'author', 'Trips › Flights › Meals', '011'),
      // Every AC tested: not one of the requirements with an untested AC.
      reqWithAcs(1, 'ticket', 'Trips › Flights › Booking', '012'),
    ],
    tests: {
      [TICKETING]:
        "it('REQ-FLYB-004 ex1: a', () => {})\nit('REQ-FLYB-012 ex1: b', () => {})",
    },
  })
  const kv = (hash) => [...page(m, hash).doc.querySelectorAll('.kpi .kv')]
  const tiles = (hash) => kv(hash).map((k) => k.firstChild.textContent.trim())
  // Trips: 9 ACs, 2 with a test.
  assert.deepEqual(tiles(at('Trips')), ['22%', '7', '2', '0'])
  assert.equal(
    kv(at('Trips'))[1].querySelector('small').textContent,
    'in 2 requirements'
  )
  // Ticketing: REQ-FLYB-004 (1 of 4) and REQ-FLYB-012 (1 of 1).
  assert.deepEqual(tiles(at(TICKET_NODE)), ['40%', '3', '2', '0'])
  assert.equal(
    kv(at(TICKET_NODE))[1].querySelector('small').textContent,
    'in 1 requirement'
  )
})

test('levels come from the path', () => {
  const levels = TRAVEL_RAW.levels
  assert.equal(levelOf('e2e/tests/a.spec.ts', levels), 'e2e')
  assert.equal(
    levelOf(
      'src/__tests__/integration/e2e-plans.integration.test.ts',
      levels
    ),
    'api-e2e'
  )
  assert.equal(
    levelOf('src/__tests__/integration/api/plans/x.test.ts', levels),
    'integration'
  )
  assert.equal(
    levelOf('src/__tests__/components/plans/q.test.tsx', levels),
    'component'
  )
  assert.equal(
    levelOf('src/__tests__/unit/lib/ticketing.test.ts', levels),
    'unit'
  )
  assert.equal(
    levelOf('src/__tests__/lib/validations/v.test.ts', levels),
    'unit'
  )
  // Any other folder under src/__tests__ is unit.
  assert.equal(
    levelOf(
      'src/__tests__/app/test/legs/default-sections.test.ts',
      levels
    ),
    'unit'
  )
})

test('scanTests ignores hooks, steps and config calls', () => {
  const src =
    "test.use({ role: 'admin' })\ntest.beforeAll(async () => {})\ntest.describe.configure({ mode: 'serial' })\ntest('real', async () => { await test.step('s', async () => {}) })"
  const scanned = scanTests(src, 'e2e/tests/a.spec.ts')
  assert.deepEqual(
    scanned.tests.map((t) => t.title),
    ['real']
  )
  assert.deepEqual(scanned.dynamic, [])
})

// ------------------------------------------------------------------ tree (E28–E35)

const BOOKING = `# FLYB requirements

Tree: Trips › Flights › Booking
Group by: stage

## REQ-FLYB-001 · ticketing
Status: active
Tags: route=Flights leg=BOOKING stage=ticket
- ex1: a → b
- ex2: c → d

## REQ-FLYB-002 · authoring
Status: active
Tags: route=Flights leg=BOOKING stage=author
Rule: A plan starts with one leg.
Source: docs/features/06-plan-system.md "Validation Rules"
- ex1: e → f
`
const USERS = `# USERS requirements

Tree: Users
Group by: feature

## REQ-USERS-001 · create
Status: active
Tags: feature=Create_accounts
- ex1: a → b
`
const FRAUD = `# FRAUD requirements

Tree: Cross-cutting › Fraud
Group by: none

## REQ-FRAUD-001 · card mismatch
Status: active
Applies to: Trips › * › *
- ex1: a → b
- ex2: c → d
`
function treeModel(files, tests = {}) {
  return buildModel({
    requirementFiles: Object.entries(files).map(([name, text]) => ({
      path: `docs/product/requirements/${name}`,
      text,
    })),
    testFiles: Object.entries(tests).map(([path, text]) => ({ path, text })),
    config: TRAVEL,
  })
}
const node = (m, key) => m.tree.nodes[key]

test('E28: a requirement sits under its stage and counts once in every ancestor', () => {
  const m = treeModel(
    { 'flyb.md': BOOKING },
    { [TICKETING]: `it('REQ-FLYB-001 ex1: a', () => {})` }
  )
  assert.deepEqual(node(m, 'Trips/Flights/Booking/Ticketing').reqIds, [
    'REQ-FLYB-001',
  ])
  assert.deepEqual(node(m, 'Trips/Flights/Booking/Ticketing').group, {
    tag: 'stage',
    value: 'ticket',
  })
  for (const key of ['Trips/Flights/Booking', 'Trips/Flights', 'Trips']) {
    assert.equal(node(m, key).stats.total, 3, key)
    assert.equal(node(m, key).stats.covered, 1, key)
    assert.equal(node(m, key).stats.reqs, 2, key)
  }
  assert.equal(node(m, 'Trips/Flights/Booking').byGroup.stage.ticket.total, 2)
  assert.equal(node(m, 'Trips/Flights/Booking').byGroup.stage.author.total, 1)
})

test('E29: Group by feature makes a node per feature; none keeps it at the tree node', () => {
  const m = treeModel({ 'users.md': USERS, 'fraud.md': FRAUD })
  assert.deepEqual(node(m, 'Users/Create accounts').reqIds, ['REQ-USERS-001'])
  assert.deepEqual(node(m, 'Cross-cutting/Fraud').reqIds, [
    'REQ-FRAUD-001',
  ])
  assert.deepEqual(node(m, 'Cross-cutting/Fraud').children, [])
})

test('E30: Applies to lists a requirement on matching nodes without counting it there', () => {
  const m = treeModel({ 'flyb.md': BOOKING, 'fraud.md': FRAUD })
  assert.deepEqual(node(m, 'Trips/Flights/Booking').applies, [
    'REQ-FRAUD-001',
  ])
  assert.deepEqual(node(m, 'Trips').applies, [])
  assert.equal(node(m, 'Trips').stats.total, 3)
  assert.equal(node(m, 'Trips/Flights/Booking').stats.total, 3)
  assert.equal(node(m, 'Cross-cutting').stats.total, 2)
  const applies = page(m, at('Trips/Flights/Booking')).doc.querySelector(
    '.applies'
  )
  assert.ok(applies.textContent.includes('REQ-FRAUD-001'))
  assert.equal(page(m, at('Trips')).doc.querySelector('.applies'), null)
})

test('E31: a file with no Tree line becomes a root named after the file', () => {
  const perf = `# PERF requirements\n\n## REQ-PERF-001 · fast\nStatus: active\n- ex1: a → b\n`
  const m = treeModel({ 'perf.md': perf })
  assert.deepEqual(m.tree.roots, ['PERF'])
  assert.deepEqual(node(m, 'PERF').reqIds, ['REQ-PERF-001'])
  // An empty Tree line is no Tree line; ">" separates like "›".
  const empty = treeModel({
    'perf.md': perf.replace('\n\n## ', '\n\nTree:\nGroup by: none\n\n## '),
  })
  assert.deepEqual(empty.tree.roots, ['PERF'])
  const ascii = treeModel({
    'perf.md': perf.replace(
      '\n\n## ',
      '\n\nTree: Non-functional > Performance\n\n## '
    ),
  })
  assert.deepEqual(node(ascii, 'Non-functional').children, [
    'Non-functional/Performance',
  ])
})

test('E32: an unknown Group by is a data problem and groups as none', () => {
  const m = treeModel({
    'users.md': USERS.replace('Group by: feature', 'Group by: colour'),
  })
  assert.ok(
    m.problems.some(
      (p) =>
        p.includes('users.md') &&
        p.includes('Group by must be stage, feature or none')
    )
  )
  assert.deepEqual(node(m, 'Users').reqIds, ['REQ-USERS-001'])
})

test('E33: nodes follow the fixed order, stages their own, the rest alphabetically', () => {
  // Every expected order below differs from plain alphabetical order.
  const leaf = (route, id) =>
    `# ${id} requirements\n\nTree: Trips › ${route} › Seats\nGroup by: stage\n\n## REQ-${id}-001 · r\nStatus: active\nTags: stage=ticket\n- ex1: a → b\n\n## REQ-${id}-002 · s\nStatus: active\nTags: stage=hold\n- ex1: a → b\n`
  const m = treeModel({
    'cars.md': leaf('Cars', 'CARS'),
    'flys.md': leaf('Flights', 'FLYS'),
    'hotl.md': leaf('Hotels', 'HOTL'),
    'fraud.md': FRAUD,
    'zeta.md': `# ZETA requirements\n\nTree: Zeta\n\n## REQ-ZETA-001 · z\nStatus: active\n- ex1: a → b\n`,
    'alpha.md': `# ALPHA requirements\n\nTree: Alpha\n\n## REQ-ALPHA-001 · a\nStatus: active\n- ex1: a → b\n`,
    'users.md': USERS,
  })
  // Users is not in the fixed list (it sits under People & access): alphabetical.
  assert.deepEqual(m.tree.roots, [
    'Trips',
    'Cross-cutting',
    'Alpha',
    'Users',
    'Zeta',
  ])
  assert.deepEqual(node(m, 'Trips').children, [
    'Trips/Flights',
    'Trips/Hotels',
    'Trips/Cars',
  ])
  assert.deepEqual(node(m, 'Trips/Hotels/Seats').children, [
    'Trips/Hotels/Seats/Hold',
    'Trips/Hotels/Seats/Ticketing',
  ])
})

test('E34: Rule and Source are kept for the page', () => {
  const m = treeModel({ 'flyb.md': BOOKING })
  const r = m.requirements.find((x) => x.id === 'REQ-FLYB-002')
  assert.equal(r.rule, 'A plan starts with one leg.')
  assert.equal(
    r.source,
    'docs/features/06-plan-system.md "Validation Rules"'
  )
  const card = page(m, at('Trips/Flights/Booking/Author')).doc.querySelector(
    'details.req[data-req="REQ-FLYB-002"]'
  )
  assert.ok(
    card.textContent.includes('RuleA plan starts with one leg.')
  )
  assert.ok(
    card.textContent.includes('Sourcedocs/features/06-plan-system.md')
  )
})

test('E35: a node whose children are all stages is a heatmap row', () => {
  const m = treeModel({ 'flyb.md': BOOKING, 'users.md': USERS })
  assert.equal(node(m, 'Trips/Flights/Booking').matrixRow, true)
  assert.equal(node(m, 'Trips/Flights').matrixRow, false)
  assert.equal(node(m, 'Users').matrixRow, false)
  // A stage child next to a branch that is not a stage: not a row.
  const mixed = treeModel({
    'flyb.md': BOOKING,
    'extras.md': `# EXTRAS requirements\n\nTree: Trips › Flights › Booking › Extras\n\n## REQ-EXTRAS-001 · e\nStatus: active\n- ex1: a → b\n`,
  })
  assert.equal(node(mixed, 'Trips/Flights/Booking').matrixRow, false)
})

test('E36: in a Group by stage file, a requirement with no known stage is a data problem', () => {
  const m = treeModel({
    'flyb.md': BOOKING.replace('stage=ticket', 'stage=ticketing'),
  })
  assert.ok(
    m.problems.includes(
      'REQ-FLYB-001 has no stage (author, plan, hold, ticket or result) but its file groups by stage'
    )
  )
  // It is counted at the route, in no stage column.
  assert.deepEqual(node(m, 'Trips/Flights/Booking').reqIds, ['REQ-FLYB-001'])
  assert.equal(node(m, 'Trips/Flights/Booking').stats.total, 3)
  assert.equal(node(m, 'Trips/Flights/Booking').byGroup.stage.ticket.total, 0)
  // A stage tag fills a stage column only through its stage node.
  const mixed = treeModel({
    'flyb.md': BOOKING,
    'mock.md': `# HOLD requirements\n\nTree: Trips › Flights › Booking\nGroup by: none\n\n## REQ-HOLD-001 · m\nStatus: active\nTags: stage=hold\n- ex1: a → b\n`,
  })
  assert.equal(
    node(mixed, 'Trips/Flights/Booking').byGroup.stage.hold.total,
    0
  )
  assert.equal(
    node(mixed, 'Trips/Flights/Booking').byGroup.stage.ticket.total,
    2
  )
})

// ------------------------------------------------------------------ audit (E37–E38)

const PLANNED = `# ASSIGN requirements

Tree: Planned › Assignments
Group by: none

## REQ-ASSIGN-001 · Agents assign plans
Status: planned
Tags: fare=MULTIPLE_CHOICE_SINGLE
- ex1: an agent assigns a plan to a group → every traveller sees it
- ex2: a traveller submits → the agent sees the status
  Code: there is no assignment API.
  Recommend: fix code — the documents describe it.
`

test('E37: a planned requirement sits in the tree but counts nowhere', () => {
  const m = treeModel(
    { 'assign.md': PLANNED, 'flyb.md': BOOKING },
    { [TICKETING]: "it('REQ-ASSIGN-001 ex1: a', () => {})" }
  )
  assert.deepEqual(node(m, 'Planned/Assignments').reqIds, ['REQ-ASSIGN-001'])
  for (const key of ['Planned/Assignments', 'Planned']) {
    const s = node(m, key).stats
    assert.deepEqual(
      [s.total, s.covered, s.drift, s.unconfirmed, s.planned],
      [0, 0, 0, 0, 1],
      key
    )
  }
  assert.equal(node(m, 'Trips').stats.planned, 0)
  assert.deepEqual(m.drift, [])
  assert.equal(
    summary(m),
    '2 requirements, 3 ACs, 0 tested, 0 differ from code; 1 tests scanned, 0 linked to no requirement; 1 planned'
  )
  const p = page(m, at('Planned'))
  assert.equal(p.doc.querySelector('.kpi .kv').firstChild.textContent, '—')
  const row = [...p.doc.querySelectorAll('.tn')].find(
    (t) => t.querySelector('.tl').textContent === 'Planned'
  )
  assert.equal(row.querySelector('.tp').textContent, 'planned')
  assert.ok(
    p
      .text()
      .includes(
        '1 planned requirement: written from the documents, not built yet, not counted'
      )
  )
  const card = p.doc.querySelector('details.req[data-req="REQ-ASSIGN-001"]')
  assert.equal(card.querySelector('.chip-planned').textContent, 'planned')
  // Its fare type is not tabulated either.
  assert.ok(!p.text().includes('By fare type'))
  assert.equal(page(m, '#drift').doc.querySelectorAll('.dcard').length, 0)
})

test('E39: a node lists every requirement under it, however many', () => {
  // 400 requirements at one stage node; the last one's ex1 differs from the code.
  // (Until 2026-10-23 a node past 150 showed only a hint; the user asked for no limit.)
  const many = (n) =>
    `# BIG requirements\n\n${BOOKING_HEAD}\n` +
    Array.from({ length: n }, (_, i) => {
      const id = String(i + 1).padStart(3, '0')
      const drift =
        i === n - 1 ? '\n  Code: differs.\n  Recommend: fix code — x.' : ''
      return `## REQ-BIG-${id} · r${id}\nStatus: active\nTags: stage=ticket\n- ex1: a → b${drift}\n`
    }).join('\n')
  const big = page(model({ reqs: [many(400)] }), at(TICKET_NODE))
  assert.equal(big.doc.querySelectorAll('details.req').length, 400)
  assert.ok(!big.text().includes('requirements under Ticketing'))
  // A Code drift card opens its requirement among them.
  big.doc.querySelector('a[href="#drift"]').click()
  big.doc.querySelector('.dcard a').click()
  assert.equal(big.doc.querySelectorAll('details.req').length, 400)
  // S4 F6: Ticketing is a leaf feature, so every card there is open; the
  // drift card's requirement is one of them.
  const openReqs = [...big.doc.querySelectorAll('details.req[open]')].map((d) =>
    d.getAttribute('data-req')
  )
  assert.equal(openReqs.length, 400)
  assert.deepEqual(
    openReqs.filter((id) => id === 'REQ-BIG-400'),
    ['REQ-BIG-400']
  )
  assert.ok(big.ac('REQ-BIG-400-ex1').classList.contains('hit'))
})

test('E38: the audit roots and the Trips branches keep a fixed order', () => {
  const file = (tree, id) =>
    `# ${id}\n\nTree: ${tree}\n\n## REQ-${id}-001 · x\nStatus: active\n- ex1: a → b\n`
  const m = treeModel({
    'a.md': file('Planned › Assignments', 'PLA'),
    'b.md': file('Zeta', 'ZET'),
    'c.md': file('Loyalty › Tiers', 'LOY'),
    'd.md': file('People & access › Auth', 'AUT'),
    'e.md': file('Trips › Shared › Taking a plan', 'FLO'),
    'f.md': file('Trips › Flights › Meals', 'LIS'),
    'g.md': file('Non-functional › Health', 'HEA'),
    'h.md': file('Travel content › Guides', 'GUI'),
    'i.md': file('Reports & dashboards › History', 'HIS'),
    'j.md': file('Cross-cutting › Fraud', 'FRD'),
    'k.md': file('Trips › Hotels › Meals', 'KEL'),
    // A route not in the fixed list, even one after "Shared" alphabetically, comes before it.
    'l.md': file('Trips › YLE Starters › Booking', 'YLR'),
  })
  assert.deepEqual(m.tree.roots, [
    'Trips',
    'People & access',
    'Travel content',
    'Loyalty',
    'Reports & dashboards',
    'Cross-cutting',
    'Non-functional',
    'Zeta',
    'Planned',
  ])
  assert.deepEqual(node(m, 'Trips').children, [
    'Trips/Flights',
    'Trips/Hotels',
    'Trips/YLE Starters',
    'Trips/Shared',
  ])
})

// ------------------------------------------------------------------ project overview (E37–E44)
// Spec section "Bổ sung 2026-10-25: trang Project overview". These E37–E39 are
// that section's; the E37–E39 above are the requirements-audit spec's.
//
// Fixture, four roots (expected numbers below are counted from it by hand):
//   Trips › Flights › Booking (Group by: stage)
//     REQ-FLYB-101 Ticketing  1500 ACs: ex1–ex400 tested, ex1–ex1100 assumed,
//                             ex2 and ex5 differ (fix code), ex3 differs (fix AC)
//     REQ-FLYB-102 Author      3 ACs, all tested
//     REQ-FLYB-103 Author      2 ACs, only a skipped test
//     → 1505 ACs, 403 tested (27%), ≠3 (2 fix code, 1 fix AC), 1100 unconfirmed,
//       2 requirements with an untested AC
//   People & access › Auth
//     REQ-AUTH-001  8 ACs: ex1–ex5 tested, ex2 assumed, ex8 differs (fix AC)
//     REQ-AUTH-002  2 ACs, both tested
//     → 10 ACs, 7 tested (70%), ≠1 (fix AC), 1 unconfirmed, 1 untested requirement
//   Loyalty
//     REQ-LOY-001  20 ACs: ex1–ex18 tested, none differs
//     → 20 ACs, 18 tested (90%), no drift, 1 untested requirement
//   Planned › Assignments: REQ-ASSIGN-001 (2 ACs, a Code line, a test) and
//     REQ-ASSIGN-002 (1 AC), both Status: planned → counted nowhere
// Project: 6 requirements, 1535 ACs, 428 tested (27.9% → 28%), 1107 untested
// in 4 requirements, ≠4 (2 fix code, 2 fix AC), 1101 unconfirmed, 2 planned.
// Tests: 430 linked in ticketing.test.ts (one skipped), 1150 unlinked in
// misc.test.ts, 1 linked + 1 unlinked in loyalty.spec.ts → 1582 scanned,
// 1151 name no requirement.

const range = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
const ASSUMED = ' `assumed`'
const OV_DRIFT = {
  2: '\n  Code: differs 2.\n  Recommend: fix code — r2.',
  3: '\n  Code: differs 3.\n  Recommend: fix AC — r3.',
  5: '\n  Code: differs 5.\n  Recommend: fix code — r5.',
}
const OV_FILES = {
  'flyb.md': `# FLYB requirements

Tree: Trips › Flights › Booking
Group by: stage

## REQ-FLYB-101 · Ticketing every booking
Status: active
Tags: route=Flights leg=BOOKING stage=ticket
${range(1, 1500)
  .map(
    (i) =>
      `- ex${i}${i <= 1100 ? ASSUMED : ''}: case ${i} → seat ${i}${OV_DRIFT[i] ?? ''}`
  )
  .join('\n')}

## REQ-FLYB-102 · Authoring a leg
Status: active
Tags: route=Flights leg=BOOKING stage=author
- ex1: a → b
- ex2: c → d
- ex3: e → f

## REQ-FLYB-103 · Authoring a leg group
Status: active
Tags: route=Flights leg=BOOKING stage=author
- ex1: g → h
- ex2: i → j
`,
  'auth.md': `# AUTH requirements

Tree: People & access › Auth
Group by: none

## REQ-AUTH-001 · Signing in
Status: active
${range(1, 8)
  .map(
    (i) =>
      `- ex${i}${i === 2 ? ASSUMED : ''}: attempt ${i} → result ${i}${i === 8 ? '\n  Code: no lockout.\n  Recommend: fix AC — the code is safer.' : ''}`
  )
  .join('\n')}

## REQ-AUTH-002 · Signing out
Status: active
- ex1: sign out → the session ends
- ex2: sign out twice → no error
`,
  'loyalty.md': `# LOY requirements

Tree: Loyalty
Group by: none

## REQ-LOY-001 · Reward tiers open by level
Status: active
${range(1, 20)
  .map((i) => `- ex${i}: level ${i} → tier ${i}`)
  .join('\n')}
`,
  'assign.md': `# ASSIGN requirements

Tree: Planned › Assignments
Group by: none

## REQ-ASSIGN-001 · Agents assign plans
Status: planned
- ex1: an agent assigns a plan → every traveller sees it
- ex2: a traveller submits → the agent sees the status
  Code: there is no assignment API.
  Recommend: fix code — the documents describe it.

## REQ-ASSIGN-002 · Deadlines close assignments
Status: planned
- ex1: the deadline passes → the assignment closes
`,
}
const linked = (id, exs) =>
  exs.map((i) => `it('${id} ex${i}: t${i}', () => {})`)
const OV_TESTS = {
  [TICKETING]: [
    ...linked('REQ-FLYB-101', range(1, 400)),
    ...linked('REQ-FLYB-102', range(1, 3)),
    "it.skip('REQ-FLYB-103 ex1: later', () => {})",
    ...linked('REQ-AUTH-001', range(1, 5)),
    ...linked('REQ-AUTH-002', range(1, 2)),
    ...linked('REQ-LOY-001', range(1, 18)),
    ...linked('REQ-ASSIGN-001', [1]),
  ].join('\n'),
  'src/__tests__/unit/misc.test.ts': range(1, 1150)
    .map((i) => `it('plain ${i}', () => {})`)
    .join('\n'),
  'e2e/tests/loyalty.spec.ts':
    "test('REQ-LOY-001 ex1: browser', async () => {})\ntest('opens the home page', async () => {})",
}
const OV = treeModel(OV_FILES, OV_TESTS)

/** A card in the right pane, by the start of its heading. */
const ovCard = (p, title) =>
  [...p.doc.querySelectorAll('main section, main .card')].find((s) => {
    const h = s.querySelector('h2, h3, h4')
    return h && h.textContent.trim().startsWith(title)
  })
const headerLink = (p, label) =>
  [...p.doc.querySelectorAll('header a')].find((a) =>
    a.textContent.trim().startsWith(label)
  )
const kvs = (p) => [...p.doc.querySelectorAll('.kpi .kv')]
const kvTexts = (p) => kvs(p).map((k) => k.firstChild.textContent.trim())
/** One entry per link to a branch in the "Features" card ("By area" until S4, F6). */
function areaRows(p) {
  const c = ovCard(p, 'Features')
  assert.ok(c, 'the Overview has a "Features" card')
  return [...c.querySelectorAll('a')]
    .filter((a) => (a.getAttribute('href') ?? '').startsWith('#/'))
    .map((a) => {
      const row = a.closest('tr, li') ?? a.parentElement
      return {
        a,
        label: a.textContent.trim(),
        row,
        text: row.textContent.replace(/\s+/g, ' '),
      }
    })
}

test('OV1: Overview — with no hash the page opens on Project overview, its link marked current', async () => {
  // The fixture is what the comment above says.
  assert.deepEqual(OV.tree.roots, [
    'Trips',
    'People & access',
    'Loyalty',
    'Planned',
  ])
  assert.deepEqual(OV.problems, [])
  const p = page(OV)
  assert.equal(p.text('h1'), 'Project overview')
  const labels = [...p.doc.querySelectorAll('header a')].map((a) =>
    a.textContent.trim()
  )
  const overview = labels.findIndex((l) => l.startsWith('Overview'))
  const drift = labels.findIndex((l) => l.startsWith('Code drift'))
  assert.ok(overview >= 0, `an "Overview" link in the top bar: ${labels}`)
  assert.ok(overview < drift, `"Overview" before "Code drift": ${labels}`)
  assert.equal(headerLink(p, 'Overview').getAttribute('aria-current'), 'page')
  for (const other of ['Code drift', 'Tests'])
    assert.equal(headerLink(p, other).getAttribute('aria-current'), null, other)
  assert.equal(p.doc.getElementById('menu').textContent, '☰  Overview')
  assert.equal(p.doc.querySelectorAll('.tn.active').length, 0)
  assert.deepEqual(p.errors, [])
  // Elsewhere the link is not current, and it leads back here.
  const q = page(OV, at('Trips'))
  assert.equal(headerLink(q, 'Overview').getAttribute('aria-current'), null)
  headerLink(q, 'Overview').click()
  await q.wait(20)
  assert.equal(q.text('h1'), 'Project overview')
  assert.equal(q.doc.querySelectorAll('.tn.active').length, 0)
})

test('OV2: Overview — the four tiles add up the root branches, as summary() does', () => {
  assert.equal(
    summary(OV),
    '6 requirements, 1535 ACs, 428 tested, 4 differ from code; 1582 tests scanned, 1151 linked to no requirement; 2 planned'
  )
  const p = page(OV)
  assert.equal(p.text('h1'), 'Project overview')
  assert.deepEqual(
    [...p.doc.querySelectorAll('.kpi .kl')].map((k) => k.textContent),
    [
      'ACs with a test',
      'ACs without a test',
      'ACs the code does differently',
      'Unconfirmed ACs',
    ]
  )
  // 428/1535 = 27.9% → 28%; Trips alone would be 27%.
  assert.deepEqual(kvTexts(p), ['28%', '1,107', '4', '1,101'])
  const small = kvs(p).map((k) => k.querySelector('small')?.textContent ?? '')
  assert.equal(small[0], '428 of 1535')
  assert.equal(small[1], 'in 4 requirements')
  assert.equal(small[3], 'of 1535')
  const band = p.doc.querySelector('.kpi .band')
  assert.ok(band && band.classList.contains('band-bad'), 'band under 50%')
  const kpi = p.text('.kpis')
  assert.ok(kpi.includes('2 fix code') && kpi.includes('2 fix AC'), kpi)
  // covered, total and drift are the numbers summary() prints.
  const [, total, covered, drift] = summary(OV)
    .match(/^\d+ requirements, (\d+) ACs, (\d+) tested, (\d+) differ/)
    .map(Number)
  const of = small[0].replace(/,/g, '').match(/^(\d+) of (\d+)$/)
  assert.deepEqual(
    [Number(of[1]), Number(of[2]), Number(kvTexts(p)[2].replace(/,/g, ''))],
    [covered, total, drift]
  )
})

test('OV3: Overview — "Features" has a row per root with counted ACs, each followed by its children with counted ACs, in tree order', () => {
  const p = page(OV)
  const rows = areaRows(p)
  // Planned has no counted AC: no row. S4 F6: each root's children follow it
  // (Flights under Trips, Auth under People & access; Loyalty has none).
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Trips', 'Flights', 'People & access', 'Auth', 'Loyalty']
  )
  // The name links to the branch.
  assert.deepEqual(
    rows.map((r) => decodeURIComponent(r.a.getAttribute('href'))),
    [
      '#/Trips',
      '#/Trips/Flights',
      '#/People & access',
      '#/People & access/Auth',
      '#/Loyalty',
    ]
  )
  const expected = [
    ['Trips', 27, '403/1505 ACs', '≠3'],
    ['Flights', 27, '403/1505 ACs', '≠3'],
    ['People & access', 70, '7/10 ACs', '≠1'],
    ['Auth', 70, '7/10 ACs', '≠1'],
    ['Loyalty', 90, '18/20 ACs', null],
  ]
  for (const [label, pct, acs, drift] of expected) {
    const r = rows.find((x) => x.label === label)
    assert.ok(r.text.includes(`${pct}%`), `${label}: ${r.text}`)
    assert.ok(r.text.includes(acs), `${label}: ${r.text}`)
    if (drift) assert.ok(r.text.includes(drift), `${label}: ${r.text}`)
    else assert.ok(!r.text.includes('≠'), `${label} has no drift: ${r.text}`)
    // A bar as long as the share.
    const bar = [...r.row.querySelectorAll('[style]')].find((el) =>
      new RegExp(`width:\\s*${pct}%`).test(el.getAttribute('style'))
    )
    assert.ok(bar, `${label} has a bar ${pct}% long`)
  }
  // The planned requirements are named under the card.
  const main = p.text()
  const sentence =
    '2 planned requirements: written from the documents, not built yet, not counted.'
  assert.ok(main.includes(sentence), main.slice(0, 400))
  assert.ok(main.indexOf(sentence) > main.indexOf('Features'))
})

test('OV4: Overview — a branch in "Features" opens that branch; Back returns to the Overview', async () => {
  const p = page(OV)
  const loyalty = areaRows(p).find((r) => r.label === 'Loyalty')
  assert.ok(loyalty, 'a Loyalty row')
  loyalty.a.click()
  await p.wait(20)
  assert.equal(decodeURI(p.dom.window.location.hash), '#/Loyalty')
  assert.equal(p.text('h1'), 'Loyalty')
  // The branch page is the one a link to it opens today.
  assert.equal(
    p.doc.querySelector('main').innerHTML,
    page(OV, at('Loyalty')).doc.querySelector('main').innerHTML
  )
  p.dom.window.history.back()
  await p.wait(20)
  assert.equal(p.text('h1'), 'Project overview')
  assert.deepEqual(p.errors, [])
})

test('OV5: Overview — #overview and an unknown node open the Overview; other hashes as before', () => {
  assert.equal(page(OV, '#overview').text('h1'), 'Project overview')
  const plan = page(OV, at('Trips'))
  assert.equal(plan.text('h1'), 'Trips')
  assert.deepEqual(kvTexts(plan), ['27%', '1,102', '3', '1,100'])
  assert.equal(page(OV, '#drift').text('h1'), 'ACs the code does differently')
  assert.equal(page(OV, '#tests').text('h1'), 'Tests')
  const unknown = page(OV, '#/Không-có-nút-này')
  assert.equal(unknown.text('h1'), 'Project overview')
  assert.deepEqual(unknown.errors, [])
})

test('OV6: Overview — the Tests card counts the tests and links to the Tests view', async () => {
  const p = page(OV)
  const c = ovCard(p, 'Tests')
  assert.ok(c, 'the Overview has a "Tests" card')
  const text = c.textContent.replace(/\s+/g, ' ')
  assert.ok(text.includes('1,582 tests'), text)
  assert.ok(text.includes('1,151 name no requirement'), text)
  const link = c.querySelector('a[href="#tests"]')
  assert.ok(link, 'a link to #tests')
  link.click()
  await p.wait(20)
  assert.equal(p.text('h1'), 'Tests')
})

test('OV7: Overview — with no requirement it says so, and "ACs with a test" is "—"', () => {
  const p = page(model({ reqs: [] }))
  const link = headerLink(p, 'Overview')
  assert.ok(link, 'an "Overview" link in the top bar')
  assert.equal(link.getAttribute('aria-current'), 'page')
  assert.equal(p.doc.getElementById('menu').textContent, '☰  Overview')
  const main = p.text()
  assert.ok(main.includes('No requirements yet'), main)
  assert.ok(
    main.includes(
      'Add a requirement file under docs/product/requirements/, then run npm run coverage:map.'
    ),
    main
  )
  assert.equal(kvTexts(p)[0], '—')
  assert.deepEqual(p.errors, [])
  // Requirements, but none counted (all planned): still "—", not 0%.
  const planned = page(treeModel({ 'assign.md': OV_FILES['assign.md'] }))
  assert.equal(planned.text('h1'), 'Project overview')
  assert.equal(kvTexts(planned)[0], '—')
})

test('OV8: Overview — typing in search shows the results instead, and Back returns', async () => {
  const p = page(OV)
  assert.equal(p.text('h1'), 'Project overview')
  const q = p.doc.getElementById('q')
  q.value = 'reward tiers'
  q.dispatchEvent(new p.dom.window.Event('input', { bubbles: true }))
  await p.wait(200)
  assert.equal(p.text('h1'), 'Search')
  assert.ok(p.text().includes('1 requirement matches'))
  assert.equal(ovCard(p, 'Features'), undefined)
  assert.equal(headerLink(p, 'Overview').getAttribute('aria-current'), null)
  assert.equal(p.doc.getElementById('menu').textContent, '☰  Search')
  p.dom.window.history.back()
  await p.wait(20)
  assert.equal(p.text('h1'), 'Project overview')
  assert.equal(q.value, '')
  assert.deepEqual(p.errors, [])
})

// ------------------------------------------------------------------ re-read card (RT1–RT7)
// renderHtml(model, { commit, reread }), with reread the result
// of codeLinesTouched() plus `since`, puts a first card on #drift listing the
// Code: lines to re-read; without reread the page is as before.
// rereadSummary(reread) is the line main() adds with --since.
//
// Fixture: REQ-AUTH-018 ex4 and REQ-USERS-028 ex3 are in the model, each with a
// Code line and so a Code drift card; REQ-AUTH-018 ex5 is removed;
// REQ-PROFILE-009 is in no file. REQ-AUTH-001 shares the Auth node, so opening
// that node does not open REQ-AUTH-018 by itself. REREAD has three entries:
// REQ-AUTH-018 ex4, REQ-PROFILE-009 ex7 (not in the model) and REQ-USERS-028
// ex3 (two files).

const RT_AUTH = `# AUTH requirements

Tree: People & access › Auth
Group by: none

## REQ-AUTH-001 · Signing in
Status: active
- ex1: the right username and password → the dashboard opens

## REQ-AUTH-018 · Changing one's own password
Status: active
- ex1: the current password is right and the new one valid → the password changes
- ex4: the new password equals the current one → "Choose a password you have not used"
  Code: the route answers 500 "Failed to update password" (src/app/api/auth/change-password/route.ts:29-101).
  Recommend: fix code — the user is not told what is wrong.
- ex5 (removed 2026-10-20: merged into ex4): an empty new password → refused
`
const RT_USERS = `# USERS requirements

Tree: People & access › Users
Group by: none

## REQ-USERS-028 · An admin resets a user's password
Status: active
- ex1: an admin resets a password → a temporary password is shown once
- ex3: the temporary password → cannot be guessed from the user's name
  Code: it is {username}@{year}, "maitt@2026" (src/app/api/users/[id]/reset-password/route.ts:151-154; src/lib/password.ts:104-107).
  Recommend: fix code — anyone who knows her name can sign in first.
`
const RT = treeModel({ 'auth.md': RT_AUTH, 'users.md': RT_USERS })
const REREAD = {
  since: 'origin/main',
  base: 'origin/main',
  head: null,
  entries: [
    {
      doc: 'auth.md',
      line: 14,
      req: 'REQ-AUTH-018',
      ex: 'ex4',
      text: 'Code: the route answers 500 "Failed to update password" (src/app/api/auth/change-password/route.ts:29-101).',
      files: [
        {
          file: 'src/app/api/auth/change-password/route.ts',
          ranges: [[29, 101]],
          changed: [
            [57, 58],
            [62, 62],
          ],
        },
      ],
    },
    {
      doc: 'profile.md',
      line: 180,
      req: 'REQ-PROFILE-009',
      ex: 'ex7',
      text: 'Code: the page shows only the toast "Failed to update password" (src/app/(dashboard)/dashboard/profile/password/page.tsx:31-45).',
      files: [
        {
          file: 'src/app/(dashboard)/dashboard/profile/password/page.tsx',
          ranges: [[31, 45]],
          changed: [[40, 41]],
        },
      ],
    },
    {
      doc: 'users.md',
      line: 10,
      req: 'REQ-USERS-028',
      ex: 'ex3',
      text: 'Code: it is {username}@{year}, "maitt@2026" (src/app/api/users/[id]/reset-password/route.ts:151-154; src/lib/password.ts:104-107).',
      files: [
        {
          file: 'src/app/api/users/[id]/reset-password/route.ts',
          ranges: [[151, 154]],
          changed: [[150, 152]],
        },
        {
          file: 'src/lib/password.ts',
          ranges: [[104, 107]],
          changed: [[101, 108]],
        },
      ],
    },
  ],
  unnumbered: 0,
}

const flat = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const headingOf = (card) => flat(card?.querySelector('h2, h3, h4'))
/** The first card of the right pane (a section or .card), Data problems aside. */
const firstCard = (p) =>
  [...p.doc.querySelectorAll('#detail section, #detail .card')].find(
    (s) => !s.classList.contains('problems')
  ) ?? null
/** The re-read card: it must be the first card of #drift. */
function rereadCard(p, since = 'origin/main') {
  const card = firstCard(p)
  const want = `Re-read after this change (since ${since})`
  assert.ok(
    card && headingOf(card).startsWith(want),
    `the first card in #drift is headed "${want}…"; it is ${card ? `"${headingOf(card)}"` : 'not there'}`
  )
  return card
}
/** The innermost element of `root` whose text holds every needle. */
function innermost(root, needles) {
  const holds = [root, ...root.querySelectorAll('*')].filter((el) =>
    needles.every((n) => flat(el).includes(n))
  )
  return (
    holds.find((el) => !holds.some((o) => o !== el && el.contains(o))) ?? null
  )
}
const sentence = (e) => e.text.replace(/^Code:\s*/, '')
/** One entry of the card: the innermost element holding its ID and its Code: sentence. */
function entryEl(card, e, all = REREAD.entries) {
  const el = innermost(card, [e.req, sentence(e)])
  assert.ok(el, `the card lists ${e.req} ${e.ex} with its Code: sentence`)
  for (const other of all)
    if (other.req !== e.req)
      assert.ok(
        !flat(el).includes(other.req),
        `${e.req} ${e.ex} is an entry of its own: ${flat(el)}`
      )
  return el
}
/** Links in `el` whose text holds the requirement ID. */
const idLinks = (el, req) =>
  [...el.querySelectorAll('a, [data-go]')].filter((a) => flat(a).includes(req))
/** Where a click leaves the page: address, title, marked ACs, open requirements. */
const landing = (p) => ({
  hash: p.dom.window.location.hash,
  h1: p.text('h1'),
  hit: [...p.doc.querySelectorAll('li.ac.hit')].map((li) => li.id),
  open: [...p.doc.querySelectorAll('details.req[open]')].map((d) =>
    d.getAttribute('data-req')
  ),
})

test('RT1: with reread, the first card of Code drift lists each entry: ID and example, doc file, code files, Code: sentence', () => {
  assert.deepEqual(RT.problems, [])
  const p = page(RT, '#drift', { reread: REREAD })
  assert.equal(p.text('h1'), 'ACs the code does differently')
  const card = rereadCard(p)
  for (const e of REREAD.entries) {
    const el = entryEl(card, e)
    // Once the Code: sentence is taken out, the rest still names everything else.
    const rest = flat(el).replace(sentence(e), ' ')
    assert.ok(rest.includes(e.ex), `${e.req}: example ${e.ex} shown: ${rest}`)
    assert.ok(
      rest.includes(e.doc),
      `${e.req}: doc file ${e.doc} shown: ${rest}`
    )
    for (const { file } of e.files) {
      const name = file.slice(file.lastIndexOf('/') + 1)
      const listed =
        rest.includes(file) ||
        (rest.includes(name) &&
          [...el.querySelectorAll('[title]')].some((t) =>
            t.getAttribute('title').includes(file)
          ))
      assert.ok(listed, `${e.req}: code file ${file} listed: ${rest}`)
    }
  }
  // The Code drift groups are still there, after the card.
  assert.ok(
    p
      .text()
      .includes('Recommend fixing the code — keep the AC, change the code (2)'),
    p.text()
  )
  assert.deepEqual(p.errors, [])
})

test('RT2: an entry whose AC is in the model links to it and opens it as its Code drift card does', () => {
  // S4 F6: Auth and Users are leaf features, so every card there is open:
  // Auth has REQ-AUTH-001 beside REQ-AUTH-018.
  for (const [e, h1, hash, open] of [
    [
      REREAD.entries[0],
      'Auth',
      '#/People%20%26%20access/Auth',
      ['REQ-AUTH-001', 'REQ-AUTH-018'],
    ],
    [
      REREAD.entries[2],
      'Users',
      '#/People%20%26%20access/Users',
      ['REQ-USERS-028'],
    ],
  ]) {
    const ref = `${e.req} ${e.ex}`
    // The Code drift card for the same AC, on the page without reread.
    const before = page(RT, '#drift')
    const dcard = [...before.doc.querySelectorAll('.dcard')].find((c) =>
      flat(c).includes(ref)
    )
    assert.ok(dcard, `a Code drift card for ${ref}`)
    dcard.querySelector('a').click()
    const expected = landing(before)
    assert.deepEqual(expected, {
      hash,
      h1,
      hit: [`${e.req}-${e.ex}`],
      open,
    })
    const p = page(RT, '#drift', { reread: REREAD })
    const links = idLinks(entryEl(rereadCard(p), e), e.req)
    assert.equal(links.length, 1, `${ref}: its ID is one link`)
    links[0].click()
    assert.deepEqual(landing(p), expected, ref)
    assert.deepEqual(p.errors, [])
  }
})

test('RT3: an entry whose AC is not in the current documents is listed, its ID not a link', () => {
  const gone = [
    // No requirement file has it.
    REREAD.entries[1],
    // The requirement is there, the example was removed since.
    {
      doc: 'auth.md',
      line: 16,
      req: 'REQ-AUTH-018',
      ex: 'ex5',
      text: 'Code: an empty password reaches Supabase (src/app/api/auth/change-password/route.ts:40-44).',
      files: [
        {
          file: 'src/app/api/auth/change-password/route.ts',
          ranges: [[40, 44]],
          changed: [[41, 41]],
        },
      ],
    },
  ]
  const p = page(RT, '#drift', { reread: { ...REREAD, entries: gone } })
  const card = rereadCard(p)
  for (const e of gone) {
    const el = entryEl(card, e, gone)
    assert.ok(flat(el).includes(e.ex), `${e.req} ${e.ex} shown`)
    assert.deepEqual(
      idLinks(el, e.req).map((a) => a.outerHTML),
      [],
      `${e.req} ${e.ex} is not a link`
    )
  }
  assert.deepEqual(p.errors, [])
})

// The #drift pane for RT as the page drew it before the re-read card existed
// (captured on commit 65e502c). "Không có --since → trang ... như hôm nay".
const RT_DRIFT_BEFORE =
  '<h1>ACs the code does differently</h1>' +
  '<p class="lead">The code does something other than the AC. The recommendations are Claude’s; the product owner decides.</p>' +
  '<section class="dgroup"><h3><span class="rec rec-code"><i></i></span>Recommend fixing the code — keep the AC, change the code <span class="muted">(2)</span></h3>' +
  '<ul class="dlist">' +
  '<li class="dcard"><div class="ac-top"><a href="#/People%20%26%20access/Auth" data-go="People &amp; access/Auth" class="mono" data-open="REQ-AUTH-018" data-ac="REQ-AUTH-018-ex4">REQ-AUTH-018 ex4</a>' +
  '<span class="chip">No stage</span><span class="st-label st-label-no">no test</span><span class="muted dpath">People &amp; access › Auth</span></div>' +
  '<p class="ac-text">the new password equals the current one → "Choose a password you have not used"</p>' +
  '<div class="callout"><p><span class="k">Code does</span><span>the route answers 500 "Failed to update password" (src/app/api/auth/change-password/route.ts:29-101).</span></p><p><span class="k">Why</span><span>the user is not told what is wrong.</span></p></div></li>' +
  '<li class="dcard"><div class="ac-top"><a href="#/People%20%26%20access/Users" data-go="People &amp; access/Users" class="mono" data-open="REQ-USERS-028" data-ac="REQ-USERS-028-ex3">REQ-USERS-028 ex3</a>' +
  '<span class="chip">No stage</span><span class="st-label st-label-no">no test</span><span class="muted dpath">People &amp; access › Users</span></div>' +
  '<p class="ac-text">the temporary password → cannot be guessed from the user\'s name</p>' +
  '<div class="callout"><p><span class="k">Code does</span><span>it is {username}@{year}, "maitt@2026" (src/app/api/users/[id]/reset-password/route.ts:151-154; src/lib/password.ts:104-107).</span></p><p><span class="k">Why</span><span>anyone who knows her name can sign in first.</span></p></div></li></ul></section>'

test('RT4: without reread, Code drift has no re-read card and is what it was before', () => {
  const p = page(RT, '#drift')
  const detail = p.doc.getElementById('detail')
  assert.ok(!flat(detail).includes('Re-read'), flat(detail))
  assert.equal(detail.innerHTML, RT_DRIFT_BEFORE)
  // main() handing on an unset reread is the same as passing none.
  assert.equal(
    renderHtml(RT, { commit: 'abc1234', reread: undefined }),
    renderHtml(RT, { commit: 'abc1234' })
  )
  assert.deepEqual(p.errors, [])
})

test('RT5: rereadSummary counts the entries and names the revision given to --since', () => {
  assert.equal(
    typeof coverageMap.rereadSummary,
    'function',
    'coverage-map.mjs exports rereadSummary'
  )
  assert.equal(
    coverageMap.rereadSummary(REREAD),
    '3 Code: lines to re-read since origin/main'
  )
  // `since` is what the user typed, whatever base it stands for.
  assert.equal(
    coverageMap.rereadSummary({
      ...REREAD,
      since: 'HEAD~2',
      base: 'a3bf095',
      entries: [],
    }),
    '0 Code: lines to re-read since HEAD~2'
  )
})


test('RT7: the card comes first on Code drift even when no AC differs from the code any more', () => {
  // The change also fixed the document: no Code line is left, the AC still is.
  const fixed = treeModel({
    'auth.md': RT_AUTH.replace(/\n {2}(Code|Recommend):[^\n]*/g, ''),
  })
  assert.deepEqual(fixed.drift, [])
  const p = page(fixed, '#drift', {
    reread: { ...REREAD, entries: [REREAD.entries[0]] },
  })
  const el = entryEl(rereadCard(p), REREAD.entries[0])
  assert.equal(
    idLinks(el, 'REQ-AUTH-018').length,
    1,
    'REQ-AUTH-018 ex4 is a link'
  )
  assert.deepEqual(p.errors, [])
})

// ------------------------------------------------------------------ config (C2–C19)
// Sample data after the design's Bookstore project
// (docs/coverage/GENERIC-COVERAGE-DESIGN.html). C1 (the page as on
// origin/main) is the differential script next to the spec, compare.mjs; C4 is
// the old tests above, run with the travel config. Scripts are read and copied
// from SOURCE (a project's root or the kit's files/), so they run in both places.

/** An export the spec's Interface names; a missing one fails with its name. */
function need(name) {
  assert.equal(
    typeof coverageMap[name],
    'function',
    `coverage-map.mjs exports ${name}`
  )
  return coverageMap[name]
}

/** A model from requirement files by name, test files by path, and a config as JSON.parse gives it. */
function bookModel(files, tests = {}, raw = {}) {
  return buildModel({
    requirementFiles: Object.entries(files).map(([name, text]) => ({
      path: `docs/product/requirements/${name}`,
      text,
    })),
    testFiles: Object.entries(tests).map(([path, text]) => ({ path, text })),
    config: need('resolveConfig')(raw),
  })
}
/** A requirement with `n` ACs; `under[i]` is added under AC i. */
const section = (id, tags, n, under = {}) =>
  `## ${id} · ${id.toLowerCase()}\nStatus: active\n${tags ? `Tags: ${tags}\n` : ''}` +
  range(1, n)
    .map((i) => `- ex${i}: case ${i} → result ${i}${under[i] ?? ''}`)
    .join('\n') +
  '\n'
const reqFile = (head, ...sections) =>
  `# CHECKOUT requirements\n\n${head}\n\n${sections.join('\n')}`
const itFor = (id, exs) =>
  exs.map((i) => `it('${id} ex${i}: t${i}', () => {})`).join('\n')

const COUPONS = 'src/lib/pricing/coupons.test.ts'
const COUPONS_TEST =
  "it('REQ-CHECKOUT-012 ex1: 10% + 5% on 100,000 → 85,500', () => {})\n"
const CHECKOUT_MD =
  '# CHECKOUT requirements\n\n## REQ-CHECKOUT-012 · Coupons stack\nStatus: active\n- ex1: 10% + 5% on 100,000 → 85,500\n'
const PRIORITY = {
  label: 'priority',
  plural: 'priorities',
  values: ['must', 'should', 'could'],
  labels: { must: 'Must', should: 'Should', could: 'Could' },
  rowNoun: ['feature', 'features'],
}
const BY_PRIORITY = { groups: { priority: PRIORITY } }
const C8_FILES = {
  'checkout.md': reqFile(
    'Tree: Checkout\nGroup by: priority',
    section('REQ-CHECKOUT-012', 'priority=must', 3),
    section('REQ-CHECKOUT-013', 'priority=should', 2)
  ),
}
const C8_TESTS = {
  [COUPONS]: `${itFor('REQ-CHECKOUT-012', [1, 2])}\n${itFor('REQ-CHECKOUT-013', [1, 2])}`,
}

/** A card of the right pane, by its exact heading. */
const cardHeaded = (p, title) =>
  [...p.doc.querySelectorAll('main section')].find(
    (s) => headingOf(s) === title
  )
/** A card's table: its column headings, and each body row as its cells. */
function table(card) {
  const t = card.querySelector('table')
  assert.ok(t, `"${headingOf(card)}" has a table`)
  return {
    head: [...t.querySelectorAll('thead th')].map(flat),
    rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children]),
  }
}
/** Every property the stylesheet sets on `el`, as jsdom computes it. */
function look(p, el) {
  const cs = p.dom.window.getComputedStyle(el)
  const out = []
  for (let i = 0; i < cs.length; i++)
    out.push(`${cs.item(i)}: ${cs.getPropertyValue(cs.item(i))}`)
  return out.sort().join('; ')
}

/** A written page in jsdom, as page() opens a rendered one. */
function openHtml(html, hash = '') {
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => {
    if (!/Not implemented/.test(e.message)) errors.push(e.message)
  })
  const dom = new JSDOM(html, {
    url: `https://coverage.test/${hash}`,
    runScripts: 'dangerously',
    virtualConsole: vc,
  })
  const doc = dom.window.document
  return {
    dom,
    doc,
    errors,
    text: (sel = 'main') =>
      (doc.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' '),
  }
}

/**
 * A throwaway repository: the coverage-map script (and, unless `touched` is
 * false, code-lines-touched.mjs where SOURCE has it) copied in from SOURCE,
 * and `files` written. The node_modules this file resolves typescript from is
 * linked one folder above it (the script imports typescript), so a scan of
 * the whole repository does not walk it.
 */
function tempRepo(files = {}, { touched = true, modules = true } = {}) {
  const outer = mkdtempSync(join(tmpdir(), 'coverage-map-'))
  // `modules: false`: no node_modules linked, for a repository without typescript.
  if (modules) symlinkSync(NODE_MODULES, join(outer, 'node_modules'), 'dir')
  const dir = join(outer, 'repo')
  const copy = (rel) =>
    cpSync(join(SOURCE, rel), join(dir, rel), { recursive: true })
  copy('scripts/coverage-map.mjs')
  copy('scripts/coverage-map')
  copy('scripts/trace-check.mjs')
  if (touched && HAS_TOUCHED) copy('scripts/code-lines-touched.mjs')
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  for (const [rel, text] of Object.entries(files)) write(rel, text)
  return {
    dir,
    write,
    read: (rel) => readFileSync(join(dir, rel), 'utf8'),
    has: (rel) => existsSync(join(dir, rel)),
    run: (...args) =>
      spawnSync(process.execPath, ['scripts/coverage-map.mjs', ...args], {
        cwd: dir,
        encoding: 'utf8',
      }),
    done: () => rmSync(outer, { recursive: true, force: true }),
  }
}
const PAGE = 'docs/coverage/COVERAGE-MAP.html'

test('C2: the Tests view gives as its example the first AC with a test, in tree order', () => {
  const say = (ref) =>
    `A test is linked when its name, or a describe around it, names the AC: “${ref}”.`
  // File order puts Loyalty first, IDs put REQ-FLYB-010 first, label
  // order puts Hotels first; tree order puts Flights › Booking › Author first.
  const m = treeModel(
    {
      'a-loy.md': `# LOY requirements\n\nTree: Loyalty\nGroup by: none\n\n${section('REQ-LOY-001', '', 1)}`,
      'b-ketr.md': `# KETR requirements\n\nTree: Trips › Hotels › Booking\nGroup by: stage\n\n${section('REQ-KETR-001', 'stage=ticket', 1)}`,
      'c-flyb.md': `# FLYB requirements\n\nTree: Trips › Flights › Booking\nGroup by: stage\n\n${section('REQ-FLYB-010', 'stage=ticket', 1)}\n${section('REQ-FLYB-011', 'stage=author', 2)}`,
    },
    {
      [TICKETING]: [
        itFor('REQ-LOY-001', [1]),
        itFor('REQ-KETR-001', [1]),
        itFor('REQ-FLYB-010', [1]),
        itFor('REQ-FLYB-011', [2]),
      ].join('\n'),
    }
  )
  // The tree is the one the comment above describes.
  assert.deepEqual(m.tree.roots, ['Trips', 'Loyalty'])
  assert.deepEqual(node(m, 'Trips').children, [
    'Trips/Flights',
    'Trips/Hotels',
  ])
  assert.deepEqual(node(m, 'Trips/Flights/Booking').children, [
    'Trips/Flights/Booking/Author',
    'Trips/Flights/Booking/Ticketing',
  ])
  const text = page(m, '#tests').text()
  assert.ok(text.includes(say('REQ-FLYB-011 ex2')), text.slice(0, 400))
  // No AC has a test: the project kit's example.
  for (const none of [model(), model({ reqs: [] })]) {
    const t = page(none, '#tests').text()
    assert.ok(t.includes(say('REQ-CHECKOUT-012 ex1')), t.slice(0, 400))
  }
})

test('C3: the script, the page code and its stylesheet name nothing of the fixture', () => {
  const TRAVEL_WORDS =
    /Flights|stage|fare|variant|Trips|src\/__tests__|e2e/
  const files = [
    'scripts/coverage-map.mjs',
    'scripts/coverage-map/app.js',
    'scripts/coverage-map/style.css',
  ]
  // The one exception (C3, added in S3): the string reports/e2e.xml in the
  // `results` default of the script, the kit's file name convention. Only
  // that occurrence is set aside; any other e2e still counts.
  const RESULTS_DEFAULT = /(\bresults:\s*\[[^\]]*?)(['"`])reports\/e2e\.xml\2/
  const read = (f) => {
    const text = readFileSync(join(SOURCE, f), 'utf8')
    return f === 'scripts/coverage-map.mjs'
      ? text.replace(
          RESULTS_DEFAULT,
          (_, before, q) => `${before}${q}reports/(allowed).xml${q}`
        )
      : text
  }
  const hits = files.flatMap((f) =>
    read(f)
      .split('\n')
      .map((line, i) => [f, i + 1, line])
      .filter(([, , line]) => TRAVEL_WORDS.test(line))
      .map(([file, n, line]) => `${file}:${n}: ${line.trim()}`)
  )
  assert.equal(
    hits.length,
    0,
    `${hits.length} lines, first ones:\n${hits.slice(0, 10).join('\n')}`
  )
})

test('C5: with no config file, or an empty one, the defaults find the requirement and its unit test', () => {
  const resolveConfig = need('resolveConfig')
  const d = resolveConfig(undefined)
  assert.equal(d.project ?? null, null, 'no project')
  assert.equal(d.requirements, 'docs/product/requirements')
  assert.deepEqual(d.tests, ['**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}'])
  assert.deepEqual(
    [d.levels, d.order, d.last, d.breakdowns, d.tagRows],
    [[], [], [], [], []]
  )
  assert.deepEqual(Object.keys(d.groups), ['feature'])
  assert.equal(d.notes, 'docs/coverage/test-notes.json')
  assert.equal(d.output, 'docs/coverage/COVERAGE-MAP.html')
  const json = (x) => JSON.parse(JSON.stringify(x))
  assert.deepEqual(json(resolveConfig({})), json(d))

  const repo = tempRepo({
    'docs/product/requirements/checkout.md': CHECKOUT_MD,
    [COUPONS]: COUPONS_TEST,
    // Matches the default glob, but everything under node_modules is skipped.
    'node_modules/left-pad/index.test.js':
      "it('REQ-CHECKOUT-012 ex1: not ours', () => {})\n",
  })
  try {
    const run = repo.run()
    assert.equal(run.status, 0, run.stderr)
    assert.ok(repo.has(PAGE), `the page is written to ${PAGE}`)
    const html = repo.read(PAGE)
    const p = openHtml(html, '#/CHECKOUT')
    assert.deepEqual(
      [...p.doc.querySelectorAll('.tn .tl')].map(flat),
      ['CHECKOUT'],
      'one root node, CHECKOUT'
    )
    assert.equal(p.text('h1'), 'CHECKOUT')
    const right = p.doc
      .getElementById('REQ-CHECKOUT-012-ex1')
      .querySelector('.ac-r')
    assert.ok(!flat(right).includes('No test yet'), flat(right))
    assert.ok(flat(right).includes('10% + 5% on 100,000 → 85,500'))
    assert.deepEqual([...right.querySelectorAll('.lv')].map(flat), ['unit'])
    assert.ok(p.text('.tree').includes('1 test scanned'), p.text('.tree'))
    assert.deepEqual(p.errors, [])
    // `{}` is the same as no file.
    repo.write('coverage-map.config.json', '{}\n')
    const again = repo.run()
    assert.equal(again.status, 0, again.stderr)
    assert.equal(again.stdout, run.stdout)
    assert.equal(repo.read(PAGE), html)
  } finally {
    repo.done()
  }
})

test('C6: the tests globs pick the test files, never one under node_modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-map-'))
  const files = [
    'src/a.test.ts',
    'src/x/y/b.test.tsx',
    'src/c.spec.ts',
    'lib/d.test.ts',
    'src/node_modules/e.test.ts',
  ]
  try {
    for (const f of files) {
      mkdirSync(dirname(join(dir, f)), { recursive: true })
      writeFileSync(join(dir, f), `it('${f}', () => {})\n`)
    }
    mkdirSync(join(dir, 'docs/product/requirements'), { recursive: true })
    const config = need('resolveConfig')({ tests: ['src/**/*.test.{ts,tsx}'] })
    const { testFiles } = need('readInputs')(dir, config)
    assert.deepEqual(testFiles.map((f) => f.path).sort(), [
      'src/a.test.ts',
      'src/x/y/b.test.tsx',
    ])
    assert.equal(
      testFiles.find((f) => f.path === 'src/a.test.ts').text,
      "it('src/a.test.ts', () => {})\n"
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  // The glob rules: ** is zero or more folders, * stays in one part of the
  // path, ? is one character, {a,b} one of the choices.
  const matchGlob = need('matchGlob')
  for (const [pattern, path, want] of [
    ['src/**/*.test.{ts,tsx}', 'src/a.test.ts', true],
    ['src/**/*.test.{ts,tsx}', 'src/x/y/b.test.tsx', true],
    ['src/**/*.test.{ts,tsx}', 'src/c.spec.ts', false],
    ['src/**/*.test.{ts,tsx}', 'lib/d.test.ts', false],
    ['src/*.test.ts', 'src/x/a.test.ts', false],
    ['src/?.test.ts', 'src/a.test.ts', true],
    ['src/?.test.ts', 'src/ab.test.ts', false],
  ])
    assert.equal(matchGlob(pattern, path), want, `${pattern} on ${path}`)
})

test('C7: levels come from the config: first match wins, no match is unit, list order under an AC, the first level stands out', () => {
  const E2E = 'e2e/checkout.spec.ts'
  const API = 'src/app/api/coupons/route.test.ts'
  const levels = [
    { match: 'e2e/**', level: 'e2e' },
    { match: 'src/app/api/**', level: 'api' },
  ]
  assert.deepEqual(
    [E2E, API, COUPONS].map((p) => levelOf(p, levels)),
    ['e2e', 'api', 'unit']
  )
  // How e2e looks on the travel page today, next to a plain level.
  const fx = page(
    model({
      tests: {
        [TICKETING]: `it('REQ-FLYB-004 ex1: unit', () => {})`,
        'e2e/tests/booking-flex.spec.ts': `test('REQ-FLYB-004 ex1: browser', async () => {})`,
      },
    }),
    at(TICKET_NODE)
  )
  const [fxE2e, fxUnit] = fx.ac('REQ-FLYB-004-ex1').querySelectorAll('.lv')
  assert.deepEqual([fxE2e, fxUnit].map(flat), ['e2e', 'unit'])
  const standsOut = look(fx, fxE2e)
  const plain = look(fx, fxUnit)
  assert.notEqual(standsOut, plain, 'e2e stands out on the travel page')
  assert.ok(standsOut.includes('var(--primary-tint)'), standsOut)

  const files = {
    'checkout.md': reqFile(
      'Tree: Checkout',
      section('REQ-CHECKOUT-012', '', 1)
    ),
  }
  const tests = {
    [E2E]: "test('REQ-CHECKOUT-012 ex1: in the browser', async () => {})",
    [API]: "it('REQ-CHECKOUT-012 ex1: through the API', () => {})",
    [COUPONS]: COUPONS_TEST,
  }
  const badges = (raw) => {
    const p = page(bookModel(files, tests, raw), at('Checkout'))
    const lv = [...p.ac('REQ-CHECKOUT-012-ex1').querySelectorAll('.ac-r .lv')]
    return lv.map((el) => [flat(el), look(p, el)])
  }
  assert.deepEqual(badges({ levels }), [
    ['e2e', standsOut],
    ['api', plain],
    ['unit', plain],
  ])
  // The list's order, not the paths': api first, and it is the one that stands out.
  assert.deepEqual(badges({ levels: [levels[1], levels[0]] }), [
    ['api', standsOut],
    ['e2e', plain],
    ['unit', plain],
  ])
})

test('C8: a group with values makes ordered nodes and a heatmap column per value reached', () => {
  const m = bookModel(C8_FILES, C8_TESTS, BY_PRIORITY)
  assert.deepEqual(node(m, 'Checkout').children, [
    'Checkout/Must',
    'Checkout/Should',
  ])
  const p = page(m, at('Checkout'))
  const card = cardHeaded(p, 'Coverage by priority')
  assert.ok(card, 'a "Coverage by priority" card')
  assert.ok(
    flat(card).includes('1 feature · click a cell to open it'),
    flat(card)
  )
  const { head, rows } = table(card)
  assert.deepEqual(head.filter(Boolean), ['All priorities', 'Must', 'Should'])
  assert.equal(rows.length, 1)
  const [row] = rows
  assert.ok(flat(row[head.indexOf('Must')]).startsWith('67%'))
  assert.ok(flat(row[head.indexOf('Should')]).startsWith('100%'))
  row[head.indexOf('Must')].querySelector('button, a, [data-go]').click()
  assert.equal(decodeURI(p.dom.window.location.hash), '#/Checkout/Must')
  assert.equal(p.text('h1'), 'Must')
  assert.deepEqual(p.errors, [])
  // The values' order, not the alphabet's.
  const could = bookModel(
    {
      'checkout.md': C8_FILES['checkout.md'].replace(
        '\n## REQ-CHECKOUT-013',
        `\n${section('REQ-CHECKOUT-014', 'priority=could', 1)}\n## REQ-CHECKOUT-013`
      ),
    },
    {},
    BY_PRIORITY
  )
  assert.deepEqual(node(could, 'Checkout').children, [
    'Checkout/Must',
    'Checkout/Should',
    'Checkout/Could',
  ])
})

test('C9: in a file grouped by a group with values, a requirement with another value is a data problem', () => {
  const m = bookModel(
    {
      'checkout.md':
        C8_FILES['checkout.md'] +
        `\n${section('REQ-CHECKOUT-014', 'priority=urgent', 1)}`,
    },
    {},
    BY_PRIORITY
  )
  const problem =
    'REQ-CHECKOUT-014 has no priority (must, should or could) but its file groups by priority'
  assert.ok(m.problems.includes(problem), m.problems.join('\n'))
  assert.deepEqual(node(m, 'Checkout').reqIds, ['REQ-CHECKOUT-014'])
  const box = page(m, at('Checkout')).doc.querySelector('.problems')
  assert.ok(box && flat(box).includes('Data problems'))
  assert.ok(flat(box).includes(problem), flat(box))
})

test('C10: a Group by naming no group is a data problem listing the groups, and groups as none', () => {
  const m = bookModel(
    {
      'checkout.md': C8_FILES['checkout.md'].replace(
        'Group by: priority',
        'Group by: colour'
      ),
    },
    {},
    BY_PRIORITY
  )
  const problem =
    'docs/product/requirements/checkout.md: Group by must be priority or none'
  assert.ok(m.problems.includes(problem), m.problems.join('\n'))
  const box = page(m, at('Checkout')).doc.querySelector('.problems')
  assert.ok(box && flat(box).includes(problem), flat(box))
  assert.deepEqual(node(m, 'Checkout').reqIds, [
    'REQ-CHECKOUT-012',
    'REQ-CHECKOUT-013',
  ])
  assert.deepEqual(node(m, 'Checkout').children, [])
  // Two groups, stage and feature: the sentence of today.
  const fx = bookModel(
    {
      'checkout.md': C8_FILES['checkout.md'].replace(
        'Group by: priority',
        'Group by: colour'
      ),
    },
    {},
    TRAVEL_RAW
  )
  assert.ok(
    fx.problems.includes(
      'docs/product/requirements/checkout.md: Group by must be stage, feature or none'
    ),
    fx.problems.join('\n')
  )
})

test('C11: a breakdown makes a card with a row per value of its tag and a column per group value', () => {
  const m = bookModel(
    {
      'checkout.md': reqFile(
        'Tree: Checkout\nGroup by: priority',
        section('REQ-CHECKOUT-012', 'priority=must platform=web,ios', 3),
        section('REQ-CHECKOUT-013', 'priority=should', 2)
      ),
    },
    C8_TESTS,
    {
      ...BY_PRIORITY,
      breakdowns: [
        {
          rows: 'platform',
          columns: 'priority',
          title: 'By platform',
          noun: ['platform', 'platforms'],
        },
      ],
    }
  )
  const p = page(m, at('Checkout'))
  const card = cardHeaded(p, 'By platform')
  assert.ok(card, 'a "By platform" card')
  assert.ok(flat(card).includes('2 platforms in this branch'), flat(card))
  const { head, rows } = table(card)
  assert.deepEqual(
    rows.map((r) => flat(r[0])),
    ['ios', 'web']
  )
  const must = head.indexOf('Must')
  assert.ok(must > 0, `a Must column: ${head}`)
  for (const r of rows)
    assert.ok(
      flat(r[must]).startsWith('67%'),
      `${flat(r[0])}: ${flat(r[must])}`
    )
  assert.deepEqual(p.errors, [])
})

test('C12: a tag row shows the tag values on the requirement card, and only where the tag is', () => {
  const m = bookModel(
    {
      'checkout.md': reqFile(
        'Tree: Checkout\nGroup by: none',
        section('REQ-CHECKOUT-012', 'platform=web,ios', 1),
        section('REQ-CHECKOUT-013', '', 1)
      ),
    },
    {},
    { tagRows: [{ label: 'Platform', tags: ['platform'] }] }
  )
  const p = page(m, at('Checkout'))
  const card = (id) => p.doc.querySelector(`details.req[data-req="${id}"]`)
  const line = [...card('REQ-CHECKOUT-012').querySelectorAll('*')].find((el) =>
    /^Platform\s*web · ios$/.test(flat(el))
  )
  assert.ok(line, flat(card('REQ-CHECKOUT-012')))
  assert.ok(!flat(card('REQ-CHECKOUT-013')).includes('Platform'))
})

test('C13: a Code drift card carries the label of the first group with values; none without such a group', () => {
  // Travel: the stage, or "No stage".
  const fx = page(model({ reqs: [DRIFT] }), '#drift')
  assert.equal(flat(fx.doc.querySelector('.dcard .chip')), 'Ticketing')
  assert.deepEqual(
    [...page(RT, '#drift').doc.querySelectorAll('.dcard .chip')].map(flat),
    ['No stage', 'No stage']
  )
  const DIFFERS =
    '\n  Code: the second coupon is ignored.\n  Recommend: fix code — both coupons apply.'
  const files = {
    'checkout.md': reqFile(
      'Tree: Checkout\nGroup by: priority',
      section('REQ-CHECKOUT-012', 'priority=must team=web', 2, { 2: DIFFERS })
    ),
    'returns.md': `# RETURNS requirements\n\nTree: Returns\nGroup by: none\n\n${section('REQ-RETURNS-001', '', 1, { 1: DIFFERS })}`,
  }
  const chips = (raw) => {
    const cards = [
      ...page(bookModel(files, {}, raw), '#drift').doc.querySelectorAll(
        '.dcard'
      ),
    ]
    assert.deepEqual(
      cards.map((c) => flat(c.querySelector('a'))),
      ['REQ-CHECKOUT-012 ex2', 'REQ-RETURNS-001 ex1']
    )
    return cards.map((c) => {
      const chip = c.querySelector('.chip')
      return chip ? flat(chip) : null
    })
  }
  assert.deepEqual(chips(BY_PRIORITY), ['Must', 'No priority'])
  const TEAM = {
    label: 'team',
    plural: 'teams',
    values: ['web', 'app'],
    labels: { web: 'Web', app: 'App' },
    rowNoun: ['area', 'areas'],
  }
  assert.deepEqual(chips({ groups: { team: TEAM, priority: PRIORITY } }), [
    'Web',
    'No team',
  ])
  assert.deepEqual(chips({ groups: { feature: {}, priority: PRIORITY } }), [
    'Must',
    'No priority',
  ])
  // No group has values: no chip.
  assert.deepEqual(chips({}), [null, null])
})

test('C14: a project name follows "Coverage map" in the top bar; without one the bar is as today', () => {
  const files = {
    'checkout.md': reqFile(
      'Tree: Checkout',
      section('REQ-CHECKOUT-012', '', 1)
    ),
  }
  const named = page(bookModel(files, {}, { project: 'Bookstore' }))
  const bar = flat(named.doc.querySelector('header'))
  assert.match(bar, /Coverage map\s*Bookstore/, bar)
  // Today's brand: the mark, the name, the commit.
  const TODAY =
    '<span class="mark">AC</span><b>Coverage map</b><span class="muted">commit abc1234</span>'
  for (const m of [model(), bookModel(files)]) {
    const p = page(m)
    assert.equal(p.doc.querySelector('header .brand').innerHTML, TODAY)
  }
})

/** Runs the script on a broken config: exit 2, `want` on stderr, the old page kept. */
function refuses(configText, want) {
  const OLD = '<!doctype html><p>the page before this run</p>\n'
  const repo = tempRepo({
    'docs/product/requirements/checkout.md': CHECKOUT_MD,
    [COUPONS]: COUPONS_TEST,
    [PAGE]: OLD,
    'coverage-map.config.json': configText,
  })
  try {
    const run = repo.run()
    assert.equal(run.status, 2, `exit code; stderr: ${run.stderr}`)
    assert.ok(run.stderr.includes(want), `stderr has ${want}: ${run.stderr}`)
    assert.equal(repo.read(PAGE), OLD, 'the old page is left as it was')
  } finally {
    repo.done()
  }
}

test('C15: a config that is not JSON stops the script with the parse error', () => {
  const text = '{ "tests": ["src/**/*.test.ts"], }\n'
  let message = null
  try {
    JSON.parse(text)
  } catch (err) {
    message = err.message
  }
  assert.ok(message, 'the fixture is not JSON')
  refuses(text, `coverage-map.config.json: ${message}`)
})

test('C16: an unknown key in the config stops the script', () => {
  const want = 'coverage-map.config.json: unknown key "test"'
  const resolveConfig = need('resolveConfig')
  assert.throws(() => resolveConfig({ test: ['src/**/*.test.ts'] }), {
    message: want,
  })
  refuses('{ "test": ["src/**/*.test.ts"] }\n', want)
})

test('C17: a key of the wrong kind stops the script', () => {
  const cases = [
    [
      { tests: 'src/**' },
      'coverage-map.config.json: tests must be a list of patterns',
    ],
    [
      { levels: [{ match: 'e2e/**' }] },
      'coverage-map.config.json: levels[0] needs match and level',
    ],
  ]
  const resolveConfig = need('resolveConfig')
  for (const [raw, want] of cases) {
    assert.throws(() => resolveConfig(raw), { message: want })
    refuses(`${JSON.stringify(raw)}\n`, want)
  }
})

test('C18: a tests glob that matches no file still writes the page, with 0 tests scanned', () => {
  // A test file sits where the travel config's folders are; the config looks elsewhere.
  const repo = tempRepo({
    'docs/product/requirements/checkout.md': CHECKOUT_MD,
    'src/__tests__/unit/coupons.test.ts': COUPONS_TEST,
    'coverage-map.config.json': '{ "tests": ["test/**/*.test.ts"] }\n',
  })
  try {
    const run = repo.run()
    assert.equal(run.status, 0, run.stderr)
    assert.ok(run.stdout.includes('0 tests scanned'), run.stdout)
    const p = openHtml(repo.read(PAGE))
    assert.ok(p.text('.tree').includes('0 tests scanned'), p.text('.tree'))
    assert.deepEqual(p.errors, [])
  } finally {
    repo.done()
  }
})

test('C19: --since needs scripts/code-lines-touched.mjs; without --since the script runs without it', (t) => {
  const files = {
    'docs/product/requirements/checkout.md': CHECKOUT_MD,
    [COUPONS]: COUPONS_TEST,
  }
  const bare = tempRepo(files, { touched: false })
  try {
    const since = bare.run('--since', 'origin/main')
    assert.equal(since.status, 1, `exit code; stderr: ${since.stderr}`)
    const out = `${since.stderr}${since.stdout}`
    assert.ok(
      out.includes(
        '--since needs scripts/code-lines-touched.mjs, which this repository does not have'
      ),
      out
    )
    const plain = bare.run()
    assert.equal(plain.status, 0, plain.stderr)
    assert.ok(bare.has(PAGE), 'the page is written')
  } finally {
    bare.done()
  }
  // With the file, --since reads the change as before (a project with that script; the kit has none).
  if (!HAS_TOUCHED) {
    t.diagnostic(
      'no scripts/code-lines-touched.mjs here: --since with it not run'
    )
    return
  }
  const full = tempRepo(files)
  try {
    const git = (...args) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@example.com',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: full.dir, stdio: 'pipe' }
      )
    git('init', '-q')
    git('add', '-A')
    git('commit', '-qm', 'base')
    const run = full.run('--since', 'HEAD')
    assert.equal(run.status, 0, run.stderr)
    assert.ok(
      run.stdout.includes('0 Code: lines to re-read since HEAD'),
      run.stdout
    )
  } finally {
    full.done()
  }
})

// ------------------------------------------------------------------ config, second pass
// Claims of the spec a mutation check (70 injected bugs) found no test failing
// on: the glob `?`, a file two patterns match (C6's sentence added 03/11), a
// group's label against its tag, the values' order in columns, a breakdown's
// noun and detail, a tag row of two tags.

test('C6b: glob ? is exactly one character, never none', () => {
  const matchGlob = need('matchGlob')
  assert.equal(matchGlob('src/?.test.ts', 'src/a.test.ts'), true)
  assert.equal(matchGlob('src/?.test.ts', 'src/.test.ts'), false)
})

test('C6c: a file two patterns match is scanned once and its tests counted once', () => {
  const resolveConfig = need('resolveConfig')
  const readInputs = need('readInputs')
  const dir = mkdtempSync(join(tmpdir(), 'coverage-map-'))
  try {
    for (const [rel, text] of [
      ['docs/product/requirements/checkout.md', CHECKOUT_MD],
      ['src/lib/x.test.ts', "it('REQ-CHECKOUT-012 ex1: t', () => {})\n"],
    ]) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    const config = resolveConfig({
      tests: ['src/**/*.test.ts', 'src/lib/**/*.test.ts'],
    })
    const inputs = readInputs(dir, config)
    assert.deepEqual(
      inputs.testFiles.map((f) => f.path),
      ['src/lib/x.test.ts']
    )
    const m = buildModel({ ...inputs, config })
    assert.equal(m.testCount, 1)
    assert.equal(ex(m, 'REQ-CHECKOUT-012', 'ex1').tests.length, 1)
    assert.ok(page(m).text('.tree').includes('1 test scanned'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('C8c: the page names a group by its label and plural, not by its tag', () => {
  // Tag `prio`, label "priority": a page showing the tag would say "prio".
  const PRIO = {
    prio: {
      label: 'priority',
      plural: 'priorities',
      values: ['must', 'should', 'could'],
      labels: { must: 'Must', should: 'Should', could: 'Could' },
      rowNoun: ['feature', 'features'],
    },
  }
  const DIFFERS =
    '\n  Code: the second coupon is ignored.\n  Recommend: fix code — both coupons apply.'
  const m = bookModel(
    {
      'checkout.md': reqFile(
        'Tree: Checkout\nGroup by: prio',
        section('REQ-CHECKOUT-012', 'prio=must', 3, { 3: DIFFERS }),
        section('REQ-CHECKOUT-013', 'prio=should', 2),
        section('REQ-CHECKOUT-014', 'prio=urgent', 1)
      ),
      'returns.md': `# RETURNS requirements\n\nTree: Returns\nGroup by: none\n\n${section('REQ-RETURNS-001', '', 1, { 1: DIFFERS })}`,
    },
    C8_TESTS,
    { groups: PRIO }
  )
  assert.deepEqual(node(m, 'Checkout').children, [
    'Checkout/Must',
    'Checkout/Should',
  ])
  const p = page(m, at('Checkout'))
  const card = cardHeaded(p, 'Coverage by priority')
  assert.ok(
    card,
    `a "Coverage by priority" card: ${[...p.doc.querySelectorAll('main section')].map(headingOf)}`
  )
  assert.deepEqual(table(card).head.filter(Boolean), [
    'All priorities',
    'Must',
    'Should',
  ])
  // C9's sentence names the group by its label.
  assert.ok(
    m.problems.some((x) =>
      x.startsWith(
        'REQ-CHECKOUT-014 has no priority (must, should or could) but its file groups by '
      )
    ),
    m.problems.join('\n')
  )
  // C13: a drift card with no such tag says "No <label>".
  const cards = [...page(m, '#drift').doc.querySelectorAll('.dcard')]
  assert.deepEqual(
    cards.map((c) => [
      flat(c.querySelector('a')),
      flat(c.querySelector('.chip')),
    ]),
    [
      ['REQ-CHECKOUT-012 ex3', 'Must'],
      ['REQ-RETURNS-001 ex1', 'No priority'],
    ]
  )
})

test('C8d: heatmap and breakdown columns follow the values order, not the alphabet', () => {
  // Must and Could reached: the values say Must first, the alphabet Could.
  const m = bookModel(
    {
      'checkout.md': reqFile(
        'Tree: Checkout\nGroup by: priority',
        section('REQ-CHECKOUT-012', 'priority=must platform=web', 2),
        section('REQ-CHECKOUT-015', 'priority=could platform=web', 1)
      ),
    },
    {},
    {
      ...BY_PRIORITY,
      breakdowns: [
        {
          rows: 'platform',
          columns: 'priority',
          title: 'By platform',
          noun: ['platform', 'platforms'],
        },
      ],
    }
  )
  assert.deepEqual(node(m, 'Checkout').children, [
    'Checkout/Must',
    'Checkout/Could',
  ])
  const p = page(m, at('Checkout'))
  const values = (head) =>
    head.filter((h) => ['Must', 'Should', 'Could'].includes(h))
  const heat = cardHeaded(p, 'Coverage by priority')
  assert.ok(heat, 'a "Coverage by priority" card')
  assert.deepEqual(values(table(heat).head), ['Must', 'Could'])
  const byPlatform = cardHeaded(p, 'By platform')
  assert.ok(byPlatform, 'a "By platform" card')
  assert.deepEqual(values(table(byPlatform).head), ['Must', 'Could'])
})

test('C11b: a breakdown counts its rows with its own noun', () => {
  const card = (platforms) => {
    const m = bookModel(
      {
        'checkout.md': reqFile(
          'Tree: Checkout\nGroup by: priority',
          section('REQ-CHECKOUT-012', `priority=must platform=${platforms}`, 1)
        ),
      },
      {},
      {
        ...BY_PRIORITY,
        breakdowns: [
          {
            rows: 'platform',
            columns: 'priority',
            title: 'By surface',
            noun: ['surface', 'surfaces'],
          },
        ],
      }
    )
    const c = cardHeaded(page(m, at('Checkout')), 'By surface')
    assert.ok(c, 'a "By surface" card')
    return flat(c)
  }
  const two = card('web,ios')
  assert.ok(two.includes('2 surfaces in this branch'), two)
  assert.ok(!two.includes('platform'), two)
  const one = card('web')
  assert.ok(one.includes('1 surface in this branch'), one)
})

test('C11c: a breakdown writes the detail tag values beside each row', () => {
  const m = bookModel(
    {
      'checkout.md': reqFile(
        'Tree: Checkout\nGroup by: priority',
        section(
          'REQ-CHECKOUT-012',
          'priority=must platform=web browser=chrome,firefox',
          1
        ),
        section(
          'REQ-CHECKOUT-013',
          'priority=should platform=web browser=safari',
          1
        ),
        section('REQ-CHECKOUT-015', 'priority=must platform=ios', 1)
      ),
    },
    {},
    {
      ...BY_PRIORITY,
      breakdowns: [
        {
          rows: 'platform',
          detail: 'browser',
          columns: 'priority',
          title: 'By platform',
          noun: ['platform', 'platforms'],
        },
      ],
    }
  )
  const card = cardHeaded(page(m, at('Checkout')), 'By platform')
  assert.ok(card, 'a "By platform" card')
  const { rows } = table(card)
  assert.equal(rows.length, 2)
  // A row's heading cell holds its name, alone in the cell or in an element.
  const rowOf = (name) =>
    rows.find(
      ([h]) =>
        flat(h) === name ||
        [...h.querySelectorAll('*')].some((el) => flat(el) === name)
    )
  assert.ok(
    rowOf('ios') && rowOf('web'),
    rows.map(([h]) => flat(h)).join(' | ')
  )
  // web: its browsers, in an element of their own next to the row's name.
  const web = rowOf('web')[0]
  for (const b of ['chrome', 'firefox', 'safari'])
    assert.ok(flat(web).includes(b), `${b} beside web: ${flat(web)}`)
  assert.ok(
    [...web.querySelectorAll('*')].some(
      (el) => flat(el).includes('chrome') && !flat(el).includes('web')
    ),
    `the detail is apart from the name: ${web.innerHTML}`
  )
  // ios: no browser tag, nothing beside it.
  assert.equal(flat(rowOf('ios')[0]), 'ios')
  // Travel: the variants beside each fare type.
  const fx = page(
    model({
      reqs: [
        REQ_004.replace(
          'fare=ECONOMY_FLEX',
          'fare=BASIC variant=basic-refundable,basic-changeable'
        ),
      ],
    }),
    at('Trips/Flights/Booking')
  )
  const qt = cardHeaded(fx, 'By fare type')
  assert.ok(qt, 'a "By fare type" card')
  const head = table(qt).rows[0][0]
  for (const v of ['BASIC', 'basic-refundable', 'basic-changeable'])
    assert.ok(flat(head).includes(v), `${v}: ${flat(head)}`)
})

test('C12b: a tag row of two tags shows the values of both, joined by " · "', () => {
  const m = bookModel(
    {
      'checkout.md': reqFile(
        'Tree: Checkout\nGroup by: none',
        section('REQ-CHECKOUT-012', 'platform=web,ios browser=chrome', 1)
      ),
    },
    {},
    { tagRows: [{ label: 'Platform', tags: ['platform', 'browser'] }] }
  )
  const card = page(m, at('Checkout')).doc.querySelector(
    'details.req[data-req="REQ-CHECKOUT-012"]'
  )
  assert.ok(
    [...card.querySelectorAll('*')].some((el) =>
      /^Platform\s*web · ios · chrome$/.test(flat(el))
    ),
    flat(card)
  )
  // Travel: "Fare type  ECONOMY_FLEX · REFUNDABLE".
  const fx = page(
    model({
      reqs: [
        REQ_004.replace(
          'fare=ECONOMY_FLEX',
          'fare=ECONOMY_FLEX variant=REFUNDABLE'
        ),
      ],
    }),
    at(TICKET_NODE)
  ).doc.querySelector('details.req[data-req="REQ-FLYB-004"]')
  assert.ok(
    [...fx.querySelectorAll('*')].some((el) =>
      /^Fare type\s*ECONOMY_FLEX · REFUNDABLE$/.test(flat(el))
    ),
    flat(fx)
  )
})

// ------------------------------------------------------------------ project kit (K1–K11)
// K12–K15 (documents, project-init) are checked by a reader, not here.

/** A folder holding `files`, removed once `fn` has run. */
function withFiles(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-map-'))
  try {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
/** The test files readInputs finds under `dir` with a config as JSON.parse gives it, sorted. */
const scanned = (dir, raw) =>
  need('readInputs')(dir, need('resolveConfig')(raw))
    .testFiles.map((f) => f.path)
    .sort()
const A_TEST = "it('a', () => {})\n"

// K1's requirement file, after the kit's _template.md, with no Tree: line.
const KIT_CHECKOUT = `# Checkout requirements

## REQ-CHECKOUT-012 · Coupons stack on one order
Status: active
Source: the shop owner, 2026-11-03
Rule: A second coupon applies to the price the first one left.
- ex1: 10% + 5% on 100,000 → 85,500
- ex2: 10% on 100,000, then a 20,000 voucher → 70,000
- ex3: a coupon that expired yesterday → refused, "This coupon has expired"
`

/**
 * K1's repository: package.json with typescript in devDependencies and the
 * coverage:map script project-init adds, node_modules at the root as npm
 * leaves it, the requirement and its test, no coverage-map.config.json. In
 * the kit every file under files/ is copied too, as project-init's step 4
 * does (never over a file the repository has).
 */
function kitRepo(extra = {}) {
  const repo = tempRepo(
    {
      'package.json': `${JSON.stringify(
        {
          name: 'bookstore',
          private: true,
          scripts: { 'coverage:map': 'node scripts/coverage-map.mjs' },
          devDependencies: { typescript: '5.9.3' },
        },
        null,
        2
      )}\n`,
      'docs/product/requirements/checkout.md': KIT_CHECKOUT,
      [COUPONS]: COUPONS_TEST,
      ...extra,
    },
    { touched: false }
  )
  symlinkSync(NODE_MODULES, join(repo.dir, 'node_modules'), 'dir')
  if (IN_KIT)
    cpSync(SOURCE, repo.dir, {
      recursive: true,
      force: false,
      filter: (src) => basename(src) !== 'gitignore.append',
    })
  return repo
}
const npmRun = (repo, script) =>
  spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', '--silent', script],
    {
      cwd: repo.dir,
      encoding: 'utf8',
      env: { ...process.env, npm_config_update_notifier: 'false' },
    }
  )

test('K1: a new repository with the kit and no config: npm run coverage:map writes the page', () => {
  const repo = kitRepo()
  try {
    assert.ok(!repo.has('coverage-map.config.json'), 'no config file')
    const run = npmRun(repo, 'coverage:map')
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.ok(repo.has(PAGE), `the page is written to ${PAGE}`)
    assert.ok(run.stdout.includes('3 ACs, 1 tested'), run.stdout)
    assert.ok(run.stdout.includes('1 tests scanned'), run.stdout)
    // S4 F6: the file's heading "# Checkout requirements" names the root.
    const p = openHtml(repo.read(PAGE), '#/Checkout')
    assert.deepEqual(
      [...p.doc.querySelectorAll('.tn .tl')].map(flat),
      ['Checkout'],
      'one root node, Checkout'
    )
    assert.equal(p.text('h1'), 'Checkout')
    assert.deepEqual(p.errors, [])
  } finally {
    repo.done()
  }
})

test('K2: copies of a test in dot folders and build output are not scanned', () => {
  const decoys = [
    '.claude/worktrees/w/src/lib/pricing/coupons.test.ts',
    '.next/server/x.test.js',
    '.git/hooks/y.test.js',
    'dist/coupons.test.js',
    'build/a.spec.js',
    'coverage/lcov-report/b.test.js',
    'out/c.test.js',
  ]
  // Each copy names ex1, so one scanned by mistake is a second test under it.
  const repo = kitRepo(Object.fromEntries(decoys.map((p) => [p, COUPONS_TEST])))
  try {
    const config = need('resolveConfig')(undefined)
    const inputs = need('readInputs')(repo.dir, config)
    assert.deepEqual(
      inputs.testFiles.map((f) => f.path),
      [COUPONS]
    )
    const m = buildModel({ ...inputs, config })
    assert.equal(ex(m, 'REQ-CHECKOUT-012', 'ex1').tests.length, 1)
    const run = npmRun(repo, 'coverage:map')
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.ok(run.stdout.includes('1 tests scanned'), run.stdout)
    // S4 F6: the root is named by the file's heading.
    const p = openHtml(repo.read(PAGE), '#/Checkout')
    const right = p.doc
      .getElementById('REQ-CHECKOUT-012-ex1')
      .querySelector('.ac-r')
    assert.equal(right.querySelectorAll('.ct').length, 1, flat(right))
  } finally {
    repo.done()
  }
})

test('K3: dot folders and node_modules are skipped, except the folder a pattern starts in', () => {
  withFiles(
    {
      'src/b.test.ts': A_TEST,
      '.storybook/a.test.ts': A_TEST,
      '.hidden/c.test.ts': A_TEST,
      'src/.cache/d.test.ts': A_TEST,
      'node_modules/e/f.test.ts': A_TEST,
      'src/node_modules/g.test.ts': A_TEST,
    },
    (dir) => {
      assert.deepEqual(scanned(dir), ['src/b.test.ts'])
      assert.deepEqual(scanned(dir, { tests: ['.storybook/**/*.test.ts'] }), [
        '.storybook/a.test.ts',
      ])
      assert.deepEqual(scanned(dir, { tests: ['src/.cache/**/*.test.ts'] }), [
        'src/.cache/d.test.ts',
      ])
    }
  )
})

test('K4: exclude leaves out build output by default, and a list set in the config replaces it', () => {
  const resolveConfig = need('resolveConfig')
  const DEFAULT = ['**/dist/**', '**/build/**', '**/coverage/**', '**/out/**']
  assert.deepEqual(resolveConfig(undefined).exclude, DEFAULT)
  // The travel config sets none: the default.
  assert.deepEqual(resolveConfig(TRAVEL_RAW).exclude, DEFAULT)
  withFiles(
    {
      'src/new.test.ts': A_TEST,
      'src/legacy/old.test.ts': A_TEST,
      'dist/x.test.js': A_TEST,
      'src/dist/y.test.ts': A_TEST,
      'build/a.test.ts': A_TEST,
      'coverage/b.test.ts': A_TEST,
      'out/c.test.ts': A_TEST,
    },
    (dir) => {
      assert.deepEqual(scanned(dir), [
        'src/legacy/old.test.ts',
        'src/new.test.ts',
      ])
      assert.deepEqual(scanned(dir, { exclude: ['src/legacy/**'] }), [
        'build/a.test.ts',
        'coverage/b.test.ts',
        'dist/x.test.js',
        'out/c.test.ts',
        'src/dist/y.test.ts',
        'src/new.test.ts',
      ])
    }
  )
})

/** A config resolveConfig refuses with `want`, and the script with it (exit 2, old page kept). */
function refusedConfig(raw, want) {
  assert.throws(() => need('resolveConfig')(raw), { message: want })
  refuses(`${JSON.stringify(raw)}\n`, want)
}

test('K5: a level name with a space stops the script', () => {
  refusedConfig(
    { levels: [{ match: 'e2e/**', level: 'api e2e' }] },
    'coverage-map.config.json: levels[0].level must use only letters, digits, - and _'
  )
  // Letters, digits, - and _ pass.
  assert.doesNotThrow(() =>
    need('resolveConfig')({ levels: [{ match: 'x/**', level: 'Api-e2e_2' }] })
  )
})

test('K6: an empty requirements path stops the script', () => {
  refusedConfig(
    { requirements: '' },
    'coverage-map.config.json: requirements must be a folder path'
  )
})

test('K7: a pattern starting with "./" stops the script, in tests, exclude and levels[].match', () => {
  const rest = 'starts with "./"; patterns are relative to the repository root'
  refusedConfig(
    { tests: ['./src/**/*.test.ts'] },
    `coverage-map.config.json: tests[0] ${rest}`
  )
  refusedConfig(
    { exclude: ['dist/**', './tmp/**'] },
    `coverage-map.config.json: exclude[1] ${rest}`
  )
  refusedConfig(
    { levels: [{ match: './e2e/**', level: 'e2e' }] },
    `coverage-map.config.json: levels[0].match ${rest}`
  )
})

test('K8: a value listed twice in a group stops the script', () => {
  refusedConfig(
    { groups: { priority: { values: ['must', 'should', 'must'] } } },
    'coverage-map.config.json: groups.priority.values lists "must" twice'
  )
})

test('K8b: a missing requirements folder is a data problem; the page is still written', () => {
  for (const [config, folder] of [
    [null, 'docs/product/requirements'],
    ['{ "requirements": "specs/reqs" }\n', 'specs/reqs'],
  ]) {
    const repo = tempRepo({
      [COUPONS]: COUPONS_TEST,
      ...(config ? { 'coverage-map.config.json': config } : {}),
    })
    try {
      assert.ok(!repo.has(folder), `no ${folder}`)
      const run = repo.run()
      assert.equal(run.status, 0, run.stderr)
      const p = openHtml(repo.read(PAGE))
      assert.ok(p.text().includes('No requirements yet'), p.text())
      const box = p.doc.querySelector('.problems')
      assert.ok(box && flat(box).includes('Data problems'), p.text())
      assert.ok(flat(box).includes(`${folder} does not exist`), flat(box))
      if (config)
        assert.ok(
          !flat(box).includes('docs/product/requirements does not exist'),
          `the path is the config's: ${flat(box)}`
        )
    } finally {
      repo.done()
    }
  }
})

test(
  "K11: nothing project-init copies from the kit can break a project's tests",
  {
    skip: !IN_KIT && 'project kit only: it walks the kit folder files/',
  },
  () => {
    const kit = fileURLToPath(new URL('..', import.meta.url))
    const files = join(kit, 'files')
    const all = readdirSync(files, { recursive: true }).map((p) =>
      String(p).split(sep).join('/')
    )
    assert.ok(all.length > 0, 'files/ has files')
    assert.deepEqual(
      all.filter((p) => /\.(test|spec)\./.test(basename(p))),
      [],
      'no *.test.* or *.spec.* under files/'
    )
    assert.deepEqual(
      all.filter((p) =>
        p.split('/').some((s) => s === 'package.json' || s === 'node_modules')
      ),
      [],
      'no package.json or node_modules under files/'
    )
    assert.ok(
      existsSync(join(kit, 'package.json')) &&
        statSync(join(kit, 'package.json')).isFile(),
      "the kit's package.json, beside files/"
    )
    const ignored = readFileSync(join(kit, '.gitignore'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
    assert.ok(
      ignored.some((l) => /^\/?node_modules\/?$/.test(l)),
      `node_modules/ in the kit's .gitignore: ${ignored.join(' | ')}`
    )
  }
)

// K16–K19: the spec's "Bổ sung 03/11" (after the review and the project-init run).

const NEEDS_TS5 = (has) =>
  `coverage-map needs the TypeScript 5 compiler API; this project has ${has}. Install typescript@5 (npm i -D typescript@5)`
/** Where Node finds typescript from `dir`'s scripts/, or null. */
const typescriptFrom = (dir) => {
  try {
    return createRequire(join(dir, 'scripts/coverage-map.mjs')).resolve(
      'typescript'
    )
  } catch {
    return null
  }
}

test('K16: a typescript without the TypeScript 5 compiler API, or none, stops the script with one line', () => {
  const OLD = '<!doctype html><p>the page before this run</p>\n'
  // typescript 7.0.2: a package with no createSourceFile. Its code says
  // another version, so the line has to take the package.json's.
  const seven = tempRepo(
    {
      'docs/product/requirements/checkout.md': KIT_CHECKOUT,
      [COUPONS]: COUPONS_TEST,
      [PAGE]: OLD,
      'node_modules/typescript/package.json': `${JSON.stringify({
        name: 'typescript',
        version: '7.0.2',
        main: 'lib/version.cjs',
      })}\n`,
      'node_modules/typescript/lib/version.cjs':
        "module.exports = { version: '7.0.2-dev' }\n",
    },
    { touched: false, modules: false }
  )
  try {
    const found = typescriptFrom(seven.dir)
    assert.ok(
      found &&
        found.endsWith(join('repo/node_modules/typescript/lib/version.cjs')),
      `the repository's typescript is the fake one: ${found}`
    )
    const run = seven.run()
    assert.equal(run.status, 2, `exit code; stderr: ${run.stderr}`)
    assert.equal(run.stderr.replace(/\n$/, ''), NEEDS_TS5('typescript 7.0.2'))
    assert.equal(seven.read(PAGE), OLD, 'the old page is left as it was')
  } finally {
    seven.done()
  }
  // No typescript anywhere the script can see.
  const none = tempRepo(
    {
      'docs/product/requirements/checkout.md': KIT_CHECKOUT,
      [COUPONS]: COUPONS_TEST,
    },
    { touched: false, modules: false }
  )
  try {
    assert.equal(
      typescriptFrom(none.dir),
      null,
      'no typescript resolves from the repository'
    )
    const run = none.run()
    assert.equal(run.status, 2, `exit code; stderr: ${run.stderr}`)
    assert.equal(run.stderr.replace(/\n$/, ''), NEEDS_TS5('no typescript'))
    assert.ok(!none.has(PAGE), 'no page written')
  } finally {
    none.done()
  }
})

test('K17: outside a git repository the script is silent on stderr and the page says commit unknown', () => {
  const repo = tempRepo(
    {
      'docs/product/requirements/checkout.md': KIT_CHECKOUT,
      [COUPONS]: COUPONS_TEST,
    },
    { touched: false }
  )
  try {
    assert.ok(!repo.has('.git'), 'no .git')
    const git = spawnSync('git', ['rev-parse', '--git-dir'], {
      cwd: repo.dir,
      encoding: 'utf8',
    })
    assert.notEqual(
      git.status,
      0,
      `the folder is in no git repository: ${git.stdout}`
    )
    const run = repo.run()
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stderr, '', 'nothing on stderr')
    assert.ok(repo.has(PAGE), 'the page is written')
    const header = flat(openHtml(repo.read(PAGE)).doc.querySelector('header'))
    assert.ok(header.includes('commit unknown'), header)
  } finally {
    repo.done()
  }
})

test('K18: test files the default exclude leaves out are counted on the console and listed on the Tests view', () => {
  const left = ['src/build/old.test.ts', 'src/features/coverage/limits.test.ts']
  const repo = kitRepo(
    Object.fromEntries(
      left.map((p) => [p, "it('REQ-CHECKOUT-012 ex2: left out', () => {})\n"])
    )
  )
  try {
    const run = npmRun(repo, 'coverage:map')
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    const lines = run.stdout.split('\n')
    const total = lines.findIndex((l) => l.includes('tests scanned'))
    assert.ok(total >= 0, `a summary line: ${run.stdout}`)
    assert.ok(
      lines.indexOf('2 test files left out by exclude') > total,
      `"2 test files left out by exclude" after the summary line:\n${run.stdout}`
    )
    const html = repo.read(PAGE)
    const tests = openHtml(html, '#tests')
    const sections = [...tests.doc.querySelectorAll('main section')]
    const card = sections.find(
      (s) => headingOf(s) === 'Left out by exclude (2)'
    )
    assert.ok(
      card,
      `a "Left out by exclude (2)" section: ${sections.map(headingOf).join(' | ')}`
    )
    for (const p of left)
      assert.ok(flat(card).includes(p), `${p}: ${flat(card)}`)
    // S4 F6: the root is named by the file's heading.
    const ex2 = openHtml(html, '#/Checkout')
      .doc.getElementById('REQ-CHECKOUT-012-ex2')
      .querySelector('.ac-r')
    assert.ok(flat(ex2).includes('No test yet'), flat(ex2))
  } finally {
    repo.done()
  }
  // K1's repository: nothing left out, so neither the line nor the section.
  const plain = kitRepo()
  try {
    const run = npmRun(plain, 'coverage:map')
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.ok(!run.stdout.includes('left out by exclude'), run.stdout)
    const tests = openHtml(plain.read(PAGE), '#tests')
    assert.equal(tests.text('h1'), 'Tests')
    assert.ok(!tests.text().includes('Left out by exclude'), tests.text())
  } finally {
    plain.done()
  }
})

test(
  "K19: the kit's gitignore.append has a node_modules/ line",
  {
    skip: !IN_KIT && 'project kit only: reads its files/gitignore.append',
  },
  () => {
    const lines = readFileSync(join(SOURCE, 'gitignore.append'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
    assert.ok(lines.includes('node_modules/'), lines.join(' | '))
  }
)

// Second pass on S2: claims a mutation check found no test failing on.

test('K1b: a requirement file whose name starts with _ is not read, even one that parses', () => {
  const TEMPLATE = `# TEMPLATE requirements

## REQ-TEMPLATE-001 · a template example
Status: active
- ex1: a → b
- ex2: c → d
`
  // Read as a requirement file it would count: one more requirement, two ACs.
  const would = buildModel({
    requirementFiles: [
      { path: 'docs/product/requirements/_template.md', text: TEMPLATE },
    ],
    testFiles: [],
    config: need('resolveConfig')(undefined),
  })
  assert.ok(summary(would).startsWith('1 requirements, 2 ACs'), summary(would))
  const repo = kitRepo({ 'docs/product/requirements/_template.md': TEMPLATE })
  try {
    const { requirementFiles } = need('readInputs')(
      repo.dir,
      need('resolveConfig')(undefined)
    )
    assert.deepEqual(
      requirementFiles.map((f) => f.path),
      ['docs/product/requirements/checkout.md']
    )
    const run = npmRun(repo, 'coverage:map')
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.ok(
      run.stdout.includes('1 requirements, 3 ACs, 1 tested'),
      run.stdout
    )
    const p = openHtml(repo.read(PAGE))
    const tree = p.text('.tree')
    assert.ok(tree.includes('checkout.md'), tree)
    assert.ok(!tree.includes('_template.md'), tree)
    // S4 F6: the root is named by checkout.md's heading.
    assert.deepEqual([...p.doc.querySelectorAll('.tn .tl')].map(flat), [
      'Checkout',
    ])
  } finally {
    repo.done()
  }
})

test('K4b: an exclude pattern can name files, not only folders', () => {
  const raw = { exclude: ['**/*.snap.test.ts'] }
  const SNAP = "it('REQ-CHECKOUT-012 ex2: snapshot', () => {})\n"
  withFiles(
    {
      'src/a.test.ts': A_TEST,
      'src/a.snap.test.ts': SNAP,
      'src/lib/b.snap.test.ts': SNAP,
    },
    (dir) => {
      assert.deepEqual(scanned(dir, raw), ['src/a.test.ts'])
    }
  )
  const left = ['src/a.snap.test.ts', 'src/lib/b.snap.test.ts']
  const repo = tempRepo(
    {
      'docs/product/requirements/checkout.md': KIT_CHECKOUT,
      [COUPONS]: COUPONS_TEST,
      ...Object.fromEntries(left.map((p) => [p, SNAP])),
      'coverage-map.config.json': `${JSON.stringify(raw)}\n`,
    },
    { touched: false }
  )
  try {
    const run = repo.run()
    assert.equal(run.status, 0, run.stderr)
    assert.ok(run.stdout.includes('1 tests scanned'), run.stdout)
    assert.ok(
      run.stdout.split('\n').includes('2 test files left out by exclude'),
      run.stdout
    )
    const tests = openHtml(repo.read(PAGE), '#tests')
    const card = [...tests.doc.querySelectorAll('main section')].find(
      (s) => headingOf(s) === 'Left out by exclude (2)'
    )
    assert.ok(card, tests.text())
    for (const p of left) assert.ok(flat(card).includes(p), flat(card))
  } finally {
    repo.done()
  }
})

test('K5b: a dot, a slash or a colon in a level name stops the script too', () => {
  const resolveConfig = need('resolveConfig')
  for (const level of ['api.e2e', 'api/e2e', 'api:e2e'])
    assert.throws(
      () => resolveConfig({ levels: [{ match: 'e2e/**', level }] }),
      {
        message:
          'coverage-map.config.json: levels[0].level must use only letters, digits, - and _',
      },
      level
    )
})

test('K8c: the value listed twice is the one repeated, wherever it is', () => {
  const resolveConfig = need('resolveConfig')
  assert.throws(
    () =>
      resolveConfig({
        groups: { priority: { values: ['must', 'should', 'should'] } },
      }),
    {
      message:
        'coverage-map.config.json: groups.priority.values lists "should" twice',
    }
  )
})

// ------------------------------------------------------------------ last test run (R1–R15)
// The Bookstore repository, its two JUnit files written by hand in
// the shapes of jest-junit (default: classname = name = describe + title, no
// file) and Playwright (suite and classname = the file name). R16 (the kit
// copy) is checked outside this file.

const UNIT_XML = 'reports/unit.xml'
const E2E_XML = 'reports/e2e.xml'
const RESULTS_PAGE = 'reports/coverage-map.html'
const xmlEsc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const EX1_UNIT = 'REQ-CHECKOUT-012 ex1: 10% + 5% on 100,000 → 85,500'
const EX2_UNIT =
  'REQ-CHECKOUT-012 ex2: the order of entry does not change the total'
const EX1_E2E = 'REQ-CHECKOUT-012 ex1: two coupons at checkout'
const EX3_E2E = 'REQ-CHECKOUT-012 ex3: pays by card'
const FAILURE =
  'expect(received).toBe(expected)\n\nExpected: 85500\nReceived: 85499\n\n    at Object.<anonymous> (src/lib/pricing/coupons.test.ts:31:5)'

/**
 * A jest-junit report: one suite (the outer describe), each case's classname
 * and name the describe and the title joined by a space; `file` only when
 * given (addFileAttribute). A case: { title, failure?, skipped?, file? }.
 */
function jestJunit(
  cases,
  { suite = 'coupons', timestamp = '2026-11-03T09:12:00' } = {}
) {
  const failed = cases.filter((c) => c.failure).length
  const body = cases
    .map((c) => {
      const name = xmlEsc(`${suite} ${c.title}`)
      const file = c.file ? ` file="${xmlEsc(c.file)}"` : ''
      const inner = c.failure
        ? `\n      <failure message="${xmlEsc(c.failure.split('\n')[0])}">${xmlEsc(c.failure)}</failure>\n    `
        : c.skipped
          ? '\n      <skipped/>\n    '
          : '\n    '
      return `    <testcase classname="${name}" name="${name}" time="0.012"${file}>${inner}</testcase>`
    })
    .join('\n')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<testsuites name="jest tests" tests="${cases.length}" failures="${failed}" errors="0" time="0.5">\n` +
    `  <testsuite name="${xmlEsc(suite)}" errors="0" failures="${failed}" skipped="0" timestamp="${timestamp}" time="0.4" tests="${cases.length}">\n` +
    `${body}\n  </testsuite>\n</testsuites>\n`
  )
}

/** A Playwright report: a suite per file, named by the file, which is also each case's classname. */
function playwrightJunit(
  files,
  { timestamp = '2026-11-03T09:20:00.000Z' } = {}
) {
  const all = Object.values(files).flat()
  const suites = Object.entries(files)
    .map(
      ([file, titles]) =>
        `<testsuite name="${xmlEsc(file)}" timestamp="${timestamp}" hostname="chromium" tests="${titles.length}" failures="0" skipped="0" time="2.1" errors="0">\n` +
        titles
          .map(
            (t) =>
              `<testcase name="${xmlEsc(t)}" classname="${xmlEsc(file)}" time="2.1">\n</testcase>\n`
          )
          .join('') +
        '</testsuite>\n'
    )
    .join('')
  return `<testsuites id="" name="" tests="${all.length}" failures="0" skipped="0" errors="0" time="3.2">\n${suites}</testsuites>\n`
}

const COUPONS_SUITE = `describe('coupons', () => {
  it('${EX1_UNIT}', () => {})
  it('${EX2_UNIT}', () => {})
})
`
/** The spec's Bookstore repository, `changes` written over it (null: no such file). */
// S4 F6: the S3 fixture names no heading, so its root stays CHECKOUT, the
// file's name (with "# Checkout requirements" it would be "Checkout").
const BOOKSTORE_CHECKOUT = KIT_CHECKOUT.replace(
  '# Checkout requirements\n\n',
  ''
)
assert.ok(!BOOKSTORE_CHECKOUT.includes('# Checkout'), 'no heading')
function bookstore(changes = {}) {
  const files = {
    'docs/product/requirements/checkout.md': BOOKSTORE_CHECKOUT,
    [COUPONS]: COUPONS_SUITE,
    'e2e/checkout.spec.ts': `test('${EX1_E2E}', async () => {})\n`,
    'e2e/payment.spec.ts': `test('${EX3_E2E}', async () => {})\n`,
    [UNIT_XML]: jestJunit([
      { title: EX1_UNIT },
      { title: EX2_UNIT, failure: FAILURE },
    ]),
    [E2E_XML]: playwrightJunit({ 'checkout.spec.ts': [EX1_E2E] }),
    ...changes,
  }
  return tempRepo(
    Object.fromEntries(Object.entries(files).filter(([, t]) => t !== null)),
    { touched: false }
  )
}

// The spec shows times as the files write them ("09:20" for
// 2026-11-03T09:20:00.000Z). The script and the page run in a zone far from
// UTC, so a time turned into local time shows up as wrong.
const ZONE = 'America/New_York'
function zoned(fn) {
  const was = process.env.TZ
  process.env.TZ = ZONE
  try {
    return fn()
  } finally {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
}
const runResults = (repo, ...args) =>
  spawnSync(
    process.execPath,
    ['scripts/coverage-map.mjs', '--results', ...args],
    { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, TZ: ZONE } }
  )

const squash = (s) => s.replace(/\s+/g, '')
/** Whether `el` shows `label`, spaces aside ("✓ Passing" may be two elements). */
const shows = (el, label) => squash(flat(el)).includes(squash(label))
const acOf = (p, ex) => p.doc.getElementById(`REQ-CHECKOUT-012-${ex}`)
/** The tests listed under an AC (or in a section), one row each. */
const rowsOf = (el) => [...el.querySelectorAll('.ct')]
/** A test row's file path, from the title holding it. */
const pathOf = (row) =>
  [...row.querySelectorAll('[title]')]
    .map((e) => e.getAttribute('title'))
    .find((t) => t.includes('/'))
const MARKS = ['✓', '✗', '○', '–']
const marksOf = (row) => MARKS.filter((m) => flat(row).includes(m))
const treeRow = (p, label) =>
  [...p.doc.querySelectorAll('.tn')].find(
    (t) => flat(t.querySelector('.tl')) === label
  )
/** The Failing ACs tile, by its label. */
const failingTile = (p) =>
  [...p.doc.querySelectorAll('.kpi')].find((k) =>
    flat(k).startsWith('Failing ACs')
  )
/** The card text from `from` up to `to` (or its end). */
function between(text, from, to) {
  const a = text.indexOf(from)
  assert.ok(a >= 0, `"${from}" in: ${text}`)
  const b = to ? text.indexOf(to, a + from.length) : -1
  return text.slice(a, b < 0 ? undefined : b)
}
/** Each part found in `text`, in this order. */
function inOrder(text, parts) {
  let at = 0
  for (const part of parts) {
    const i = text.indexOf(part, at)
    assert.ok(i >= 0, `"${part}" after "${text.slice(0, at)}" in: ${text}`)
    at = i + part.length
  }
}

test('R1: without --results the reports are not read: the page is the same, byte for byte, as without them', () => {
  const repo = bookstore()
  try {
    const first = repo.run()
    assert.equal(first.status, 0, first.stderr)
    const page = repo.read(PAGE)
    assert.ok(!repo.has(RESULTS_PAGE), 'no results page')
    rmSync(join(repo.dir, 'reports'), { recursive: true, force: true })
    const again = repo.run()
    assert.equal(again.status, 0, again.stderr)
    assert.equal(repo.read(PAGE), page)
    assert.equal(again.stdout, first.stdout)
    // The page of today: no result on any AC.
    const p = openHtml(page, '#/CHECKOUT')
    for (const ex of ['ex1', 'ex2', 'ex3'])
      for (const label of ['✓ Passing', '✗ Failing', '○ Not run'])
        assert.ok(!shows(acOf(p, ex), label), `${ex}: ${flat(acOf(p, ex))}`)
  } finally {
    repo.done()
  }
})

test('R2: with --results an AC says Passing, Failing or Not run, and each test carries its mark', () =>
  zoned(() => {
    const repo = bookstore()
    try {
      const run = runResults(repo)
      assert.equal(run.status, 0, run.stderr)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      // ex1: both tests passed, the e2e one first.
      const ex1 = acOf(p, 'ex1')
      assert.ok(shows(ex1, '✓ Passing'), flat(ex1))
      assert.deepEqual(rowsOf(ex1).map(pathOf), [
        'e2e/checkout.spec.ts',
        COUPONS,
      ])
      assert.deepEqual(rowsOf(ex1).map(marksOf), [['✓'], ['✓']])
      // ex2: failed, the first three non-empty lines of the failure under it.
      const ex2 = acOf(p, 'ex2')
      assert.ok(shows(ex2, '✗ Failing'), flat(ex2))
      const [row2, ...more2] = rowsOf(ex2)
      assert.deepEqual(more2, [])
      assert.deepEqual(marksOf(row2), ['✗'])
      const lines = [
        'expect(received).toBe(expected)',
        'Expected: 85500',
        'Received: 85499',
      ]
      const block = innermost(row2, lines)
      assert.ok(block, `the failure under the test: ${flat(row2)}`)
      inOrder(block.textContent, lines)
      assert.ok(!flat(row2).includes('at Object.'), flat(row2))
      // ex3: its test is in no results file.
      const ex3 = acOf(p, 'ex3')
      assert.ok(shows(ex3, '○ Not run'), flat(ex3))
      const [row3] = rowsOf(ex3)
      assert.ok(flat(row3).includes('pays by card'), flat(row3))
      assert.deepEqual(marksOf(row3), ['○'])
      assert.ok(
        [row3, ...row3.querySelectorAll('[title]')].some(
          (el) =>
            el.getAttribute('title') === 'Not in the last run' &&
            flat(el).includes('○')
        ),
        `○ says "Not in the last run" on hover: ${row3.innerHTML}`
      )
      assert.deepEqual(p.errors, [])
    } finally {
      repo.done()
    }
  }))

test('R3: a skipped test is "–", an AC with only that "– Only skipped", one with no test "○ No test yet"; without --results as today', () =>
  zoned(() => {
    const repo = bookstore({
      'docs/product/requirements/checkout.md': `${BOOKSTORE_CHECKOUT}- ex4: a coupon from another shop → refused\n`,
      [COUPONS]: `${COUPONS_SUITE}it.skip('REQ-CHECKOUT-012 ex3: pays by card later', () => {})\n`,
      'e2e/payment.spec.ts': null,
    })
    try {
      const run = runResults(repo)
      assert.equal(run.status, 0, run.stderr)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      const ex3 = acOf(p, 'ex3')
      assert.ok(shows(ex3, '– Only skipped'), flat(ex3))
      assert.deepEqual(rowsOf(ex3).map(marksOf), [['–']])
      const ex4 = acOf(p, 'ex4')
      assert.ok(shows(ex4, '○ No test yet'), flat(ex4))
      // Without --results: the words of today.
      assert.equal(repo.run().status, 0)
      const today = openHtml(repo.read(PAGE), '#/CHECKOUT')
      assert.ok(flat(acOf(today, 'ex3')).includes('Only skipped tests'))
      assert.ok(!shows(acOf(today, 'ex3'), '– Only skipped'))
      assert.ok(flat(acOf(today, 'ex4')).includes('No test yet'))
      assert.ok(!shows(acOf(today, 'ex4'), '○ No test yet'))
    } finally {
      repo.done()
    }
  }))

test('R4: a "Failing ACs" tile: 1, "1 failing test", "From the last run · 3 Nov 2026, 09:20"; none without --results', () =>
  zoned(() => {
    const repo = bookstore()
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      const tile = failingTile(p)
      assert.ok(tile, [...p.doc.querySelectorAll('.kpi')].map(flat).join(' | '))
      const text = flat(tile)
      inOrder(text, [
        'Failing ACs',
        '1 failing test',
        'From the last run · 3 Nov 2026, 09:20',
      ])
      // The number between the label and "1 failing test".
      assert.equal(
        squash(between(text, 'Failing ACs', '1 failing test')),
        'FailingACs1'
      )
      assert.equal(repo.run().status, 0)
      assert.equal(
        failingTile(openHtml(repo.read(PAGE), '#/CHECKOUT')),
        undefined
      )
    } finally {
      repo.done()
    }
  }))

test('R5: the "Failing" filter, with its count, leaves only ex2; the tree shows ✗1 by CHECKOUT', () =>
  zoned(() => {
    const repo = bookstore()
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      assert.ok(
        flat(treeRow(p, 'CHECKOUT')).includes('✗1'),
        flat(treeRow(p, 'CHECKOUT'))
      )
      const filter = [
        ...p.doc.querySelectorAll('.toolbar label, .toolbar button'),
      ].find((el) => flat(el).startsWith('Failing'))
      assert.ok(filter, flat(p.doc.querySelector('.toolbar')))
      assert.equal(
        flat(filter).slice('Failing'.length).replace(/\D/g, ''),
        '1',
        `its count: ${flat(filter)}`
      )
      ;(filter.querySelector('input') ?? filter).click()
      assert.deepEqual(
        [...p.doc.querySelectorAll('li.ac')].map((li) => li.id),
        ['REQ-CHECKOUT-012-ex2']
      )
      assert.deepEqual(p.errors, [])
      assert.equal(repo.run().status, 0)
      const today = openHtml(repo.read(PAGE), '#/CHECKOUT')
      assert.ok(!flat(treeRow(today, 'CHECKOUT')).includes('✗'))
    } finally {
      repo.done()
    }
  }))

test('R6: the Overview has a "Last test run" card: each file, its time and counts, and the tests in no results file', () =>
  zoned(() => {
    const repo = bookstore()
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE))
      assert.equal(p.text('h1'), 'Project overview')
      const card = cardHeaded(p, 'Last test run')
      assert.ok(
        card,
        [...p.doc.querySelectorAll('main section')].map(headingOf).join(' | ')
      )
      const text = flat(card)
      inOrder(between(text, UNIT_XML, E2E_XML), [
        UNIT_XML,
        '3 Nov 2026, 09:12',
        '1 passed',
        '1 failed',
        '0 skipped',
      ])
      inOrder(between(text, E2E_XML), [
        E2E_XML,
        '3 Nov 2026, 09:20',
        '1 passed',
        '0 failed',
        '0 skipped',
      ])
      assert.ok(
        text.includes('1 test in the code is not in any results file'),
        text
      )
      assert.equal(repo.run().status, 0)
      assert.equal(
        cardHeaded(openHtml(repo.read(PAGE)), 'Last test run'),
        undefined
      )
    } finally {
      repo.done()
    }
  }))

test('R7: the Tests view lists "Failing in the last run (1)", with the failure and a link to its AC, and "Not in the last run (1)"', () =>
  zoned(() => {
    const repo = bookstore()
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE), '#tests')
      const failing = cardHeaded(p, 'Failing in the last run (1)')
      assert.ok(
        failing,
        [...p.doc.querySelectorAll('main section')].map(headingOf).join(' | ')
      )
      assert.equal(rowsOf(failing).length, 1, flat(failing))
      const text = flat(failing)
      assert.ok(
        text.includes('the order of entry does not change the total'),
        text
      )
      assert.ok(text.includes('expect(received).toBe(expected)'), text)
      const notRun = cardHeaded(p, 'Not in the last run (1)')
      assert.ok(
        notRun,
        [...p.doc.querySelectorAll('main section')].map(headingOf).join(' | ')
      )
      assert.equal(rowsOf(notRun).length, 1, flat(notRun))
      assert.ok(flat(notRun).includes('pays by card'), flat(notRun))
      // The link opens the AC.
      const link = [...failing.querySelectorAll('a, [data-go]')].find((a) =>
        flat(a).includes('REQ-CHECKOUT-012 ex2')
      )
      assert.ok(link, `a link to REQ-CHECKOUT-012 ex2: ${failing.innerHTML}`)
      link.click()
      assert.equal(decodeURI(p.dom.window.location.hash), '#/CHECKOUT')
      assert.equal(p.text('h1'), 'CHECKOUT')
      assert.ok(acOf(p, 'ex2'), 'the AC is on the page it opens')
      assert.deepEqual(p.errors, [])
    } finally {
      repo.done()
    }
  }))

test('R8: a Playwright result naming only checkout.spec.ts goes to every test in a file of that name, and to no other file', () =>
  zoned(() => {
    const repo = bookstore({
      'e2e/admin/checkout.spec.ts': `test('${EX1_E2E}', async () => {})\n`,
      'e2e/cart.spec.ts': `test('${EX1_E2E}', async () => {})\n`,
    })
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      const mark = Object.fromEntries(
        rowsOf(acOf(p, 'ex1')).map((r) => [pathOf(r), marksOf(r)])
      )
      assert.deepEqual(mark, {
        'e2e/admin/checkout.spec.ts': ['✓'],
        'e2e/cart.spec.ts': ['○'],
        'e2e/checkout.spec.ts': ['✓'],
        [COUPONS]: ['✓'],
      })
    } finally {
      repo.done()
    }
  }))

test('R9: a result with a file attribute goes only to the test in that file', () =>
  zoned(() => {
    const LEGACY = 'src/lib/pricing/legacy.test.ts'
    const repo = bookstore({
      [LEGACY]: `describe('coupons', () => {\n  it('${EX1_UNIT}', () => {})\n})\n`,
      [UNIT_XML]: jestJunit([
        { title: EX1_UNIT, file: COUPONS },
        { title: EX2_UNIT, failure: FAILURE, file: COUPONS },
      ]),
    })
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      const mark = Object.fromEntries(
        rowsOf(acOf(p, 'ex1')).map((r) => [pathOf(r), marksOf(r)])
      )
      assert.deepEqual(mark[COUPONS], ['✓'])
      assert.deepEqual(mark[LEGACY], ['○'])
    } finally {
      repo.done()
    }
  }))

test('R10: a template title matches each result it could produce; one failing makes the test and its AC fail', () =>
  zoned(() => {
    const repo = bookstore({
      [COUPONS]:
        "describe('coupons', () => {\n  for (const [a, b] of [[10, 5], [20, 5]]) {\n    it(`REQ-CHECKOUT-012 ex1: ${a}% + ${b}%`, () => {})\n  }\n})\n",
      [UNIT_XML]: jestJunit([
        { title: 'REQ-CHECKOUT-012 ex1: 10% + 5%' },
        { title: 'REQ-CHECKOUT-012 ex1: 20% + 5%', failure: FAILURE },
      ]),
      'e2e/checkout.spec.ts': null,
      [E2E_XML]: null,
    })
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      const ex1 = acOf(p, 'ex1')
      assert.equal(rowsOf(ex1).length, 1, flat(ex1))
      assert.deepEqual(marksOf(rowsOf(ex1)[0]), ['✗'])
      assert.ok(shows(ex1, '✗ Failing'), flat(ex1))
    } finally {
      repo.done()
    }
  }))

/** A JUnit file of one suite; a case is { name, classname, failure? }. */
function junitOf(suite, cases, { timestamp = '2026-11-03T09:12:00' } = {}) {
  const failed = cases.filter((c) => c.failure).length
  const body = cases
    .map(
      (c) =>
        `    <testcase classname="${xmlEsc(c.classname)}" name="${xmlEsc(c.name)}" time="0.01">` +
        (c.failure
          ? `\n      <failure message="${xmlEsc(c.failure.split('\n')[0])}">${xmlEsc(c.failure)}</failure>\n    `
          : '\n    ') +
        '</testcase>'
    )
    .join('\n')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<testsuites tests="${cases.length}" failures="${failed}" errors="0" time="0.5">\n` +
    `  <testsuite name="${xmlEsc(suite)}" errors="0" failures="${failed}" skipped="0" timestamp="${timestamp}" time="0.4" tests="${cases.length}">\n` +
    `${body}\n  </testsuite>\n</testsuites>\n`
  )
}
// Only the unit tests of `changes` and reports/unit.xml: no e2e file or report.
const unitOnly = (changes) =>
  bookstore({
    'e2e/checkout.spec.ts': null,
    'e2e/payment.spec.ts': null,
    [E2E_XML]: null,
    ...changes,
  })

test('R10b: a result goes to the test whose whole chain it names, the parts joined by " ", " › " or " > "', () =>
  zoned(() => {
    // "returns 0" ends "when empty returns 0": by the end of the name alone,
    // it would take the failing result of the other test too.
    const SUITE = `describe('coupons', () => {
  describe('REQ-CHECKOUT-012 ex1', () => {
    it('returns 0', () => {})
    it('when empty returns 0', () => {})
  })
})
`
    const shapes = [
      // jest-junit: the suite is the describe, classname = name.
      [' ', 'coupons', (name) => name],
      // Playwright: the suite and classname are the file's name.
      [' › ', 'coupons.test.ts', () => 'coupons.test.ts'],
      // Vitest: the suite and classname are the file's path.
      [' > ', COUPONS, () => COUPONS],
    ]
    for (const [joiner, suite, classname] of shapes) {
      const chain = (t) => ['coupons', 'REQ-CHECKOUT-012 ex1', t].join(joiner)
      const repo = unitOnly({
        [COUPONS]: SUITE,
        [UNIT_XML]: junitOf(suite, [
          {
            name: chain('returns 0'),
            classname: classname(chain('returns 0')),
          },
          {
            name: chain('when empty returns 0'),
            classname: classname(chain('when empty returns 0')),
            failure: FAILURE,
          },
        ]),
      })
      try {
        const run = runResults(repo)
        assert.equal(run.status, 0, run.stderr)
        const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
        const rows = rowsOf(acOf(p, 'ex1'))
        assert.equal(rows.length, 2, flat(acOf(p, 'ex1')))
        const plain = rows.find((r) => !flat(r).includes('when empty'))
        const empty = rows.find((r) => flat(r).includes('when empty'))
        assert.ok(plain && empty, rows.map(flat).join(' | '))
        assert.deepEqual(
          [marksOf(plain), marksOf(empty)],
          [['✓'], ['✗']],
          `joined by "${joiner}": returns 0 ✓, when empty returns 0 ✗`
        )
      } finally {
        repo.done()
      }
    }
  }))

test('R10c: an it.each title with %s matches each case it produced; no result is left unmatched', () =>
  zoned(() => {
    const repo = unitOnly({
      [COUPONS]:
        "describe('coupons', () => {\n  it.each([[10, 5], [20, 5]])('REQ-CHECKOUT-012 ex1: %s%% + %s%%', () => {})\n})\n",
      [UNIT_XML]: jestJunit([
        { title: 'REQ-CHECKOUT-012 ex1: 10% + 5%' },
        { title: 'REQ-CHECKOUT-012 ex1: 20% + 5%' },
      ]),
    })
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      const ex1 = acOf(p, 'ex1')
      assert.equal(rowsOf(ex1).length, 1, flat(ex1))
      assert.deepEqual(marksOf(rowsOf(ex1)[0]), ['✓'])
      assert.ok(shows(ex1, '✓ Passing'), flat(ex1))
      const card = cardHeaded(
        openHtml(repo.read(RESULTS_PAGE)),
        'Last test run'
      )
      assert.ok(card, 'a "Last test run" card')
      assert.ok(!flat(card).includes('results match no test'), flat(card))
    } finally {
      repo.done()
    }
  }))

test('R10c, every placeholder: every .each placeholder, and ${…}, matches in a test title and in a describe title', () =>
  zoned(() => {
    // One AC per placeholder. ex11 and ex12: a placeholder in the describe;
    // a sibling describe has a failing test of the same name, which the
    // first takes too if its describe cannot be matched.
    const tests = `describe('coupons', () => {
  it.each([[10]])('REQ-CHECKOUT-012 ex1: %s off', () => {})
  it.each([[10]])('REQ-CHECKOUT-012 ex2: %d off', () => {})
  it.each([[10]])('REQ-CHECKOUT-012 ex3: %i off', () => {})
  it.each([[1.5]])('REQ-CHECKOUT-012 ex4: %f off', () => {})
  it.each([[{ a: 1 }]])('REQ-CHECKOUT-012 ex5: %j off', () => {})
  it.each([[{ a: 1 }]])('REQ-CHECKOUT-012 ex6: %o off', () => {})
  it.each([[10]])('REQ-CHECKOUT-012 ex7: %p off', () => {})
  it.each([[10]])('REQ-CHECKOUT-012 ex8: case %# off', () => {})
  it.each([{ code: 'SAVE10' }])('REQ-CHECKOUT-012 ex9: $code off', () => {})
  it.each([{ coupon: { code: 'SAVE10' } }])('REQ-CHECKOUT-012 ex10: $coupon.code off', () => {})
})
describe.each([['web']])('checkout on %s', () => {
  it('REQ-CHECKOUT-012 ex11: applies the coupon', () => {})
})
describe('refunds', () => {
  it('REQ-CHECKOUT-012 ex11: applies the coupon', () => {})
})
for (const place of ['web']) {
  describe(\`checkout on \${place}\`, () => {
    it('REQ-CHECKOUT-012 ex12: shows the total', () => {})
  })
}
describe('refunds', () => {
  it('REQ-CHECKOUT-012 ex12: shows the total', () => {})
})
`
    // What jest-junit writes for them: the describes and the title, joined by a space.
    const ran = [
      ['coupons REQ-CHECKOUT-012 ex1: 10 off'],
      ['coupons REQ-CHECKOUT-012 ex2: 10 off'],
      ['coupons REQ-CHECKOUT-012 ex3: 10 off'],
      ['coupons REQ-CHECKOUT-012 ex4: 1.5 off'],
      ['coupons REQ-CHECKOUT-012 ex5: {"a":1} off'],
      ['coupons REQ-CHECKOUT-012 ex6: {"a":1} off'],
      ['coupons REQ-CHECKOUT-012 ex7: 10 off'],
      ['coupons REQ-CHECKOUT-012 ex8: case 0 off'],
      ['coupons REQ-CHECKOUT-012 ex9: "SAVE10" off'],
      ['coupons REQ-CHECKOUT-012 ex10: "SAVE10" off'],
      ['checkout on web REQ-CHECKOUT-012 ex11: applies the coupon'],
      ['refunds REQ-CHECKOUT-012 ex11: applies the coupon', FAILURE],
      ['checkout on web REQ-CHECKOUT-012 ex12: shows the total'],
      ['refunds REQ-CHECKOUT-012 ex12: shows the total', FAILURE],
    ].map(([name, failure]) => ({ name, classname: name, failure }))
    const repo = unitOnly({
      // S4 F6: no heading, so the root stays CHECKOUT.
      'docs/product/requirements/checkout.md': section(
        'REQ-CHECKOUT-012',
        '',
        12
      ),
      [COUPONS]: tests,
      [UNIT_XML]: junitOf('coupons', ran),
    })
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      const placeholders = [
        '%s',
        '%d',
        '%i',
        '%f',
        '%j',
        '%o',
        '%p',
        '%#',
        '$code',
        '$coupon.code',
      ]
      placeholders.forEach((ph, i) => {
        const rows = rowsOf(acOf(p, `ex${i + 1}`))
        assert.equal(rows.length, 1, `ex${i + 1} (${ph}): one test`)
        assert.deepEqual(
          marksOf(rows[0]),
          ['✓'],
          `ex${i + 1} (${ph}): ${flat(rows[0])}`
        )
      })
      for (const [ex, how] of [
        ['ex11', 'describe.each with %s'],
        ['ex12', 'a describe title with ${…}'],
      ]) {
        const rows = rowsOf(acOf(p, ex))
        assert.equal(rows.length, 2, `${ex}: two tests`)
        const mark = Object.fromEntries(
          rows.map((r) => [
            flat(r).includes('refunds') ? 'refunds' : 'checkout on',
            marksOf(r),
          ])
        )
        assert.deepEqual(
          mark,
          { 'checkout on': ['✓'], refunds: ['✗'] },
          `${ex} (${how})`
        )
      }
      const card = cardHeaded(
        openHtml(repo.read(RESULTS_PAGE)),
        'Last test run'
      )
      assert.ok(card, 'a "Last test run" card')
      assert.ok(!flat(card).includes('results match no test'), flat(card))
    } finally {
      repo.done()
    }
  }))

test('R10d: with no result matching by chain (Node runner), a result naming the end of the title still counts', () =>
  zoned(() => {
    // node --test-reporter=junit: the describe is the suite, the case only
    // the title, classname "test".
    const NODE = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
\t<testsuite name="coupons" time="0.004" disabled="0" errors="0" tests="1" failures="0" skipped="0" hostname="ci">
\t\t<testcase name="${xmlEsc(EX1_UNIT)}" time="0.0005" classname="test"/>
\t</testsuite>
</testsuites>
`
    const repo = bookstore({ [UNIT_XML]: NODE })
    try {
      assert.equal(runResults(repo).status, 0)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      const mark = Object.fromEntries(
        rowsOf(acOf(p, 'ex1')).map((r) => [pathOf(r), marksOf(r)])
      )
      assert.deepEqual(mark[COUPONS], ['✓'], JSON.stringify(mark))
      // ex2's test is not in that report.
      assert.deepEqual(rowsOf(acOf(p, 'ex2')).map(marksOf), [['○']])
      // The result is counted as matched, not as matching no test (one such
      // result would read "1 result matches no test …").
      const card = cardHeaded(
        openHtml(repo.read(RESULTS_PAGE)),
        'Last test run'
      )
      assert.ok(card, 'a "Last test run" card')
      assert.ok(!flat(card).includes('no test found in the code'), flat(card))
    } finally {
      repo.done()
    }
  }))

test('R11: results that match no test change no AC, and the card counts them', () =>
  zoned(() => {
    const repo = bookstore({
      [UNIT_XML]: jestJunit([
        { title: EX1_UNIT },
        { title: EX2_UNIT, failure: FAILURE },
        // Neither is a test in the code; the first even names ex3.
        { title: 'REQ-CHECKOUT-012 ex3: refunds the coupon', failure: FAILURE },
        { title: 'applies a gift card' },
      ]),
    })
    try {
      assert.equal(runResults(repo).status, 0)
      const node = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      assert.ok(shows(acOf(node, 'ex1'), '✓ Passing'))
      assert.ok(shows(acOf(node, 'ex2'), '✗ Failing'))
      assert.ok(shows(acOf(node, 'ex3'), '○ Not run'), flat(acOf(node, 'ex3')))
      const card = cardHeaded(
        openHtml(repo.read(RESULTS_PAGE)),
        'Last test run'
      )
      assert.ok(card, 'a "Last test run" card')
      assert.ok(
        flat(card).includes('2 results match no test found in the code'),
        flat(card)
      )
    } finally {
      repo.done()
    }
  }))

test('R12: a results file that is missing says "not found" and the others are used; with none, exit 2 and no page', () =>
  zoned(() => {
    const repo = bookstore({ [E2E_XML]: null })
    try {
      assert.equal(runResults(repo).status, 0)
      const card = cardHeaded(
        openHtml(repo.read(RESULTS_PAGE)),
        'Last test run'
      )
      assert.ok(card, 'a "Last test run" card')
      assert.ok(between(flat(card), E2E_XML).includes('not found'), flat(card))
      const p = openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')
      assert.ok(shows(acOf(p, 'ex2'), '✗ Failing'), 'unit.xml still read')
    } finally {
      repo.done()
    }
    for (const [config, listed] of [
      [null, 'reports/unit.xml, reports/e2e.xml'],
      ['{ "results": ["reports/a.xml"] }\n', 'reports/a.xml'],
    ]) {
      const none = bookstore({
        [UNIT_XML]: null,
        [E2E_XML]: null,
        ...(config ? { 'coverage-map.config.json': config } : {}),
      })
      try {
        const run = runResults(none)
        assert.equal(run.status, 2, `exit code; stderr: ${run.stderr}`)
        assert.equal(
          run.stderr.replace(/\n$/, ''),
          `--results: no results file found (${listed}). Run the tests with a JUnit reporter first.`
        )
        assert.ok(!none.has(RESULTS_PAGE), 'no results page')
        assert.ok(!none.has(PAGE), 'no page')
      } finally {
        none.done()
      }
    }
  }))

test('R13: a file that is not a JUnit report, or broken XML, says so and the others are used; all of them so, exit 2', () =>
  zoned(() => {
    const COBERTURA =
      '<?xml version="1.0" ?>\n<coverage line-rate="0.9" branch-rate="0.8" version="1.9"><packages/></coverage>\n'
    const BROKEN = `<testsuites name="jest tests"><testsuite name="coupons"><testcase name="coupons ${EX1_UNIT}"`
    for (const [changes, bad, check] of [
      // e2e.xml is coverage, not test results: unit.xml still counts.
      [
        { [E2E_XML]: COBERTURA },
        E2E_XML,
        (p) => shows(acOf(p, 'ex2'), '✗ Failing'),
      ],
      // unit.xml is cut off: e2e.xml still counts.
      [
        { [UNIT_XML]: BROKEN },
        UNIT_XML,
        (p) => shows(acOf(p, 'ex1'), '✓ Passing'),
      ],
    ]) {
      const repo = bookstore(changes)
      try {
        const run = runResults(repo)
        assert.equal(run.status, 0, run.stderr)
        const card = cardHeaded(
          openHtml(repo.read(RESULTS_PAGE)),
          'Last test run'
        )
        assert.ok(card, 'a "Last test run" card')
        const other = bad === UNIT_XML ? E2E_XML : UNIT_XML
        const row =
          bad === UNIT_XML
            ? between(flat(card), UNIT_XML, other)
            : between(flat(card), E2E_XML)
        assert.ok(row.includes('not a JUnit report'), flat(card))
        assert.ok(
          check(openHtml(repo.read(RESULTS_PAGE), '#/CHECKOUT')),
          `${other} is still used`
        )
      } finally {
        repo.done()
      }
    }
    const all = bookstore({ [UNIT_XML]: BROKEN, [E2E_XML]: COBERTURA })
    try {
      const run = runResults(all)
      assert.equal(run.status, 2, `exit code; stderr: ${run.stderr}`)
      assert.ok(run.stderr.startsWith('--results: '), run.stderr)
      assert.ok(!all.has(RESULTS_PAGE), 'no results page')
    } finally {
      all.done()
    }
  }))

test('R14: --results writes resultsOutput, says so, and leaves the committed page as it was', () =>
  zoned(() => {
    const repo = bookstore()
    try {
      assert.equal(repo.run().status, 0)
      const committed = repo.read(PAGE)
      const run = runResults(repo)
      assert.equal(run.status, 0, run.stderr)
      const lines = run.stdout.split('\n')
      assert.ok(lines.includes('→ reports/coverage-map.html'), run.stdout)
      assert.ok(
        !run.stdout.includes('→ docs/coverage/COVERAGE-MAP.html'),
        run.stdout
      )
      assert.ok(repo.has(RESULTS_PAGE))
      assert.equal(repo.read(PAGE), committed)
      // resultsOutput set in the config.
      repo.write(
        'coverage-map.config.json',
        '{ "resultsOutput": "tmp/map-with-results.html" }\n'
      )
      const set = runResults(repo)
      assert.equal(set.status, 0, set.stderr)
      assert.ok(
        set.stdout.split('\n').includes('→ tmp/map-with-results.html'),
        set.stdout
      )
      assert.ok(repo.has('tmp/map-with-results.html'))
      assert.equal(repo.read(PAGE), committed)
    } finally {
      repo.done()
    }
  }))


// ------------------------------------------------------------------ last test run, review (R10e–R14b)
// The spec's examples added after the review, and claims of the matching rule
// a mutation check found no test failing on.

/** --results in `repo`, which must succeed, then the results page at `hash`. */
function resultsPage(repo, hash = '') {
  const run = runResults(repo)
  assert.equal(run.status, 0, run.stderr)
  return openHtml(repo.read(RESULTS_PAGE), hash)
}
/** Each test row under an AC, by the describe around it (shown beside the name). */
const byDescribe = (ac) =>
  Object.fromEntries(
    rowsOf(ac).map((r) => [flat(r.querySelector('.ct-ctx')), marksOf(r)])
  )
const lastRunCard = (repo) =>
  cardHeaded(openHtml(repo.read(RESULTS_PAGE)), 'Last test run')
const A_REQ =
  '# A requirements\n\n## REQ-A-001 · works\nStatus: active\n- ex1: it works\n'
/** A repository of REQ-A-001 (node A), `tests` in src/a.test.ts, and reports/unit.xml. */
const aRepo = (tests, unitXml) =>
  tempRepo(
    {
      'docs/product/requirements/a.md': A_REQ,
      'src/a.test.ts': tests,
      [UNIT_XML]: unitXml,
    },
    { touched: false }
  )
const aEx1 = (p) => p.doc.getElementById('REQ-A-001-ex1')

test("R10e: a result one test takes by its chain is never another test's by the end of its title", () =>
  zoned(() => {
    const tests =
      "describe('A', () => {\n  it('REQ-A-001 ex1: works', () => {})\n})\ndescribe('B', () => {\n  it('REQ-A-001 ex1: works', () => {})\n})\n"
    for (const [failure, b] of [
      [FAILURE, '✗'],
      [undefined, '✓'],
    ]) {
      const name = 'B REQ-A-001 ex1: works'
      const repo = aRepo(
        tests,
        junitOf('B', [{ name, classname: name, failure }])
      )
      try {
        const p = resultsPage(repo, '#/A')
        assert.deepEqual(
          byDescribe(aEx1(p)),
          { A: ['○'], B: [b] },
          failure ? 'the case fails' : 'the case passes'
        )
      } finally {
        repo.done()
      }
    }
  }))

test('R10f: a classname with a space is not a file name, even one that holds "x.spec.ts"', () =>
  zoned(() => {
    const name = 'A REQ-A-001 ex1: reads x.spec.ts files'
    const repo = aRepo(
      "describe('A', () => {\n  it('REQ-A-001 ex1: reads x.spec.ts files', () => {})\n})\n",
      junitOf('A', [{ name, classname: name }])
    )
    try {
      const p = resultsPage(repo, '#/A')
      assert.deepEqual(rowsOf(aEx1(p)).map(marksOf), [['✓']])
    } finally {
      repo.done()
    }
  }))

test('R10g: a file attribute holding an absolute path goes to the test whose path it ends with', () =>
  zoned(() => {
    const ABS = `/Users/x/proj/${COUPONS}`
    const repo = bookstore({
      [UNIT_XML]: jestJunit([
        { title: EX1_UNIT, file: ABS },
        { title: EX2_UNIT, failure: FAILURE, file: ABS },
      ]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const ex1 = Object.fromEntries(
        rowsOf(acOf(p, 'ex1')).map((r) => [pathOf(r), marksOf(r)])
      )
      assert.deepEqual(ex1[COUPONS], ['✓'])
      assert.deepEqual(rowsOf(acOf(p, 'ex2')).map(marksOf), [['✗']])
    } finally {
      repo.done()
    }
  }))

test('R10h: a title with 12 ${…} against a 60-word result that does not match takes under 2 seconds', () =>
  zoned(() => {
    // The title ends in a word the result lacks, so every split of the 60
    // words between the 12 parts fails: a matcher that tries them hangs.
    const holes = Array.from({ length: 12 }, () => '${a}').join(' ')
    const tests = `describe('A', () => {\n  const a = 1\n  it(\`REQ-A-001 ex1: ${holes} done\`, () => {})\n})\n`
    const words = Array.from({ length: 57 }, (_, i) => `w${i + 1}`)
    const name = `A REQ-A-001 ex1: ${words.join(' ')}`
    assert.equal(name.split(' ').length, 60)
    const repo = aRepo(tests, junitOf('A', [{ name, classname: name }]))
    try {
      const t0 = Date.now()
      const run = spawnSync(
        process.execPath,
        ['scripts/coverage-map.mjs', '--results'],
        {
          cwd: repo.dir,
          encoding: 'utf8',
          env: { ...process.env, TZ: ZONE },
          timeout: 10_000,
        }
      )
      const ms = Date.now() - t0
      assert.equal(
        run.status,
        0,
        `exit ${run.status} (${run.signal ?? 'no signal'}) after ${ms} ms`
      )
      assert.ok(ms < 2000, `--results took ${ms} ms`)
      const p = openHtml(repo.read(RESULTS_PAGE), '#/A')
      assert.deepEqual(rowsOf(aEx1(p)).map(marksOf), [['○']])
    } finally {
      repo.done()
    }
  }))

// R10i: the JUnit reader takes the shapes real files have, one test each.
// Unless a shape needs other titles, each is R2's unit.xml (ex1 passes, ex2
// fails) written that way, so ex1's unit test must be ✓ and ex2's ✗.
const R2_UNIT = jestJunit([
  { title: EX1_UNIT },
  { title: EX2_UNIT, failure: FAILURE },
])
const FAILURE_TAG = `<failure message="expect(received).toBe(expected)">${xmlEsc(FAILURE)}</failure>`
assert.ok(R2_UNIT.includes(FAILURE_TAG), 'the failure as jestJunit writes it')
/** ex1's unit test and ex2's test, as marks, on the results page of `repo`. */
function unitMarks(repo) {
  const p = resultsPage(repo, '#/CHECKOUT')
  const ex1 = Object.fromEntries(
    rowsOf(acOf(p, 'ex1')).map((r) => [pathOf(r), marksOf(r)])
  )
  return { p, ex1: ex1[COUPONS], ex2: rowsOf(acOf(p, 'ex2')).map(marksOf) }
}
function shapeTest(name, unitXml, extra = {}) {
  test(`R10i: ${name}`, () =>
    zoned(() => {
      const repo = bookstore({ [UNIT_XML]: unitXml, ...extra.changes })
      try {
        const m = unitMarks(repo)
        assert.deepEqual(m.ex1, ['✓'], `ex1: ${flat(acOf(m.p, 'ex1'))}`)
        assert.deepEqual(
          m.ex2,
          extra.ex2 ?? [['✗']],
          `ex2: ${flat(acOf(m.p, 'ex2'))}`
        )
        extra.check?.(m.p)
      } finally {
        repo.done()
      }
    }))
}

shapeTest('a byte order mark before the <?xml?> line', `﻿${R2_UNIT}`)

shapeTest(
  'CDATA, split by ]]]]><![CDATA[> to hold "]]>"',
  R2_UNIT.replace(
    FAILURE_TAG,
    '<failure message="expect(received).toBe(expected)"><![CDATA[expect(received).toBe(expected)\n\nExpected: "a]]]]><![CDATA[>b"\nReceived: 85499]]></failure>'
  ),
  {
    check: (p) => {
      const row = rowsOf(acOf(p, 'ex2'))[0]
      assert.ok(innermost(row, ['Expected: "a]]>b"']), flat(row))
    },
  }
)

shapeTest(
  'CDATA in <system-out> holding text like a <testcase>',
  R2_UNIT.replace(
    /(<testcase [^>]*ex1[^>]*>)/,
    `$1\n      <system-out><![CDATA[log: <testcase name="coupons ${EX3_E2E}" classname="payment.spec.ts"/> done]]></system-out>`
  ),
  {
    // Read as a result, it would make ex3's test ✓.
    check: (p) =>
      assert.deepEqual(rowsOf(acOf(p, 'ex3')).map(marksOf), [['○']]),
  }
)

shapeTest(
  '&quot; and &#10; in a name',
  jestJunit([
    { title: 'REQ-CHECKOUT-012 ex1: the "SAVE10" coupon' },
    { title: 'REQ-CHECKOUT-012 ex2: two\nlines', failure: FAILURE },
  ]).replace(/two\nlines/g, 'two&#10;lines'),
  {
    changes: {
      [COUPONS]:
        "describe('coupons', () => {\n  it('REQ-CHECKOUT-012 ex1: the \"SAVE10\" coupon', () => {})\n  it('REQ-CHECKOUT-012 ex2: two\\nlines', () => {})\n})\n",
    },
  }
)

shapeTest(
  'attributes in single quotes',
  R2_UNIT.replace(/([\w:]+)="([^"]*)"/g, "$1='$2'")
)

shapeTest(
  '">" inside an attribute value',
  jestJunit([
    { title: 'REQ-CHECKOUT-012 ex1: 100,000 -> 85,500' },
    { title: EX2_UNIT, failure: FAILURE },
  ]).replace(/-&gt;/g, '->'),
  {
    changes: {
      [COUPONS]: COUPONS_SUITE.replace(
        EX1_UNIT,
        'REQ-CHECKOUT-012 ex1: 100,000 -> 85,500'
      ),
    },
  }
)

shapeTest(
  '<error> counts as failed',
  R2_UNIT.replace(
    FAILURE_TAG,
    '<error message="TypeError: total is not a function">TypeError: total is not a function\n    at Object.&lt;anonymous&gt; (src/lib/pricing/coupons.test.ts:31:5)</error>'
  ),
  {
    check: (p) => {
      const ex2 = acOf(p, 'ex2')
      assert.ok(shows(ex2, '✗ Failing'), flat(ex2))
      assert.ok(
        flat(rowsOf(ex2)[0]).includes('TypeError: total is not a function'),
        flat(ex2)
      )
    },
  }
)

shapeTest(
  '<skipped message="…"/>',
  R2_UNIT.replace(FAILURE_TAG, '<skipped message="skipped by --grep"/>'),
  {
    ex2: [['–']],
    check: (p) => assert.ok(shows(acOf(p, 'ex2'), '– Only skipped')),
  }
)

shapeTest(
  'a testsuite inside a testsuite',
  R2_UNIT.replace(
    /(<testsuite [^>]*>)/,
    '<testsuite name="all" tests="2" failures="1">\n$1'
  ).replace('</testsuite>', '</testsuite>\n</testsuite>')
)

shapeTest(
  'testcases right under testsuites',
  R2_UNIT.replace(/\s*<testsuite [^>]*>/, '').replace(/\s*<\/testsuite>/, '')
)

test('R14b: resultsOutput equal to output stops the script, with or without --results', () => {
  const want =
    'coverage-map.config.json: resultsOutput must differ from output, so the committed page never shows test results'
  refusedConfig({ resultsOutput: 'docs/coverage/COVERAGE-MAP.html' }, want)
  refusedConfig(
    { output: 'site/map.html', resultsOutput: 'site/map.html' },
    want
  )
  const OLD = '<!doctype html><p>the page before this run</p>\n'
  const repo = bookstore({
    [PAGE]: OLD,
    'coverage-map.config.json':
      '{ "resultsOutput": "docs/coverage/COVERAGE-MAP.html" }\n',
  })
  try {
    const run = runResults(repo)
    assert.equal(run.status, 2, `exit code; stderr: ${run.stderr}`)
    assert.ok(run.stderr.includes(want), run.stderr)
    assert.equal(repo.read(PAGE), OLD, 'the committed page is left as it was')
  } finally {
    repo.done()
  }
})

// Gaps the mutation check found.

test('R1b: the committed page carries no test-run data at all, not even an empty one', () => {
  const repo = bookstore()
  try {
    assert.equal(repo.run().status, 0)
    const json = repo
      .read(PAGE)
      .match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)
    assert.ok(json, 'the page data')
    const data = JSON.parse(json[1])
    assert.ok(!Object.hasOwn(data, 'run'), `keys: ${Object.keys(data)}`)
  } finally {
    repo.done()
  }
})

test('R2b: an AC with a failing and a passing test is failing, and counts once in the tile, the filter and ✗n', () =>
  zoned(() => {
    const repo = bookstore({
      [COUPONS]: COUPONS_SUITE.replace(
        '})\n})',
        "})\n  it('REQ-CHECKOUT-012 ex2: keeps the total', () => {})\n})"
      ),
      [UNIT_XML]: jestJunit([
        { title: EX1_UNIT },
        { title: EX2_UNIT, failure: FAILURE },
        { title: 'REQ-CHECKOUT-012 ex2: keeps the total' },
      ]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const ex2 = acOf(p, 'ex2')
      assert.deepEqual(rowsOf(ex2).map(marksOf).sort(), [['✓'], ['✗']])
      assert.ok(shows(ex2, '✗ Failing'), flat(ex2))
      const text = flat(failingTile(p))
      assert.equal(
        squash(between(text, 'Failing ACs', '1 failing test')),
        'FailingACs1'
      )
      assert.ok(flat(treeRow(p, 'CHECKOUT')).includes('✗1'))
      const filter = [
        ...p.doc.querySelectorAll('.toolbar label, .toolbar button'),
      ].find((el) => flat(el).startsWith('Failing'))
      assert.equal(flat(filter).slice('Failing'.length).replace(/\D/g, ''), '1')
      ;(filter.querySelector('input') ?? filter).click()
      assert.deepEqual(
        [...p.doc.querySelectorAll('li.ac')].map((li) => li.id),
        ['REQ-CHECKOUT-012-ex2']
      )
    } finally {
      repo.done()
    }
  }))

test('R4b: the tile counts failing ACs and its line failing tests: one AC with two failing tests is "1", "2 failing tests"', () =>
  zoned(() => {
    const repo = bookstore({
      [COUPONS]: COUPONS_SUITE.replace(
        '})\n})',
        "})\n  it('REQ-CHECKOUT-012 ex2: keeps the total', () => {})\n})"
      ),
      [UNIT_XML]: jestJunit([
        { title: EX1_UNIT },
        { title: EX2_UNIT, failure: FAILURE },
        { title: 'REQ-CHECKOUT-012 ex2: keeps the total', failure: FAILURE },
      ]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const text = flat(failingTile(p))
      inOrder(text, ['Failing ACs', '2 failing tests'])
      assert.equal(
        squash(between(text, 'Failing ACs', '2 failing tests')),
        'FailingACs1'
      )
      assert.ok(flat(treeRow(p, 'CHECKOUT')).includes('✗1'))
      assert.ok(!flat(treeRow(p, 'CHECKOUT')).includes('✗2'))
      const filter = [
        ...p.doc.querySelectorAll('.toolbar label, .toolbar button'),
      ].find((el) => flat(el).startsWith('Failing'))
      assert.equal(flat(filter).slice('Failing'.length).replace(/\D/g, ''), '1')
    } finally {
      repo.done()
    }
  }))

test('R5b: ✗n is on every branch above a failing AC', () =>
  zoned(() => {
    const repo = bookstore({
      'docs/product/requirements/checkout.md': KIT_CHECKOUT.replace(
        '# Checkout requirements\n',
        '# Checkout requirements\n\nTree: Shop › Checkout\n'
      ),
    })
    try {
      const p = resultsPage(repo, '#/Shop/Checkout')
      for (const label of ['Shop', 'Checkout'])
        assert.ok(
          flat(treeRow(p, label)).includes('✗1'),
          `${label}: ${flat(treeRow(p, label))}`
        )
    } finally {
      repo.done()
    }
  }))

test('R3b: a case the run skipped makes its test "–" and its AC "– Only skipped"; the card counts it', () =>
  zoned(() => {
    const repo = bookstore({
      [UNIT_XML]: jestJunit([
        { title: EX1_UNIT },
        { title: EX2_UNIT, skipped: true },
      ]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const ex2 = acOf(p, 'ex2')
      assert.deepEqual(rowsOf(ex2).map(marksOf), [['–']])
      assert.ok(shows(ex2, '– Only skipped'), flat(ex2))
      inOrder(between(flat(lastRunCard(repo)), UNIT_XML, E2E_XML), [
        UNIT_XML,
        '1 passed',
        '0 failed',
        '1 skipped',
      ])
    } finally {
      repo.done()
    }
  }))

test('R6b: a test skipped in the code is not one "not in any results file"', () =>
  zoned(() => {
    const repo = bookstore({
      [COUPONS]: `${COUPONS_SUITE}it.skip('REQ-CHECKOUT-012 ex3: pays by card later', () => {})\n`,
    })
    try {
      assert.equal(runResults(repo).status, 0)
      const text = flat(lastRunCard(repo))
      assert.ok(
        text.includes('1 test in the code is not in any results file'),
        text
      )
    } finally {
      repo.done()
    }
  }))

test('R13b: a file cut off after a complete tag is not a JUnit report', () =>
  zoned(() => {
    const repo = bookstore({
      [UNIT_XML]:
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="jest tests">\n  <testsuite name="coupons">',
    })
    try {
      assert.equal(runResults(repo).status, 0)
      const text = flat(lastRunCard(repo))
      assert.ok(
        between(text, UNIT_XML, E2E_XML).includes('not a JUnit report'),
        text
      )
    } finally {
      repo.done()
    }
  }))

test('R9b: a file attribute names the file by its path, not its base name: a coupons.test.ts in another folder stays not run', () =>
  zoned(() => {
    const OTHER = 'src/legacy/coupons.test.ts'
    const repo = bookstore({
      [OTHER]: COUPONS_SUITE,
      [UNIT_XML]: jestJunit([
        { title: EX1_UNIT, file: COUPONS },
        { title: EX2_UNIT, failure: FAILURE, file: COUPONS },
      ]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      for (const [ex, mine] of [
        ['ex1', ['✓']],
        ['ex2', ['✗']],
      ]) {
        const mark = Object.fromEntries(
          rowsOf(acOf(p, ex)).map((r) => [pathOf(r), marksOf(r)])
        )
        assert.deepEqual(mark[COUPONS], mine, ex)
        assert.deepEqual(mark[OTHER], ['○'], `${ex}: ${JSON.stringify(mark)}`)
      }
    } finally {
      repo.done()
    }
  }))

test('R10b, boundary: the chain starts after a joiner: "coupons X" is not the "pons X" test\'s', () =>
  zoned(() => {
    const t = 'REQ-CHECKOUT-012 ex1: t'
    const repo = unitOnly({
      [COUPONS]: `describe('pons', () => {\n  it('${t}', () => {})\n})\ndescribe('coupons', () => {\n  it('${t}', () => {})\n})\n`,
      [UNIT_XML]: junitOf('coupons', [
        { name: `coupons ${t}`, classname: `coupons ${t}`, failure: FAILURE },
        { name: `pons ${t}`, classname: `pons ${t}` },
      ]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      assert.deepEqual(byDescribe(acOf(p, 'ex1')), {
        coupons: ['✗'],
        pons: ['✓'],
      })
    } finally {
      repo.done()
    }
  }))

test('R10b, prefix: a name with more before the joiner and the chain still matches it', () =>
  zoned(() => {
    // The project name first, as some Playwright reports write it.
    const repo = bookstore({
      'e2e/checkout.spec.ts': `test.describe('guest', () => {\n  test('${EX1_E2E}', async () => {})\n})\ntest.describe('member', () => {\n  test('${EX1_E2E}', async () => {})\n})\n`,
      [E2E_XML]: junitOf(
        'checkout.spec.ts',
        [
          {
            name: `chromium › guest › ${EX1_E2E}`,
            classname: 'checkout.spec.ts',
          },
          {
            name: `chromium › member › ${EX1_E2E}`,
            classname: 'checkout.spec.ts',
            failure: FAILURE,
          },
        ],
        { timestamp: '2026-11-03T09:20:00.000Z' }
      ),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const e2e = rowsOf(acOf(p, 'ex1')).filter(
        (r) => pathOf(r) === 'e2e/checkout.spec.ts'
      )
      assert.deepEqual(
        Object.fromEntries(
          e2e.map((r) => [flat(r.querySelector('.ct-ctx')), marksOf(r)])
        ),
        { guest: ['✓'], member: ['✗'] }
      )
    } finally {
      repo.done()
    }
  }))

test('R10d, ends with the title: the fallback takes a result whose name ends with the title, not one that only holds it', () =>
  zoned(() => {
    // Node's runner: describes as nested suites, a case named by its title only.
    const NODE = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
\t<testsuite name="coupons" tests="2" failures="1">
\t\t<testsuite name="REQ-CHECKOUT-012 ex1" tests="2" failures="1">
\t\t\t<testcase name="returns 0" time="0.0005" classname="test"/>
\t\t\t<testcase name="returns 0 when empty" time="0.0005" classname="test">
\t\t\t\t<failure message="expect(received).toBe(expected)">${xmlEsc(FAILURE)}</failure>
\t\t\t</testcase>
\t\t</testsuite>
\t</testsuite>
</testsuites>
`
    const repo = unitOnly({
      [COUPONS]:
        "describe('coupons', () => {\n  describe('REQ-CHECKOUT-012 ex1', () => {\n    it('returns 0', () => {})\n    it('returns 0 when empty', () => {})\n  })\n})\n",
      [UNIT_XML]: NODE,
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const rows = rowsOf(acOf(p, 'ex1'))
      const empty = rows.find((r) => flat(r).includes('when empty'))
      const plain = rows.find((r) => !flat(r).includes('when empty'))
      assert.ok(plain && empty, rows.map(flat).join(' | '))
      assert.deepEqual([marksOf(plain), marksOf(empty)], [['✓'], ['✗']])
    } finally {
      repo.done()
    }
  }))

test('R8b: a classname shaped like a test file names the file on its own, the suite name not a file', () =>
  zoned(() => {
    const repo = bookstore({
      'e2e/cart.spec.ts': `test('${EX1_E2E}', async () => {})\n`,
      [E2E_XML]: junitOf(
        'checkout',
        [{ name: EX1_E2E, classname: 'checkout.spec.ts' }],
        {
          timestamp: '2026-11-03T09:20:00.000Z',
        }
      ),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const mark = Object.fromEntries(
        rowsOf(acOf(p, 'ex1')).map((r) => [pathOf(r), marksOf(r)])
      )
      assert.deepEqual(mark['e2e/checkout.spec.ts'], ['✓'])
      assert.deepEqual(mark['e2e/cart.spec.ts'], ['○'], JSON.stringify(mark))
    } finally {
      repo.done()
    }
  }))

test('R8c: a suite name shaped like a test file names the file on its own, the classname not a file', () =>
  zoned(() => {
    const repo = bookstore({
      'e2e/cart.spec.ts': `test('${EX1_E2E}', async () => {})\n`,
      [E2E_XML]: junitOf(
        'checkout.spec.ts',
        [{ name: EX1_E2E, classname: 'Checkout flow' }],
        {
          timestamp: '2026-11-03T09:20:00.000Z',
        }
      ),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const mark = Object.fromEntries(
        rowsOf(acOf(p, 'ex1')).map((r) => [pathOf(r), marksOf(r)])
      )
      assert.deepEqual(mark['e2e/checkout.spec.ts'], ['✓'])
      assert.deepEqual(mark['e2e/cart.spec.ts'], ['○'], JSON.stringify(mark))
    } finally {
      repo.done()
    }
  }))

test('R10c, %%: in a .each title %% is a literal %, so "%s%% off" matches "10% off" and not "10 off" or "10x off"', () =>
  zoned(() => {
    const repo = unitOnly({
      [COUPONS]:
        "describe('coupons', () => {\n  it.each([[10]])('REQ-CHECKOUT-012 ex1: %s%% off', () => {})\n})\n",
      [UNIT_XML]: jestJunit([
        { title: 'REQ-CHECKOUT-012 ex1: 10% off' },
        { title: 'REQ-CHECKOUT-012 ex1: 10 off', failure: FAILURE },
        { title: 'REQ-CHECKOUT-012 ex1: 10x off', failure: FAILURE },
      ]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      assert.deepEqual(rowsOf(acOf(p, 'ex1')).map(marksOf), [['✓']])
    } finally {
      repo.done()
    }
  }))

// Last S3 round: more claims of the matching rule no test could fail on.

test('R14b, normalised: resultsOutput naming the same file as output by another spelling is refused too', () => {
  const want =
    'coverage-map.config.json: resultsOutput must differ from output, so the committed page never shows test results'
  for (const same of [
    './docs/coverage/COVERAGE-MAP.html',
    'docs//coverage/COVERAGE-MAP.html',
  ])
    assert.throws(
      () => need('resolveConfig')({ resultsOutput: same }),
      { message: want },
      same
    )
  refusedConfig({ resultsOutput: './docs/coverage/COVERAGE-MAP.html' }, want)
})

test('R10b, chain only: a test with a result by its chain takes no other through the fallback', () =>
  zoned(() => {
    // Only "returns 0" is in the code. "when empty returns 0" ends with its
    // title, but the test already has its own result by chain.
    const chain = (t) => `coupons REQ-CHECKOUT-012 ex1 ${t}`
    const repo = unitOnly({
      [COUPONS]:
        "describe('coupons', () => {\n  describe('REQ-CHECKOUT-012 ex1', () => {\n    it('returns 0', () => {})\n  })\n})\n",
      [UNIT_XML]: junitOf('coupons', [
        { name: chain('returns 0'), classname: chain('returns 0') },
        {
          name: chain('when empty returns 0'),
          classname: chain('when empty returns 0'),
          failure: FAILURE,
        },
      ]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      assert.deepEqual(rowsOf(acOf(p, 'ex1')).map(marksOf), [['✓']])
    } finally {
      repo.done()
    }
  }))

/** A unit test file of template-literal titles, one per AC, and their results (jest-junit). */
const templateRepo = (titles, cases) =>
  unitOnly({
    // S4 F6: no heading, so the root stays CHECKOUT.
    'docs/product/requirements/checkout.md': section(
      'REQ-CHECKOUT-012',
      '',
      titles.length
    ),
    [COUPONS]: `describe('coupons', () => {\n  const a = 1\n  const b = 2\n  const c = 3\n${titles.map((t) => `  it(\`${t}\`, () => {})\n`).join('')}})\n`,
    [UNIT_XML]: jestJunit(cases),
  })

test('R10c, not empty: what runs at runtime matches text that is not empty, at the end and in the middle', () =>
  zoned(() => {
    const repo = templateRepo(
      ['REQ-CHECKOUT-012 ex1: ${a}off', 'REQ-CHECKOUT-012 ex2: ${a}x${b} off'],
      [
        // ex1: nothing where ${a} is; ex2: nothing before the "x".
        { title: 'REQ-CHECKOUT-012 ex1: off', failure: FAILURE },
        { title: 'REQ-CHECKOUT-012 ex2: x1 off', failure: FAILURE },
      ]
    )
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      for (const ex of ['ex1', 'ex2'])
        assert.deepEqual(rowsOf(acOf(p, ex)).map(marksOf), [['○']], ex)
    } finally {
      repo.done()
    }
  }))

test('R10c, first fit: the last piece ends the name, and a piece that comes twice still fits', () =>
  zoned(() => {
    const repo = templateRepo(
      [
        'REQ-CHECKOUT-012 ex1: ${a} off',
        'REQ-CHECKOUT-012 ex2: ${a} + ${b} = ${c}',
      ],
      [
        // " off" comes twice; the title's last piece is the one at the end.
        { title: 'REQ-CHECKOUT-012 ex1: 10 off then 5 off' },
        // " + " comes twice before " = ".
        { title: 'REQ-CHECKOUT-012 ex2: 1 + 2 + 3 = 6' },
      ]
    )
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      for (const ex of ['ex1', 'ex2'])
        assert.deepEqual(rowsOf(acOf(p, ex)).map(marksOf), [['✓']], ex)
    } finally {
      repo.done()
    }
  }))

test('R10f, file shape: a classname is a file only with no space and ending in .test.<ext> or .spec.<ext>', () =>
  zoned(() => {
    // Read as files, neither would be the test's path, and the test would be ○.
    for (const [classname, why] of [
      [
        'coupons REQ-CHECKOUT-012 ex1: reads x.spec.ts',
        'a space, though it ends in .spec.ts',
      ],
      [
        'checkout.test.helpers.ts',
        '.test. in the middle, not before the extension',
      ],
    ]) {
      const repo = unitOnly({
        [COUPONS]:
          "describe('coupons', () => {\n  it('REQ-CHECKOUT-012 ex1: reads x.spec.ts', () => {})\n})\n",
        [UNIT_XML]: junitOf('coupons', [
          { name: 'coupons REQ-CHECKOUT-012 ex1: reads x.spec.ts', classname },
        ]),
      })
      try {
        const p = resultsPage(repo, '#/CHECKOUT')
        assert.deepEqual(rowsOf(acOf(p, 'ex1')).map(marksOf), [['✓']], why)
      } finally {
        repo.done()
      }
    }
  }))

test('R10f, suite name: a suite name with a space is not a file, though it ends in .test.ts', () =>
  zoned(() => {
    const t = 'REQ-CHECKOUT-012 ex1: reads it'
    const name = `parses a.test.ts ${t}`
    const repo = unitOnly({
      [COUPONS]: `describe('parses a.test.ts', () => {\n  it('${t}', () => {})\n})\n`,
      [UNIT_XML]: junitOf('parses a.test.ts', [{ name, classname: name }]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      assert.deepEqual(rowsOf(acOf(p, 'ex1')).map(marksOf), [['✓']])
    } finally {
      repo.done()
    }
  }))

test('R10g, slash: a file attribute ending in the path only past a "/" names that file, not ".../mysrc/…"', () =>
  zoned(() => {
    const FILE = '/x/mysrc/lib/pricing/coupons.test.ts'
    const repo = bookstore({
      [UNIT_XML]: jestJunit([
        { title: EX1_UNIT, file: FILE },
        { title: EX2_UNIT, failure: FAILURE, file: FILE },
      ]),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const ex1 = Object.fromEntries(
        rowsOf(acOf(p, 'ex1')).map((r) => [pathOf(r), marksOf(r)])
      )
      assert.deepEqual(ex1[COUPONS], ['○'], JSON.stringify(ex1))
      assert.deepEqual(rowsOf(acOf(p, 'ex2')).map(marksOf), [['○']])
    } finally {
      repo.done()
    }
  }))

test('R8, slash: a short path names the file only past a "/": min/checkout.spec.ts is not e2e/admin/checkout.spec.ts', () =>
  zoned(() => {
    const repo = bookstore({
      'e2e/admin/checkout.spec.ts': `test('${EX1_E2E}', async () => {})\n`,
      [E2E_XML]: junitOf(
        'min/checkout.spec.ts',
        [{ name: EX1_E2E, classname: 'min/checkout.spec.ts' }],
        { timestamp: '2026-11-03T09:20:00.000Z' }
      ),
    })
    try {
      const p = resultsPage(repo, '#/CHECKOUT')
      const mark = Object.fromEntries(
        rowsOf(acOf(p, 'ex1')).map((r) => [pathOf(r), marksOf(r)])
      )
      assert.deepEqual(
        mark['e2e/admin/checkout.spec.ts'],
        ['○'],
        JSON.stringify(mark)
      )
      assert.deepEqual(
        mark['e2e/checkout.spec.ts'],
        ['○'],
        JSON.stringify(mark)
      )
    } finally {
      repo.done()
    }
  }))

// ------------------------------------------------------------------ feature pages (F1–F5)
// F6 is the old tests changed above; F7 is compare.mjs --base; F8 the
// kit copy.

/** The requirement cards on the page, and the IDs of the open ones. */
const cards = (p) => [...p.doc.querySelectorAll('details.req')]
const openIds = (p) =>
  cards(p)
    .filter((d) => d.open)
    .map((d) => d.getAttribute('data-req'))

test('F1: on a leaf feature every requirement card is open; a click on its title closes it, and that choice survives a filter', async () => {
  // Travel: Ticketing, a leaf with two requirements.
  const fx = page(
    model({
      reqs: [
        REQ_004,
        reqWithAcs(2, 'ticket', 'Trips › Flights › Booking', '010'),
      ],
    }),
    at(TICKET_NODE)
  )
  assert.deepEqual(
    cards(fx).map((d) => d.getAttribute('data-req')),
    ['REQ-FLYB-004', 'REQ-FLYB-010']
  )
  assert.deepEqual(openIds(fx), ['REQ-FLYB-004', 'REQ-FLYB-010'])
  // Bookstore: CHECKOUT, a file with no heading and no Group by, so a leaf.
  const m = bookModel({
    'checkout.md': [
      section('REQ-CHECKOUT-012', '', 2),
      section('REQ-CHECKOUT-013', '', 2),
    ].join('\n'),
  })
  assert.deepEqual(m.tree.roots, ['CHECKOUT'])
  assert.deepEqual(node(m, 'CHECKOUT').children, [])
  const p = page(m, at('CHECKOUT'))
  assert.deepEqual(openIds(p), ['REQ-CHECKOUT-012', 'REQ-CHECKOUT-013'])
  // The ACs and the column of tests are in the open cards.
  for (const d of cards(p)) {
    assert.ok(flat(d).includes('Tests covering it'), flat(d))
    assert.equal(d.querySelectorAll('li.ac').length, 2)
  }
  // A click on a card's title closes it; the choice holds while a filter is
  // turned on and off; another click opens it again.
  const first = () =>
    p.doc.querySelector('details.req[data-req="REQ-CHECKOUT-012"]')
  first().querySelector('summary').click()
  await p.wait(10)
  assert.deepEqual(openIds(p), ['REQ-CHECKOUT-013'])
  p.doc.getElementById('f-untested').click()
  await p.wait(10)
  assert.equal(cards(p).length, 2, 'every AC is untested: both cards stay')
  assert.deepEqual(openIds(p), ['REQ-CHECKOUT-013'], 'filter on')
  p.doc.getElementById('f-untested').click()
  await p.wait(10)
  assert.deepEqual(openIds(p), ['REQ-CHECKOUT-013'], 'filter off')
  first().querySelector('summary').click()
  await p.wait(10)
  assert.deepEqual(openIds(p), ['REQ-CHECKOUT-012', 'REQ-CHECKOUT-013'])
  assert.deepEqual(p.errors, [])
})

test('F2: on a node with children the cards stay closed; with one requirement in scope, that one is open', () => {
  // Travel: Booking has Author and Ticketing under it.
  const two = model({
    reqs: [
      REQ_004,
      reqWithAcs(2, 'author', 'Trips › Flights › Booking', '011'),
    ],
  })
  const p = page(two, at('Trips/Flights/Booking'))
  assert.equal(cards(p).length, 2)
  assert.deepEqual(openIds(p), [])
  // One requirement under Booking: open, as today.
  const one = page(model(), at('Trips/Flights/Booking'))
  assert.deepEqual(openIds(one), ['REQ-FLYB-004'])
  // Bookstore: Checkout grouped by priority has Must and Should under it.
  const parent = page(bookModel(C8_FILES, {}, BY_PRIORITY), at('Checkout'))
  assert.equal(cards(parent).length, 2)
  assert.deepEqual(openIds(parent), [])
})

/** The Features card's rows: label, node key, whether a root, the row element. */
function featureRows(p) {
  const card = cardHeaded(p, 'Features')
  assert.ok(
    card,
    `a "Features" card: ${[...p.doc.querySelectorAll('main section')].map(headingOf).join(' | ')}`
  )
  return [...card.querySelectorAll('a')]
    .filter((a) => (a.getAttribute('href') ?? '').startsWith('#/'))
    .map((a) => {
      const key = a
        .getAttribute('href')
        .slice(2)
        .split('/')
        .map(decodeURIComponent)
        .join('/')
      return {
        a,
        key,
        label: flat(a),
        root: !key.includes('/'),
        row: a.closest('tr, li') ?? a.parentElement,
      }
    })
}
/** How a row looks: the row, its first cell and its link, as jsdom styles them. */
const rowLook = (p, r) =>
  [r.row, r.row.firstElementChild, r.a]
    .map((el) => `${el.tagName}{${look(p, el)}}`)
    .join(' ')
/**
 * The weight a row's name is drawn in: the first font-weight set on its link
 * or around it, up to the row (jsdom does not pass it down); a th, b or
 * strong with none set is bold, as browsers draw it.
 */
function weightOf(p, r) {
  for (let e = r.a; e && e !== r.row.parentElement; e = e.parentElement) {
    const w = p.dom.window.getComputedStyle(e).fontWeight
    if (w)
      return w === 'bold' || w === 'bolder'
        ? 700
        : w === 'normal' || w === 'lighter'
          ? 400
          : Number(w)
    if (/^(TH|B|STRONG)$/.test(e.tagName)) return 700
  }
  return 400
}
/** How far right a row's name starts: padding, margin and text indent from its link out to its cell. */
function indentOf(p, r) {
  const px = (v) => {
    const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v ?? '')
    return m ? Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1) : 0
  }
  const cell = r.a.closest('th, td') ?? r.row
  let sum = 0
  for (let e = r.a; e; e = e.parentElement) {
    const cs = p.dom.window.getComputedStyle(e)
    sum += px(cs.paddingLeft) + px(cs.marginLeft) + px(cs.textIndent)
    if (e === cell) break
  }
  return sum
}

const F3_FILES = {
  'accounts.md': `# Accounts\n\nTree: Accounts\n\n${section('REQ-ACCOUNTS-001', '', 1)}`,
  'checkout.md': `# Checkout\n\nTree: Shop › Checkout\n\n${section(
    'REQ-CHECKOUT-012',
    '',
    3,
    {
      2: '\n  Code: the second coupon is ignored.\n  Recommend: fix code — both coupons apply.',
    }
  )}`,
  'returns.md': `# Returns\n\nTree: Shop › Returns\n\n${section('REQ-RETURNS-001', '', 2)}`,
  // Planned only, so counted nowhere: no row, as today.
  'gifts.md': `# Gift cards\n\nTree: Shop › Gift cards\n\n${section('REQ-GIFTS-001', '', 1).replace('Status: active', 'Status: planned')}`,
  'loyalty.md': `# Loyalty\n\nTree: Planned › Loyalty\n\n${section('REQ-LOYALTY-001', '', 1).replace('Status: active', 'Status: planned')}`,
}
const F3_TESTS = { [COUPONS]: "it('REQ-CHECKOUT-012 ex1: a', () => {})\n" }

test('F3: the Overview has a "Features" card: each root with ACs a row, its children with ACs under it, the columns of today', () => {
  const m = bookModel(F3_FILES, F3_TESTS)
  const p = page(m)
  assert.equal(p.text('h1'), 'Project overview')
  const card = cardHeaded(p, 'Features')
  assert.ok(card, 'a "Features" card')
  assert.ok(
    flat(card).includes(
      'every area and the features under it · click one to open it'
    ),
    flat(card)
  )
  assert.equal(cardHeaded(p, 'By area'), undefined, 'no "By area" card')
  const rows = featureRows(p)
  assert.deepEqual(
    rows.map((r) => [r.label, r.key]),
    [
      ['Accounts', 'Accounts'],
      ['Shop', 'Shop'],
      ['Checkout', 'Shop/Checkout'],
      ['Returns', 'Shop/Returns'],
    ]
  )
  // A root row is set apart from the rows under it.
  for (const root of rows.filter((r) => r.root))
    for (const child of rows.filter((r) => !r.root))
      assert.notEqual(
        rowLook(p, root),
        rowLook(p, child),
        `${root.label} and ${child.label}`
      )
  // A root's name is bold; a child's starts further right than a root's.
  for (const root of rows.filter((r) => r.root))
    assert.ok(
      weightOf(p, root) >= 600,
      `${root.label}: weight ${weightOf(p, root)}`
    )
  for (const root of rows.filter((r) => r.root))
    for (const child of rows.filter((r) => !r.root))
      assert.ok(
        indentOf(p, child) > indentOf(p, root),
        `${child.label} (${indentOf(p, child)}px) is indented from ${root.label} (${indentOf(p, root)}px)`
      )
  // Each row: a bar as long as its %, the %, covered/total ACs, ≠drift.
  for (const [label, pct, acs, drift] of [
    ['Accounts', 0, '0/1 ACs', null],
    ['Shop', 20, '1/5 ACs', '≠1'],
    ['Checkout', 33, '1/3 ACs', '≠1'],
    ['Returns', 0, '0/2 ACs', null],
  ]) {
    const r = rows.find((x) => x.label === label)
    const text = flat(r.row)
    assert.ok(
      text.includes(`${pct}%`) && text.includes(acs),
      `${label}: ${text}`
    )
    if (drift) assert.ok(text.includes(drift), `${label}: ${text}`)
    else assert.ok(!text.includes('≠'), `${label}: ${text}`)
    assert.ok(
      [...r.row.querySelectorAll('[style]')].some((el) =>
        new RegExp(`width:\\s*${pct}%`).test(el.getAttribute('style'))
      ),
      `${label} has a bar ${pct}% long`
    )
  }
  // The planned requirements are named under the card, as today.
  const main = p.text()
  const sentence =
    '2 planned requirements: written from the documents, not built yet, not counted.'
  assert.ok(main.includes(sentence), main)
  assert.ok(
    main.indexOf(sentence) >
      main.indexOf('every area and the features under it')
  )
  // A child's name opens it.
  rows.find((r) => r.label === 'Checkout').a.click()
  assert.equal(decodeURI(p.dom.window.location.hash), '#/Shop/Checkout')
  assert.deepEqual(p.errors, [])
})


test('F3b: with --results a Features row says "✗n failing" when its node has failing ACs; without, no such column', () =>
  zoned(() => {
    const repo = bookstore({
      'docs/product/requirements/checkout.md': `Tree: Shop › Checkout\n\n${BOOKSTORE_CHECKOUT}`,
      'docs/product/requirements/returns.md': `Tree: Shop › Returns\n\n${section('REQ-RETURNS-001', '', 1)}`,
    })
    try {
      const rows = Object.fromEntries(
        featureRows(resultsPage(repo)).map((r) => [r.label, flat(r.row)])
      )
      assert.deepEqual(Object.keys(rows), ['Shop', 'Checkout', 'Returns'])
      assert.ok(rows.Shop.includes('✗1 failing'), rows.Shop)
      assert.ok(rows.Checkout.includes('✗1 failing'), rows.Checkout)
      assert.ok(
        !rows.Returns.includes('✗') && !rows.Returns.includes('failing'),
        rows.Returns
      )
      assert.equal(repo.run().status, 0)
      for (const r of featureRows(openHtml(repo.read(PAGE))))
        assert.ok(
          !flat(r.row).includes('✗') && !flat(r.row).includes('failing'),
          flat(r.row)
        )
      // No column at all, not an empty one: without --results a Features row
      // has the cells of a plain branch row (Shop's Branches card), with
      // --results one more.
      const plainPage = openHtml(repo.read(PAGE), '#/Shop')
      const branches = cardHeaded(plainPage, 'Branches')
      assert.ok(branches, 'Shop has a "Branches" card')
      const plain = [...branches.querySelectorAll('tr')].map(
        (tr) => tr.children.length
      )
      assert.ok(
        plain.length > 0 && plain.every((n) => n === plain[0]),
        `${plain}`
      )
      const cellsOf = (p) => featureRows(p).map((r) => r.row.children.length)
      assert.deepEqual(
        cellsOf(openHtml(repo.read(PAGE))),
        [plain[0], plain[0], plain[0]],
        'without --results'
      )
      assert.deepEqual(
        cellsOf(openHtml(repo.read(RESULTS_PAGE))),
        [plain[0] + 1, plain[0] + 1, plain[0] + 1],
        'with --results'
      )
    } finally {
      repo.done()
    }
  }))

test('F4: the tree on the left is headed "Features"', () => {
  for (const p of [page(model(), at(TICKET_NODE)), page(bookModel(F3_FILES))]) {
    const tree = flat(p.doc.getElementById('tree'))
    assert.ok(tree.startsWith('Features'), tree.slice(0, 80))
    assert.ok(!tree.includes('Requirements'), tree.slice(0, 80))
  }
})

test('F5: a file with no Tree: line names its root by its # heading less " requirements"; with no heading, by the file name in capitals', () => {
  const body = section('REQ-CHECKOUT-012', '', 1)
  for (const [head, root] of [
    ['# Checkout requirements', 'Checkout'],
    ['# Checkout Requirements', 'Checkout'],
    ['# Checkout REQUIREMENTS', 'Checkout'],
    ['# Payments', 'Payments'],
    ['', 'CHECKOUT'],
    ['# requirements', 'CHECKOUT'],
    ['# Requirements', 'CHECKOUT'],
  ]) {
    const m = bookModel({ 'checkout.md': head ? `${head}\n\n${body}` : body })
    assert.deepEqual(m.tree.roots, [root], JSON.stringify(head))
  }
  // On the page, in the tree.
  const p = page(
    bookModel({ 'checkout.md': `# Checkout requirements\n\n${body}` })
  )
  assert.deepEqual([...p.doc.querySelectorAll('.tn .tl')].map(flat), [
    'Checkout',
  ])
  // A Tree: line still names it.
  const tree = bookModel({
    'checkout.md': `# Payments\n\nTree: Shop\n\n${body}`,
  })
  assert.deepEqual(tree.tree.roots, ['Shop'])
})

// ------------------------------------------------------------------ the Map view (M1–M11, M14)
// M12 (speed in Chromium) and M13 (the kit copy) are checked
// elsewhere; M14 is compare.mjs --allow s5.
//
// jsdom has no layout and lacks PointerEvent, CSS.escape and pointer
// capture: mapPage() gives the map box (#map) a size and adds those before
// the page's script runs. What the tests read of the page's structure, kept
// here: the box is #map; the graph is the element in it whose inline style
// holds "translate(…px, …px) scale(…)"; each graph node is an element in it
// with inline left and top (graph coordinates, px); a node's toggle is its
// button with aria-expanded.

// The root node's name when the config has no `project` (an open question
// with the user; the spec proposes "Project").
const NO_PROJECT_ROOT = 'Project'
const MAP_W = 1000
const MAP_H = 600

const MAP_ACCOUNTS = `Tree: Accounts
Group by: feature

## REQ-ACCOUNTS-001 · Sign in with a password
Status: active
Tags: feature=Sign-in
- ex1: the right password → signed in
- ex2: a wrong password → "Wrong email or password"

## REQ-ACCOUNTS-002 · Stay signed in
Status: active
Tags: feature=Sign-in
- ex1: "Remember me" ticked → signed in for 30 days

## REQ-ACCOUNTS-003 · Reset a forgotten password
Status: active
Tags: feature=Password_reset
- ex1: a reset asked for → one email with a link
`
const MAP_CHECKOUT = `Tree: Checkout
Group by: feature

## REQ-CHECKOUT-010 · Add a book to the cart
Status: active
Tags: feature=Cart
- ex1: one book added → the cart shows 1
- ex2: the same book twice → the cart shows 2

## REQ-CHECKOUT-011 · Change a quantity
Status: active
Tags: feature=Cart
- ex1 \`assumed\`: quantity 0 → the line is removed

## REQ-CHECKOUT-012 · Coupons stack on one order
Status: active
Tags: feature=Coupons
- ex1: 10% + 5% on 100,000 → 85,500
- ex2: the order of entry does not change the total
- ex3: a coupon that expired yesterday → refused
  Code: an expired coupon is accepted.
  Recommend: fix code — an expired coupon must be refused.

## REQ-CHECKOUT-013 · Pay by card
Status: active
Tags: feature=Coupons
- ex1: a card payment → the order is paid
`
const MAP_FILES = { 'accounts.md': MAP_ACCOUNTS, 'checkout.md': MAP_CHECKOUT }
// Sign-in 3/3 (100%), Password reset 0/1, Cart 0/3 (REQ-CHECKOUT-010 ex1
// only skipped, ex2 none, REQ-CHECKOUT-011 ex1 unconfirmed, none), Coupons
// 3/4 (75%, ≠1); Accounts 3/4, Checkout 3/7, the project 6/11.
const MAP_TESTS = {
  'src/lib/accounts/sign-in.test.ts':
    "describe('sign-in', () => {\n  it('REQ-ACCOUNTS-001 ex1: right password', () => {})\n  it('REQ-ACCOUNTS-001 ex2: wrong password', () => {})\n  it('REQ-ACCOUNTS-002 ex1: remember me', () => {})\n})\n",
  [COUPONS]: `${COUPONS_SUITE}it.skip('REQ-CHECKOUT-010 ex1: adds a book', () => {})\n`,
  'e2e/checkout.spec.ts':
    "test('REQ-CHECKOUT-013 ex1: pays by card', async () => {})\n",
}
// The last run: ex1 passed, ex2 failed, the sign-in tests passed; the e2e
// test for REQ-CHECKOUT-013 ex1 is in no results file (not run).
const MAP_UNIT_XML = junitOf(
  'coupons',
  [
    [`coupons ${EX1_UNIT}`],
    [`coupons ${EX2_UNIT}`, FAILURE],
    ['sign-in REQ-ACCOUNTS-001 ex1: right password'],
    ['sign-in REQ-ACCOUNTS-001 ex2: wrong password'],
    ['sign-in REQ-ACCOUNTS-002 ex1: remember me'],
  ].map(([name, failure]) => ({ name, classname: name, failure }))
)
/** The Bookstore page as the committed page draws it, in memory. */
const mapHtml = (raw = {}, files = MAP_FILES, tests = MAP_TESTS) =>
  renderHtml(bookModel(files, tests, raw), { commit: 'abc1234' })
/** The Bookstore page with --results, written by the script. */
function mapResultsHtml(raw) {
  const repo = tempRepo(
    {
      'docs/product/requirements/accounts.md': MAP_ACCOUNTS,
      'docs/product/requirements/checkout.md': MAP_CHECKOUT,
      ...MAP_TESTS,
      [UNIT_XML]: MAP_UNIT_XML,
      ...(raw
        ? { 'coverage-map.config.json': `${JSON.stringify(raw)}\n` }
        : {}),
    },
    { touched: false }
  )
  try {
    const run = runResults(repo)
    assert.equal(run.status, 0, run.stderr)
    return repo.read(RESULTS_PAGE)
  } finally {
    repo.done()
  }
}

/** The page in jsdom with what the map needs of a browser: a sized box, pointer events, CSS.escape. */
function mapPage(
  html,
  { hash = '#map', width = MAP_W, height = MAP_H, url } = {}
) {
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => {
    if (!/Not implemented/.test(e.message)) errors.push(e.message)
  })
  const dom = new JSDOM(html, {
    url: url ?? `https://coverage.test/${hash}`,
    runScripts: 'dangerously',
    virtualConsole: vc,
    beforeParse(w) {
      if (!w.PointerEvent)
        w.PointerEvent = class PointerEvent extends w.MouseEvent {
          constructor(type, init = {}) {
            super(type, init)
            this.pointerId = init.pointerId ?? 1
            this.pointerType = init.pointerType ?? 'mouse'
            this.isPrimary = init.isPrimary ?? true
          }
        }
      w.CSS ??= {}
      w.CSS.escape ??= (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`)
      const E = w.Element.prototype
      E.setPointerCapture ??= function () {}
      E.releasePointerCapture ??= function () {}
      E.hasPointerCapture ??= () => false
      const rect = E.getBoundingClientRect
      E.getBoundingClientRect = function () {
        if (this.id !== 'map') return rect.call(this)
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width,
          height,
          right: width,
          bottom: height,
          toJSON() {},
        }
      }
    },
  })
  const doc = dom.window.document
  return {
    dom,
    doc,
    errors,
    text: (sel = 'main') =>
      (doc.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' '),
    wait: (ms = 0) => new Promise((r) => dom.window.setTimeout(r, ms)),
  }
}

/** Whether `el` is out of sight: hidden itself or by a parent, by attribute or style. */
function isHidden(p, el) {
  for (let e = el; e; e = e.parentElement) {
    if (e.hidden) return true
    const cs = p.dom.window.getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden') return true
  }
  return false
}
const px = (v) => Number(String(v ?? '').replace(/px$/, '')) || 0
const M = {
  box: (p) => p.doc.getElementById('map'),
  stage(p) {
    const box = M.box(p)
    return (
      box &&
      [...box.querySelectorAll('[style]')].find((el) =>
        /scale\(/.test(el.getAttribute('style'))
      )
    )
  },
  /** The graph's pan and zoom: translate(x, y) scale(k). */
  view(p) {
    const t = M.stage(p)?.style.transform ?? ''
    const m = t.match(
      /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\((-?[\d.]+)\)/
    )
    assert.ok(m, `the graph's transform: ${t}`)
    return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) }
  },
  nodes(p) {
    const stage = M.stage(p)
    return stage
      ? [...stage.querySelectorAll('[style]')].filter((el) => {
          const s = el.style
          return s.left !== '' && s.top !== ''
        })
      : []
  },
  /** Every element of every node, the nodes themselves included, found once. */
  inNodes: (p) =>
    new Set(M.nodes(p).flatMap((n) => [n, ...n.querySelectorAll('*')])),
  /** The element in a node that shows exactly `name` (not its toggle). */
  nameIn: (n, name) =>
    [...n.querySelectorAll('*')].find(
      (el) => flat(el) === name && !el.closest('button[aria-expanded]')
    ),
  node: (p, name) => M.nodes(p).find((n) => M.nameIn(n, name)),
  toggle: (n) => n.querySelector('button[aria-expanded]'),
  pos: (n) => ({
    left: px(n.style.left),
    top: px(n.style.top),
    width: px(n.style.width),
  }),
  /** Where a node's top is on screen, in px from the box's top. */
  screenTop(p, n) {
    const v = M.view(p)
    return v.y + M.pos(n).top * v.k
  },
  /** Buttons and labels of the box that are not in a node. */
  outside(p) {
    const inside = M.inNodes(p)
    return [...M.box(p).querySelectorAll('*')].filter((el) => !inside.has(el))
  },
  button: (p, text) =>
    M.outside(p).find((el) => el.tagName === 'BUTTON' && flat(el) === text),
  zoomLabel: (p) =>
    M.outside(p).find((el) => !el.children.length && /^\d+%$/.test(flat(el))),
  show: (p, label) =>
    [...p.doc.querySelectorAll('main button')].find((b) => flat(b) === label),
  close: (p) =>
    M.outside(p).find((el) => el.tagName === 'BUTTON' && flat(el) === '×'),
  panelOpen: (p) => !!M.close(p) && !isHidden(p, M.close(p)),
  panel: (p) => M.close(p)?.parentElement,
  legend: (p) => innermost(M.box(p), ['Under 50%', '50–79%', '80% and up']),
}
const mapLink = (p) =>
  [...p.doc.querySelectorAll('header a')].find((a) => flat(a) === 'Map')
const fire = {
  pointer: (p, el, type, { id = 1, x = 0, y = 0 } = {}) =>
    el.dispatchEvent(
      new p.dom.window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: id,
        button: 0,
      })
    ),
  wheel: (p, el, { deltaY, x, y }) =>
    el.dispatchEvent(
      new p.dom.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY,
        clientX: x,
        clientY: y,
      })
    ),
  key: (p, el, key) =>
    el.dispatchEvent(
      new p.dom.window.KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      })
    ),
}
/** The graph point under the screen point (x, y). */
const under = (p, x, y) => {
  const v = M.view(p)
  return { gx: (x - v.x) / v.k, gy: (y - v.y) / v.k }
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps
/** A node's look, itself and everything in it, as jsdom styles them. */
const nodeLook = (p, n) =>
  [n, ...n.querySelectorAll('*')].map((el) => look(p, el)).join('|')
/** The background the stylesheet gives `el`, shorthand or not. */
const bgOf = (p, el) => {
  const cs = p.dom.window.getComputedStyle(el)
  return (
    cs.getPropertyValue('background') || cs.getPropertyValue('background-color')
  )
}
/** The AC dots in a node or the legend: elements with neither text nor children nor inline style. */
const dotsIn = (el) =>
  [...el.querySelectorAll('*')].filter(
    (d) =>
      !d.children.length &&
      !d.textContent.trim() &&
      !d.getAttribute('style') &&
      d.tagName !== 'BUTTON'
  )
/** The legend's sample dot for an AC state: the dot its words follow. */
const legendDot = (p, words) =>
  dotsIn(M.legend(p)).find((d) =>
    (d.getAttribute('title') || d.nextSibling?.textContent || '')
      .trim()
      .toLowerCase()
      .startsWith(words)
  )
/** The legend's swatch for a band: the empty element inside the item with that name. */
const swatch = (p, band) => {
  const item = [...M.legend(p).querySelectorAll('*')].find(
    (el) => flat(el) === band && el.querySelector('*')
  )
  assert.ok(item, `a legend item "${band}"`)
  return [...item.querySelectorAll('*')].find((el) => !el.textContent.trim())
}

test('M1: a "Map" link after "Overview" opens #map: the tree hides, "Feature map", Show, legend, zoom, hint; leaving shows the tree again', async () => {
  const p = mapPage(mapHtml(), { hash: '' })
  const links = [...p.doc.querySelectorAll('header a')].map((a) => flat(a))
  const i = links.findIndex((l) => l.startsWith('Overview'))
  assert.ok(
    i >= 0 && links[i + 1] === 'Map',
    `the top bar: ${links.join(' | ')}`
  )
  mapLink(p).click()
  await p.wait(20)
  assert.equal(p.dom.window.location.hash, '#map')
  assert.ok(isHidden(p, p.doc.getElementById('tree')), 'the tree is hidden')
  assert.equal(p.text('h1'), 'Feature map')
  // Show: Areas · Features · Everything, in a group labelled Show.
  const shows = ['Areas', 'Features', 'Everything'].map((l) => M.show(p, l))
  assert.ok(shows.every(Boolean), 'three Show buttons')
  assert.ok(
    flat(shows[0].parentElement).startsWith('Show'),
    flat(shows[0].parentElement)
  )
  assert.ok(shows.every((b) => b.parentElement === shows[0].parentElement))
  // In the map box: the legend, "− 100% + Fit", the hint.
  const box = M.box(p)
  assert.ok(box, 'the map box')
  assert.ok(M.legend(p), 'a legend of the three bands')
  assert.ok(
    flat(box).includes(
      'Drag to move · scroll or pinch to zoom · + on a node opens its branch'
    ),
    flat(box).slice(0, 300)
  )
  const zoom = [
    M.button(p, '−'),
    M.zoomLabel(p),
    M.button(p, '+'),
    M.button(p, 'Fit'),
  ]
  assert.ok(zoom.every(Boolean), 'the zoom controls')
  const order = M.outside(p)
  assert.ok(
    zoom.every(
      (el, k) => k === 0 || order.indexOf(zoom[k - 1]) < order.indexOf(el)
    ),
    'in the order − 100% + Fit'
  )
  // Leaving #map shows the tree again.
  ;[...p.doc.querySelectorAll('header a')]
    .find((a) => flat(a) === 'Overview')
    .click()
  await p.wait(20)
  assert.equal(p.text('h1'), 'Project overview')
  assert.ok(!isHidden(p, p.doc.getElementById('tree')), 'the tree is back')
  assert.deepEqual(p.errors, [])
})

test(`M2: left to right, the project ("${NO_PROJECT_ROOT}" without one), the areas, the features, then requirements as leaves`, () => {
  const p = mapPage(mapHtml())
  const L = (name) => {
    const n = M.node(p, name)
    assert.ok(n, `a node "${name}": ${M.nodes(p).map(flat).join(' | ')}`)
    return M.pos(n).left
  }
  assert.ok(L(NO_PROJECT_ROOT) < L('Accounts'))
  assert.equal(L('Accounts'), L('Checkout'))
  assert.ok(L('Accounts') < L('Sign-in'))
  for (const f of ['Password reset', 'Cart', 'Coupons'])
    assert.equal(L(f), L('Sign-in'), f)
  // With a project in the config, its name.
  const named = mapPage(mapHtml({ project: 'Bookstore' }))
  assert.ok(M.node(named, 'Bookstore'), 'a node "Bookstore"')
  assert.equal(M.node(named, NO_PROJECT_ROOT), undefined)
  // Everything: each requirement a leaf, one column right of its feature.
  M.show(p, 'Everything').click()
  for (const code of ['CHECKOUT-012', 'CHECKOUT-013']) {
    const r = M.node(p, code)
    assert.ok(r, code)
    assert.equal(M.toggle(r), null, `${code} is a leaf`)
    assert.ok(M.pos(r).left > L('Coupons'), code)
  }
  const coupons = M.toggle(M.node(p, 'Coupons'))
  assert.equal(coupons.getAttribute('aria-expanded'), 'true')
  assert.match(coupons.getAttribute('aria-label'), /^Hide 2 .* of Coupons$/)
  assert.deepEqual(p.errors, [])
})

test('M2: a feature node says its name, "p% · covered/total ACs", ≠n with drift, ✗n with failing ACs; a requirement its code, title, dots and covered/total', () =>
  zoned(() => {
    const p = mapPage(mapHtml())
    for (const [name, stat, drift] of [
      ['Sign-in', '100% · 3/3 ACs', null],
      ['Password reset', '0% · 0/1 ACs', null],
      ['Cart', '0% · 0/3 ACs', null],
      ['Coupons', '75% · 3/4 ACs', '≠1'],
    ]) {
      const t = flat(M.node(p, name))
      assert.ok(t.includes(stat), `${name}: ${t}`)
      if (drift) assert.ok(t.includes(drift), `${name}: ${t}`)
      else assert.ok(!t.includes('≠'), `${name}: ${t}`)
      assert.ok(!t.includes('✗'), `${name} without --results: ${t}`)
    }
    M.show(p, 'Everything').click()
    const r = M.node(p, 'CHECKOUT-012')
    const t = flat(r)
    assert.ok(t.includes('Coupons stack on one order') && t.includes('2/3'), t)
    assert.ok(!t.includes('REQ-'), t)
    assert.equal(dotsIn(r).length, 3, 'a dot per AC')
    // With --results, ✗1 on Coupons and on what holds it.
    const q = mapPage(mapResultsHtml())
    for (const name of ['Coupons', 'Checkout', NO_PROJECT_ROOT])
      assert.ok(
        flat(M.node(q, name)).includes('✗1'),
        `${name}: ${flat(M.node(q, name))}`
      )
    for (const name of ['Sign-in', 'Cart', 'Accounts'])
      assert.ok(
        !flat(M.node(q, name)).includes('✗'),
        `${name}: ${flat(M.node(q, name))}`
      )
    assert.deepEqual([...p.errors, ...q.errors], [])
  }))

test('M2: a node with no AC says "No ACs", one with only planned requirements "N planned"', () => {
  const p = mapPage(
    mapHtml(
      {},
      {
        'profile.md': `Tree: Profile\n\n## REQ-PROFILE-001 · Edit the profile\nStatus: active\n`,
        'gifts.md': `Tree: Planned › Gift cards\n\n${section('REQ-GIFTS-001', '', 1).replace('Status: active', 'Status: planned')}`,
      },
      {}
    )
  )
  assert.ok(
    flat(M.node(p, 'Profile')).includes('No ACs'),
    flat(M.node(p, 'Profile'))
  )
  for (const name of ['Planned', 'Gift cards'])
    assert.ok(
      flat(M.node(p, name)).includes('1 planned'),
      `${name}: ${flat(M.node(p, name))}`
    )
})

test("M2: a node's background is its band's light colour, as the legend shows it, with a bar as long as its %", () => {
  const p = mapPage(mapHtml())
  const bands = ['Under 50%', '50–79%', '80% and up']
  const sw = Object.fromEntries(bands.map((b) => [b, bgOf(p, swatch(p, b))]))
  assert.equal(new Set(Object.values(sw)).size, 3, JSON.stringify(sw))
  for (const [name, band, pct] of [
    ['Sign-in', '80% and up', 100],
    ['Coupons', '50–79%', 75],
    ['Cart', 'Under 50%', 0],
    ['Checkout', 'Under 50%', 43],
  ]) {
    const n = M.node(p, name)
    const used = new Set(
      [n, ...n.querySelectorAll('*')].map((el) => bgOf(p, el))
    )
    assert.deepEqual(
      bands.filter((b) => used.has(sw[b])),
      [band],
      `${name}: ${[...used].join(', ')}`
    )
    assert.ok(
      [...n.querySelectorAll('[style]')].some((el) =>
        new RegExp(`width:\\s*${pct}%`).test(el.getAttribute('style'))
      ),
      `${name} has a bar ${pct}% long`
    )
  }
})

test('M3: without --results a dot is full for an AC with a test, empty without; with --results it shows the AC state, as the legend does', () =>
  zoned(() => {
    const p = mapPage(mapHtml())
    M.show(p, 'Everything').click()
    const [ex1, ex2, ex3] = dotsIn(M.node(p, 'CHECKOUT-012')).map((d) =>
      look(p, d)
    )
    assert.equal(ex1, ex2, 'ex1 and ex2 both have a test')
    assert.notEqual(ex1, ex3, 'ex3 has none')
    const plainLegend = flat(M.legend(p)).toLowerCase()
    for (const w of ['passing', 'failing', 'not run'])
      assert.ok(
        !plainLegend.includes(w),
        `no "${w}" without --results: ${plainLegend}`
      )
    // With --results: passing, failing, no test, not run, only skipped.
    const q = mapPage(mapResultsHtml())
    M.show(q, 'Everything').click()
    const states = [
      ['CHECKOUT-012', 0, 'passing'],
      ['CHECKOUT-012', 1, 'failing'],
      ['CHECKOUT-012', 2, 'no test'],
      ['CHECKOUT-013', 0, 'not run'],
      ['CHECKOUT-010', 0, 'only skipped'],
      ['CHECKOUT-010', 1, 'no test'],
    ]
    const looks = new Set()
    for (const [code, i, state] of states) {
      const sample =
        legendDot(q, state) ??
        (state === 'only skipped' ? legendDot(q, 'skipped') : undefined)
      assert.ok(sample, `the legend shows "${state}": ${flat(M.legend(q))}`)
      const dot = dotsIn(M.node(q, code))[i]
      assert.equal(
        look(q, dot),
        look(q, sample),
        `${code} ex${i + 1} is ${state}`
      )
      looks.add(look(q, sample))
    }
    assert.equal(looks.size, 5, 'five states, five looks')
    assert.deepEqual([...p.errors, ...q.errors], [])
  }))

test('M4: Bookstore opens on Features (4 rows); Areas, Features and Everything open to their depth, then Fit, the one in use marked; a toggle unseats them', () => {
  const p = mapPage(mapHtml())
  const pressed = () =>
    ['Areas', 'Features', 'Everything'].filter(
      (l) => M.show(p, l).getAttribute('aria-pressed') === 'true'
    )
  assert.deepEqual(pressed(), ['Features'])
  const shown = () => M.nodes(p).length
  assert.equal(shown(), 7, 'the project, 2 areas, 4 features')
  assert.equal(M.node(p, 'CHECKOUT-012'), undefined)
  for (const [label, n] of [
    ['Areas', 3],
    ['Everything', 14],
    ['Features', 7],
  ]) {
    M.show(p, label).click()
    assert.equal(shown(), n, label)
    assert.deepEqual(pressed(), [label])
    // Then Fit: what the Fit button gives.
    const after = M.view(p)
    M.button(p, 'Fit').click()
    const fitted = M.view(p)
    assert.ok(
      near(after.k, fitted.k, 0.001) &&
        near(after.x, fitted.x, 0.5) &&
        near(after.y, fitted.y, 0.5),
      `${label}: ${JSON.stringify([after, fitted])}`
    )
  }
  // Opening or closing one branch: none of the three is marked.
  M.toggle(M.node(p, 'Coupons')).click()
  assert.deepEqual(pressed(), [])
  assert.deepEqual(p.errors, [])
})


test('M5: a node with children has a toggle, "+n" closed and "−" open; it opens or closes the branch and the node stays where it was on screen', () => {
  const p = mapPage(mapHtml())
  const checkout = () => M.node(p, 'Checkout')
  const tog = () => M.toggle(checkout())
  assert.equal(flat(tog()), '−')
  assert.equal(tog().getAttribute('aria-expanded'), 'true')
  assert.equal(tog().getAttribute('aria-label'), 'Hide 2 features of Checkout')
  const y0 = M.screenTop(p, checkout())
  tog().click()
  assert.equal(flat(tog()), '+2')
  assert.equal(tog().getAttribute('aria-expanded'), 'false')
  assert.equal(tog().getAttribute('aria-label'), 'Show 2 features of Checkout')
  assert.equal(M.node(p, 'Cart'), undefined, 'its features are hidden')
  assert.ok(
    Math.abs(M.screenTop(p, checkout()) - y0) <= 1,
    'Checkout stays put'
  )
  tog().click()
  assert.equal(flat(tog()), '−')
  assert.ok(M.node(p, 'Cart'))
  assert.ok(Math.abs(M.screenTop(p, checkout()) - y0) <= 1, 'and again')
  // A feature: "+2" for its two requirements.
  const coupons = M.toggle(M.node(p, 'Coupons'))
  assert.equal(flat(coupons), '+2')
  assert.match(coupons.getAttribute('aria-label'), /^Show 2 .* of Coupons$/)
  const yc = M.screenTop(p, M.node(p, 'Coupons'))
  coupons.click()
  assert.ok(M.node(p, 'CHECKOUT-012') && M.node(p, 'CHECKOUT-013'))
  assert.ok(
    Math.abs(M.screenTop(p, M.node(p, 'Coupons')) - yc) <= 1,
    'Coupons stays put'
  )
  assert.deepEqual(p.errors, [])
})

test('M6: a click on a node selects it and opens its panel: path, name, the counts, its link; × and Esc close it', () =>
  zoned(() => {
    const p = mapPage(mapHtml())
    assert.ok(!M.panelOpen(p), 'no panel at first')
    const coupons = () => M.node(p, 'Coupons')
    const cart = () => M.node(p, 'Cart')
    const [lookC, lookK] = [nodeLook(p, coupons()), nodeLook(p, cart())]
    M.nameIn(coupons(), 'Coupons').click()
    assert.notEqual(nodeLook(p, coupons()), lookC, 'Coupons is outlined')
    assert.equal(nodeLook(p, cart()), lookK, 'Cart is not')
    assert.ok(M.panelOpen(p), 'the panel is open')
    const t = flat(M.panel(p))
    inOrder(t, [
      NO_PROJECT_ROOT,
      'Checkout',
      'Coupons',
      'ACs with a test',
      '75%',
    ])
    for (const row of ['Requirements', 'Unconfirmed ACs', 'Code differs'])
      assert.ok(t.includes(row), `${row}: ${t}`)
    assert.ok(!t.includes('Failing ACs'), t)
    // × closes; Esc too.
    M.close(p).click()
    assert.ok(!M.panelOpen(p))
    M.nameIn(cart(), 'Cart').click()
    const k = flat(M.panel(p))
    assert.ok(
      k.includes('Unconfirmed ACs') &&
        !k.includes('Code differs') &&
        !k.includes('Failing ACs'),
      k
    )
    fire.key(p, M.box(p), 'Escape')
    assert.ok(!M.panelOpen(p))
    // A feature's link opens its page.
    M.nameIn(coupons(), 'Coupons').click()
    const open = [...M.panel(p).querySelectorAll('a')].find(
      (a) => flat(a) === 'Open the page →'
    )
    assert.ok(open, flat(M.panel(p)))
    open.click()
    assert.equal(decodeURI(p.dom.window.location.hash), '#/Checkout/Coupons')
    assert.deepEqual(p.errors, [])
  }))

test("M6: a requirement's panel lists its ACs, each with a dot and its text, and opens the feature it belongs to; with --results, Failing ACs", () =>
  zoned(() => {
    const p = mapPage(mapHtml())
    M.show(p, 'Everything').click()
    M.nameIn(M.node(p, 'CHECKOUT-012'), 'CHECKOUT-012').click()
    const panel = M.panel(p)
    const t = flat(panel)
    inOrder(t, [
      '10% + 5% on 100,000 → 85,500',
      'the order of entry does not change the total',
      'a coupon that expired yesterday → refused',
    ])
    assert.equal(dotsIn(panel).length, 3, 'a dot per AC')
    const open = [...panel.querySelectorAll('a')].find(
      (a) => flat(a) === 'Open the feature it belongs to →'
    )
    assert.ok(open, t)
    open.click()
    assert.equal(decodeURI(p.dom.window.location.hash), '#/Checkout/Coupons')
    const q = mapPage(mapResultsHtml())
    M.nameIn(M.node(q, 'Coupons'), 'Coupons').click()
    assert.ok(flat(M.panel(q)).includes('Failing ACs'), flat(M.panel(q)))
    assert.deepEqual([...p.errors, ...q.errors], [])
  }))

test('M7: the wheel zooms about the pointer, a pinch zooms, − and + zoom about the centre by ×0.8 and ×1.25, the keys too; 15%–250%; the label says the zoom', () => {
  const p = mapPage(mapHtml())
  const box = M.box(p)
  const label = () => flat(M.zoomLabel(p))
  const shows = () => assert.equal(label(), `${Math.round(M.view(p).k * 100)}%`)
  shows()
  // The wheel, about the pointer: the point under it stays.
  const g0 = under(p, 300, 200)
  const k0 = M.view(p).k
  assert.equal(
    fire.wheel(p, box, { deltaY: -200, x: 300, y: 200 }),
    false,
    'the page does not scroll'
  )
  assert.ok(M.view(p).k > k0, 'zoomed in')
  const g1 = under(p, 300, 200)
  assert.ok(near(g0.gx, g1.gx) && near(g0.gy, g1.gy), JSON.stringify([g0, g1]))
  shows()
  // − and +: ×0.8 and ×1.25 about the centre.
  for (const [b, f] of [
    ['−', 0.8],
    ['+', 1.25],
  ]) {
    const before = M.view(p).k
    const c0 = under(p, MAP_W / 2, MAP_H / 2)
    M.button(p, b).click()
    assert.ok(
      near(M.view(p).k, before * f, 0.0001),
      `${b}: ${before} → ${M.view(p).k}`
    )
    const c1 = under(p, MAP_W / 2, MAP_H / 2)
    assert.ok(near(c0.gx, c1.gx) && near(c0.gy, c1.gy), b)
    shows()
  }
  // A pinch: two pointers moving apart zoom in.
  const n = M.node(p, 'Coupons')
  const kp = M.view(p).k
  fire.pointer(p, n, 'pointerdown', { id: 1, x: 400, y: 300 })
  fire.pointer(p, n, 'pointerdown', { id: 2, x: 600, y: 300 })
  fire.pointer(p, n, 'pointermove', { id: 2, x: 700, y: 300 })
  fire.pointer(p, n, 'pointerup', { id: 2, x: 700, y: 300 })
  fire.pointer(p, n, 'pointerup', { id: 1, x: 400, y: 300 })
  assert.ok(M.view(p).k > kp, `pinched: ${kp} → ${M.view(p).k}`)
  // Keys, the box focused: + − 0 and the arrows (60px).
  box.focus()
  let before = M.view(p)
  fire.key(p, box, '+')
  assert.ok(near(M.view(p).k, before.k * 1.25, 0.0001), '+')
  before = M.view(p)
  fire.key(p, box, '-')
  assert.ok(near(M.view(p).k, before.k * 0.8, 0.0001), '-')
  fire.key(p, box, '0')
  const byKey = M.view(p)
  M.button(p, 'Fit').click()
  assert.deepEqual(M.view(p), byKey, '0 is Fit')
  for (const [key, dx, dy] of [
    ['ArrowLeft', 60, 0],
    ['ArrowRight', 60, 0],
    ['ArrowUp', 0, 60],
    ['ArrowDown', 0, 60],
  ]) {
    before = M.view(p)
    fire.key(p, box, key)
    const v = M.view(p)
    assert.deepEqual(
      [Math.abs(v.x - before.x), Math.abs(v.y - before.y), v.k],
      [dx, dy, before.k],
      key
    )
  }
  // 15%–250%.
  for (let i = 0; i < 30; i++) M.button(p, '+').click()
  assert.equal(label(), '250%')
  for (let i = 0; i < 40; i++) M.button(p, '−').click()
  assert.equal(label(), '15%')
  assert.deepEqual(p.errors, [])
})

test('M7: under 45% a node shows only its name; its numbers and code are hidden', () => {
  const p = mapPage(mapHtml())
  M.show(p, 'Everything').click()
  const stat = (name, text) =>
    [...M.node(p, name).querySelectorAll('*')].find(
      (el) => !el.children.length && flat(el).includes(text)
    )
  const shown = () => ({
    name: !isHidden(p, M.nameIn(M.node(p, 'Coupons'), 'Coupons')),
    numbers: !isHidden(p, stat('Coupons', '75%')),
    code: !isHidden(p, M.nameIn(M.node(p, 'CHECKOUT-012'), 'CHECKOUT-012')),
  })
  while (M.view(p).k < 0.45) M.button(p, '+').click()
  assert.deepEqual(
    shown(),
    { name: true, numbers: true, code: true },
    `at ${flat(M.zoomLabel(p))}`
  )
  while (M.view(p).k >= 0.45) M.button(p, '−').click()
  assert.deepEqual(
    shown(),
    { name: true, numbers: false, code: false },
    `at ${flat(M.zoomLabel(p))}`
  )
})

test('M8: a drag over 4px moves the graph and is not a click; under 4px it is a click; the box does not scroll the page; a node tabbed to moves into view', () => {
  const p = mapPage(mapHtml())
  const name = () => M.nameIn(M.node(p, 'Coupons'), 'Coupons')
  const v0 = M.view(p)
  fire.pointer(p, name(), 'pointerdown', { x: 100, y: 100 })
  fire.pointer(p, name(), 'pointermove', { x: 115, y: 100 })
  fire.pointer(p, name(), 'pointermove', { x: 130, y: 110 })
  fire.pointer(p, name(), 'pointerup', { x: 130, y: 110 })
  name().click()
  const v1 = M.view(p)
  assert.deepEqual(
    [v1.x - v0.x, v1.y - v0.y, v1.k],
    [30, 10, v0.k],
    'moved by the drag'
  )
  assert.ok(!M.panelOpen(p), 'the drag was not a click')
  // Under 4px: a click.
  fire.pointer(p, name(), 'pointerdown', { x: 100, y: 100 })
  fire.pointer(p, name(), 'pointermove', { x: 102, y: 101 })
  fire.pointer(p, name(), 'pointerup', { x: 102, y: 101 })
  name().click()
  assert.ok(M.panelOpen(p), 'a short move is still a click')
  assert.deepEqual(
    [M.view(p).x, M.view(p).y],
    [v1.x, v1.y],
    'and does not move the graph'
  )
  // Tab to a node off screen: the box's own scroll becomes a pan, and is undone.
  const box = M.box(p)
  const before = M.view(p)
  box.scrollLeft = 120
  box.scrollTop = 40
  box.dispatchEvent(new p.dom.window.Event('scroll'))
  const after = M.view(p)
  assert.deepEqual([before.x - after.x, before.y - after.y], [120, 40])
  assert.deepEqual(
    [box.scrollLeft, box.scrollTop],
    [0, 0],
    'the box stays in place'
  )
  assert.deepEqual(p.errors, [])
})

test('M9: the map opens fitted when Fit gives 60% or more, else at 60% with the project at the left edge, centred; Fit always shows the whole graph', () => {
  // 1000×600: Fit is over 60%, so the first view is Fit's.
  const p = mapPage(mapHtml())
  const first = M.view(p)
  M.button(p, 'Fit').click()
  assert.deepEqual(M.view(p), first, 'the first view is Fit')
  assert.ok(first.k >= 0.6, `${first.k}`)
  // 1000×200: Fit would go under 60%, so 60%, the project at the left edge, centred.
  const low = mapPage(mapHtml(), { height: 200 })
  const start = () => {
    const v = M.view(low)
    const root = M.node(low, NO_PROJECT_ROOT)
    const left = v.x + M.pos(root).left * v.k
    const h = px(low.dom.window.getComputedStyle(root).height)
    const mid = v.y + (M.pos(root).top + h / 2) * v.k
    return { k: v.k, left, mid, h }
  }
  let s = start()
  assert.equal(s.k, 0.6)
  assert.equal(flat(M.zoomLabel(low)), '60%')
  assert.ok(
    s.left >= 0 && s.left <= 48,
    `the project at the left edge: ${s.left}`
  )
  assert.ok(s.h > 0, 'a node height')
  assert.ok(Math.abs(s.mid - 100) <= 1, `centred: ${s.mid}`)
  // The same after a Show button.
  M.show(low, 'Features').click()
  s = start()
  assert.ok(s.k === 0.6 && Math.abs(s.mid - 100) <= 1, JSON.stringify(s))
  // Fit shows every node inside the box.
  M.button(low, 'Fit').click()
  const v = M.view(low)
  assert.ok(v.k < 0.6 && v.k >= 0.15, `${v.k}`)
  for (const n of M.nodes(low)) {
    const { left, top, width } = M.pos(n)
    const h = px(low.dom.window.getComputedStyle(n).height)
    const box = [
      v.x + left * v.k,
      v.y + top * v.k,
      v.x + (left + width) * v.k,
      v.y + (top + h) * v.k,
    ]
    assert.ok(
      box[0] >= 0 && box[1] >= 0 && box[2] <= MAP_W && box[3] <= 200,
      `${flat(n)}: ${box}`
    )
  }
  assert.deepEqual([...p.errors, ...low.errors], [])
})


test('M10: back on #map after another view, the open branches, the zoom and the position are as they were', async () => {
  const p = mapPage(mapHtml())
  M.toggle(M.node(p, 'Coupons')).click()
  M.button(p, '+').click()
  fire.key(p, M.box(p), 'ArrowLeft')
  const view = M.view(p)
  const open = M.nodes(p).length
  ;[...p.doc.querySelectorAll('header a')]
    .find((a) => flat(a) === 'Overview')
    .click()
  await p.wait(20)
  assert.equal(p.text('h1'), 'Project overview')
  mapLink(p).click()
  await p.wait(20)
  assert.equal(p.text('h1'), 'Feature map')
  assert.deepEqual(M.view(p), view)
  assert.equal(M.nodes(p).length, open)
  assert.equal(
    M.toggle(M.node(p, 'Coupons')).getAttribute('aria-expanded'),
    'true'
  )
  assert.deepEqual(p.errors, [])
})

test('M11: nothing on the page leads outside but the font stylesheet, and the map works opened as a file', () => {
  const html = mapHtml()
  const p = mapPage(html, { url: 'file:///tmp/coverage/COVERAGE-MAP.html#map' })
  assert.equal(p.text('h1'), 'Feature map')
  assert.ok(M.node(p, 'Coupons'), 'the graph is drawn')
  M.show(p, 'Everything').click()
  M.button(p, 'Fit').click()
  const outside = [...p.doc.querySelectorAll('[href], [src]')]
    .map((el) => el.getAttribute('href') ?? el.getAttribute('src'))
    .filter(
      (u) =>
        /^[a-z][\w+.-]*:/i.test(u) &&
        !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)
    )
  assert.deepEqual(outside, [])
  assert.doesNotMatch(html, /<script[^>]+src=/)
  assert.deepEqual(p.errors, [])
})

// After the review and the Chromium check (M15–M20), and two gaps the
// mutation check found (M3b, M4b).

/** The rows the graph takes: the nodes shown with nothing shown under them. */
function mapRows(p) {
  return M.nodes(p).filter((n) => {
    const t = M.toggle(n)
    return !t || t.getAttribute('aria-expanded') === 'false'
  }).length
}
/** A node's own button, the one its toggle is not. */
const mainButton = (n) =>
  [...n.querySelectorAll('button')].find(
    (b) => !b.hasAttribute('aria-expanded')
  ) ?? n
/** Enter on `el` as a browser does it: the key, then a click from the keyboard (detail 0). */
function pressEnter(p, el) {
  const w = p.dom.window
  el.dispatchEvent(
    new w.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
  )
  el.dispatchEvent(
    new w.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })
  )
  el.dispatchEvent(
    new w.KeyboardEvent('keyup', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
  )
}
const bandColours = (p) =>
  new Set(
    ['Under 50%', '50–79%', '80% and up'].map((b) => bgOf(p, swatch(p, b)))
  )
const backgroundsIn = (p, n) =>
  new Set([n, ...n.querySelectorAll('*')].map((el) => bgOf(p, el)))

test('M3b: without --results, an AC whose only test is skipped has the empty dot of an AC with no test', () => {
  const p = mapPage(mapHtml())
  M.show(p, 'Everything').click()
  // REQ-CHECKOUT-010: ex1 only an it.skip test, ex2 none.
  const [skippedOnly, none] = dotsIn(M.node(p, 'CHECKOUT-010')).map((d) =>
    look(p, d)
  )
  const tested = look(p, dotsIn(M.node(p, 'CHECKOUT-012'))[0])
  assert.equal(skippedOnly, none, 'only skipped looks like no test')
  assert.notEqual(skippedOnly, tested, 'and not like an AC with a test')
})

test('M4b: 24 rows at the Features level open on Features; 25 open on Areas', () => {
  for (const [n, opens] of [
    [24, 'Features'],
    [25, 'Areas'],
  ]) {
    // One area, n features, each with one requirement: n rows at Features.
    const reqs = Array.from({ length: n }, (_, i) => {
      const id = String(i + 1).padStart(3, '0')
      return `## REQ-BIG-${id} · r${id}\nStatus: active\nTags: feature=F${id}\n- ex1: a → b\n`
    }).join('\n')
    const p = mapPage(
      mapHtml({}, { 'big.md': `Tree: Big\nGroup by: feature\n\n${reqs}` }, {})
    )
    const pressed = ['Areas', 'Features', 'Everything'].filter(
      (l) => M.show(p, l).getAttribute('aria-pressed') === 'true'
    )
    assert.deepEqual(pressed, [opens], `${n} rows`)
    M.show(p, 'Features').click()
    assert.equal(mapRows(p), n, `${n} rows at Features`)
  }
})

const M15_FILES = {
  ...MAP_FILES,
  'checkout.md': `${MAP_CHECKOUT}\n## REQ-CHECKOUT-014 · Wrap the order as a gift\nStatus: planned\nTags: feature=Coupons\n- ex1: gift wrap chosen → the order shows it\n`,
  // A node with no AC, to compare colours with.
  'profile.md':
    'Tree: Profile\n\n## REQ-PROFILE-001 · Edit the profile\nStatus: active\n',
}

test('M15: a planned requirement is a neutral node with no bar and no dots, says "planned", its panel says so, and its feature counts as before', () => {
  const p = mapPage(mapHtml({}, M15_FILES))
  M.show(p, 'Everything').click()
  const planned = M.node(p, 'CHECKOUT-014')
  assert.ok(planned, 'a node CHECKOUT-014')
  const t = flat(planned)
  assert.ok(t.includes('planned'), t)
  assert.ok(!/\d+%|\d+\/\d+/.test(t), `no share or count: ${t}`)
  assert.deepEqual(dotsIn(planned), [], 'no AC dots')
  assert.ok(
    ![...planned.querySelectorAll('[style]')].some((el) =>
      /width:\s*\d+%/.test(el.getAttribute('style'))
    ),
    'no bar'
  )
  // Neutral, as the "No ACs" node is.
  assert.ok(flat(M.node(p, 'Profile')).includes('No ACs'))
  const bands = bandColours(p)
  const mine = backgroundsIn(p, planned)
  assert.deepEqual(
    [...mine].filter((b) => bands.has(b)),
    [],
    'no band colour'
  )
  const neutral = backgroundsIn(p, M.node(p, 'Profile'))
  assert.deepEqual(
    [...mine].filter((b) => !neutral.has(b)),
    [],
    'only the colours of the "No ACs" node'
  )
  // Its feature counts as before: the planned requirement is not counted.
  assert.ok(
    flat(M.node(p, 'Coupons')).includes('75% · 3/4 ACs'),
    flat(M.node(p, 'Coupons'))
  )
  // The panel says planned, not "ACs with a test".
  M.nameIn(planned, 'CHECKOUT-014').click()
  const panel = flat(M.panel(p))
  assert.ok(!panel.includes('ACs with a test'), panel)
  assert.ok(
    panel.includes(
      'Planned: written from the documents, not built yet, not counted.'
    ),
    panel
  )
  assert.deepEqual(p.errors, [])
})


test('M16: a drag of 40px in 2px steps moves the graph by 40px, the steps before 4px included', () => {
  const p = mapPage(mapHtml())
  const name = M.nameIn(M.node(p, 'Coupons'), 'Coupons')
  const v0 = M.view(p)
  fire.pointer(p, name, 'pointerdown', { x: 100, y: 100 })
  for (let i = 1; i <= 20; i++)
    fire.pointer(p, name, 'pointermove', { x: 100 + 2 * i, y: 100 })
  fire.pointer(p, name, 'pointerup', { x: 140, y: 100 })
  const v1 = M.view(p)
  assert.deepEqual([v1.x - v0.x, v1.y - v0.y, v1.k], [40, 0, v0.k])
})

test('M17: after a Show button the map box has the focus, so the keys work at once; after × the selected node has it again', () => {
  const p = mapPage(mapHtml())
  M.show(p, 'Areas').click()
  assert.equal(p.doc.activeElement, M.box(p), 'the map box has the focus')
  const k = M.view(p).k
  fire.key(p, p.doc.activeElement, '+')
  assert.ok(near(M.view(p).k, k * 1.25, 0.0001), 'and + zooms')
  M.show(p, 'Features').click()
  M.nameIn(M.node(p, 'Coupons'), 'Coupons').click()
  assert.ok(M.panelOpen(p))
  M.close(p).click()
  assert.ok(!M.panelOpen(p))
  const a = p.doc.activeElement
  assert.ok(
    M.node(p, 'Coupons').contains(a),
    `focus on Coupons: ${a?.outerHTML?.slice(0, 120)}`
  )
  assert.ok(!a.hasAttribute('aria-expanded'), 'on the node, not its toggle')
  assert.deepEqual(p.errors, [])
})

test('M18: Esc closes the panel wherever the focus is on the map view', () => {
  const p = mapPage(mapHtml())
  const open = () => {
    M.nameIn(M.node(p, 'Coupons'), 'Coupons').click()
    assert.ok(M.panelOpen(p))
  }
  for (const [where, el] of [
    ['the search box', () => p.doc.getElementById('q')],
    ['a Show button', () => M.show(p, 'Areas')],
    ['the page', () => p.doc.body],
  ]) {
    open()
    const target = el()
    target.focus?.()
    target.dispatchEvent(
      new p.dom.window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    )
    assert.ok(!M.panelOpen(p), `Esc from ${where}`)
  }
  assert.deepEqual(p.errors, [])
})

test('M19: after a pinch, or a cancelled pointer, the next Enter on a node opens its panel', () => {
  const p = mapPage(mapHtml())
  const n = () => M.node(p, 'Coupons')
  fire.pointer(p, n(), 'pointerdown', { id: 1, x: 400, y: 300 })
  fire.pointer(p, n(), 'pointerdown', { id: 2, x: 600, y: 300 })
  fire.pointer(p, n(), 'pointermove', { id: 2, x: 700, y: 300 })
  fire.pointer(p, n(), 'pointerup', { id: 2, x: 700, y: 300 })
  fire.pointer(p, n(), 'pointerup', { id: 1, x: 400, y: 300 })
  pressEnter(p, mainButton(n()))
  assert.ok(M.panelOpen(p), 'after a pinch')
  assert.ok(flat(M.panel(p)).includes('Coupons'))
  M.close(p).click()
  const cart = () => M.node(p, 'Cart')
  fire.pointer(p, cart(), 'pointerdown', { x: 100, y: 100 })
  fire.pointer(p, cart(), 'pointermove', { x: 120, y: 100 })
  fire.pointer(p, cart(), 'pointercancel', { x: 120, y: 100 })
  pressEnter(p, mainButton(cart()))
  assert.ok(M.panelOpen(p), 'after pointercancel')
  assert.ok(flat(M.panel(p)).includes('Cart'), flat(M.panel(p)))
  assert.deepEqual(p.errors, [])
})

test('M20: on #map the menu button says "☰ Map"; with no node chosen its fallback label is "Features", not "Requirements"', () => {
  const p = mapPage(mapHtml())
  assert.equal(flat(p.doc.getElementById('menu')), '☰ Map')
  // The fallback cannot be reached from the page (a node view always has its
  // node), so it is read in the code: what builds the menu's label.
  const app = readFileSync(
    join(SOURCE, 'scripts/coverage-map/app.js'),
    'utf8'
  ).split('\n')
  const at = app.findIndex((l) => l.includes('☰') && l.includes('textContent'))
  assert.ok(at > 0, "the line that writes the menu's label")
  const label = app.slice(Math.max(0, at - 25), at + 1).join('\n')
  assert.ok(label.includes("'Features'"), label)
  assert.ok(!label.includes("'Requirements'"), label)
})

// ---- Priority on a Recommend line: `Recommend: fix code (P0) — <why>` ----

const PRIO = REQ_004.replace(
  '- ex2: "F" → 0',
  '- ex2: "F" → 0\n  Code: "F" books 1.\n  Recommend: fix code (P2) — scores a wrong answer.\n- ex3: "Z" → 0\n  Code: "Z" books 1.\n  Recommend: fix code (P0) — every traveller on the common path.\n- ex4: "x" → 0\n  Code: "x" books 1.\n  Recommend: fix code — not ticketed (yet).\n- ex5: "y" → 0\n  Code: "y" books 1.\n  Recommend: fix AC (P0) — the code is right.'
)

test('PR1: a priority in brackets is read off the Recommend line, and is optional', () => {
  const m = model({ reqs: [PRIO] })
  assert.deepEqual(ex(m, 'REQ-FLYB-004', 'ex3').recommend, {
    kind: 'code',
    priority: 'P0',
    reason: 'every traveller on the common path.',
  })
  // Brackets after the dash belong to the reason.
  assert.deepEqual(ex(m, 'REQ-FLYB-004', 'ex4').recommend, {
    kind: 'code',
    priority: null,
    reason: 'not ticketed (yet).',
  })
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex5').recommend.priority, 'P0')
  assert.equal(m.problems.filter((p) => p.includes('priority')).length, 0)
})

test('PR2: a priority outside P0–P3 is a data problem, and counts as none', () => {
  const m = model({ reqs: [PRIO.replace('(P2)', '(P5)')] })
  assert.ok(
    m.problems.includes('REQ-FLYB-004 ex2: priority must be P0–P3, not (P5)'),
    m.problems.join('\n')
  )
  assert.equal(ex(m, 'REQ-FLYB-004', 'ex2').recommend.priority, null)
})

test('PR3: open P0s count only code fixes', () => {
  const m = model({ reqs: [PRIO] })
  assert.equal(stats(m, 'Trips').driftCodeP0, 1)
  assert.equal(stats(model({ reqs: [DRIFT] }), 'Trips').driftCodeP0, 0)
})

test('PR4: the Code drift tab shows the open P0s, only when there are some', () => {
  const tab = (m) => page(m).doc.querySelector('a[data-view="drift"]')
  const withP0 = tab(model({ reqs: [PRIO] }))
  assert.equal(withP0.querySelector('.badge-p0').textContent, 'P0 1')
  assert.equal(tab(model({ reqs: [DRIFT] })).querySelector('.badge-p0'), null)
})

test('PR5: the chip on an AC names its priority', () => {
  const p = page(model({ reqs: [PRIO] }), at(TICKET_NODE))
  assert.equal(p.ac('REQ-FLYB-004-ex3').querySelector('.rec').textContent, 'Recommend: fix code · P0')
  assert.equal(p.ac('REQ-FLYB-004-ex4').querySelector('.rec').textContent, 'Recommend: fix code')
})

test('PR6: the Code drift view puts P0 first, marks each priority, and counts P0 in the heading', () => {
  const p = page(model({ reqs: [PRIO] }), '#drift')
  const [code, ac] = [...p.doc.querySelectorAll('.dgroup')]
  assert.deepEqual(
    [...code.querySelectorAll('.dcard')].map((c) => [
      c.querySelector('a').textContent,
      c.querySelector('.chip-prio')?.textContent ?? null,
    ]),
    [
      ['REQ-FLYB-004 ex3', 'P0'],
      ['REQ-FLYB-004 ex2', 'P2'],
      ['REQ-FLYB-004 ex4', null],
    ]
  )
  assert.match(code.querySelector('h3').textContent, /\(3 · 1 P0\)$/)
  assert.match(ac.querySelector('h3').textContent, /\(1\)$/)
})

// ------------------------------------------------------------------ Known gaps (test.failing / test.fail)
// Cases "KG ex1" to "KG ex9". A test marked as failing (Jest test.failing or
// it.failing, Playwright test.fail(title, fn)) names an AC the code does not
// meet yet: a known gap. It counts as a test, and its AC as differing from
// the code, with or without a Code: line. Jest's JUnit reports such a test
// passed when it fails as expected and failed when it passes unexpectedly;
// Playwright does the same for test.fail. "Code: line may be stale" is a
// separate mark, drawn only with --results: an AC with a Code: line whose
// plain test passed.

const KG_DOC = 'docs/product/requirements/shop.md'
const KG_UNIT = 'src/shop/wrap.test.ts'
const KG_E2E = 'e2e/wrap.spec.ts'
const KG_REQ = `# Shop requirements

## REQ-SHOP-001 · Gift wrap
Status: active
- ex1: gift wrap on a 100,000 order → 110,000
- ex2: gift wrap twice on one order → charged once
`
const KG_EX1 = 'REQ-SHOP-001 ex1: wraps a 100,000 order for 110,000'
const KG_EX1_OWN = 'wraps a 100,000 order for 110,000'
const KG_EX2 = 'REQ-SHOP-001 ex2: charges one wrap for two'
const KG_EX2_OWN = 'charges one wrap for two'
/** What Jest writes when a test.failing passes. */
const KG_PASSED_ANYWAY =
  'Error: Failing test passed even though it was expected to fail. Remove `.failing` to remove error.'
/** `test.failing`, `it.failing` or a plain `it` around `title`, in describe('wrap'). */
const kgUnit = (...tests) =>
  `describe('wrap', () => {\n${tests
    .map(
      ([how, title]) =>
        `  ${how}('${title}', () => {\n    expect(wrapPrice(100000)).toBe(110000)\n  })\n`
    )
    .join('')}})\n`
/** The Shop repository: KG_REQ, then `files` (which may replace it). */
const kgRepo = (files) =>
  tempRepo({ [KG_DOC]: KG_REQ, ...files }, { touched: false })
const kgAc = (p, ex, req = 'REQ-SHOP-001') =>
  p.doc.getElementById(`${req}-${ex}`)
/** The test row under `ac` whose text holds `own`. */
const kgRow = (ac, own) => rowsOf(ac).find((r) => flat(r).includes(own))
/** What `el` says: its text, and the title and aria-label of it and of all inside it. */
const kgSays = (el) =>
  [el, ...el.querySelectorAll('*')]
    .map((e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''}`)
    .join(' ') + ` ${flat(el)}`
/** The state chip of an AC on a --results page. */
function kgState(ac) {
  const chip = ac.querySelector('.state')
  assert.ok(chip, `the AC has a state chip: ${flat(ac)}`)
  return flat(chip)
}
const kgDriftTab = (p) => p.doc.querySelector('a[data-view="drift"]')
const STALE = /Code: line may be stale/i
/** The count a part of the Code drift tab naming "stale" (text, title or aria-label) holds; null: none. */
function kgStaleOnTab(p) {
  for (const el of kgDriftTab(p).querySelectorAll('*'))
    if (/stale/i.test(kgSays(el))) return flat(el).match(/\d+/)?.[0] ?? null
  return null
}
/** --results in `repo` (it must succeed and attach every test a result), then the page at #/Shop. */
function kgResults(repo) {
  const run = runResults(repo)
  assert.equal(run.status, 0, run.stderr)
  assert.ok(
    run.stdout.includes('0 tests in the code are in no results file'),
    `every test has a result: ${run.stdout}`
  )
  return openHtml(repo.read(RESULTS_PAGE), '#/Shop')
}

/** Without --results: what ex1 says of the test naming REQ-SHOP-001 ex1 (`own`), and what is counted. */
function kgWithout(files, own = KG_EX1_OWN) {
  const repo = kgRepo(files)
  try {
    const run = repo.run()
    assert.equal(run.status, 0, run.stderr)
    assert.ok(!repo.has(RESULTS_PAGE), 'no results page')
    const p = openHtml(repo.read(PAGE), '#/Shop')
    const ex1 = kgAc(p, 'ex1')
    assert.ok(ex1, `ex1 is on the page: ${p.text()}`)
    const row = kgRow(ex1, own)
    assert.ok(row, `the test is listed under ex1: ${flat(ex1)}`)
    assert.deepEqual(p.errors, [])
    const drift = openHtml(repo.read(PAGE), '#drift').text()
    return {
      'the test is marked "known gap"': /known gap/i.test(kgSays(row)),
      'console line': run.stdout.split('\n')[0],
      'Code drift tab': flat(kgDriftTab(p).querySelector('.badge')),
      'ex1 on the Code drift view': drift.includes('REQ-SHOP-001 ex1'),
      'ex2 on the Code drift view': drift.includes('REQ-SHOP-001 ex2'),
    }
  } finally {
    repo.done()
  }
}
// ex1 tested (a known gap is a test, Decisions) and differing from the code;
// ex2 has neither a test nor a Code: line.
const KG_WITHOUT = {
  'the test is marked "known gap"': true,
  'console line':
    '1 requirements, 2 ACs, 1 tested, 1 differ from code; 1 tests scanned, 0 linked to no requirement',
  'Code drift tab': '1',
  'ex1 on the Code drift view': true,
  'ex2 on the Code drift view': false,
}

test('KG ex1: without --results a test.failing shows under its AC as a known gap; the AC counts as tested and as differing from the code, with no Code: line', () => {
  assert.deepEqual(
    kgWithout({ [KG_UNIT]: kgUnit(['test.failing', KG_EX1]) }),
    KG_WITHOUT
  )
})

test('KG ex2: it.failing, and Playwright test.fail(title, fn), give what test.failing gives', () => {
  const variants = {
    'it.failing': { [KG_UNIT]: kgUnit(['it.failing', KG_EX1]) },
    'test.fail (Playwright)': {
      [KG_E2E]: `test.fail('${KG_EX1}', async ({ page }) => {\n  await page.goto('/cart')\n})\n`,
    },
  }
  const seen = {}
  for (const [how, files] of Object.entries(variants))
    seen[how] = kgWithout(files)
  assert.deepEqual(seen, {
    'it.failing': KG_WITHOUT,
    'test.fail (Playwright)': KG_WITHOUT,
  })
})

test('KG ex3: with --results, a test.failing the run reports passed (it failed as expected) makes its AC "Known gap", not "Passing"; a Playwright test.fail too', () =>
  zoned(() => {
    const repo = kgRepo({
      [KG_UNIT]: kgUnit(['test.failing', KG_EX1]),
      [UNIT_XML]: jestJunit([{ title: KG_EX1 }], { suite: 'wrap' }),
      [KG_E2E]: `test.fail('${KG_EX2}', async ({ page }) => {\n  await page.goto('/cart')\n})\n`,
      [E2E_XML]: playwrightJunit({ 'wrap.spec.ts': [KG_EX2] }),
    })
    try {
      const p = kgResults(repo)
      const ex1 = kgAc(p, 'ex1')
      assert.ok(kgRow(ex1, KG_EX1_OWN), `the test is listed under ex1: ${flat(ex1)}`)
      assert.match(kgState(ex1), /Known gap$/)
      assert.ok(!shows(ex1, 'Passing'), flat(ex1))
      const ex2 = kgAc(p, 'ex2')
      assert.ok(kgRow(ex2, KG_EX2_OWN), `the test is listed under ex2: ${flat(ex2)}`)
      assert.match(kgState(ex2), /Known gap$/)
      assert.ok(!shows(ex2, 'Passing'), flat(ex2))
      assert.deepEqual(p.errors, [])
    } finally {
      repo.done()
    }
  }))

test('KG ex4: with --results, a test.failing the run reports failed (it passed: the code now meets the AC) makes its AC "Failing", with the error under the test', () =>
  zoned(() => {
    const repo = kgRepo({
      [KG_UNIT]: kgUnit(['test.failing', KG_EX1], ['test.failing', KG_EX2]),
      [UNIT_XML]: jestJunit(
        [{ title: KG_EX1, failure: KG_PASSED_ANYWAY }, { title: KG_EX2 }],
        { suite: 'wrap' }
      ),
    })
    try {
      const p = kgResults(repo)
      // The page tells a failing test from a plain one: ex2's, passed as
      // expected, is a known gap.
      assert.match(kgState(kgAc(p, 'ex2')), /Known gap$/)
      const ex1 = kgAc(p, 'ex1')
      const row = kgRow(ex1, KG_EX1_OWN)
      assert.ok(row, `the test is listed under ex1: ${flat(ex1)}`)
      assert.match(kgState(ex1), /Failing$/)
      assert.deepEqual(marksOf(row), ['✗'])
      assert.ok(
        flat(row).includes('Remove `.failing` to remove error.'),
        `the error under the test: ${flat(row)}`
      )
    } finally {
      repo.done()
    }
  }))

// REQ-SHOP-001 ex2 and REQ-SHOP-002 ex1 and ex2 differ from the code (a Code:
// line each). REQ-SHOP-002 ex1 has a plain test that passes: its Code: line
// may be stale. REQ-SHOP-002 ex2 has no test.
const KG_CODE_REQ = `# Shop requirements

## REQ-SHOP-001 · Gift wrap
Status: active
- ex1: gift wrap on a 100,000 order → 110,000
- ex2: gift wrap twice on one order → charged once
  Code: two wraps on one order are charged twice (wrap.ts).
  Recommend: fix code — a customer pays for one wrap.

## REQ-SHOP-002 · Wrapping paper
Status: active
- ex1: no paper chosen → plain brown paper
  Code: no paper chosen → no wrap at all (wrap.ts).
  Recommend: fix code — the shop always wraps.
- ex2: paper out of stock → plain brown paper
  Code: paper out of stock → the order fails (wrap.ts).
  Recommend: fix code — never fail an order for paper.
`
const KG_PAPER = 'REQ-SHOP-002 ex1: plain brown paper by default'
/** KG_CODE_REQ, REQ-SHOP-001 ex2's test written `how` with `result` ({ failure? }), REQ-SHOP-002 ex1's plain and passed. */
const kgCodeRepo = (how, result = {}) =>
  kgRepo({
    [KG_DOC]: KG_CODE_REQ,
    [KG_UNIT]: kgUnit([how, KG_EX2], ['it', KG_PAPER]),
    [UNIT_XML]: jestJunit([{ title: KG_EX2, ...result }, { title: KG_PAPER }], {
      suite: 'wrap',
    }),
  })

test('KG ex5: with --results, an AC with a Code: line whose plain test passed is marked "Code: line may be stale", and the Code drift tab counts those ACs; without --results no such mark', () =>
  zoned(() => {
    const repo = kgCodeRepo('it')
    try {
      const p = kgResults(repo)
      const ex2 = kgAc(p, 'ex2')
      assert.ok(kgRow(ex2, KG_EX2_OWN), `the test is listed under ex2: ${flat(ex2)}`)
      assert.match(kgSays(ex2), STALE, `ex2: ${flat(ex2)}`)
      const paper1 = kgAc(p, 'ex1', 'REQ-SHOP-002')
      assert.match(kgSays(paper1), STALE, `REQ-SHOP-002 ex1: ${flat(paper1)}`)
      // No test, so nothing says the Code: line is out of date.
      const paper2 = kgAc(p, 'ex2', 'REQ-SHOP-002')
      assert.doesNotMatch(kgSays(paper2), STALE, `REQ-SHOP-002 ex2: ${flat(paper2)}`)
      assert.equal(
        kgStaleOnTab(p),
        '2',
        `the Code drift tab counts the 2 ACs: ${kgDriftTab(p).outerHTML}`
      )
      // Without results nothing says whether the test passes (Decisions).
      assert.equal(repo.run().status, 0)
      const today = openHtml(repo.read(PAGE), '#/Shop')
      assert.doesNotMatch(kgSays(today.doc.querySelector('main')), /stale/i)
      assert.equal(kgStaleOnTab(today), null)
    } finally {
      repo.done()
    }
  }))

test('KG ex6: with --results, an AC with a Code: line whose plain test failed has no "may be stale" mark and is "Failing"', () =>
  zoned(() => {
    const repo = kgCodeRepo('it', { failure: FAILURE })
    try {
      const p = kgResults(repo)
      // The mark is drawn on this page: REQ-SHOP-002 ex1's test passed.
      assert.match(kgSays(kgAc(p, 'ex1', 'REQ-SHOP-002')), STALE)
      const ex2 = kgAc(p, 'ex2')
      assert.ok(kgRow(ex2, KG_EX2_OWN), `the test is listed under ex2: ${flat(ex2)}`)
      assert.doesNotMatch(kgSays(ex2), /stale/i, flat(ex2))
      assert.match(kgState(ex2), /Failing$/)
    } finally {
      repo.done()
    }
  }))

test('KG ex7: with --results, an AC with a Code: line and only a test.failing that failed as expected has no "may be stale" mark and is "Known gap"', () =>
  zoned(() => {
    const repo = kgCodeRepo('test.failing')
    try {
      const p = kgResults(repo)
      assert.match(kgSays(kgAc(p, 'ex1', 'REQ-SHOP-002')), STALE)
      const ex2 = kgAc(p, 'ex2')
      assert.ok(kgRow(ex2, KG_EX2_OWN), `the test is listed under ex2: ${flat(ex2)}`)
      assert.doesNotMatch(kgSays(ex2), /stale/i, flat(ex2))
      assert.match(kgState(ex2), /Known gap$/)
    } finally {
      repo.done()
    }
  }))

test('KG ex8: a plain test that passed wins over a test.failing that passed as expected ("Passing"); a test.failing reported failed makes it "Failing"', () =>
  zoned(() => {
    const t = {
      plain1: 'REQ-SHOP-001 ex1: adds 10,000 for a wrap',
      gap1: KG_EX1,
      plain2: KG_EX2,
      gap2: 'REQ-SHOP-001 ex2: charges once at checkout',
      gap3: 'REQ-SHOP-001 ex3: refuses a wrap on a voucher',
    }
    const repo = kgRepo({
      [KG_DOC]: `${KG_REQ}- ex3: gift wrap on a voucher → refused\n`,
      [KG_UNIT]: kgUnit(
        ['it', t.plain1],
        ['test.failing', t.gap1],
        ['it', t.plain2],
        ['test.failing', t.gap2],
        ['test.failing', t.gap3]
      ),
      [UNIT_XML]: jestJunit(
        [
          { title: t.plain1 },
          { title: t.gap1 },
          { title: t.plain2 },
          { title: t.gap2, failure: KG_PASSED_ANYWAY },
          { title: t.gap3 },
        ],
        { suite: 'wrap' }
      ),
    })
    try {
      const p = kgResults(repo)
      // On its own, a test.failing passed as expected is a known gap.
      assert.match(kgState(kgAc(p, 'ex3')), /Known gap$/)
      const ex1 = kgAc(p, 'ex1')
      assert.equal(rowsOf(ex1).length, 2, `both tests under ex1: ${flat(ex1)}`)
      assert.match(kgState(ex1), /Passing$/)
      const ex2 = kgAc(p, 'ex2')
      assert.equal(rowsOf(ex2).length, 2, `both tests under ex2: ${flat(ex2)}`)
      assert.match(kgState(ex2), /Failing$/)
    } finally {
      repo.done()
    }
  }))

// ex9's repository: the Bookstore of the R-tests (ex1 passed, ex2 failed, ex3
// in no results file), ex2 and a new ex4 with a Code: line (ex2's test fails,
// ex4 has none, so neither is a "may be stale" case), and no test.failing or
// test.fail. KG_TODAY is what the script and the page said for it before S2
// (project kit at e2237bd, 2026-11-05).
const KG_EX9_DOC = BOOKSTORE_CHECKOUT.replace(
  '- ex2: 10% on 100,000, then a 20,000 voucher → 70,000\n',
  '- ex2: 10% on 100,000, then a 20,000 voucher → 70,000\n  Code: the voucher is taken off first (coupons.ts).\n  Recommend: fix code — the voucher applies last.\n'
).concat(
  '- ex4: a coupon from another shop → refused\n  Code: a coupon from another shop is accepted.\n  Recommend: fix code — refuse it.\n'
)
assert.ok(KG_EX9_DOC.includes('Code: the voucher'), 'ex2 has its Code: line')
/** What the script prints and the page shows, without and with --results. */
function kgSeen() {
  const repo = bookstore({ 'docs/product/requirements/checkout.md': KG_EX9_DOC })
  try {
    const out = {}
    for (const [mode, run, file] of [
      ['without', () => repo.run(), PAGE],
      ['with', () => runResults(repo), RESULTS_PAGE],
    ]) {
      const r = run()
      assert.equal(r.status, 0, r.stderr)
      const p = openHtml(repo.read(file), '#/CHECKOUT')
      out[mode] = {
        stdout: r.stdout,
        acs: Object.fromEntries(
          [...p.doc.querySelectorAll('li.ac')].map((li) => [li.id, flat(li)])
        ),
        tiles: [...p.doc.querySelectorAll('.kpi')].map(flat),
        tab: flat(kgDriftTab(p)),
        drift: openHtml(repo.read(file), '#drift').text().trim(),
      }
      assert.deepEqual(p.errors, [])
    }
    return out
  } finally {
    repo.done()
  }
}
const KG_TODAY = {
  "without": {
    "stdout": "1 requirements, 4 ACs, 3 tested, 2 differ from code; 4 tests scanned, 0 linked to no requirement\n→ docs/coverage/COVERAGE-MAP.html\n",
    "acs": {
      "REQ-CHECKOUT-012-ex1": "ex110% + 5% on 100,000 → 85,500two coupons at checkoutunitcheckout.spec.ts:110% + 5% on 100,000 → 85,500unitcoupons.test.ts:2coupons",
      "REQ-CHECKOUT-012-ex2": "ex2≠ codeRecommend: fix code10% on 100,000, then a 20,000 voucher → 70,000Code doesthe voucher is taken off first (coupons.ts).Whythe voucher applies last.The code differs from this AC, so this test is failing or does not test the real codethe order of entry does not change the totalunitcoupons.test.ts:3coupons",
      "REQ-CHECKOUT-012-ex3": "ex3a coupon that expired yesterday → refused, \"This coupon has expired\"pays by cardunitpayment.spec.ts:1",
      "REQ-CHECKOUT-012-ex4": "ex4≠ codeRecommend: fix codea coupon from another shop → refusedCode doesa coupon from another shop is accepted.Whyrefuse it.No test yet"
    },
    "tiles": [
      "ACs with a test75%3 of 450–79%",
      "ACs without a test1in 1 requirementFilter below with “Untested”",
      "ACs the code does differently22 fix code0 fix AC",
      "Unconfirmed ACs0of 4Taken from the code; waiting for the product owner"
    ],
    "tab": "Code drift2",
    "drift": "ACs the code does differentlyThe code does something other than the AC. The recommendations are Claude’s; the product owner decides.Recommend fixing the code — keep the AC, change the code (2)REQ-CHECKOUT-012 ex2testedCHECKOUT10% on 100,000, then a 20,000 voucher → 70,000Code doesthe voucher is taken off first (coupons.ts).Whythe voucher applies last.REQ-CHECKOUT-012 ex4no testCHECKOUTa coupon from another shop → refusedCode doesa coupon from another shop is accepted.Whyrefuse it."
  },
  "with": {
    "stdout": "1 requirements, 4 ACs, 3 tested, 2 differ from code; 4 tests scanned, 0 linked to no requirement\nlast test run: 2 passed, 1 failed, 0 skipped; 1 test in the code is in no results file\n→ reports/coverage-map.html\n",
    "acs": {
      "REQ-CHECKOUT-012-ex1": "ex110% + 5% on 100,000 → 85,500✓ Passing✓two coupons at checkoutunitcheckout.spec.ts:1✓10% + 5% on 100,000 → 85,500unitcoupons.test.ts:2coupons",
      "REQ-CHECKOUT-012-ex2": "ex2≠ codeRecommend: fix code10% on 100,000, then a 20,000 voucher → 70,000Code doesthe voucher is taken off first (coupons.ts).Whythe voucher applies last.✗ FailingThe code differs from this AC, so this test is failing or does not test the real code✗the order of entry does not change the totalunitcoupons.test.ts:3couponsexpect(received).toBe(expected) Expected: 85500 Received: 85499",
      "REQ-CHECKOUT-012-ex3": "ex3a coupon that expired yesterday → refused, \"This coupon has expired\"○ Not run○pays by cardunitpayment.spec.ts:1",
      "REQ-CHECKOUT-012-ex4": "ex4≠ codeRecommend: fix codea coupon from another shop → refusedCode doesa coupon from another shop is accepted.Whyrefuse it.○ No test yet"
    },
    "tiles": [
      "ACs with a test75%3 of 450–79%",
      "ACs without a test1in 1 requirementFilter below with “Untested”",
      "Failing ACs11 failing testFrom the last run · 3 Nov 2026, 09:20",
      "ACs the code does differently22 fix code0 fix AC",
      "Unconfirmed ACs0of 4Taken from the code; waiting for the product owner"
    ],
    "tab": "Code drift2",
    "drift": "ACs the code does differentlyThe code does something other than the AC. The recommendations are Claude’s; the product owner decides.Recommend fixing the code — keep the AC, change the code (2)REQ-CHECKOUT-012 ex2testedCHECKOUT10% on 100,000, then a 20,000 voucher → 70,000Code doesthe voucher is taken off first (coupons.ts).Whythe voucher applies last.REQ-CHECKOUT-012 ex4no testCHECKOUTa coupon from another shop → refusedCode doesa coupon from another shop is accepted.Whyrefuse it."
  }
}

test('KG ex9: with no test.failing or test.fail, the console line and the page are as they were before', () =>
  zoned(() => {
    const seen = kgSeen()
    // Reached what it compares: both pages hold the four ACs, drift counted.
    assert.deepEqual(Object.keys(seen.with.acs), Object.keys(KG_TODAY.with.acs))
    assert.ok(seen.with.stdout.includes('2 differ from code'), seen.with.stdout)
    assert.deepEqual(seen, KG_TODAY)
  }))
