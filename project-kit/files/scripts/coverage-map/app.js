// The coverage map page. Draws everything from the JSON in #data, which
// scripts/coverage-map.mjs writes into the same file.
//
// Left: the requirement tree. Right: the selected node (#/<node key>), the code
// drift view (#drift), the tests view (#tests), or search results.
;(() => {
  'use strict'
  const D = JSON.parse(document.getElementById('data').textContent)
  const N = D.nodes
  const R = D.reqs
  // The config's groups with values ({ tag, label, plural, values, labels,
  // rowNoun }), in its order: heatmap columns, breakdown columns, drift chips.
  const G = D.groups

  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  // Rounded, but 100% only when every AC has a test and 0% only when none has.
  const pct = (c, t) =>
    t
      ? Math.min(
          c < t ? 99 : 100,
          Math.max(c > 0 ? 1 : 0, Math.round((c / t) * 100))
        )
      : null
  const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`
  const href = (key) => `#/${key.split('/').map(encodeURIComponent).join('/')}`
  const fileName = (path) => path.slice(path.lastIndexOf('/') + 1)
  const tagValues = (r, tag) => (Object.hasOwn(r.tags, tag) ? r.tags[tag] : [])
  const valueLabel = (g, v) => (Object.hasOwn(g.labels, v) ? g.labels[v] : v)

  const state = {
    view: 'overview',
    key: null,
    q: '',
    untested: false,
    drift: false,
    unconfirmed: false,
    failing: false,
    expanded: {},
    open: {},
  }

  // ---------------------------------------------------------------- last run
  // Only on a page drawn with --results (D.run): each test's result in the
  // last run, each AC's state from its tests. Without it nothing here is
  // drawn, and the page is the one committed.
  const RUN = D.run
  const MARK = { passed: '✓', failed: '✗', notrun: '○', skipped: '–' }
  const SAID = {
    passed: 'Passed in the last run',
    failed: 'Failed in the last run',
    notrun: 'Not in the last run',
    skipped: 'Skipped',
  }
  const STATE = {
    passing: ['✓', 'Passing'],
    failing: ['✗', 'Failing'],
    notrun: ['○', 'Not run'],
    skipped: ['–', 'Only skipped'],
    none: ['○', 'No test yet'],
    gap: ['◐', 'Known gap'],
  }
  // A test skipped in the code, or by the run, does not count for its AC.
  // A test marked as failing (a known gap) passes when it fails as expected:
  // a plain test that passed makes the AC passing, a known gap alone does not.
  const acState = (e) => {
    const live = e.tests.filter((t) => t.result !== 'skipped')
    if (live.some((t) => t.result === 'failed')) return 'failing'
    if (live.some((t) => t.result === 'passed' && !t.failing)) return 'passing'
    if (live.some((t) => t.result === 'passed')) return 'gap'
    if (live.length) return 'notrun'
    return e.tests.length ? 'skipped' : 'none'
  }
  // As the generator counts it: a Code: line, or a test marked as failing.
  const differs = (e) => e.code.length > 0 || e.tests.some((t) => t.failing)
  // With results: the AC has a Code: line, yet its tests pass, so the code
  // may now do what the AC says.
  const isStale = (r, e) =>
    !!RUN && !r.planned && e.code.length > 0 && acState(e) === 'passing'
  const STALE_CHIP =
    '<span class="chip chip-stale" title="The tests of this AC passed in the last run, so the code may now do what the AC says: read the Code: line again">Code: line may be stale</span>'
  const stateChip = (st) =>
    `<p class="state state-${st}"><span aria-hidden="true">${STATE[st][0]}</span> ${STATE[st][1]}</p>`
  /** Failing ACs and failing tests among the requirements `ids`. */
  const failingIn = (ids) => {
    const f = { acs: 0, tests: 0 }
    for (const id of ids) {
      if (R[id].planned) continue
      for (const e of R[id].examples) {
        if (acState(e) !== 'failing') continue
        f.acs++
        f.tests += e.tests.filter((t) => t.result === 'failed').length
      }
    }
    return f
  }
  // Failed first, then passed, not run, skipped; otherwise as listed.
  const RESULT_ORDER = ['failed', 'passed', 'notrun', 'skipped']
  const byResult = (tests) =>
    RUN
      ? [...tests].sort(
          (a, b) =>
            RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result)
        )
      : tests
  // A known gap's result read the right way round.
  const GAP_SAID = {
    passed: 'Failed as expected in the last run: the code does not meet this AC yet',
    failed: 'Passed in the last run though marked as failing: remove the mark',
  }
  /** The mark before a test's name; its meaning on hover. */
  const mark = (t) => {
    if (!RUN) return ''
    const said = (t.failing && GAP_SAID[t.result]) || SAID[t.result]
    return `<span class="ti ti-${t.result}" title="${said}" aria-label="${said}">${MARK[t.result]}</span>`
  }
  const GAP_CHIP =
    '<span class="chip chip-gap" title="Marked as failing in the code: a known gap, the code does not meet this AC yet">known gap</span>'
  /** The chip on a test marked as failing. */
  const gapChip = (t) => (t.failing ? GAP_CHIP : '')
  /** The first lines of a failure, under the test. */
  const failureOf = (t) =>
    t.failure ? `<code class="ct-msg">${esc(t.failure.join('\n'))}</code>` : ''
  const resultClass = (t) => (RUN ? ` r-${t.result}` : '')

  // ---------------------------------------------------------------- bands
  // Coverage-tool convention (Istanbul watermarks): under 50% critical, 50–79%
  // warning, 80% and up good. Colours come from CSS tokens, so they follow the
  // theme; each band also has an icon and a name, so colour never works alone.
  const ICON = {
    bad: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 10H1z" fill="currentColor"/><path d="M6 4.5v2.3M6 8.4v.1" stroke="var(--surface)" stroke-width="1.4" stroke-linecap="round"/></svg>',
    warn: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/><path d="M6 3.5v3M6 8.3v.1" stroke="var(--surface)" stroke-width="1.4" stroke-linecap="round"/></svg>',
    good: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/><path d="m3.6 6.1 1.7 1.7 3.1-3.3" fill="none" stroke="var(--surface)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  }
  const BANDS = [
    { below: 50, key: 'bad', name: 'Under 50%' },
    { below: 80, key: 'warn', name: '50–79%' },
    { below: Infinity, key: 'good', name: '80% and up' },
  ]
  const band = (p) => BANDS.find((b) => p < b.below)
  const bandVar = (p) => `var(--${band(p).key})`
  const bandPill = (p) => {
    const b = band(p)
    return `<span class="band band-${b.key}">${ICON[b.key]}${b.name}</span>`
  }

  // ---------------------------------------------------------------- skeleton
  // A drifting AC's own record, and the open P0 code fixes the tab announces.
  const driftEx = (d) => R[d.reqId].examples.find((x) => x.id === d.exId)
  const isP0Code = (e) =>
    e.recommend?.kind === 'code' && e.recommend.priority === 'P0'
  const openP0 = D.drift.filter((d) => isP0Code(driftEx(d))).length
  const staleN = D.drift.filter((d) => isStale(R[d.reqId], driftEx(d))).length
  const app = document.createElement('div')
  app.innerHTML =
    '<header class="top"><button id="menu" class="menu" aria-label="Show the requirement tree"></button>' +
    `<div class="brand"><span class="mark">AC</span><b>Coverage map</b>${D.project ? `<span class="proj">${esc(D.project)}</span>` : ''}<span class="muted">commit ${esc(D.commit)}</span></div>` +
    '<nav class="views" aria-label="Views">' +
    '<a href="#overview" data-view="overview">Overview</a><a href="#map" data-view="map">Map</a>' +
    `<a href="#drift" data-view="drift">Code drift<span class="badge">${num(D.drift.length)}</span>${openP0 ? `<span class="badge badge-p0">P0 ${num(openP0)}</span>` : ''}${staleN ? `<span class="badge badge-stale" title="${plural(staleN, 'AC', 'ACs')} whose Code: line may be stale: the tests passed in the last run">${num(staleN)} stale</span>` : ''}</a>` +
    `<a href="#tests" data-view="tests">Tests<span class="badge">${num(D.testCount)}</span></a></nav>` +
    '<input id="q" type="search" placeholder="Search requirements and ACs" aria-label="Search requirements and acceptance criteria"></header>' +
    '<div class="layout"><nav id="tree" class="tree" aria-label="Requirement tree"></nav><main id="detail" class="detail"></main></div>' +
    '<div id="tip" class="tip" role="tooltip"></div>'
  document.body.prepend(app)
  const tree = document.getElementById('tree')
  const detail = document.getElementById('detail')
  const tip = document.getElementById('tip')
  const search = document.getElementById('q')
  const menu = document.getElementById('menu')

  // ---------------------------------------------------------------- helpers
  const meter = (c, t, cls = '') => {
    const p = pct(c, t) || 0
    return `<span class="meter ${cls}"><span style="width:${p}%;background:${bandVar(p)}"></span></span>`
  }
  const rec = (kind, text) =>
    `<span class="rec rec-${kind}"><i></i>${text}</span>`
  const ancestors = (key) => {
    const out = []
    for (let k = key; k; k = N[k].parent) out.unshift(k)
    return out
  }
  const subtree = (key) => {
    const out = []
    const walk = (k) => {
      out.push(k)
      N[k].children.forEach(walk)
    }
    walk(key)
    return out
  }
  /** The path of `key` below `from`, "Checkout › Coupons". */
  const rel = (key, from) =>
    ancestors(key)
      .slice(from ? ancestors(from).length : 0)
      .map((k) => N[k].label)
      .join(' › ') || N[key].label
  const goLink = (key, text, extra = '') =>
    `<a href="${esc(href(key))}" data-go="${esc(key)}"${extra}>${text}</a>`

  // Navigation goes through the hash, so Back and links work as usual.
  function fromHash() {
    const h = location.hash
    if (h === '#drift' || h === '#tests' || h === '#map') {
      state.view = h.slice(1)
      return
    }
    let key = null
    try {
      key = h.startsWith('#/')
        ? h.slice(2).split('/').map(decodeURIComponent).join('/')
        : null
    } catch {
      key = null
    }
    // No hash, #overview, or a hash naming no node: the project overview.
    if (!key || !Object.hasOwn(N, key)) {
      state.view = 'overview'
      return
    }
    state.view = 'node'
    state.key = key
    ancestors(state.key).forEach((k) => (state.expanded[k] = true))
  }
  function navigate(hash, focusAc) {
    state.q = ''
    search.value = ''
    if (location.hash !== hash) history.pushState(null, '', hash)
    fromHash()
    document.body.classList.remove('show-tree')
    hideTip()
    render()
    window.scrollTo(0, 0)
    // Opened from a Code drift card: no filter may hide that AC, and it is
    // marked so it stands out.
    if (
      focusAc &&
      (state.untested || state.drift || state.unconfirmed || state.failing)
    ) {
      state.untested = state.drift = state.unconfirmed = state.failing = false
      render()
    }
    const ac = focusAc && document.getElementById(focusAc)
    if (ac) {
      ac.classList.add('hit')
      if (ac.scrollIntoView) ac.scrollIntoView({ block: 'center' })
    }
  }

  // ---------------------------------------------------------------- tree
  // ✗n by a node with failing ACs under it, on a page with results.
  const failing = {}
  /** Failing ACs under node `key` (results never change on a page). */
  const failingAcs = (key) =>
    (failing[key] ??= failingIn(subtree(key).flatMap((k) => N[k].reqIds)).acs)
  const failingMark = (key) => {
    if (!RUN) return ''
    const n = failingAcs(key)
    return n
      ? `<span class="tf" title="${plural(n, 'failing AC', 'failing ACs')}">✗${n}</span>`
      : ''
  }
  const CHEVRON =
    '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m4.5 2.5 3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  function treeHtml(key, depth) {
    const n = N[key]
    const p = pct(n.stats.covered, n.stats.total)
    const kids = n.children.length > 0
    const open = !!state.expanded[key]
    const active = state.view === 'node' && !state.q && state.key === key
    return (
      `<li><div class="tn${active ? ' active' : ''}" style="--d:${depth}" data-key="${esc(key)}" tabindex="0" role="treeitem"${kids ? ` aria-expanded="${open}"` : ''}>` +
      (kids
        ? `<button class="tw${open ? ' open' : ''}" data-toggle="${esc(key)}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(n.label)}">${CHEVRON}</button>`
        : '<span></span>') +
      `<span class="tl">${esc(n.label)}</span>` +
      `<span class="td">${failingMark(key)}${n.stats.drift ? `≠${n.stats.drift}` : ''}</span>` +
      `<span class="tp">${p !== null ? `<i class="bd" style="background:${bandVar(p)}" title="${band(p).name}"></i>${p}%` : n.stats.planned ? '<span class="muted">planned</span>' : '—'}</span></div>` +
      (kids && open
        ? `<ul role="group">${n.children.map((c) => treeHtml(c, depth + 1)).join('')}</ul>`
        : '') +
      '</li>'
    )
  }
  function renderTree() {
    const checked = D.codeChecked
      .map(
        (c) =>
          `<p class="tree-foot"><span class="mono">${esc(fileName(c.file))}</span> · ${c.text ? `code checked ${esc(c.text)}` : 'code not checked'}</p>`
      )
      .join('')
    tree.innerHTML =
      '<p class="tree-h">Features</p>' +
      (D.roots.length
        ? `<ul role="tree">${D.roots.map((k) => treeHtml(k, 0)).join('')}</ul>`
        : '<p class="tree-foot">None yet</p>') +
      `<p class="tree-foot">${plural(D.testCount, 'test', 'tests')} scanned · ${num(D.unlinked.total)} name no requirement</p>` +
      checked
  }
  tree.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-toggle]')
    if (t) {
      const k = t.getAttribute('data-toggle')
      state.expanded[k] = !state.expanded[k]
      renderTree()
      return
    }
    const row = ev.target.closest('.tn')
    if (row) navigate(href(row.getAttribute('data-key')))
  })
  tree.addEventListener('keydown', (ev) => {
    const row = ev.target.closest('.tn')
    if (row && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault()
      navigate(href(row.getAttribute('data-key')))
    }
  })

  // ---------------------------------------------------------------- stats
  // Same counting as the generator's tree, for groupings it does not store
  // (a breakdown's rows within a node).
  const blank = () => ({
    total: 0,
    covered: 0,
    drift: 0,
    driftCode: 0,
    driftCodeP0: 0,
    driftAc: 0,
    unconfirmed: 0,
    reqs: 0,
  })
  function add(s, r) {
    s.reqs++
    for (const e of r.examples) {
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

  // ---------------------------------------------------------------- summary tiles
  // `untestedHint` says where the untested ACs can be filtered from this page.
  // `ids`: the requirements counted, for the Failing ACs tile of a page with
  // results.
  function kpis(s, ids, untestedHint = 'Filter below with “Untested”') {
    const p = pct(s.covered, s.total)
    let failingTile = ''
    if (RUN) {
      const f = failingIn(ids)
      failingTile =
        `<div class="kpi"><span class="kl">Failing ACs</span><span class="kv${f.acs ? ' kv-bad' : ''}">${num(f.acs)}<small>${plural(f.tests, 'failing test', 'failing tests')}</small></span>` +
        `<span class="ks">From the last run${RUN.time ? ` · ${esc(RUN.time)}` : ''}</span></div>`
    }
    return (
      '<div class="kpis">' +
      `<div class="kpi"><span class="kl">ACs with a test</span><span class="kv">${p === null ? '—' : `${p}%`}<small>${s.covered} of ${s.total}</small></span>` +
      (p === null ? '' : meter(s.covered, s.total) + bandPill(p)) +
      '</div>' +
      `<div class="kpi"><span class="kl">ACs without a test</span><span class="kv">${num(s.total - s.covered)}<small>in ${plural(s.untestedReqs, 'requirement', 'requirements')}</small></span>` +
      `<span class="ks">${untestedHint}</span></div>` +
      failingTile +
      `<div class="kpi"><span class="kl">ACs the code does differently</span><span class="kv">${num(s.drift)}</span>` +
      `<span class="ks">${rec('code', `${s.driftCode} fix code`)}${rec('ac', `${s.driftAc} fix AC`)}</span></div>` +
      `<div class="kpi"><span class="kl">Unconfirmed ACs</span><span class="kv">${num(s.unconfirmed)}<small>of ${s.total}</small></span>` +
      '<span class="ks">Taken from the code; waiting for the product owner</span></div>' +
      '</div>'
    )
  }

  // ---------------------------------------------------------------- heatmaps
  function cellInner(p, drift) {
    return (
      `<span class="hv">${p}%${drift ? `<i class="hd">≠${drift}</i>` : ''}</span>` +
      `<span class="hbar"><i style="width:${Math.max(p, 3)}%;background:${bandVar(p)}"></i></span>`
    )
  }
  // The column goes under its group's tag, which is how showTip finds it.
  const tipData = (c, row, g, v) =>
    esc(
      JSON.stringify({
        p: pct(c.covered, c.total),
        row,
        [g.tag]: valueLabel(g, v),
        c: c.covered,
        t: c.total,
        d: c.drift,
        dc: c.driftCode,
        da: c.driftAc,
        u: c.unconfirmed,
      })
    )
  /**
   * One table: a row per entry, "All <plural>", then a column per value of
   * group `g` some row reaches (`row.cols[value]`). `cell(row, value, stats)`
   * draws a cell that has ACs.
   */
  function groupTable(rows, g, cell) {
    const values = g.values.filter((v) => rows.some((row) => row.cols[v].total))
    // With one value, "All …" would repeat its column.
    const showAll = values.length > 1
    const head = `<thead><tr><th></th>${showAll ? `<th>All ${esc(g.plural)}</th>` : ''}${values.map((v) => `<th>${esc(valueLabel(g, v))}</th>`).join('')}</tr></thead>`
    const body = rows
      .map((row) => {
        const all = pct(row.stats.covered, row.stats.total)
        const allCell = showAll
          ? `<td><span class="hc all">${all === null ? '—' : cellInner(all, 0)}</span></td>`
          : ''
        const cells = values
          .map((v) => {
            const c = row.cols[v]
            if (!c.total)
              return `<td><span class="hc empty" title="No requirements at this ${esc(g.label)}">—</span></td>`
            return `<td>${cell(row, v, c)}</td>`
          })
          .join('')
        return `<tr><th scope="row">${row.head}</th>${allCell}${cells}</tr>`
      })
      .join('')
    return `<div class="scroll"><table class="heat">${head}<tbody>${body}</tbody></table></div>`
  }
  const cellLabel = (row, g, v, c) =>
    `${row.label}, ${valueLabel(g, v)}: ${pct(c.covered, c.total)}% of ${c.total} ACs tested`
  const legend = () =>
    `<p class="legend">${BANDS.map((b) => `<span class="lg"><i style="background:var(--${b.key})"></i>${b.name}</span>`).join('')}` +
    '<span>Bar length = share of ACs with a test</span><span>≠n = ACs the code does differently</span></p>'

  /** Nodes whose children are the values of group `g`, a row each. */
  function heatmap(keys, from, g) {
    const rows = keys.map((k) => {
      const n = N[k]
      const label = rel(k, from)
      const parts = label.split(' › ')
      const name =
        parts.length > 1
          ? `<span class="ex">${esc(parts.slice(0, -1).join(' › '))} › </span>${esc(parts[parts.length - 1])}`
          : esc(label)
      return { ...n, label, head: goLink(k, name), cols: n.byGroup[g.tag] }
    })
    const cell = (row, v, c) => {
      const target = row.children.find((ch) => N[ch].group.value === v)
      return `<button class="hc" data-go="${esc(target)}" data-tip="${tipData(c, row.label, g, v)}" aria-label="${esc(cellLabel(row, g, v, c))}">${cellInner(pct(c.covered, c.total), c.drift)}</button>`
    }
    return (
      `<section class="card"><div class="card-h"><h3>Coverage by ${esc(g.label)}</h3><span class="muted">${esc(plural(rows.length, ...g.rowNoun))} · click a cell to open it</span></div>` +
      groupTable(rows, g, cell) +
      legend() +
      '</section>'
    )
  }

  /**
   * A breakdown of the config: a row per value of tag `b.rows` among the
   * requirements `ids`, its `b.detail` values beside it, a column per value of
   * group `b.columns` (the requirement's own tag, not its node).
   */
  function breakdownCard(ids, b) {
    const g = G.find((x) => x.tag === b.columns)
    const rows = new Map()
    for (const id of ids) {
      const r = R[id]
      if (r.planned) continue
      for (const value of tagValues(r, b.rows)) {
        if (!rows.has(value)) {
          const cols = {}
          g.values.forEach((v) => (cols[v] = blank()))
          rows.set(value, { label: value, details: [], stats: blank(), cols })
        }
        const row = rows.get(value)
        add(row.stats, r)
        const col = tagValues(r, b.columns)[0]
        if (col && Object.hasOwn(row.cols, col)) add(row.cols[col], r)
        if (b.detail)
          tagValues(r, b.detail).forEach((d) => {
            if (!row.details.includes(d)) row.details.push(d)
          })
      }
    }
    if (!rows.size) return ''
    const list = [...rows.values()]
      .sort((x, y) => x.label.localeCompare(y.label))
      .map((row) => ({
        ...row,
        // The detail values carry the class "<tag>s".
        head:
          `<span class="mono">${esc(row.label)}</span>` +
          (row.details.length
            ? `<span class="${esc(b.detail)}s">${esc(row.details.sort().join(', '))}</span>`
            : ''),
      }))
    const cell = (row, v, c) =>
      `<span class="hc static" tabindex="0" data-tip="${tipData(c, row.label, g, v)}" aria-label="${esc(cellLabel(row, g, v, c))}">${cellInner(pct(c.covered, c.total), c.drift)}</span>`
    return (
      `<section class="card"><div class="card-h"><h3>${esc(b.title)}</h3><span class="muted">${esc(plural(list.length, ...b.noun))} in this branch</span></div>` +
      groupTable(list, g, cell) +
      '</section>'
    )
  }

  // Tooltip for heat cells: value first, then what it is made of. Same on focus.
  function showTip(el) {
    let d
    try {
      d = JSON.parse(el.getAttribute('data-tip'))
    } catch {
      return
    }
    tip.innerHTML = ''
    const v = document.createElement('div')
    v.className = 'tv'
    v.textContent = `${d.p}%`
    v.insertAdjacentHTML('beforeend', bandPill(d.p))
    const t = document.createElement('div')
    t.className = 'tt'
    const g = G.find((x) => Object.hasOwn(d, x.tag))
    t.textContent = `${d.row} · ${g ? d[g.tag] : ''}`
    tip.append(v, t)
    const rows = [[`${d.c} of ${d.t} ACs have a test`, bandVar(d.p)]]
    if (d.d)
      rows.push([
        `${d.d} differ from code (${d.dc} fix code, ${d.da} fix AC)`,
        'var(--fix-code)',
      ])
    if (d.u) rows.push([`${d.u} unconfirmed`, 'var(--line-strong)'])
    for (const [text, colour] of rows) {
      const row = document.createElement('div')
      row.className = 'tr'
      const key = document.createElement('i')
      key.className = 'key'
      key.style.background = colour
      const span = document.createElement('span')
      span.textContent = text
      row.append(key, span)
      tip.append(row)
    }
    const box = el.getBoundingClientRect()
    tip.classList.add('on')
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    const x = Math.min(
      window.innerWidth - w - 12,
      Math.max(12, box.left + box.width / 2 - w / 2)
    )
    const y = box.top - h - 8 < 64 ? box.bottom + 8 : box.top - h - 8
    tip.style.left = `${x}px`
    tip.style.top = `${y}px`
  }
  function hideTip() {
    tip.classList.remove('on')
  }
  detail.addEventListener('pointerover', (ev) => {
    const c = ev.target.closest('[data-tip]')
    if (c) showTip(c)
  })
  detail.addEventListener('pointerout', (ev) => {
    if (ev.target.closest('[data-tip]')) hideTip()
  })
  detail.addEventListener('focusin', (ev) => {
    const c = ev.target.closest('[data-tip]')
    if (c) showTip(c)
  })
  detail.addEventListener('focusout', hideTip)
  window.addEventListener('scroll', hideTip, { passive: true })

  // ---------------------------------------------------------------- branches
  /** One row per node: its name (a link), a bar, %, ACs with a test, drift. */
  // `kind`: "root" or "sub", the Overview's Features rows, which on a page
  // with results also say how many ACs under them fail.
  function branchRows(keys, kind = '') {
    return keys
      .map((k) => {
        const c = N[k]
        const p = pct(c.stats.covered, c.stats.total)
        const fails = kind && RUN ? failingAcs(k) : 0
        return (
          `<tr${kind ? ` class="${kind}"` : ''}><th scope="row">${goLink(k, esc(c.label))}</th>` +
          `<td class="w">${meter(c.stats.covered, c.stats.total)}</td><td class="num">${p === null ? '—' : `${p}%`}</td>` +
          `<td class="num">${c.stats.covered}/${c.stats.total} ACs</td><td class="num">${c.stats.drift ? `≠${c.stats.drift}` : ''}</td>` +
          (kind && RUN
            ? `<td class="num fails">${fails ? `✗${num(fails)} failing` : ''}</td>`
            : '') +
          '</tr>'
        )
      })
      .join('')
  }
  function branches(n) {
    return (
      '<section class="card"><div class="card-h"><h3>Branches</h3></div><table class="kids">' +
      branchRows(n.children) +
      '</table></section>'
    )
  }

  // ---------------------------------------------------------------- tests
  // The AC ids a test title carries, so a test listed under its AC can drop them.
  const REF =
    /(?:REQ[-_][A-Z0-9]+[-_]\d{3}(?:[\s_:·.,\-–—]*?ex\d+)?[\s,:·]*)+/gi
  const where = (t) =>
    `<span class="lv lv-${t.level}">${esc(t.level)}</span><span class="ct-file" title="${esc(t.path)}">${esc(fileName(t.path))}:${t.line}</span>`

  /** A test under its AC: its own name first, where it lives below, smaller. */
  function testItem(t) {
    const parts = t.title.split(' › ').map((p) => p.replace(REF, '').trim())
    const own = parts.pop() || t.title
    const context = parts.filter(Boolean).join(' › ')
    return (
      `<li class="ct${t.skipped ? ' skipped' : ''}${resultClass(t)}"><span class="ct-name">${mark(t)}${esc(own)}</span>` +
      `<span class="ct-where">${where(t)}` +
      (context ? `<span class="ct-ctx">${esc(context)}</span>` : '') +
      (t.skipped ? '<span class="chip">skipped</span>' : '') +
      gapChip(t) +
      `</span>${failureOf(t)}</li>`
    )
  }
  /** A test listed on its own: the full name, as written; `extra` after it. */
  const testRow = (t, extra = '') =>
    `<li class="ct${t.skipped ? ' skipped' : ''}${resultClass(t)}"><span class="ct-name">${mark(t)}${esc(t.title)}</span><span class="ct-where">${where(t)}${t.skipped ? '<span class="chip">skipped</span>' : ''}${gapChip(t)}</span>${failureOf(t)}${extra}</li>`

  // ---------------------------------------------------------------- requirements
  const acPasses = (e) =>
    !(state.untested && e.covered) &&
    !(state.drift && !differs(e)) &&
    !(state.unconfirmed && !e.assumed) &&
    !(state.failing && acState(e) !== 'failing')

  function codeCallout(e) {
    if (!e.code.length && !e.recommend) return ''
    return (
      '<div class="callout">' +
      e.code
        .map(
          (c) => `<p><span class="k">Code does</span><span>${esc(c)}</span></p>`
        )
        .join('') +
      (e.recommend
        ? `<p><span class="k">Why</span><span>${esc(e.recommend.reason)}</span></p>`
        : '') +
      '</div>'
    )
  }

  function acHtml(r, e) {
    let flags = ''
    if (e.assumed)
      flags +=
        '<span class="chip chip-unconf" title="Value taken from the code because the documents are silent; the product owner has not confirmed it">unconfirmed</span>'
    if (differs(e)) flags += '<span class="chip chip-drift">≠ code</span>'
    if (isStale(r, e)) flags += STALE_CHIP
    if (e.recommend)
      flags += rec(
        e.recommend.kind,
        `Recommend: fix ${e.recommend.kind === 'ac' ? 'AC' : 'code'}${e.recommend.priority ? ` · ${e.recommend.priority}` : ''}`
      )
    let notes = codeCallout(e)
    for (const o of e.otherDocs)
      notes += `<p class="other"><span class="k">Other doc</span><span>${esc(o)}</span></p>`

    // Right column: the tests that cover this AC, or why there are none. With
    // results, the AC's state in the last run comes first and says it.
    let right
    if (!e.tests.length)
      right = RUN
        ? stateChip('none')
        : '<p class="no-test"><span class="st"></span>No test yet</p>'
    else {
      const skipOnly = RUN
        ? stateChip(acState(e))
        : e.covered
          ? ''
          : '<p class="no-test"><span class="st st-skip"></span>Only skipped tests</p>'
      const warn =
        differs(e) && e.covered
          ? '<p class="warn">The code differs from this AC, so this test is failing or does not test the real code</p>'
          : ''
      const tests = byResult(e.tests)
      const shown = tests.slice(0, 3)
      const rest = tests.slice(3)
      right =
        skipOnly +
        warn +
        `<ul class="ctl">${shown.map(testItem).join('')}</ul>` +
        (rest.length
          ? `<details class="more"><summary>${plural(rest.length, 'more test', 'more tests')}</summary><ul class="ctl">${rest.map(testItem).join('')}</ul></details>`
          : '')
    }
    return (
      `<li class="ac" id="${esc(`${r.id}-${e.id}`)}"><div class="ac-l"><div class="ac-top"><b class="exid">${esc(e.id)}</b>${flags}</div>` +
      `<p class="ac-text">${esc(e.text)}</p>${notes}</div><div class="ac-r">${right}</div></li>`
    )
  }

  function reqHtml(id, openByDefault) {
    const r = R[id]
    const acs = r.examples.filter(acPasses)
    if (!acs.length) return ''
    const cov = r.examples.filter((e) => e.covered).length
    const drift = r.examples.filter(differs).length
    const open = id in state.open ? state.open[id] : openByDefault
    const meta = []
    const row = (k, v, cls = '') =>
      `<p class="rule"><span class="k">${k}</span><span${cls ? ` class="${cls}"` : ''}>${esc(v)}</span></p>`
    if (r.rule) meta.push(row('Rule', r.rule))
    if (r.source) meta.push(row('Source', r.source, 'src'))
    if (r.appliesTo.length) meta.push(row('Applies to', r.appliesTo.join(', ')))
    // A tag row is shown when its first tag has a value; the others follow it.
    for (const t of D.tagRows)
      if (tagValues(r, t.tags[0]).length)
        meta.push(
          row(
            esc(t.label),
            t.tags.flatMap((tag) => tagValues(r, tag)).join(' · ')
          )
        )
    const general = r.general.length
      ? '<div class="general"><p><b>Tests naming no AC</b> · linked to this requirement but to no AC, so no AC counts as tested because of them.</p>' +
        `<ul class="ctl">${byResult(r.general).map(testItem).join('')}</ul></div>`
      : ''
    return (
      `<details class="req" data-req="${esc(id)}"${open ? ' open' : ''}><summary>` +
      `<span class="rid" title="${esc(r.file)}">${esc(id)}</span><span class="rtitle">${esc(r.title)}${r.planned ? ' <span class="chip chip-planned">planned</span>' : ''}</span>` +
      `<span class="rmeta">${meter(cov, r.examples.length, 'small')}<span>${cov}/${r.examples.length}</span>${drift ? `<span class="chip chip-drift">≠${drift}</span>` : ''}</span></summary>` +
      `<div class="rbody">${meta.join('')}<div class="ac-head"><span>Acceptance criterion</span><span>Tests covering it</span></div>` +
      `<ul class="acs">${acs.map((e) => acHtml(r, e)).join('')}</ul>${general}</div></details>`
    )
  }

  function reqList(n, ids) {
    const groups = new Map()
    for (const id of ids) {
      const h = R[id].home
      if (!groups.has(h)) groups.set(h, [])
      groups.get(h).push(id)
    }
    // On a leaf feature every card is open, so its ACs and tests show at
    // once; above it they stay closed (hundreds of requirements), unless the
    // node holds only one.
    const opened = n.children.length === 0 || ids.length === 1
    const html = [...groups]
      .map(([h, list]) => {
        const items = list.map((id) => reqHtml(id, opened)).join('')
        if (!items) return ''
        const head =
          groups.size > 1 || h !== n.key
            ? `<h3 class="gh">${goLink(h, esc(rel(h, n.key === h ? N[h].parent : n.key)))}<span class="muted">${list.length}</span></h3>`
            : ''
        return head + items
      })
      .join('')
    return (
      html ||
      '<p class="hint">No acceptance criterion matches these filters.</p>'
    )
  }

  // `ids`: the requirements listed; on a page with results, "Failing" counts
  // their failing ACs.
  function toolbar(ids) {
    const seg = (key, label) =>
      `<label class="seg${state[key] ? ' on' : ''}"><input type="checkbox" id="f-${key}" data-f="${key}"${state[key] ? ' checked' : ''}>${label}</label>`
    const failingSeg = RUN
      ? seg(
          'failing',
          `Failing<span class="n">${num(failingIn(ids).acs)}</span>`
        )
      : ''
    return `<div class="toolbar">${seg('untested', 'Untested')}${seg('drift', 'Code differs')}${seg('unconfirmed', 'Unconfirmed')}${failingSeg}</div>`
  }

  function crumbs(key) {
    return `<nav class="crumbs" aria-label="Path">${ancestors(key)
      .map((k, i, a) =>
        i === a.length - 1
          ? `<span>${esc(N[k].label)}</span>`
          : goLink(k, esc(N[k].label))
      )
      .join('<i>/</i>')}</nav>`
  }

  // ---------------------------------------------------------------- views
  function problemsHtml() {
    if (!D.problems.length) return ''
    return (
      `<section class="problems"><h3>Data problems <span class="muted">(${D.problems.length})</span></h3>` +
      '<p>The requirement or test files have these mistakes. The numbers on this page may be off until they are fixed.</p>' +
      `<ul>${D.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></section>`
    )
  }

  function nodeView() {
    if (!state.key)
      return `<h1>No requirements yet</h1><p class="hint">Add a requirement file under <span class="mono">${esc(D.requirements)}/</span>, then run <span class="mono">npm run coverage:map</span>.</p>`
    const n = N[state.key]
    const ids = subtree(n.key).flatMap((k) => N[k].reqIds)
    let html = `${crumbs(n.key)}<h1>${esc(n.label)}</h1>${kpis(n.stats, ids)}`
    if (n.stats.planned)
      html += `<p class="hint">${plural(n.stats.planned, 'planned requirement', 'planned requirements')}: written from the documents, not built yet, not counted.</p>`
    const rows = subtree(n.key).filter((k) => N[k].matrixRow)
    // A heatmap per group the rows split by, in the config's order.
    for (const g of G) {
      const mine = rows.filter((k) => N[N[k].children[0]].group.tag === g.tag)
      if (mine.length) html += heatmap(mine, n.parent || n.key, g)
    }
    if (!rows.length && n.children.length) html += branches(n)
    for (const b of D.breakdowns) html += breakdownCard(ids, b)
    if (n.applies.length) {
      html +=
        `<section class="card applies"><div class="card-h"><h3>Also applies here</h3><span class="muted">${plural(n.applies.length, 'requirement', 'requirements')}, counted under their own branch</span></div>` +
        n.applies
          .map(
            (id) =>
              `<p>${goLink(R[id].home, esc(id), ` class="mono" data-open="${esc(id)}"`)} ${esc(R[id].title)} <span class="muted">· ${esc(rel(R[id].home, null))}</span></p>`
          )
          .join('') +
        '</section>'
    }
    if (!ids.length) return html
    // Every requirement under the node is listed, grouped by branch; closed cards are cheap.
    html += `<h2>Requirements</h2>${toolbar(ids)}${reqList(n, ids)}`
    return html
  }

  // The whole project: the root branches added up, as summary() prints them.
  function overviewView() {
    const s = { ...blank(), untestedReqs: 0, planned: 0 }
    for (const k of D.roots)
      for (const f of Object.keys(s)) s[f] += N[k].stats[f] || 0
    const ids = D.roots.flatMap((k) => subtree(k).flatMap((c) => N[c].reqIds))
    let html = `<h1>Project overview</h1>${kpis(s, ids, 'Open a branch to filter them with “Untested”')}`
    if (!D.roots.length)
      return (
        html +
        `<p class="hint">No requirements yet. Add a requirement file under <span class="mono">${esc(D.requirements)}/</span>, then run <span class="mono">npm run coverage:map</span>.</p>` +
        lastRunCard()
      )
    // A root with nothing counted (only planned requirements) has no row.
    // Two levels: each root, and under it its children; the tree shows deeper.
    const counted = (k) => N[k].stats.total > 0
    const areas = D.roots.filter(counted)
    if (areas.length)
      html +=
        '<section class="card"><div class="card-h"><h3>Features</h3><span class="muted">every area and the features under it · click one to open it</span></div>' +
        `<div class="scroll"><table class="kids">${areas
          .map(
            (k) =>
              branchRows([k], 'root') +
              branchRows(N[k].children.filter(counted), 'sub')
          )
          .join('')}</table></div></section>`
    if (s.planned)
      html += `<p class="hint">${plural(s.planned, 'planned requirement', 'planned requirements')}: written from the documents, not built yet, not counted.</p>`
    html +=
      lastRunCard() +
      `<section class="card"><div class="card-h"><h3>Tests</h3><a href="#tests" data-view="tests">Open the list</a></div>` +
      `<p>${plural(D.testCount, 'test', 'tests')} · ${num(D.unlinked.total)} name no requirement</p></section>`
    return html
  }

  // With results: each results file with its time and counts, or why it was
  // not used; the failing tests; what the run and the code do not share.
  function lastRunCard() {
    if (!RUN) return ''
    const files = RUN.files
      .map((f) => {
        const what =
          f.status === 'missing'
            ? '<span class="muted">not found</span>'
            : f.status === 'invalid'
              ? '<span class="ko">not a JUnit report</span>'
              : `${f.time ? `${esc(f.time)} · ` : ''}<span class="ok">${num(f.passed)} passed</span> · ` +
                `<span class="${f.failed ? 'ko' : 'muted'}">${num(f.failed)} failed</span> · <span class="muted">${num(f.skipped)} skipped</span>`
        return `<dt class="mono">${esc(f.path)}</dt><dd>${what}</dd>`
      })
      .join('')
    const lines = [
      `${plural(RUN.failing.length, 'failing test', 'failing tests')} · <a href="#tests" data-view="tests">see them</a>`,
      RUN.notRun
        ? `${num(RUN.notRun)} ${RUN.notRun === 1 ? 'test in the code is' : 'tests in the code are'} not in any results file`
        : 'Every test in the code is in a results file',
    ]
    if (RUN.unmatched)
      lines.push(
        `${num(RUN.unmatched)} ${RUN.unmatched === 1 ? 'result matches' : 'results match'} no test found in the code`
      )
    return (
      '<section class="card"><div class="card-h"><h3>Last test run</h3><span class="muted">from the JUnit files in the config</span></div>' +
      `<dl class="runs">${files}</dl>${lines.map((l) => `<p class="run-line">${l}</p>`).join('')}</section>`
    )
  }

  const span = ([a, b]) => (a === b ? `${a}` : `${a}-${b}`)

  // With --since: the Code: lines citing code changed since then. Each may now
  // describe the old behaviour, so it is read again before the change ships.
  function rereadCard() {
    const rr = D.reread
    if (!rr) return ''
    const items = rr.entries
      .map((e) => {
        const r = R[e.req]
        const ac = r && r.examples.find((x) => x.id === e.ex)
        const ref = esc(`${e.req ?? '?'} ${e.ex ?? '?'}`)
        const id = ac
          ? goLink(
              r.home,
              ref,
              ` class="mono" data-open="${esc(r.id)}" data-ac="${esc(`${r.id}-${ac.id}`)}"`
            )
          : `<span class="mono">${ref}</span>`
        const files = e.files
          .map(
            (f) =>
              `<span class="mono">${esc(f.file)}:${f.ranges.map(span).join(', ')}</span> <span class="muted">(changed ${f.changed.map(span).join(', ')})</span>`
          )
          .join('<br>')
        return (
          `<li class="dcard"><div class="ac-top">${id}<span class="muted dpath">${esc(e.doc)}:${e.line}</span></div>` +
          `<p class="ac-text">${files}</p><p class="ac-text">${esc(e.text)}</p></li>`
        )
      })
      .join('')
    const n = rr.entries.length
    return (
      `<section class="card"><div class="card-h"><h3>Re-read after this change (since ${esc(rr.since)})</h3>` +
      `<span class="muted">${plural(n, 'Code: line cites', 'Code: lines cite')} lines that changed${rr.unnumbered ? ` · ${plural(rr.unnumbered, 'citation', 'citations')} without line numbers, not checked` : ''}</span></div>` +
      (n
        ? `<ul class="dlist">${items}</ul>`
        : '<p class="hint">No Code: line cites a line that changed.</p>') +
      '</section>'
    )
  }

  // A drift card's chip: the requirement's value of the first group with values.
  function chip(r) {
    const g = G[0]
    if (!g) return ''
    const v = tagValues(r, g.tag)[0]
    return `<span class="chip">${esc(v ? valueLabel(g, v) : `No ${g.label}`)}</span>`
  }

  function driftView() {
    let html =
      '<h1>ACs the code does differently</h1>' +
      '<p class="lead">The code does something other than the AC. The recommendations are Claude’s; the product owner decides.</p>' +
      rereadCard()
    if (!D.drift.length)
      return `${html}<p class="hint">No AC differs from the code.</p>`
    const groups = [
      ['code', 'Recommend fixing the code — keep the AC, change the code'],
      [
        'ac',
        'Recommend fixing the AC — the code is better, change the document',
      ],
      [null, 'No recommendation yet'],
    ]
    for (const [kind, title] of groups) {
      // P0 first, then P1–P3, then the unranked; file order within a rank.
      const rank = (d) => {
        const p = driftEx(d).recommend?.priority
        return p ? Number(p[1]) : 4
      }
      const items = D.drift
        .filter((d) => (driftEx(d).recommend?.kind ?? null) === kind)
        .map((d, i) => [d, i])
        .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
        .map(([d]) => d)
      if (!items.length) continue
      const p0 =
        kind === 'code' ? items.filter((d) => isP0Code(driftEx(d))).length : 0
      const cards = items
        .map((d) => {
          const r = R[d.reqId]
          const e = r.examples.find((x) => x.id === d.exId)
          return (
            `<li class="dcard"><div class="ac-top">${goLink(r.home, esc(d.ref), ` class="mono" data-open="${esc(r.id)}" data-ac="${esc(`${r.id}-${e.id}`)}"`)}` +
            chip(r) +
            (e.recommend?.priority
              ? `<span class="chip chip-prio chip-prio-${e.recommend.priority.toLowerCase()}">${e.recommend.priority}</span>`
              : '') +
            `<span class="st-label st-label-${e.covered ? 'yes' : 'no'}">${e.covered ? 'tested' : 'no test'}</span>` +
            (e.tests.some((t) => t.failing) ? GAP_CHIP : '') +
            (isStale(r, e) ? STALE_CHIP : '') +
            `<span class="muted dpath">${esc(rel(r.home, null))}</span></div>` +
            `<p class="ac-text">${esc(e.text)}</p>${codeCallout(e)}</li>`
          )
        })
        .join('')
      html += `<section class="dgroup"><h3>${kind ? rec(kind, '') : ''}${esc(title)} <span class="muted">(${items.length}${p0 ? ` · ${p0} P0` : ''})</span></h3><ul class="dlist">${cards}</ul></section>`
    }
    return html
  }

  // How a test names an AC, shown with the first AC that has a live test, in
  // tree order (a node's own requirements before its children's, ACs in file
  // order); with none, the example of the project kit.
  function exampleAc() {
    for (const k of D.roots.flatMap(subtree))
      for (const id of N[k].reqIds)
        for (const e of R[id].examples) if (e.covered) return `${id} ${e.id}`
    return 'REQ-CHECKOUT-012 ex1'
  }

  // With results: the tests that failed, each with what it covers, and those
  // found in the code but in no results file, by file.
  function runSections() {
    if (!RUN) return ''
    const covers = ({ refs }) =>
      `<span class="ct-refs">${
        refs.length
          ? `Covers ${refs
              .map((x) => {
                const r = R[x.reqId]
                const ac = x.exId
                  ? ` data-ac="${esc(`${x.reqId}-${x.exId}`)}"`
                  : ''
                return goLink(
                  r.home,
                  esc(x.ref),
                  ` class="mono" data-open="${esc(x.reqId)}"${ac}`
                )
              })
              .join(', ')}`
          : 'Names no requirement'
      }</span>`
    const row = (item) => testRow(item.test, covers(item))
    const failing = RUN.failing.length
      ? `<ul class="ctl">${RUN.failing.map(row).join('')}</ul>`
      : '<p class="hint">No test failed in the last run.</p>'
    const byFile = new Map()
    for (const item of RUN.notRunTests) {
      if (!byFile.has(item.test.path)) byFile.set(item.test.path, [])
      byFile.get(item.test.path).push(item)
    }
    const notRun = byFile.size
      ? [...byFile]
          .map(
            ([path, items]) =>
              `<details class="file"><summary><span class="lv lv-${items[0].test.level}">${esc(items[0].test.level)}</span><span class="mono">${esc(path)}</span><span class="muted">${plural(items.length, 'test', 'tests')}</span></summary>` +
              `<ul class="ctl">${items.map(row).join('')}</ul></details>`
          )
          .join('')
      : '<p class="hint">Every test in the code is in a results file.</p>'
    return (
      `<section class="card"><div class="card-h"><h3>Failing in the last run <span class="muted">(${num(RUN.failing.length)})</span></h3></div>${failing}</section>` +
      `<section class="card"><div class="card-h"><h3>Not in the last run <span class="muted">(${num(RUN.notRunTests.length)})</span></h3><span class="muted">found in the code, in no results file</span></div>${notRun}</section>`
    )
  }

  function testsView() {
    let html =
      '<h1>Tests</h1>' +
      `<p class="lead">${plural(D.testCount, 'test', 'tests')} scanned; ${num(D.testCount - D.unlinked.total)} name a requirement. A test is linked when its name, or a describe around it, names the AC: “${esc(exampleAc())}”. ${RUN ? 'Each test also shows its result in the last run, from the JUnit files in the config.' : 'The page says whether a test exists, not whether it passes.'}</p>` +
      runSections()
    const orphanGroups = [
      ['missing', 'Tests naming an AC that does not exist'],
      ['removed', 'Tests naming a removed AC'],
    ]
    for (const [reason, title] of orphanGroups) {
      const items = D.orphans.filter((o) => o.reason === reason)
      if (!items.length) continue
      html +=
        `<section class="card"><div class="card-h"><h3>${esc(title)} <span class="muted">(${items.length})</span></h3></div>` +
        `<ul class="plain">${items.map((o) => `<li><b class="mono">${esc(o.ref)}</b><ul class="ctl">${testRow(o.test)}</ul></li>`).join('')}</ul></section>`
    }
    if (D.dynamic.length) {
      html +=
        `<section class="card"><div class="card-h"><h3>Tests whose name cannot be read statically <span class="muted">(${D.dynamic.length})</span></h3></div>` +
        '<p class="muted">The whole name is in a variable, so which AC it names is unknown.</p>' +
        `<ul class="plain">${D.dynamic.map((d) => `<li class="mono">${esc(`${d.path}:${d.line}`)}</li>`).join('')}</ul></section>`
    }
    // Test files a pattern of the config's `exclude` left out (build output by
    // default): listed, so one in a folder named like it is not lost unseen.
    if (D.excluded) {
      html +=
        `<section class="card"><div class="card-h"><h3>Left out by exclude <span class="muted">(${D.excluded.length})</span></h3></div>` +
        '<p class="muted">These files match the test patterns, but a pattern in <span class="mono">exclude</span> leaves them out, so their tests are not scanned.</p>' +
        `<ul class="plain">${D.excluded.map((p) => `<li class="mono">${esc(p)}</li>`).join('')}</ul></section>`
    }
    const notes = Object.keys(D.notes).sort()
    if (notes.length) {
      html +=
        '<section class="card"><div class="card-h"><h3>Notes on test files</h3></div>' +
        `<ul class="plain">${notes.map((p) => `<li><span class="mono">${esc(p)}</span><p>${esc(D.notes[p])}</p></li>`).join('')}</ul></section>`
    }
    html +=
      `<section class="card"><div class="card-h"><h3>Tests naming no requirement</h3><span class="muted">${plural(D.unlinked.total, 'test', 'tests')} in ${plural(D.unlinked.files.length, 'file', 'files')}</span></div>` +
      D.unlinked.files
        .map(
          (f) =>
            `<details class="file"><summary><span class="lv lv-${f.level}">${esc(f.level)}</span><span class="mono">${esc(f.path)}</span><span class="muted">${plural(f.tests.length, 'test', 'tests')}</span>${D.notes[f.path] ? '<span class="chip">has a note</span>' : ''}</summary>` +
            `<ul class="plain">${f.tests.map((t) => `<li${t.skipped ? ' class="skipped"' : ''}><span class="mono muted">:${t.line}</span> ${esc(t.title)}</li>`).join('')}</ul></details>`
        )
        .join('') +
      '</section>'
    return html
  }

  function searchView() {
    const q = state.q.toLowerCase()
    const hits = Object.keys(R).filter((id) => {
      const r = R[id]
      return (
        id.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.examples.some((e) => e.text.toLowerCase().includes(q))
      )
    })
    let html =
      `<h1>Search</h1><p class="muted">${hits.length === 1 ? '1 requirement matches' : `${num(hits.length)} requirements match`} “${esc(state.q)}”` +
      `${hits.length > 40 ? ' · showing the first 40' : ''}</p>${toolbar(hits.slice(0, 40))}`
    for (const id of hits.slice(0, 40))
      html += `<p class="hit-path">${esc(rel(R[id].home, null))}</p>${reqHtml(id, false)}`
    return html
  }

  // ---------------------------------------------------------------- feature map
  // #map: the tree as a graph, left to right: the project, its areas (the
  // roots), the features under them, the requirements as leaves with a dot
  // per AC. Drawn with HTML nodes and SVG edges in one element moved by
  // translate and scale: drag to pan, wheel or pinch to zoom. What is open,
  // the zoom and the place are kept while the page is open.
  const MAP = { g: null, open: null, level: null, view: null, sel: null }
  const NODE_W = { project: 214, feature: 214, req: 250 }
  const NODE_H = 54 // as .gn's height in style.css
  const ROW = 66
  const COL = 284
  const LEVELS_SHOWN = [
    [1, 'Areas'],
    [2, 'Features'],
    [Infinity, 'Everything'],
  ]
  // The pan kept on a 1/1024 px grid, so moving by whole pixels adds exactly.
  const stamp = (n) => Math.round(n * 1024) / 1024

  /** The graph, built once: ids are node keys, "req:<id>", and "" for the project. */
  function mapGraph() {
    if (MAP.g) return MAP.g
    const byId = {}
    const add = (n, parent, d) => {
      n.parent = parent
      n.d = d
      byId[n.id] = n
      n.children.forEach((c) => add(c, n, d + 1))
      return n
    }
    // A planned requirement is counted nowhere, as in the tree: no share, no
    // dots, no bar on its node.
    const reqNode = (id) => {
      const r = R[id]
      const s = { total: 0, covered: 0, drift: 0, unconfirmed: 0, failing: 0 }
      if (!r.planned)
        for (const e of r.examples) {
          s.total++
          if (e.covered) s.covered++
          if (differs(e)) s.drift++
          if (e.assumed) s.unconfirmed++
          if (RUN && acState(e) === 'failing') s.failing++
        }
      return {
        id: `req:${id}`,
        reqId: id,
        kind: 'req',
        code: id.replace(/^REQ-/, ''),
        label: r.title,
        planned: r.planned,
        ...s,
        acs: r.planned ? null : r.examples,
        examples: r.examples,
        children: [],
      }
    }
    const treeNode = (key) => {
      const s = N[key].stats
      return {
        id: key,
        key,
        kind: 'feature',
        label: N[key].label,
        total: s.total,
        covered: s.covered,
        drift: s.drift,
        unconfirmed: s.unconfirmed,
        reqs: s.reqs,
        planned: s.planned,
        failing: RUN ? failingAcs(key) : 0,
        children: [
          ...N[key].children.map(treeNode),
          ...N[key].reqIds.map(reqNode),
        ],
      }
    }
    const roots = D.roots.map(treeNode)
    const sum = (k) => roots.reduce((n, r) => n + r[k], 0)
    const root = {
      id: '',
      kind: 'project',
      label: D.project || 'Project',
      ...Object.fromEntries(
        ['total', 'covered', 'drift', 'unconfirmed', 'reqs', 'planned']
          .concat('failing')
          .map((k) => [k, sum(k)])
      ),
      children: roots,
    }
    MAP.g = { root: add(root, null, 0), byId }
    return MAP.g
  }
  const openTo = (level) =>
    new Set(
      Object.values(mapGraph().byId)
        .filter((n) => n.d < level && n.children.length)
        .map((n) => n.id)
    )
  function rowsAt(level) {
    let rows = 0
    const walk = (n) =>
      n.d < level && n.children.length ? n.children.forEach(walk) : rows++
    walk(mapGraph().root)
    return rows
  }
  // At first, open down to the features when that makes 24 rows or fewer,
  // else to the areas only.
  function mapOpen() {
    if (!MAP.open) {
      MAP.level = rowsAt(2) <= 24 ? 2 : 1
      MAP.open = openTo(MAP.level)
    }
    return MAP.open
  }
  function mapLayout() {
    const open = mapOpen()
    const nodes = []
    const edges = []
    let row = 0
    const place = (n, parent) => {
      n.x = n.d * COL
      n.w = NODE_W[n.kind]
      nodes.push(n)
      if (parent) edges.push([parent, n])
      const kids = open.has(n.id) ? n.children : []
      if (!kids.length) n.y = row++ * ROW
      else {
        kids.forEach((k) => place(k, n))
        n.y = (kids[0].y + kids[kids.length - 1].y) / 2
      }
    }
    place(mapGraph().root, null)
    return {
      nodes,
      edges,
      width: Math.max(...nodes.map((n) => n.x + n.w)) + 20,
      height: (row - 1) * ROW + NODE_H,
    }
  }
  // An AC's dot: with results its state in the last run, else whether it
  // has a test.
  const dotOf = (e) => (RUN ? acState(e) : e.covered ? 'covered' : 'none')
  const DOT_SAID = {
    covered: 'Has a test',
    none: 'No test yet',
    passing: 'Passing',
    failing: 'Failing',
    notrun: 'Not run',
    skipped: 'Only skipped',
    gap: 'Known gap',
  }
  function mapNodeHtml(n, open) {
    const p = pct(n.covered, n.total)
    const b = n.total ? band(p).key : 'none'
    const kids = n.children.length
    const isOpen = open.has(n.id)
    const stat =
      n.kind === 'req'
        ? n.planned
          ? 'planned'
          : `${n.covered}/${n.total}`
        : n.total
          ? `${p}% · ${n.covered}/${n.total} ACs`
          : n.planned
            ? `${num(n.planned)} planned`
            : 'No ACs'
    let toggle = ''
    if (kids) {
      const reqs = n.children.filter((c) => c.kind === 'req').length
      const feats = kids - reqs
      const what =
        reqs && feats
          ? `${plural(feats, 'feature', 'features')} and ${plural(reqs, 'requirement', 'requirements')}`
          : reqs
            ? plural(reqs, 'requirement', 'requirements')
            : plural(feats, 'feature', 'features')
      toggle = `<button type="button" class="gn-tog" data-tog="${esc(n.id)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Hide' : 'Show'} ${what} of ${esc(n.label)}">${isOpen ? '−' : `+${kids}`}</button>`
    }
    return (
      `<div class="gn ${n.kind} b-${b}${MAP.sel === n.id ? ' sel' : ''}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px" data-node="${esc(n.id)}">` +
      `<button type="button" class="gn-main" data-pick="${esc(n.id)}" title="${esc(n.label)}">` +
      `<span class="gn-l">${n.code ? `<span class="gn-code">${esc(n.code)}</span>` : ''}${esc(n.label)}</span>` +
      `<span class="gn-s">${n.acs ? `<span class="dots">${n.acs.map((e) => `<i class="ad ${dotOf(e)}"></i>`).join('')}</span>` : ''}<span>${stat}</span>` +
      (n.failing ? `<b class="gn-f">✗${num(n.failing)}</b>` : '') +
      (n.drift ? `<span class="gn-d">≠${num(n.drift)}</span>` : '') +
      '</span>' +
      (n.kind === 'req' && n.planned
        ? ''
        : `<span class="gn-bar"><i style="width:${p ?? 0}%"></i></span>`) +
      `</button>${toggle}</div>`
    )
  }
  const edgePath = ([a, b]) => {
    const x1 = a.x + a.w
    const y1 = a.y + NODE_H / 2
    const x2 = b.x
    const y2 = b.y + NODE_H / 2
    const mx = (x1 + x2) / 2
    return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`
  }
  const $ = (id) => document.getElementById(id)
  function mapDraw() {
    MAP.L = mapLayout()
    const open = mapOpen()
    $('map-nodes').innerHTML = MAP.L.nodes
      .map((n) => mapNodeHtml(n, open))
      .join('')
    const edges = $('map-edges')
    edges.setAttribute('width', MAP.L.width)
    edges.setAttribute('height', MAP.L.height)
    edges.innerHTML = MAP.L.edges.map(edgePath).join('')
  }
  function mapApply() {
    const v = MAP.view
    v.x = stamp(v.x)
    v.y = stamp(v.y)
    $('map-graph').style.transform =
      `translate(${v.x}px, ${v.y}px) scale(${v.k})`
    $('map-zoom').textContent = `${Math.round(v.k * 100)}%`
    // Far out, a node shows its name only.
    $('map').classList.toggle('z-far', v.k < 0.45)
  }
  const boxSize = () => $('map').getBoundingClientRect()
  // The whole graph in the box, never larger than its own size (100%).
  function mapFit() {
    const r = boxSize()
    const { width, height } = MAP.L
    const k = Math.max(
      0.15,
      Math.min(1, (r.width - 72) / width, (r.height - 72) / height)
    )
    MAP.view = {
      k,
      x: (r.width - width * k) / 2,
      y: (r.height - height * k) / 2,
    }
    mapApply()
  }
  // The first view fits the whole graph only while names stay readable (60%
  // or more); else it starts at 60% with the project at the left edge, and
  // Fit shows everything.
  function mapStart() {
    mapFit()
    if (MAP.view.k >= 0.6) return
    const r = boxSize()
    const root = mapGraph().root
    MAP.view = { k: 0.6, x: 24, y: r.height / 2 - (root.y + NODE_H / 2) * 0.6 }
    mapApply()
  }
  function mapZoomAt(f, cx, cy) {
    const v = MAP.view
    const k = Math.min(2.5, Math.max(0.15, v.k * f))
    v.x = cx - (cx - v.x) * (k / v.k)
    v.y = cy - (cy - v.y) * (k / v.k)
    v.k = k
    mapApply()
  }
  const mapZoomCentre = (f) => {
    const r = boxSize()
    mapZoomAt(f, r.width / 2, r.height / 2)
  }
  const markLevel = () => {
    for (const b of document.querySelectorAll('[data-level]'))
      b.setAttribute(
        'aria-pressed',
        String(Number(b.getAttribute('data-level')) === MAP.level)
      )
  }
  // Opening or closing a branch keeps that node where it was on screen.
  function mapToggle(id) {
    const n = mapGraph().byId[id]
    const before = n.y
    const open = mapOpen()
    if (open.has(id)) open.delete(id)
    else open.add(id)
    MAP.level = null
    mapDraw()
    MAP.view.y -= (n.y - before) * MAP.view.k
    mapApply()
    markLevel()
    document
      .querySelector(`[data-tog="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true })
  }
  function mapPanel() {
    const el = $('map-panel')
    for (const g of document.querySelectorAll('.gn'))
      g.classList.toggle('sel', g.getAttribute('data-node') === MAP.sel)
    const n = MAP.sel === null ? null : mapGraph().byId[MAP.sel]
    el.hidden = !n
    if (!n) return
    const path = []
    for (let x = n.parent; x; x = x.parent) path.unshift(esc(x.label))
    const p = pct(n.covered, n.total)
    const row = (k, v, cls = '') =>
      `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}</dd>`
    const link =
      n.kind === 'req'
        ? goLink(
            R[n.reqId].home,
            'Open the feature it belongs to →',
            ` data-open="${esc(n.reqId)}"`
          )
        : n.kind === 'project'
          ? '<a href="#overview" data-view="overview">Open the page →</a>'
          : goLink(n.key, 'Open the page →')
    el.innerHTML =
      '<button type="button" class="map-x" data-close-panel aria-label="Close">×</button>' +
      (path.length
        ? `<p class="map-path">${path.join(' <span class="sep">/</span> ')}</p>`
        : '') +
      `<h3>${n.code ? `<span class="gn-code">${esc(n.code)}</span>` : ''}${esc(n.label)}</h3>` +
      (n.kind === 'req' && n.planned
        ? // Counted nowhere: what it is, and its ACs, without dots.
          '<p class="map-planned">Planned: written from the documents, not built yet, not counted.</p>' +
          `<ul class="map-acs plain-acs">${n.examples.map((e) => `<li><span><b class="mono">${esc(e.id)}</b> ${esc(e.text)}</span></li>`).join('')}</ul>`
        : '<dl class="map-kv">' +
          row(
            'ACs with a test',
            n.total
              ? `${p}% · ${n.covered} of ${n.total}`
              : n.planned
                ? `none yet · ${plural(n.planned, 'planned requirement', 'planned requirements')}`
                : '—'
          ) +
          (n.kind !== 'req' ? row('Requirements', num(n.reqs)) : '') +
          (n.failing ? row('Failing ACs', num(n.failing), 'ko') : '') +
          row('Unconfirmed ACs', num(n.unconfirmed)) +
          (n.drift ? row('Code differs', num(n.drift)) : '') +
          '</dl>' +
          (n.acs
            ? `<ul class="map-acs">${n.acs.map((e) => `<li><i class="ad ${dotOf(e)}" title="${DOT_SAID[dotOf(e)]}"></i><span><b class="mono">${esc(e.id)}</b> ${esc(e.text)}</span></li>`).join('')}</ul>`
            : '')) +
      `<p class="map-open">${link}</p>`
  }
  function mapView() {
    mapOpen()
    const level = (v, l) =>
      `<button type="button" data-level="${v}" aria-pressed="${MAP.level === v}">${l}</button>`
    const acs = RUN
      ? [
          ['passing', 'passing'],
          ['failing', 'failing'],
          ['notrun', 'not run'],
          ['gap', 'known gap'],
          ['skipped', 'only skipped'],
          ['none', 'no test'],
        ]
      : [
          ['covered', 'with a test'],
          ['none', 'no test'],
        ]
    return (
      '<div class="map-head"><h1>Feature map</h1>' +
      `<div class="map-seg" role="group" aria-label="Show down to"><span class="lab">Show</span>${LEVELS_SHOWN.map(([v, l]) => level(v, l)).join('')}</div></div>` +
      '<div class="map" id="map" tabindex="0" aria-label="Feature map. Drag to move; scroll, pinch or press + and − to zoom; 0 fits the map.">' +
      '<div class="map-graph" id="map-graph"><svg class="map-edges" id="map-edges" aria-hidden="true"></svg><div id="map-nodes"></div></div>' +
      '<span class="map-hint">Drag to move · scroll or pinch to zoom · + on a node opens its branch</span>' +
      '<div class="map-legend">' +
      BANDS.map(
        (b) =>
          `<span><i class="sw" style="background:var(--${b.key}-tint)"></i>${b.name}</span>`
      ).join('') +
      `<span>ACs: ${acs.map(([c, w]) => `<i class="ad ${c}"></i>${w}`).join(' ')}</span>` +
      `<span>${RUN ? '✗ failing ACs · ' : ''}≠ code differs</span></div>` +
      '<div class="map-zoom"><button type="button" data-zoom="out" aria-label="Zoom out">−</button><span id="map-zoom">100%</span><button type="button" data-zoom="in" aria-label="Zoom in">+</button><button type="button" data-zoom="fit">Fit</button></div>' +
      '<aside class="map-panel" id="map-panel" hidden></aside></div>'
    )
  }
  function mapInit() {
    mapDraw()
    if (MAP.view) mapApply()
    else mapStart()
    mapPanel()
    const box = $('map')
    // Tabbing to a node out of sight scrolls the clipped box: a pan instead.
    box.addEventListener('scroll', () => {
      if (!box.scrollLeft && !box.scrollTop) return
      MAP.view.x -= box.scrollLeft
      MAP.view.y -= box.scrollTop
      box.scrollLeft = 0
      box.scrollTop = 0
      mapApply()
    })
    const pts = new Map()
    let moved = false
    let start = null
    box.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const r = boxSize()
        mapZoomAt(
          // About 10% a wheel notch (100px); a trackpad pinch comes as ctrl.
          Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.001)),
          e.clientX - r.left,
          e.clientY - r.top
        )
      },
      { passive: false }
    )
    box.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.map-zoom, .map-panel')) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) {
        moved = false
        start = { x: e.clientX, y: e.clientY }
      }
    })
    box.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      if (pts.size === 1) {
        // Over 4px it is a drag, which moves the graph by all of it: from
        // where the pointer went down, the steps before 4px included.
        if (
          !moved &&
          Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4
        ) {
          moved = true
          p.x = start.x
          p.y = start.y
          box.setPointerCapture(e.pointerId)
          box.classList.add('dragging')
        }
        if (moved) {
          MAP.view.x += e.clientX - p.x
          MAP.view.y += e.clientY - p.y
          mapApply()
        }
      } else if (pts.size === 2) {
        const o = [...pts].find(([id]) => id !== e.pointerId)[1]
        const d0 = Math.hypot(p.x - o.x, p.y - o.y)
        const d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y)
        const r = boxSize()
        if (d0 > 0)
          mapZoomAt(
            d1 / d0,
            (e.clientX + o.x) / 2 - r.left,
            (e.clientY + o.y) / 2 - r.top
          )
        moved = true
      }
      p.x = e.clientX
      p.y = e.clientY
    })
    // The click a drag or a pinch ends with is swallowed below; once that
    // click has had its chance (the same task), or when the pointer is
    // cancelled (no click follows), the next click counts again.
    const up = (e) => {
      pts.delete(e.pointerId)
      if (pts.size) return
      box.classList.remove('dragging')
      if (e.type === 'pointercancel') moved = false
      else setTimeout(() => (moved = false), 0)
    }
    box.addEventListener('pointerup', up)
    box.addEventListener('pointercancel', up)
    // A drag that ends on a node is not a click on it.
    box.addEventListener(
      'click',
      (e) => {
        if (!moved) return
        e.stopPropagation()
        e.preventDefault()
        moved = false
      },
      true
    )
    box.addEventListener('keydown', (e) => {
      // Enter or Space on a node is a click from the keyboard: never a drag's.
      if (e.key === 'Enter' || e.key === ' ') {
        moved = false
        return
      }
      const step = 60
      const v = MAP.view
      if (e.key === '+' || e.key === '=') mapZoomCentre(1.25)
      else if (e.key === '-' || e.key === '_') mapZoomCentre(0.8)
      else if (e.key === '0') mapFit()
      else if (e.key === 'ArrowLeft') v.x += step
      else if (e.key === 'ArrowRight') v.x -= step
      else if (e.key === 'ArrowUp') v.y += step
      else if (e.key === 'ArrowDown') v.y -= step
      else return
      if (e.key.startsWith('Arrow')) mapApply()
      e.preventDefault()
    })
  }
  /** A click in the map view; true when it was the map's. */
  function mapClick(ev) {
    if (state.view !== 'map' || state.q) return false
    const z = ev.target.closest('[data-zoom]')
    if (z) {
      const how = z.getAttribute('data-zoom')
      if (how === 'fit') mapFit()
      else mapZoomCentre(how === 'in' ? 1.25 : 0.8)
      return true
    }
    const t = ev.target.closest('[data-tog]')
    if (t) {
      mapToggle(t.getAttribute('data-tog'))
      return true
    }
    const pick = ev.target.closest('[data-pick]')
    if (pick) {
      MAP.sel = pick.getAttribute('data-pick')
      mapPanel()
      return true
    }
    if (ev.target.closest('[data-close-panel]')) {
      // The focus goes back to the node the panel was about.
      const id = MAP.sel
      MAP.sel = null
      mapPanel()
      document
        .querySelector(`[data-pick="${CSS.escape(id)}"]`)
        ?.focus({ preventScroll: true })
      return true
    }
    const lv = ev.target.closest('[data-level]')
    if (lv) {
      MAP.level = Number(lv.getAttribute('data-level'))
      MAP.open = openTo(MAP.level)
      MAP.view = null
      render()
      // The page was drawn again: the focus on the map, so its keys work.
      $('map').focus({ preventScroll: true })
      return true
    }
    return false
  }
  // Esc closes the panel wherever the focus is, while the map shows.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state.view !== 'map' || state.q) return
    if (MAP.sel === null) return
    MAP.sel = null
    mapPanel()
  })

  function render() {
    renderTree()
    let view = nodeView
    if (state.q) view = searchView
    else if (state.view === 'overview') view = overviewView
    else if (state.view === 'drift') view = driftView
    else if (state.view === 'tests') view = testsView
    else if (state.view === 'map') view = mapView
    // The map takes the whole width: the tree hides while it shows.
    const onMap = view === mapView
    document.body.classList.toggle('mapview', onMap)
    detail.innerHTML = problemsHtml() + view()
    if (onMap) mapInit()
    for (const a of document.querySelectorAll('.views a')) {
      if (!state.q && a.getAttribute('data-view') === state.view)
        a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    }
    // The phone's tree button names where you are; the path is in the crumbs.
    const here = state.q
      ? 'Search'
      : state.view === 'overview'
        ? 'Overview'
        : state.view === 'map'
          ? 'Map'
          : state.view === 'drift'
            ? 'Code drift'
            : state.view === 'tests'
              ? 'Tests'
              : state.key
                ? N[state.key].label
                : 'Features'
    menu.textContent = `☰  ${here}`
  }

  // ---------------------------------------------------------------- events
  document.querySelector('.views').addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-view]')
    if (!a) return
    ev.preventDefault()
    navigate(`#${a.getAttribute('data-view')}`)
  })
  detail.addEventListener('click', (ev) => {
    if (mapClick(ev)) return
    const v = ev.target.closest('[data-view]')
    if (v) {
      ev.preventDefault()
      navigate(`#${v.getAttribute('data-view')}`)
      return
    }
    const a = ev.target.closest('[data-go]')
    if (!a) return
    ev.preventDefault()
    const open = a.getAttribute('data-open')
    if (open) state.open[open] = true
    navigate(href(a.getAttribute('data-go')), a.getAttribute('data-ac'))
  })
  detail.addEventListener('change', (ev) => {
    const f = ev.target.getAttribute('data-f')
    if (!f) return
    state[f] = ev.target.checked
    render()
    const el = document.getElementById(`f-${f}`)
    if (el) el.focus()
  })
  detail.addEventListener(
    'toggle',
    (ev) => {
      const d = ev.target
      if (d.matches && d.matches('details.req'))
        state.open[d.getAttribute('data-req')] = d.open
    },
    true
  )
  let timer
  search.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const q = search.value.trim()
      // Starting a search adds a history entry, so Back returns to the view
      // the search started on.
      if (q && !state.q) history.pushState(null, '', location.href)
      state.q = q
      render()
    }, 150)
  })
  menu.addEventListener('click', () =>
    document.body.classList.toggle('show-tree')
  )
  // Back or a typed address leaves search, like any other navigation.
  window.addEventListener('popstate', () => {
    state.q = ''
    search.value = ''
    fromHash()
    render()
  })

  D.roots.forEach((k) => (state.expanded[k] = true))
  fromHash()
  render()
})()
