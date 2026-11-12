#!/usr/bin/env node
/**
 * Coverage map: requirement → AC → test case, as one self-contained HTML page.
 *
 *   npm run coverage:map   →   docs/coverage/COVERAGE-MAP.html
 *
 * Reads the requirements (docs/product/requirements/*.md by default) with
 * trace-check's own parser, so the two never disagree on what an AC is, and adds
 * what the map needs on top: the file's `Tree:` / `Group by:` lines (where its
 * requirements sit in the tree), each requirement's `Tags:`, `Rule:`, `Source:`,
 * `Applies to:` and, under an AC, the `Code:` / `Recommend:` / `Other doc:` lines
 * (where the code does something else, and which side to change).
 *
 * Tests are found by reading test files, not by running them: a test is linked to an
 * AC when its title, or a `describe` around it, names the AC ("REQ-CHECKOUT-012 ex1").
 * So the map says whether a test exists, not whether it passes.
 *
 * What is the project's own (where its tests are, their levels, the tree's order,
 * the groups a file can split by) comes from coverage-map.config.json at the
 * repository root; see resolveConfig.
 */
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  statSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseRequirements, extractRefs } from './trace-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The project's typescript, which reads the test files. Missing, or a version
 * without the compiler API (typescript 7 has no createSourceFile): `ts` is
 * null and main() stops with `noTypescript`, one line, instead of a stack
 * trace. The version named is its package.json's.
 */
let ts = null
let noTypescript = null
{
  let version = null
  try {
    const main = createRequire(import.meta.url).resolve('typescript')
    for (let dir = dirname(main); dir !== dirname(dir); dir = dirname(dir)) {
      const pkg = join(dir, 'package.json')
      if (!existsSync(pkg)) continue
      const { name, version: v } = JSON.parse(readFileSync(pkg, 'utf8'))
      if (name === 'typescript') {
        version = v
        break
      }
    }
    const loaded = (await import(pathToFileURL(main).href)).default
    if (typeof loaded?.createSourceFile === 'function') ts = loaded
  } catch {
    // none the script can find, or one that does not load
  }
  if (!ts)
    noTypescript = `coverage-map needs the TypeScript 5 compiler API; this project has ${version ? `typescript ${version}` : 'no typescript'}. Install typescript@5 (npm i -D typescript@5)`
}

// ------------------------------------------------------------------ config

const CONFIG_FILE = 'coverage-map.config.json'
// Every key is optional; these are what a missing one means.
const DEFAULTS = {
  project: null,
  requirements: 'docs/product/requirements',
  tests: ['**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}'],
  // Build output. A list set in the config replaces this one, so a project
  // can scan dist/ again.
  exclude: ['**/dist/**', '**/build/**', '**/coverage/**', '**/out/**'],
  levels: [],
  order: [],
  last: [],
  groups: { feature: {} },
  breakdowns: [],
  tagRows: [],
  notes: 'docs/coverage/test-notes.json',
  output: 'docs/coverage/COVERAGE-MAP.html',
  // Read only with --results: the JUnit files of the last test run, and the
  // page drawn with them (not committed; the page at `output` never has them).
  results: ['reports/unit.xml', 'reports/e2e.xml'],
  resultsOutput: 'reports/coverage-map.html',
}

const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
const isText = (x) => typeof x === 'string'
const isTextList = (x) => Array.isArray(x) && x.every(isText)

/**
 * The config as JSON.parse gives it (undefined: no file), with every key
 * filled in. A mistake throws, with the whole line to print: a misspelt config
 * that still drew a page would draw a wrong map that nobody notices.
 */
export function resolveConfig(raw = {}) {
  const fail = (what) => {
    throw new Error(`${CONFIG_FILE}: ${what}`)
  }
  // `where` names the object as written, so a typo inside one is found too.
  const known = (obj, keys, where = '') => {
    for (const key of Object.keys(obj))
      if (!keys.includes(key)) fail(`unknown key "${where}${key}"`)
  }
  if (!isObject(raw)) fail('expected an object of settings')
  known(raw, Object.keys(DEFAULTS))
  const c = { ...DEFAULTS, ...raw }
  if (c.project !== null && !isText(c.project)) fail('project must be a name')
  const requirements = isText(c.requirements)
    ? c.requirements.replace(/\/+$/, '')
    : ''
  if (!requirements) fail('requirements must be a folder path')
  for (const key of ['notes', 'output', 'resultsOutput'])
    if (!isText(c[key])) fail(`${key} must be a path`)
  if (!isTextList(c.results)) fail('results must be a list of paths')
  if (join('.', c.resultsOutput) === join('.', c.output))
    fail(
      'resultsOutput must differ from output, so the committed page never shows test results'
    )
  // A pattern is matched against the path from the repository root, which
  // never starts with "./": such a pattern would match nothing.
  const pattern = (p, where) => {
    if (p.startsWith('./'))
      fail(
        `${where} starts with "./"; patterns are relative to the repository root`
      )
  }
  for (const key of ['tests', 'exclude']) {
    if (!isTextList(c[key])) fail(`${key} must be a list of patterns`)
    c[key].forEach((p, i) => pattern(p, `${key}[${i}]`))
  }
  for (const key of ['order', 'last'])
    if (!isTextList(c[key])) fail(`${key} must be a list of labels`)

  if (!Array.isArray(c.levels))
    fail('levels must be a list of { match, level }')
  const levels = c.levels.map((l, i) => {
    if (!isObject(l) || !isText(l.match) || !isText(l.level))
      fail(`levels[${i}] needs match and level`)
    known(l, ['match', 'level'], `levels[${i}].`)
    pattern(l.match, `levels[${i}].match`)
    // The level is the badge's class, lv-<level>.
    if (!/^[\w-]+$/.test(l.level))
      fail(`levels[${i}].level must use only letters, digits, - and _`)
    return { match: l.match, level: l.level }
  })

  // A group with values is ordered: a file grouped by it needs one of them, and
  // each value is a heatmap column. Without values, any value makes a node.
  if (!isObject(c.groups)) fail('groups must be an object of tag → group')
  const groups = {}
  for (const [tag, g] of Object.entries(c.groups)) {
    const where = `groups.${tag}`
    if (tag === 'none') fail(`${where}: none is "Group by: none", not a group`)
    if (!isObject(g)) fail(`${where} must be an object`)
    known(g, ['label', 'plural', 'values', 'labels', 'rowNoun'], `${where}.`)
    const { label = tag, values = [], labels = {} } = g
    const { plural = `${label}s`, rowNoun = ['branch', 'branches'] } = g
    if (!isText(label) || !isText(plural))
      fail(`${where}: label and plural must be words`)
    if (!isTextList(values)) fail(`${where}.values must be a list of values`)
    const twice = values.find((v, i) => values.indexOf(v) !== i)
    if (twice !== undefined) fail(`${where}.values lists "${twice}" twice`)
    if (!isObject(labels) || !Object.values(labels).every(isText))
      fail(`${where}.labels must be an object of value → label`)
    if (!isTextList(rowNoun) || rowNoun.length !== 2)
      fail(`${where}.rowNoun must be [one, many]`)
    const named = { ...labels }
    for (const v of values) named[v] = valueLabel({ labels }, v)
    groups[tag] = { label, plural, values, labels: named, rowNoun }
  }

  if (!Array.isArray(c.breakdowns))
    fail('breakdowns must be a list of { rows, columns, title }')
  const breakdowns = c.breakdowns.map((b, i) => {
    const where = `breakdowns[${i}]`
    if (
      !isObject(b) ||
      !isText(b.rows) ||
      !isText(b.columns) ||
      !isText(b.title)
    )
      fail(`${where} needs rows, columns and title`)
    known(b, ['rows', 'detail', 'columns', 'title', 'noun'], `${where}.`)
    if (!Object.hasOwn(groups, b.columns) || !groups[b.columns].values.length)
      fail(`${where}.columns must name a group with values`)
    const { detail = null, noun = [b.rows, `${b.rows}s`] } = b
    if (detail !== null && !isText(detail))
      fail(`${where}.detail must be a tag`)
    if (!isTextList(noun) || noun.length !== 2)
      fail(`${where}.noun must be [one, many]`)
    return { rows: b.rows, detail, columns: b.columns, title: b.title, noun }
  })

  if (!Array.isArray(c.tagRows))
    fail('tagRows must be a list of { label, tags }')
  const tagRows = c.tagRows.map((t, i) => {
    if (
      !isObject(t) ||
      !isText(t.label) ||
      !isTextList(t.tags) ||
      !t.tags.length
    )
      fail(`tagRows[${i}] needs label and tags`)
    known(t, ['label', 'tags'], `tagRows[${i}].`)
    return { label: t.label, tags: [...t.tags] }
  })

  return {
    project: c.project,
    requirements,
    tests: [...c.tests],
    exclude: [...c.exclude],
    levels,
    order: [...c.order],
    last: [...c.last],
    groups,
    breakdowns,
    tagRows,
    notes: c.notes,
    output: c.output,
    results: [...c.results],
    resultsOutput: c.resultsOutput,
  }
}

/** The config file's contents; one that is not JSON is a mistake like any other. */
function parseConfig(text) {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${CONFIG_FILE}: ${err.message}`)
  }
}

/** A value's label in a group: its own, else the value with `_` as spaces. */
const valueLabel = (group, value) =>
  Object.hasOwn(group.labels, value)
    ? group.labels[value]
    : value.replace(/_/g, ' ')

/** "a, b or c". */
const listing = (words) =>
  words.length > 1
    ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`
    : words.join('')

/** A requirement's values of `tag`, [] when it has none. */
const tagValues = (r, tag) => (Object.hasOwn(r.tags, tag) ? r.tags[tag] : [])

// ------------------------------------------------------------------ requirements

const HEADING = /^#{2,3}\s+(REQ-[A-Z0-9]+-\d{3})\b/
const ANY_HEADING = /^#{1,3}\s/
const EXAMPLE = /^\s*[-*]\s+\**(ex\d+)\b/i

/**
 * What trace-check does not read: tags per requirement and, per AC, the lines
 * indented under it. Keyed by requirement ID, one entry per heading in file
 * order, so a heading trace-check cannot read does not shift the others.
 */
function parseExtras(text) {
  const out = new Map()
  let req = null
  let ex = null
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(HEADING)
    if (heading) {
      req = {
        tags: {},
        examples: new Map(),
        rule: null,
        source: null,
        applies: [],
      }
      ex = null
      if (!out.has(heading[1])) out.set(heading[1], [])
      out.get(heading[1]).push(req)
      continue
    }
    if (ANY_HEADING.test(raw)) {
      req = null
      continue
    }
    if (!req) continue
    const meta = raw.match(/^(Rule|Source|Applies to):\s*(.*)$/)
    if (meta) {
      const value = meta[2].trim()
      if (meta[1] === 'Rule') req.rule = value
      else if (meta[1] === 'Source') req.source = value
      // "Shop › * › *, Users": each pattern is a tree path, `*` any one node.
      else
        req.applies = value
          .split(',')
          .map((p) =>
            p
              .split('›')
              .map((s) => s.trim())
              .filter(Boolean)
          )
          .filter((p) => p.length)
      continue
    }
    const tags = raw.match(/^Tags:\s*(.*)$/)
    if (tags) {
      for (const pair of tags[1].trim().split(/\s+/)) {
        const [key, value = ''] = pair.split('=')
        if (key) req.tags[key] = value.split(',').filter(Boolean)
      }
      continue
    }
    const e = raw.match(EXAMPLE)
    if (e) {
      ex = { code: [], otherDocs: [], recommend: null }
      // A repeated AC ID keeps its first definition; the copy's lines go nowhere.
      if (!req.examples.has(e[1].toLowerCase()))
        req.examples.set(e[1].toLowerCase(), ex)
      continue
    }
    if (!ex || !/^\s+\S/.test(raw)) continue
    const code = raw.match(/^\s+Code:\s*(.*)$/)
    if (code) ex.code.push(code[1].trim())
    // `Recommend: fix code (P0) — why`: the bracketed priority is optional.
    const rec = raw.match(
      /^\s+Recommend:\s*fix (code|AC)\s*(?:\(\s*([^)]*?)\s*\)\s*)?[—–-]\s*(.*)$/i
    )
    if (rec) {
      const given = rec[2] === undefined ? null : rec[2].toUpperCase()
      const priority = /^P[0-3]$/.test(given ?? '') ? given : null
      ex.recommend = {
        kind: rec[1].toLowerCase() === 'ac' ? 'ac' : 'code',
        priority,
        reason: rec[3].trim(),
      }
      if (given !== null && !priority) ex.badPriority = rec[2]
    }
    const other = raw.match(/^\s+Other doc:\s*(.*)$/)
    if (other) ex.otherDocs.push(other[1].trim())
  }
  return out
}

/** A file-level `Key: value` line; empty or missing is null, never the next line. */
const fileLine = (text, key) =>
  text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1].trim() || null

function readRequirementFile({ path, text }, config) {
  const base = parseRequirements(text, path)
  const extras = parseExtras(text)
  const problems = []
  // Where the file sits in the tree, and how its requirements split under it.
  const treeLine = fileLine(text, 'Tree')
  // With no Tree: line, a root named by the file's # heading, less a last
  // " requirements" ("# Checkout requirements" → Checkout); with no heading
  // (or only "requirements"), by the file's name in capitals.
  const heading = (text.match(/^#[ \t]+(.*\S)/m)?.[1] ?? '')
    .replace(/(^|\s+)requirements$/i, '')
    .trim()
  const tree = treeLine
    ? treeLine
        .split(/[›>]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [heading || path.split('/').pop().replace(/\.md$/, '').toUpperCase()]
  const groupNames = [...Object.keys(config.groups), 'none']
  let groupBy = fileLine(text, 'Group by') ?? 'none'
  if (!groupNames.includes(groupBy)) {
    problems.push(`${path}: Group by must be ${listing(groupNames)}`)
    groupBy = 'none'
  }
  const read = new Map() // ID → how many of its headings trace-check read
  const reqs = base.map((r) => {
    const nth = read.get(r.id) ?? 0
    read.set(r.id, nth + 1)
    const extra = extras.get(r.id)?.[nth] ?? {
      tags: {},
      examples: new Map(),
      applies: [],
    }
    const exIds = new Set()
    const examples = []
    for (const e of r.examples) {
      if (exIds.has(e.id)) {
        problems.push(`${r.id} ${e.id} is defined twice (${path})`)
        continue
      }
      exIds.add(e.id)
      const x = extra.examples.get(e.id) ?? {
        code: [],
        otherDocs: [],
        recommend: null,
      }
      examples.push({
        id: e.id,
        text: e.text,
        assumed: e.assumed,
        removed: e.removed,
        code: x.code,
        otherDocs: x.otherDocs,
        recommend: x.recommend,
        ...(x.badPriority !== undefined && { badPriority: x.badPriority }),
        tests: [],
      })
    }
    return {
      id: r.id,
      title: r.title,
      file: path,
      status: r.status,
      tags: extra.tags,
      rule: extra.rule ?? null,
      source: extra.source ?? null,
      appliesTo: extra.applies ?? [],
      generalTests: [],
      examples,
    }
  })
  for (const [id, headings] of extras) {
    if (headings.length > (read.get(id) ?? 0))
      problems.push(
        `${id}: the heading could not be read; check it for unusual characters (${path})`
      )
  }
  return {
    reqs,
    codeChecked: fileLine(text, 'Code checked'),
    tree,
    groupBy,
    problems,
  }
}

// ------------------------------------------------------------------ files

const globs = new Map()

/**
 * A path from the repository root, `/`-separated, against a pattern: `**` as a
 * whole part is any number of folders (last, anything below), `*` anything
 * within one part, `?` one character, `{a,b}` one of the choices.
 */
export function matchGlob(pattern, path) {
  if (!globs.has(pattern))
    globs.set(pattern, new RegExp(`^${globSource(pattern)}$`))
  return globs.get(pattern).test(path)
}

function globSource(pattern) {
  // A `{` never closed makes every brace a plain character.
  let depth = 0
  for (const c of pattern)
    if (c === '{') depth++
    else if (c === '}' && depth) depth--
  const braces = depth === 0
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    const wholePart =
      c === '*' && pattern[i + 1] === '*' && (i === 0 || pattern[i - 1] === '/')
    if (wholePart && i + 2 === pattern.length) {
      out += '.*'
      i += 1
    } else if (wholePart && pattern[i + 2] === '/') {
      out += '(?:[^/]+/)*'
      i += 2
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else if (braces && c === '{') {
      depth++
      out += '(?:'
    } else if (braces && depth && c === '}') {
      depth--
      out += ')'
    } else if (braces && depth && c === ',') out += '|'
    else out += c.replace(/[.*+?^${}()|[\]\\]/, '\\$&')
  }
  return out
}

/**
 * Every file under `dir`, as paths from `root`, sorted. Below `dir`, node_modules
 * and folders whose name starts with "." (.git, .next, copies of the project in
 * .claude/worktrees) are never entered; `dir` itself is walked whatever its
 * name.
 */
function listFiles(root, dir) {
  const out = []
  const walk = (rel) => {
    let entries
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true })
    } catch {
      return // no such folder: nothing in it
    }
    for (const e of entries) {
      if (e.name === 'node_modules') continue
      const path = rel ? `${rel}/${e.name}` : e.name
      if (!e.isDirectory()) out.push(path)
      else if (!e.name.startsWith('.')) walk(path)
    }
  }
  walk(dir)
  return out.sort()
}

/** The folder a pattern starts in: its parts before the first wildcard. */
function globStart(pattern) {
  const parts = pattern.split('/').slice(0, -1)
  const n = parts.findIndex((p) => /[*?{]/.test(p))
  return (n < 0 ? parts : parts.slice(0, n)).join('/')
}

/**
 * The files any of `patterns` matches, split into those none of `exclude`
 * matches (`found`) and those it leaves out (`excluded`, counted and listed so
 * a test in a folder named like build output is not lost unseen). Each
 * pattern is walked from the folder it starts in, so ".storybook/**" finds
 * files in a folder the walk otherwise skips.
 */
function findFiles(root, patterns, exclude) {
  const all = new Set()
  for (const start of new Set(patterns.map(globStart)))
    for (const path of listFiles(root, start)) all.add(path)
  const found = []
  const excluded = []
  for (const p of [...all].sort()) {
    if (!patterns.some((g) => matchGlob(g, p))) continue
    if (exclude.some((g) => matchGlob(g, p))) excluded.push(p)
    else found.push(p)
  }
  return { found, excluded }
}

/**
 * What main() hands to buildModel, read from the disk under `root`: the
 * requirement files (a name starting with `_` is not one), the test files the
 * config's patterns find, those `exclude` left out (paths only), and the
 * notes on test files. A missing requirements folder is a data problem: the
 * page still says what it found.
 */
export function readInputs(root, config) {
  const read = (p) => readFileSync(join(root, p), 'utf8')
  const folder = statSync(join(root, config.requirements), {
    throwIfNoEntry: false,
  })
  const missing = folder?.isDirectory()
    ? []
    : [
        `${config.requirements} ${folder ? 'is not a folder' : 'does not exist'}`,
      ]
  const requirementFiles = listFiles(root, config.requirements)
    .filter((p) => p.endsWith('.md') && !p.split('/').pop().startsWith('_'))
    .map((path) => ({ path, text: read(path) }))
  const { found, excluded } = findFiles(root, config.tests, config.exclude)
  const testFiles = found.map((path) => {
    try {
      return { path, text: read(path) }
    } catch (err) {
      return { path, error: err.message }
    }
  })
  const { notes, problems } = existsSync(join(root, config.notes))
    ? readNotes(read(config.notes), config.notes)
    : { notes: {}, problems: [] }
  return {
    requirementFiles,
    testFiles,
    excluded,
    notes,
    problems: [...missing, ...problems],
  }
}

// ------------------------------------------------------------------ tests

/** A test file's level: the first of the config's `levels` whose pattern matches, else unit. */
export function levelOf(path, levels = []) {
  return levels.find((l) => matchGlob(l.match, path))?.level ?? 'unit'
}

const TEST_ROOTS = new Set(['it', 'test', 'xit', 'fit'])
const TEST_MODS = new Set([
  'skip',
  'only',
  'fixme',
  'todo',
  'failing',
  'concurrent',
  'fail',
  'each',
])
const DESCRIBE_ROOTS = new Set(['describe', 'xdescribe', 'fdescribe'])
const DESCRIBE_MODS = new Set([
  'skip',
  'only',
  'fixme',
  'serial',
  'parallel',
  'each',
])
const SKIP_MODS = new Set(['skip', 'fixme', 'todo'])
// Expected to fail: Jest's test.failing, it.failing (and .each), Playwright's
// test.fail(title, fn). Such a test names an AC the code does not meet yet.
const FAILING_MODS = new Set(['failing', 'fail'])

function memberChain(expr) {
  const parts = []
  while (ts.isPropertyAccessExpression(expr)) {
    parts.unshift(expr.name.text)
    expr = expr.expression
  }
  return ts.isIdentifier(expr) ? [expr.text, ...parts] : null
}

/** Is this call a describe or a test definition? `it.each(t)('…', fn)` included. */
function classify(call) {
  let callee = call.expression
  // `.each(table)(title, fn)`: the title holds %s, $name… for each row.
  const each = ts.isCallExpression(callee)
  if (each) {
    const inner = memberChain(callee.expression)
    if (!inner || inner[inner.length - 1] !== 'each') return null
    callee = callee.expression
  }
  const chain = memberChain(callee)
  if (!chain || call.arguments.length === 0) return null
  const [root, ...mods] = chain
  let kind = null
  if (DESCRIBE_ROOTS.has(root) && mods.every((m) => DESCRIBE_MODS.has(m)))
    kind = 'describe'
  else if (
    root === 'test' &&
    mods[0] === 'describe' &&
    mods.slice(1).every((m) => DESCRIBE_MODS.has(m))
  )
    kind = 'describe'
  else if (TEST_ROOTS.has(root) && mods.every((m) => TEST_MODS.has(m)))
    kind = 'test'
  if (!kind) return null
  const rest = call.arguments.slice(1)
  const hasBody = rest.some(
    (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)
  )
  if (!hasBody && !mods.includes('todo')) return null
  const skip =
    root === 'xit' || root === 'xdescribe' || mods.some((m) => SKIP_MODS.has(m))
  const failing = kind === 'test' && mods.some((m) => FAILING_MODS.has(m))
  return { kind, skip, each, failing }
}

/** The title as written, with `${…}` for what only runs at runtime; null if nothing is literal. */
function titleOf(expr) {
  const parts = []
  let literal = false
  const fold = (e) => {
    if (ts.isParenthesizedExpression(e)) return fold(e.expression)
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      parts.push(e.text)
      literal ||= e.text.length > 0
      return
    }
    if (ts.isTemplateExpression(e)) {
      parts.push(e.head.text)
      literal ||= e.head.text.length > 0
      for (const span of e.templateSpans) {
        parts.push('${…}', span.literal.text)
        literal ||= span.literal.text.length > 0
      }
      return
    }
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      fold(e.left)
      fold(e.right)
      return
    }
    parts.push('${…}')
  }
  fold(expr)
  return literal ? parts.join('') : null
}

export function scanTests(source, path) {
  if (!ts) throw new Error(noTypescript)
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind
  )
  const tests = []
  const dynamic = []
  const lineOf = (node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  // `parts`: the describes around and the title, each { text, each }, which
  // is what a JUnit result names (matchesOf).
  const visit = (node, parts, skipped) => {
    if (ts.isCallExpression(node)) {
      const def = classify(node)
      if (def) {
        const title = titleOf(node.arguments[0])
        if (title === null) dynamic.push({ path, line: lineOf(node) })
        const part = { text: title ?? '${…}', each: def.each }
        if (def.kind === 'describe') {
          for (const arg of node.arguments.slice(1))
            visit(arg, [...parts, part], skipped || def.skip)
        } else if (title !== null) {
          tests.push({
            path,
            line: lineOf(node),
            title: [...parts, part].map((p) => p.text).join(' › '),
            parts: [...parts, part],
            skipped: skipped || def.skip,
            failing: def.failing,
          })
        }
        return
      }
    }
    ts.forEachChild(node, (child) => visit(child, parts, skipped))
  }
  visit(sf, [], false)
  return { tests, dynamic }
}

// ------------------------------------------------------------------ results
//
// The JUnit files of the last test run, read only with --results: whether each
// test found in the code passed, failed or did not run. Its own reader, not
// trace-check's parseJUnit, which keeps neither the failure text, the file nor
// the time.

const XML_TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g
const XML_ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const ENTITY = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (whole, e) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1] === 'x' || e[1] === 'X'
            ? parseInt(e.slice(2), 16)
            : Number(e.slice(1))
        )
      : (ENTITY[e.toLowerCase()] ?? whole)
  )
// "2026-11-03T09:20:00.000Z" → "2026-11-03 09:20": the time as the file
// writes it, never moved to another time zone.
const stampOf = (s) =>
  s?.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)?.slice(1) ?? null
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
/** "3 Nov 2026, 09:20". */
const showStamp = ([y, m, d, hh, mm]) =>
  `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}, ${hh}:${mm}`

/**
 * One JUnit report: each testcase's name, classname, file, the name of the
 * testsuite around it, outcome (passed, failed, skipped) and failure text,
 * and the newest testsuite timestamp. Null when the text is not well-formed
 * XML or its root is neither <testsuites> nor <testsuite>.
 */
export function readJUnit(text) {
  const open = []
  const suites = []
  const cases = []
  let root = null
  let current = null // the testcase open now
  let capture = false // inside its <failure> or <error>
  let newest = null
  for (const m of text.matchAll(XML_TOKEN)) {
    const [, cdata, close, tag, attrs, selfClose, chars, stray] = m
    if (stray) return null
    if (cdata !== undefined || chars !== undefined) {
      if (capture) current.failure += cdata ?? decodeXml(chars)
      else if (!open.length && chars?.trim()) return null
      continue
    }
    if (!tag) continue // a comment or a declaration
    if (close) {
      if (open.pop() !== tag) return null
      if (tag === 'testcase') current = null
      else if (tag === 'testsuite') suites.pop()
      else if (tag === 'failure' || tag === 'error') capture = false
      continue
    }
    if (!open.length) {
      if (root) return null // a second root
      root = tag
      if (tag !== 'testsuites' && tag !== 'testsuite') return null
    }
    const a = {}
    for (const [, k, v1, v2] of attrs.matchAll(XML_ATTR))
      a[k] = decodeXml(v1 ?? v2)
    if (tag === 'testsuite') {
      suites.push(a.name ?? '')
      const at = stampOf(a.timestamp)
      if (at && (!newest || at.join() > newest.join())) newest = at
    } else if (tag === 'testcase') {
      current = {
        name: a.name ?? '',
        classname: a.classname ?? '',
        file: a.file ?? null,
        suite: suites[suites.length - 1] ?? '',
        outcome: 'passed',
        message: null,
        failure: '',
      }
      cases.push(current)
    } else if (current && (tag === 'failure' || tag === 'error')) {
      current.outcome = 'failed'
      current.message ??= a.message ?? null
      if (current.failure) current.failure += '\n'
      capture = !selfClose
    } else if (current && tag === 'skipped' && current.outcome !== 'failed')
      current.outcome = 'skipped'
    if (!selfClose) open.push(tag)
    else if (tag === 'testcase') current = null
    else if (tag === 'testsuite') suites.pop()
  }
  if (!root || open.length) return null
  return { cases, newest }
}

/**
 * Each file of the config's `results`: read, missing, or not a JUnit report.
 * Called only with --results.
 */
export function readResults(root, config) {
  return config.results.map((path) => {
    let text
    try {
      text = readFileSync(join(root, path), 'utf8')
    } catch (err) {
      return { path, status: err.code === 'ENOENT' ? 'missing' : 'invalid' }
    }
    const report = readJUnit(text)
    return report
      ? { path, status: 'read', ...report }
      : { path, status: 'invalid' }
  })
}

/**
 * The file a result names: its `file`, else a classname or suite name shaped
 * like a test file's path. jest-junit's classname is the describes and the
 * title, with spaces, so a title naming "x.spec.ts" is not taken for a file.
 */
function fileOfCase(c) {
  const testFile = (s) => !/\s/.test(s) && /\.(test|spec)\.\w+$/.test(s)
  const named =
    c.file ??
    (testFile(c.classname) ? c.classname : testFile(c.suite) ? c.suite : null)
  return named && named.split('\\').join('/').replace(/^\.\//, '')
}
/** A result's file and a test's path agree: the same, or one ends with "/" and the other. */
const sameFile = (file, path) =>
  file === path || path.endsWith(`/${file}`) || file.endsWith(`/${path}`)

/** The first three lines of a failure that hold something, colour codes out. */
const failureLines = (c) =>
  (c.failure || c.message || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)

// How runners join the describes and the title in a result's name: jest-junit,
// Playwright, Vitest.
const JOINERS = [' ', ' › ', ' > ']
// What only runs at runtime: `${…}` (a template literal) anywhere; in a
// `.each` title also printf's %s %d %i %f %j %o %p %#, and $name or
// $name.field. %% is a literal %.
const RUNTIME = /\$\{…\}/g
const EACH = /\$\{…\}|%%|%[sdifjop#]|\$[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/g

/**
 * One describe or title as its literal pieces, between which runs what only
 * runs at runtime: "a ${…} b" → ["a ", " b"].
 */
function piecesOf({ text, each }) {
  const pieces = ['']
  let at = 0
  for (const m of text.matchAll(each ? EACH : RUNTIME)) {
    pieces[pieces.length - 1] += text.slice(at, m.index)
    if (m[0] === '%%') pieces[pieces.length - 1] += '%'
    else pieces.push('')
    at = m.index + m[0].length
  }
  pieces[pieces.length - 1] += text.slice(at)
  return pieces
}
/** Parts joined by `joiner`, as pieces: the joiner sticks to its neighbours. */
function joinPieces(parts, joiner) {
  const out = [...parts[0]]
  for (const p of parts.slice(1)) {
    out[out.length - 1] += joiner + p[0]
    out.push(...p.slice(1))
  }
  return out
}
/**
 * Whether `s` is the pieces with text that is not empty between each two,
 * up to its end; `open`: any text may come before. Each piece at its first
 * place that still fits (indexOf), so the time grows with the length of `s`,
 * never with the ways of splitting it.
 */
function fits(pieces, s, open) {
  const last = pieces[pieces.length - 1]
  const end = s.length - last.length
  if (end < 0 || !s.endsWith(last)) return false
  if (pieces.length === 1) return open || end === 0
  let at = open ? s.indexOf(pieces[0]) : s.startsWith(pieces[0]) ? 0 : -1
  if (at < 0) return false
  at += pieces[0].length
  for (const piece of pieces.slice(1, -1)) {
    const i = s.indexOf(piece, at + 1)
    if (i < 0) return false
    at = i + piece.length
  }
  return end >= at + 1
}

/**
 * Gives each test in `tests` its result in the last run, `files` being
 * readResults'. A result goes to a test when, first, the result names no file
 * or names the test's: the same path, or one ends with "/" and the other;
 * and, second, its name is the test's chain (its describes and title) joined
 * by " ", " › " or " > ", or ends with that joiner and the chain. A test with
 * results by chain takes only those. A result no test of its file takes by
 * chain goes to the tests whose title its name ends with (Node's runner
 * keeps the describes out of the name). Over its results: failed if one
 * failed, else passed if one passed, else skipped; none: not run. A test
 * skipped in the code stays skipped.
 */
function attachResults(tests, files) {
  // Only the tests of a result's file are tried against it, found by name.
  const byName = new Map()
  for (const t of tests) {
    const parts = t.parts.map(piecesOf)
    t.chains = JOINERS.map((j) => {
      const pieces = joinPieces(parts, j)
      const after = [...pieces]
      after[0] = j + after[0]
      return [pieces, after]
    })
    t.ending = parts[parts.length - 1]
    t.byChain = []
    t.byEnding = []
    const base = t.path.slice(t.path.lastIndexOf('/') + 1)
    if (!byName.has(base)) byName.set(base, [])
    byName.get(base).push(t)
  }
  const byChain = (t, name) =>
    t.chains.some(
      ([whole, after]) => fits(whole, name, false) || fits(after, name, true)
    )
  const counts = []
  const all = []
  for (const f of files) {
    if (f.status !== 'read') continue
    const n = { passed: 0, failed: 0, skipped: 0 }
    for (const c of f.cases) {
      n[c.outcome]++
      all.push(c)
      const file = fileOfCase(c)
      const tried = file
        ? (byName.get(file.slice(file.lastIndexOf('/') + 1)) ?? []).filter(
            (t) => sameFile(file, t.path)
          )
        : tests
      const chained = tried.filter((t) => byChain(t, c.name))
      for (const t of chained) t.byChain.push(c)
      if (!chained.length)
        for (const t of tried)
          if (fits(t.ending, c.name, true)) t.byEnding.push(c)
    }
    counts.push({ path: f.path, ...n })
  }
  const taken = new Set()
  for (const t of tests) {
    t.outcomes = t.byChain.length ? t.byChain : t.byEnding
    for (const c of t.outcomes) taken.add(c)
    delete t.chains
    delete t.ending
    delete t.byChain
    delete t.byEnding
  }
  const unmatched = all.filter((c) => !taken.has(c)).length
  for (const t of tests) {
    const failed = t.outcomes.find((c) => c.outcome === 'failed')
    t.result = t.skipped
      ? 'skipped'
      : failed
        ? 'failed'
        : t.outcomes.some((c) => c.outcome === 'passed')
          ? 'passed'
          : t.outcomes.length
            ? 'skipped'
            : 'notrun'
    t.failure = t.result === 'failed' ? failureLines(failed) : null
    delete t.outcomes
  }
  const newest = files
    .map((f) => f.newest)
    .filter(Boolean)
    .sort((a, b) => (a.join() < b.join() ? 1 : -1))[0]
  return {
    files: files.map((f) => {
      const n = counts.find((x) => x.path === f.path)
      return {
        path: f.path,
        status: f.status,
        time: f.newest ? showStamp(f.newest) : null,
        ...(n && { passed: n.passed, failed: n.failed, skipped: n.skipped }),
      }
    }),
    time: newest ? showStamp(newest) : null,
    unmatched,
    notRun: tests.filter((t) => t.result === 'notrun').length,
  }
}

// ------------------------------------------------------------------ model

/**
 * Whether an AC differs from the code: it has a Code: line, or a test marked
 * as failing names it (a known gap), passing or not, until the mark is taken
 * out of the code.
 */
const differs = (e) => e.code.length > 0 || e.tests.some((t) => t.failing)

/**
 * `config` is resolveConfig's; the model keeps it for renderHtml. `excluded`:
 * the paths of the test files `exclude` left out, kept to be listed.
 * `results`: readResults', only with --results; without it the model has no
 * `run` and the page shows no result.
 */
export function buildModel({
  requirementFiles,
  testFiles,
  excluded = [],
  notes = {},
  problems: given = [],
  config = resolveConfig(),
  results = null,
}) {
  // Live tests first (they are what covers an AC), then in the order of the
  // config's levels; the level no pattern gives (unit) after those it lists.
  const levels = [...new Set(config.levels.map((l) => l.level))]
  const rank = (level) => {
    const i = levels.indexOf(level)
    return i < 0 ? levels.length : i
  }
  const byLevel = (a, b) =>
    Number(a.skipped) - Number(b.skipped) ||
    rank(a.level) - rank(b.level) ||
    a.path.localeCompare(b.path) ||
    a.line - b.line

  const problems = [...given]
  const requirements = []
  const codeChecked = []
  const placement = new Map() // file → { tree, groupBy }
  for (const file of [...requirementFiles].sort((a, b) =>
    a.path.localeCompare(b.path)
  )) {
    const read = readRequirementFile(file, config)
    requirements.push(...read.reqs)
    codeChecked.push({ file: file.path, text: read.codeChecked })
    placement.set(file.path, { tree: read.tree, groupBy: read.groupBy })
    problems.push(...read.problems)
  }

  const seen = new Map()
  for (const r of requirements) {
    if (seen.has(r.id))
      problems.push(
        `${r.id} is defined twice: in ${seen.get(r.id)} and ${r.file}`
      )
    else seen.set(r.id, r.file)
    if (r.status !== 'deprecated' && !r.examples.some((e) => !e.removed))
      problems.push(`${r.id} has no AC (${r.file})`)
    for (const e of r.examples) {
      if (e.code.length && !e.recommend)
        problems.push(
          `${r.id} ${e.id} differs from the code but has no recommendation`
        )
      if (e.recommend && !e.code.length)
        problems.push(`${r.id} ${e.id} has a recommendation but no Code line`)
      if (e.badPriority !== undefined)
        problems.push(
          `${r.id} ${e.id}: priority must be P0–P3, not (${e.badPriority})`
        )
    }
  }
  const byId = new Map()
  for (const r of requirements) if (!byId.has(r.id)) byId.set(r.id, r)

  const allTests = []
  const dynamic = []
  for (const f of [...testFiles].sort((a, b) => a.path.localeCompare(b.path))) {
    if (f.error !== undefined) {
      problems.push(`Cannot read ${f.path}: ${f.error}`)
      continue
    }
    const scanned = scanTests(f.text, f.path)
    for (const t of scanned.tests)
      allTests.push({ ...t, level: levelOf(t.path, config.levels) })
    dynamic.push(...scanned.dynamic)
  }
  const run = results && attachResults(allTests, results)

  const orphans = []
  const unlinkedByFile = new Map()
  for (const t of allTests) {
    const named = []
    for (const ref of extractRefs(t.title)) {
      if (!named.some((r) => r.req === ref.req && r.ex === ref.ex))
        named.push(ref)
    }
    // "REQ-X" on a describe and "REQ-X ex1" on the test: the AC is the link.
    const refs = named.filter(
      (r) => r.ex || !named.some((o) => o.req === r.req && o.ex)
    )
    if (refs.length === 0) {
      if (!unlinkedByFile.has(t.path)) unlinkedByFile.set(t.path, [])
      unlinkedByFile.get(t.path).push(t)
      continue
    }
    for (const ref of refs) {
      const name = ref.ex ? `${ref.req} ${ref.ex}` : ref.req
      const req = byId.get(ref.req)
      if (!req) {
        orphans.push({ ref: name, reason: 'missing', test: t })
        continue
      }
      if (req.status === 'deprecated') {
        orphans.push({ ref: name, reason: 'removed', test: t })
        continue
      }
      if (!ref.ex) {
        req.generalTests.push(t)
        continue
      }
      const e = req.examples.find((x) => x.id === ref.ex)
      if (!e) orphans.push({ ref: name, reason: 'missing', test: t })
      else if (e.removed)
        orphans.push({ ref: name, reason: 'removed', test: t })
      else e.tests.push(t)
    }
  }

  // A duplicated ID is a data problem; its first definition is the one placed.
  const active = requirements.filter(
    (r) => r.status !== 'deprecated' && byId.get(r.id) === r
  )
  for (const r of requirements) {
    r.generalTests.sort(byLevel)
    for (const e of r.examples) {
      e.tests.sort(byLevel)
      const live = e.tests.filter((t) => !t.skipped)
      // ■: a live test at the first level the config lists.
      e.mark = live.some((t) => t.level === levels[0])
        ? '■'
        : live.length
          ? '▣'
          : e.tests.length
            ? '▫'
            : '□'
      e.covered = live.length > 0
    }
  }

  // Each entry carries its value of the first group with values (the page's
  // chip for it), under that group's tag.
  const chip = Object.keys(config.groups).find(
    (tag) => config.groups[tag].values.length
  )
  const drift = []
  for (const r of active) {
    // Not built yet: nothing to differ from.
    if (r.status === 'planned') continue
    for (const e of r.examples) {
      if (e.removed || !differs(e)) continue
      drift.push({
        ...(chip && { [chip]: tagValues(r, chip)[0] ?? null }),
        ref: `${r.id} ${e.id}`,
        reqId: r.id,
        exId: e.id,
        example: e,
      })
    }
  }

  const unlinkedFiles = [...unlinkedByFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, tests]) => ({
      path,
      level: levelOf(path, config.levels),
      tests,
    }))
  const tree = buildTree(active, placement, problems, config)

  return {
    config,
    requirements,
    codeChecked,
    drift,
    orphans: orphans.sort(
      (a, b) =>
        a.ref.localeCompare(b.ref) || a.test.path.localeCompare(b.test.path)
    ),
    dynamic,
    unlinked: {
      files: unlinkedFiles,
      total: unlinkedFiles.reduce((n, f) => n + f.tests.length, 0),
    },
    notes,
    problems,
    testCount: allTests.length,
    excluded: [...excluded].sort(),
    tree,
    // With results: the files and their counts, and the tests that failed or
    // are in no results file, in path order.
    ...(run && {
      run: {
        ...run,
        failing: allTests.filter((t) => t.result === 'failed'),
        notRunTests: allTests.filter((t) => t.result === 'notrun'),
      },
    }),
  }
}

/**
 * The notes file (docs/coverage/test-notes.json by default): { "<test file>":
 * "<note>" }. A broken file is a data problem on the page, not a crash.
 */
export function readNotes(text, path) {
  try {
    const notes = JSON.parse(text)
    if (!notes || typeof notes !== 'object' || Array.isArray(notes))
      throw new Error('expected an object of test file → note')
    return { notes, problems: [] }
  } catch (err) {
    return { notes: {}, problems: [`Cannot read ${path}: ${err.message}`] }
  }
}

/** The console line: the same counts as the page's top nodes. */
export function summary(model) {
  const s = blankStats()
  for (const key of model.tree.roots) {
    const root = model.tree.nodes[key].stats
    for (const k of Object.keys(s)) s[k] += root[k]
  }
  return (
    `${s.reqs} requirements, ${s.total} ACs, ${s.covered} tested, ${s.drift} differ from code; ` +
    `${model.testCount} tests scanned, ${model.unlinked.total} linked to no requirement` +
    (s.planned ? `; ${s.planned} planned` : '')
  )
}

// ------------------------------------------------------------------ tree

function blankStats() {
  return {
    total: 0,
    covered: 0,
    drift: 0,
    driftCode: 0,
    driftCodeP0: 0,
    driftAc: 0,
    unconfirmed: 0,
    reqs: 0,
    untestedReqs: 0,
    planned: 0,
  }
}

function addStats(s, r) {
  // Documented but not built: listed, never counted.
  if (r.status === 'planned') {
    s.planned++
    return
  }
  s.reqs++
  if (r.examples.some((e) => !e.removed && !e.covered)) s.untestedReqs++
  for (const e of r.examples) {
    if (e.removed) continue
    s.total++
    if (e.covered) s.covered++
    if (e.assumed) s.unconfirmed++
    if (differs(e)) {
      s.drift++
      if (e.recommend?.kind === 'code') s.driftCode++
      if (e.recommend?.kind === 'code' && e.recommend.priority === 'P0')
        s.driftCodeP0++
      if (e.recommend?.kind === 'ac') s.driftAc++
    }
  }
}

/**
 * Each requirement has one home node: its file's `Tree:` path, plus its value
 * of the group the file splits by (`Group by:`), if any. It is counted at its
 * home and every ancestor, once. `Applies to:` lists it on other nodes without
 * counting it. A group's columns count only requirements whose home is a node
 * of that group's values, so a heatmap cell always holds what the node it
 * opens holds.
 */
function buildTree(requirements, placement, problems, config) {
  const ordered = Object.entries(config.groups).filter(
    ([, g]) => g.values.length
  )
  const nodes = new Map()
  const nodeAt = (path) => {
    const key = path.join('/')
    if (!nodes.has(key)) {
      const parent = path.length > 1 ? nodeAt(path.slice(0, -1)) : null
      nodes.set(key, {
        key,
        label: path[path.length - 1],
        depth: path.length,
        parent: parent ? parent.key : null,
        children: [],
        reqIds: [],
        applies: [],
        group: null, // { tag, value } on a node of a group's value
        stats: blankStats(),
        byGroup: Object.fromEntries(
          ordered.map(([tag, g]) => [
            tag,
            Object.fromEntries(g.values.map((v) => [v, blankStats()])),
          ])
        ),
      })
      if (parent) parent.children.push(key)
    }
    return nodes.get(key)
  }

  // Place every requirement first, so group nodes are known before counting.
  for (const r of requirements) {
    const { tree, groupBy } = placement.get(r.file)
    let path = tree
    let group = null
    if (groupBy !== 'none') {
      const g = config.groups[groupBy]
      const value = tagValues(r, groupBy)[0] ?? null
      if (!g.values.length) {
        if (value) path = [...tree, valueLabel(g, value)]
      } else if (g.values.includes(value)) {
        path = [...tree, valueLabel(g, value)]
        group = { tag: groupBy, value }
      } else
        problems.push(
          `${r.id} has no ${g.label} (${listing(g.values)}) but its file groups by ${groupBy}`
        )
    }
    const home = nodeAt(path)
    if (group) home.group = group
    home.reqIds.push(r.id)
    r.home = home.key
  }
  for (const r of requirements) {
    const home = nodes.get(r.home)
    for (let key = home.key; key; key = nodes.get(key).parent) {
      const n = nodes.get(key)
      addStats(n.stats, r)
      if (home.group) addStats(n.byGroup[home.group.tag][home.group.value], r)
    }
  }

  for (const r of requirements) {
    for (const pattern of r.appliesTo) {
      for (const n of nodes.values()) {
        const path = n.key.split('/')
        if (path.length !== pattern.length) continue
        if (pattern.every((seg, i) => seg === '*' || seg === path[i]))
          n.applies.push(r.id)
      }
    }
  }

  // The config's `order` first, then labels it does not list, alphabetically;
  // its `last` after both. Nodes of a group's values keep the values' order.
  const { order, last } = config
  const rank = (label) => {
    if (last.includes(label)) return order.length + 1
    const i = order.indexOf(label)
    return i < 0 ? order.length : i
  }
  const byOrder = (a, b) =>
    rank(nodes.get(a).label) - rank(nodes.get(b).label) ||
    nodes.get(a).label.localeCompare(nodes.get(b).label)
  const valueRank = (key) => {
    const { tag, value } = nodes.get(key).group
    return config.groups[tag].values.indexOf(value)
  }
  const byValueOrder = (a, b) => valueRank(a) - valueRank(b)
  for (const n of nodes.values()) {
    // A heatmap row: every child is a value of one group.
    const tags = new Set(n.children.map((c) => nodes.get(c).group?.tag))
    n.matrixRow =
      n.children.length > 0 && tags.size === 1 && !tags.has(undefined)
    n.children.sort(n.matrixRow ? byValueOrder : byOrder)
  }
  const roots = [...nodes.values()]
    .filter((n) => !n.parent)
    .map((n) => n.key)
    .sort(byOrder)
  return { roots, nodes: Object.fromEntries(nodes) }
}

// ------------------------------------------------------------------ html
//
// One self-contained page: the data as JSON, drawn by scripts/coverage-map/app.js
// and styled by scripts/coverage-map/style.css, both embedded. The only outside
// request is the IBM Plex stylesheet; without it the page falls back to system
// fonts and works the same. Nothing time-dependent is written, so an unchanged
// repository gives an identical file.

const ASSETS = join(HERE, 'coverage-map')
const asset = (name) => readFileSync(join(ASSETS, name), 'utf8')
const FONTS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap'

/** A test for the page; with results also its `result` and `failure` lines. */
const slimTest = (t) => ({
  level: t.level,
  path: t.path,
  line: t.line,
  title: t.title,
  skipped: t.skipped,
  // Only when set, so a page with no such test is the one written before.
  ...(t.failing && { failing: true }),
  ...(t.result && { result: t.result }),
  ...(t.failure && { failure: t.failure }),
})

/**
 * The last run for the page, with each failing or not-run test's links: the
 * ACs (or requirements) it names among the placed ones.
 */
function runData(model) {
  const refs = new Map()
  const link = (t, ref) => {
    if (!refs.has(t)) refs.set(t, [])
    refs.get(t).push(ref)
  }
  const placed = new Set()
  for (const r of model.requirements) {
    if (!r.home || placed.has(r.id)) continue
    placed.add(r.id)
    for (const t of r.generalTests) link(t, { ref: r.id, reqId: r.id })
    for (const e of r.examples)
      if (!e.removed)
        for (const t of e.tests)
          link(t, { ref: `${r.id} ${e.id}`, reqId: r.id, exId: e.id })
  }
  const listed = (tests) =>
    tests.map((t) => ({ test: slimTest(t), refs: refs.get(t) ?? [] }))
  const { files, time, unmatched, notRun, failing, notRunTests } = model.run
  return {
    files,
    time,
    unmatched,
    notRun,
    failing: listed(failing),
    notRunTests: listed(notRunTests),
  }
}

/** What the page needs, and nothing else: placed requirements, live ACs. */
function pageData(model, commit, reread) {
  const { config } = model
  // The groups with values: heatmap columns and the Code drift chip.
  const groups = Object.entries(config.groups)
    .filter(([, g]) => g.values.length)
    .map(([tag, g]) => ({ tag, ...g }))
  // The tags the page reads: those groups', the breakdowns', the tag rows'.
  const used = new Set([
    ...groups.map((g) => g.tag),
    ...config.breakdowns.flatMap((b) =>
      [b.rows, b.detail, b.columns].filter(Boolean)
    ),
    ...config.tagRows.flatMap((t) => t.tags),
  ])
  const reqs = {}
  for (const r of model.requirements) {
    if (!r.home || reqs[r.id]) continue
    reqs[r.id] = {
      id: r.id,
      title: r.title,
      file: r.file,
      planned: r.status === 'planned',
      rule: r.rule,
      source: r.source,
      appliesTo: r.appliesTo.map((p) => p.join(' › ')),
      home: r.home,
      tags: Object.fromEntries(
        [...used]
          .filter((t) => tagValues(r, t).length)
          .map((t) => [t, r.tags[t]])
      ),
      examples: r.examples
        .filter((e) => !e.removed)
        .map((e) => ({
          id: e.id,
          text: e.text,
          assumed: e.assumed,
          code: e.code,
          otherDocs: e.otherDocs,
          recommend: e.recommend,
          covered: e.covered,
          tests: e.tests.map(slimTest),
        })),
      general: r.generalTests.map(slimTest),
    }
  }
  return {
    commit,
    project: config.project,
    requirements: config.requirements,
    groups,
    breakdowns: config.breakdowns,
    tagRows: config.tagRows,
    roots: model.tree.roots,
    nodes: model.tree.nodes,
    reqs,
    drift: model.drift.map((d) => ({
      ref: d.ref,
      reqId: d.reqId,
      exId: d.exId,
    })),
    orphans: model.orphans.map((o) => ({
      ref: o.ref,
      reason: o.reason,
      test: slimTest(o.test),
    })),
    dynamic: model.dynamic,
    notes: model.notes,
    unlinked: {
      total: model.unlinked.total,
      files: model.unlinked.files.map((f) => ({
        path: f.path,
        level: f.level,
        tests: f.tests.map((t) => ({
          line: t.line,
          title: t.title,
          skipped: t.skipped,
        })),
      })),
    },
    testCount: model.testCount,
    // Only with --results; absent, the page shows no result.
    ...(model.run && { run: runData(model) }),
    // Only when `exclude` left a test file out; absent, the page is as before.
    ...(model.excluded.length && { excluded: model.excluded }),
    codeChecked: model.codeChecked,
    problems: model.problems,
    // Only with --since; absent, the page is as without it.
    reread: reread && {
      since: reread.since,
      unnumbered: reread.unnumbered,
      entries: reread.entries.map((e) => ({
        doc: e.doc,
        line: e.line,
        req: e.req,
        ex: e.ex,
        text: e.text,
        files: e.files,
      })),
    },
  }
}

/** The line `--since` adds to the console. */
export function rereadSummary(reread) {
  const n = reread.entries.length
  return `${n} Code: ${n === 1 ? 'line' : 'lines'} to re-read since ${reread.since}`
}

export function renderHtml(model, { commit, reread }) {
  // `<` escaped so no string in the data can close the script element.
  const json = JSON.stringify(pageData(model, commit, reread)).replace(
    /</g,
    '\\u003c'
  )
  // The first of the config's levels stands out. Its badge's class is
  // `lv-<level>`, a word of the project's, so the stylesheet's `.lv-first`
  // rule is renamed to it here.
  const first = model.config.levels[0]?.level
  let css = asset('style.css')
  if (first)
    css = css.replace(
      /^\.lv-first \{/m,
      () => `.lv-${first.replace(/[^\w-]/g, (c) => `\\${c}`)} {`
    )
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coverage map</title>
<link rel="stylesheet" href="${FONTS}">
<style>${css}</style></head>
<body><noscript>This page needs JavaScript</noscript>
<script id="data" type="application/json">${json}</script>
<script>${asset('app.js')}</script></body></html>
`
}

// ------------------------------------------------------------------ main

async function main() {
  const root = join(HERE, '..')
  // A broken config stops the run before anything is written.
  let config
  try {
    const file = join(root, CONFIG_FILE)
    config = resolveConfig(
      existsSync(file) ? parseConfig(readFileSync(file, 'utf8')) : undefined
    )
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
  if (noTypescript) {
    console.error(noTypescript)
    process.exit(2)
  }
  // --results: the JUnit files of the last run, drawn on a page of its own
  // (resultsOutput). Without the flag no results file is read.
  let results = null
  if (process.argv.includes('--results')) {
    results = readResults(root, config)
    if (!results.some((f) => f.status === 'read')) {
      const run = 'Run the tests with a JUnit reporter first.'
      console.error(
        results.every((f) => f.status === 'missing')
          ? `--results: no results file found (${config.results.join(', ') || 'the config lists none'}). ${run}`
          : `--results: no results file could be read (${results.map((f) => `${f.path}: ${f.status === 'missing' ? 'not found' : 'not a JUnit report'}`).join(', ')}). ${run}`
      )
      process.exit(2)
    }
  }
  const { requirementFiles, testFiles, excluded, notes, problems } = readInputs(
    root,
    config
  )
  let commit = 'unknown'
  try {
    // git's own error ("not a git repository") is not shown.
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // not a git checkout: the page says "unknown"
  }
  const model = buildModel({
    requirementFiles,
    testFiles,
    excluded,
    notes,
    problems,
    config,
    results,
  })
  // --since <rev>: the Code: lines citing code changed since <rev>, working
  // tree included.
  const at = process.argv.indexOf('--since')
  let reread
  if (at !== -1) {
    const since = process.argv[at + 1]
    if (!since || since.startsWith('--')) {
      console.error('--since needs a revision, e.g. --since origin/main')
      process.exit(1)
    }
    // Loaded only here: a repository without it still draws its map.
    const touched = join(HERE, 'code-lines-touched.mjs')
    if (!existsSync(touched)) {
      console.error(
        '--since needs scripts/code-lines-touched.mjs, which this repository does not have'
      )
      process.exit(1)
    }
    const { codeLinesTouched } = await import(pathToFileURL(touched).href)
    try {
      reread = { ...codeLinesTouched({ cwd: root, base: since }), since }
    } catch (error) {
      console.error(error.message)
      process.exit(1)
    }
  }
  const target = results ? config.resultsOutput : config.output
  const out = join(root, target)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, renderHtml(model, { commit, reread }))

  console.log(summary(model))
  const left = model.excluded.length
  if (left)
    console.log(
      `${left} test ${left === 1 ? 'file' : 'files'} left out by exclude`
    )
  if (model.run) console.log(runSummary(model.run))
  if (reread) console.log(rereadSummary(reread))
  for (const p of model.problems) console.log(`problem: ${p}`)
  console.log(`→ ${target}`)
}

/** The line --results adds to the console: the counts, and each file not used. */
function runSummary(run) {
  const n = { passed: 0, failed: 0, skipped: 0 }
  for (const f of run.files)
    if (f.status === 'read') for (const k in n) n[k] += f[k]
  const bad = run.files
    .filter((f) => f.status !== 'read')
    .map(
      (f) =>
        `; ${f.path} ${f.status === 'missing' ? 'not found' : 'is not a JUnit report'}`
    )
  return (
    `last test run: ${n.passed} passed, ${n.failed} failed, ${n.skipped} skipped; ` +
    `${run.notRun} ${run.notRun === 1 ? 'test in the code is' : 'tests in the code are'} in no results file` +
    (run.unmatched
      ? `; ${run.unmatched} ${run.unmatched === 1 ? 'result matches' : 'results match'} no test in the code`
      : '') +
    bad.join('')
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main()
