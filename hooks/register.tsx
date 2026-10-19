import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { FRAME_MS, frameFile, imageSource, lookKey } from './creatures'
import {
  buildWorkers, CARD, clock, drawDetail, drawScene, encode, isActive, isVisible, LABEL, msysToWin, PANE as PANE_BG, parseEvents, sceneRows, sceneSvg,
  SPRITE_COLS, SPRITE_ROWS, type Meta, type Run, type Spot, type State, type Totals, type Worker,
} from './scene'
import type { Tab } from '../types'

const PANE = 'cw-crew'
const DAY = 86_400_000
// cw touches <run>.hb every 30 s while its process lives: a staler one means cw was killed before .done.
const STALE_MS = 90_000
const DIED = 137
const slots = atom({ plugin: 'cw-crew', key: 'slots' } as const, 0)
const selected = atom({ plugin: 'cw-crew', key: 'selected' } as const, '')
const tab = atom({ plugin: 'cw-crew', key: 'tab' } as const, 'notes' as Tab)
const TABS: Tab[] = ['notes', 'steps', 'report', 'test']
const NOTES = 4, STEPS = 10, REPORT_CHARS = 2400, TEST_LINES = 20
const css = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`
const TEXT = '#e6e6f0', DIM = '#8a8fa3', GOOD = '#7bd88f', BAD = '#ff5c5c'
type Tracked = Run & { size: number; final: boolean }

// Module state: a reload starts it over and the next poll rebuilds it from the run files.
let dir = ''
let session = ''
let metas = new Map<string, Meta | null>()
let runs = new Map<string, Tracked>()
let workers: Worker[] = []
let mounted: { cols: number; rows: number; maxRows: number; images: boolean; keys: Set<string> } | undefined
// Sprites are Images until the terminal shows it draws their alt instead (no image protocol,
// tmux): a blit of a mounted Image is then denied, and the pane falls back to half-blocks.
let images = true
let refused = 0
let shown = new Map<string, string>()
let seen = new Map<string, State>()
let status: string | undefined
let opened = false
let polling = false
let lastKick = 0
// Surfaces with no Raster (desktop, editor, mobile) get the scene as an Svg, redrawn by poll() while shown.
let svgAt = 0
let svgKick = 0
// PNG frames as base64, read once each; a session sees a few dozen of the 650.
const pngs = new Map<string, string>()
// Detail view: the open worker's live notes (its assistant text) and final report, refreshed by poll().
let selKey = ''
let detail: { key: string; size: number; notes: string[]; report?: string; test?: string } = { key: '', size: -1, notes: [] }
let detailKick = 0
// The lead's own spend and its 5-hour readings (session.measure), to weigh the crew's share of that limit.
let leadCost = 0
let five: { first: number; last: number } | undefined
let totals: Totals = {}

function readText($: EngineInterface, name: string) {
  return $.fs.read(`${dir}/${name}`).catch(() => undefined)
}

async function poll($: EngineInterface) {
  if (polling) return
  polling = true
  try {
    const sid = await $.session.id()
    if (sid !== session) {
      session = sid
      metas = new Map(); runs = new Map(); seen = new Map()
    }
    const now = await $.clock.now()
    const entries = await $.fs.list(dir).catch(() => [])
    const byName = new Map(entries.map(en => [en.name, en]))

    for (const en of entries) {
      if (!en.name.endsWith('.meta')) continue
      const id = en.name.slice(0, -'.meta'.length)
      if (!metas.has(id)) {
        if (now - en.mtimeMs > DAY) { metas.set(id, null); continue }
        const text = await readText($, en.name)
        let meta: Meta | undefined
        try { meta = text ? (JSON.parse(text) as Meta) : undefined } catch { meta = undefined }
        if (!meta) continue
        // A resumed/restarted lead gets a new session id: keep showing the workers still running from before.
        const hb = byName.get(`${id}.hb`)
        const live = !byName.has(`${id}.done`) && (hb ? now - hb.mtimeMs < STALE_MS
          : now / 1000 - meta.start < (meta.tmo ?? 3600) + 2400)   // no .hb (older cw): + cw's acceptance run
        metas.set(id, meta.session === session || live ? meta : null)
      }
      const meta = metas.get(id)
      if (!meta) continue
      const run = runs.get(id) ?? { id, meta, events: [], size: -1, final: false }
      if (run.final) {
        // The lead closed the request without a resume (cwopen -x): lower the hand.
        if (run.question !== undefined && !byName.has(`${id}.ask`)) runs = new Map(runs).set(id, { ...run, question: undefined })
        continue
      }
      const ev = byName.get(`${id}.events`)
      const done = byName.get(`${id}.done`)
      let next: Tracked = run
      // The events file is complete once .done exists, so read it one last time then.
      if (ev && (ev.size !== run.size || done)) {
        next = { ...next, events: parseEvents((await readText($, ev.name)) ?? ''), size: ev.size }
      }
      if (done) {
        const rc = Number.parseInt((await readText($, done.name)) ?? '', 10)
        const question = byName.has(`${id}.ask`) ? (await readText($, `${id}.ask`))?.trim() : undefined
        next = { ...next, rc: Number.isNaN(rc) ? 1 : rc, doneAt: done.mtimeMs, question, final: true }
      } else {
        // Not final: a heartbeat that resumes (laptop woke up) brings the worker back.
        const hb = byName.get(`${id}.hb`)
        const died = !!hb && now - hb.mtimeMs > STALE_MS
        if (died !== (next.rc === DIED)) next = died ? { ...next, rc: DIED, doneAt: hb.mtimeMs } : { ...next, rc: undefined, doneAt: undefined }
      }
      if (next !== run || !runs.has(id)) runs = new Map(runs).set(id, next)
    }

    const all = buildWorkers([...runs.values()], now)
    announce($, all)
    const spent = all.reduce((s, w) => s + (w.cost ?? 0), 0)
    // Workers draw on the same account: the 5-hour window moved by this much since the session began,
    // and the crew's part of it is taken as its part of the money spent.
    const moved = five ? five.last - five.first : 0
    totals = { cost: spent || undefined, limit: spent && moved > 0 ? (moved * spent) / (spent + leadCost) : undefined }
    const visible = all.filter(w => isVisible(w, now))
    const grew = visible.length !== workers.length
    workers = visible
    if (grew) await update($, slots, () => visible.length)

    const active = all.filter(isActive).length
    const asking = all.filter(w => w.state === 'ask').length
    const text = active ? `⚒ ${active} working${asking ? ` · ${asking} asking` : ''}`
      : asking ? `? ${asking} waiting for an answer` : undefined
    if (text !== status) { status = text; $.ui.status(text) }

    if (active && !opened) {
      opened = true
      const res = await $.ui.open(paneArgs())
      if (!res.isPlaced) $.ui.toast('cw-crew: workers running, open the pane with /crew')
    }
    // A pane hidden behind a tab drops its Raster; ask for a redraw now and then so the animation resumes.
    if (!mounted && opened && now - lastKick > 2000) { lastKick = now; $.ui.invalidate('ui.render') }
    // ponytail: whole-Svg redraw per poll, no per-frame blit there; fine for a handful of workers.
    else if (!selKey && now - svgAt < 5000 && now - svgKick >= (active ? 400 : 2000)) { svgKick = now; $.ui.invalidate('ui.render') }
    if (selKey) {
      await refreshDetail($, all, byName)
      // The limits tick with the clock: redraw a live worker's detail view each second.
      if (all.some(w => w.key === selKey && isActive(w)) && now - detailKick >= 1000) { detailKick = now; $.ui.invalidate('ui.render') }
    }
  } finally {
    polling = false
  }
}

// The open worker's newest run: its stream (.jsonl) holds the notes, its result (.json) the report.
async function refreshDetail($: EngineInterface, all: Worker[], byName: Map<string, { size: number }>) {
  const w = all.find(x => x.key === selKey)
  const id = w?.runIds.at(-1)
  if (!w || !id) return
  const size = byName.get(`${id}.jsonl`)?.size ?? 0
  if (detail.key === w.key && detail.size === size && (w.end === undefined || detail.report !== undefined)) return
  const notes: string[] = []
  for (const line of ((await readText($, `${id}.jsonl`)) ?? '').split('\n')) {
    if (!line.includes('"type":"assistant"')) continue
    try {
      const m = JSON.parse(line) as { message?: { content?: { type: string; text?: string }[] } }
      for (const c of m.message?.content ?? []) if (c.type === 'text' && c.text?.trim()) notes.push(c.text.trim())
    } catch { /* a line still being written */ }
  }
  let report: string | undefined, test: string | undefined
  if (w.end !== undefined) {
    try { report = ((JSON.parse((await readText($, `${id}.json`)) ?? '{}') as { result?: string }).result ?? '').trim() } catch { report = '' }
    test = (await readText($, `${id}.accept`))?.trimEnd().split('\n').slice(-TEST_LINES).join('\n')
  }
  detail = { key: w.key, size, notes: notes.slice(-NOTES), report, test }
  $.ui.invalidate('ui.render')
}

function openDetail($: EngineInterface, key: string) {
  selKey = key
  detail = { key: '', size: -1, notes: [] }
  mounted = undefined
  const w = workers.find(x => x.key === key)
  void update($, tab, () => (w?.end !== undefined ? 'report' : 'notes'))
  void update($, selected, () => key)
}

// Each tool step with how it came back: tool results follow their calls in order.
function stepsOf(w: Worker) {
  const out: { t: number; tool: string; arg: string; res?: string }[] = []
  let next = 0
  for (const ev of w.runIds.flatMap(id => runs.get(id)?.events ?? [])) {
    if (ev.e === 'tool') out.push({ t: ev.t, tool: ev.tool ?? '', arg: ev.arg ?? '' })
    else if ((ev.e === 'ok' || ev.e === 'error' || ev.e === 'denied') && out[next]) out[next++]!.res = ev.e
    else if (ev.e === 'init') next = out.length
  }
  return out.slice(-STEPS)
}

// A drawn scene as one Svg, the sprites' PNG frames inlined; half-block pixels if a frame will not read.
async function svgOf($: EngineInterface, draw: (images: boolean) => { rows: number; words: Uint32Array; spots: Spot[] }, cols: number) {
  let { rows, words, spots } = draw(true)
  const sprites = []
  for (const s of spots) {
    const file = frameFile(s.look)
    let base64 = pngs.get(file)
    if (base64 === undefined) {
      base64 = await $.fs.read(`${$.plugin.root}/frames/${file}`, { as: 'bytes' }).then(r => r.base64, () => '')
      pngs.set(file, base64)
    }
    if (base64) sprites.push({ x: s.x, y: s.y, base64 })
  }
  let svg = sceneSvg(words, cols, rows, sprites)
  if (sprites.length < spots.length || svg.length > 131_072) { ({ rows, words } = draw(false)); svg = sceneSvg(words, cols, rows) }
  return svg
}

// Ask for the rows the scene needs (room for two workers once any run), not the default third of the screen.
const paneArgs = () => ({ id: PANE, title: 'Crew', rows: sceneRows(workers.length && Math.max(2, workers.length), 60), columns: 60 })

function announce($: EngineInterface, all: Worker[]) {
  // One state per key (the last run wins): two entries with one key would flip-flop and toast every poll.
  for (const w of new Map(all.map(w => [w.key, w])).values()) {
    const before = seen.get(w.key)
    seen.set(w.key, w.state)
    if (before === w.state || (before === undefined && w.end !== undefined)) continue
    if (w.state === 'ask') $.ui.toast(`? ${w.name} asks: ${w.question ?? ''}`, { timeoutMs: 8000 })
    else if (w.state === 'blocked') $.ui.toast(`! ${w.name} blocked: ${w.arg}`)
    else if (w.state === 'done') $.ui.toast(`✓ ${w.name} (${w.role}) done`)
    else if (w.state === 'failed') $.ui.toast(`✗ ${w.name} (${w.role}) failed`)
  }
}

async function paint($: EngineInterface) {
  const at = mounted
  const root = $.plugin.root
  if (!at || sceneRows(workers.length, at.cols, at.maxRows) !== at.rows) return
  const { words, spots } = drawScene(workers, at.cols, await $.clock.now(), at.maxRows, at.images, totals)
  const res = await $.ui.blit({ requestId: PANE, key: 'crew', cells: encode(words) })
  if (res.deny) { mounted = undefined; return }
  // The cells went in, so the pane is mounted: an Image refused now is one drawing its alt.
  for (const s of spots) {
    const key = lookKey(s.look)
    if (!at.keys.has(s.key) || shown.get(s.key) === key) continue
    const img = await $.ui.blit({ requestId: PANE, key: s.key, source: imageSource(s.look, root) })
    if (img.deny) {
      if (/alt|placeholder|unsupported/i.test(img.deny) || ++refused >= 6) {
        images = false
        mounted = undefined
        $.ui.log(`cw-crew: no images here (${img.deny}); half-block sprites`)
        $.ui.invalidate('ui.render')
      }
      return
    }
    refused = 0
    shown.set(s.key, key)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    session = await $.session.id()
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
    dir = msysToWin((await $.env.get('CW_LOG_DIR')) || `${home}/.claude/cw-runs`).replace(/\\/g, '/')
    await $.command.register({ name: 'crew', description: 'Open the cw worker pane (Haiku scouts / Sonnet coders)' })
    $.clock.every(400, () => void poll($).catch(err => $.ui.log(`cw-crew poll: ${String(err)}`)))
    $.clock.every(FRAME_MS, () => void paint($).catch(() => { mounted = undefined }))
    return next(e)
  })

  // The engine docks a pane on the right only in the fullscreen layout from 110 columns; else it sits above the prompt.
  on('command.run', { command: 'crew' }, async ($, e) => {
    opened = true
    // A reload with the pane open can refuse the first blits before the pane mounts; /crew retries PNG sprites.
    images = true
    refused = 0
    mounted = undefined
    await $.ui.open(paneArgs())
    const { isFullscreen, columns } = e.presentation
    // The layout hints are the terminal's; the desktop places the pane itself.
    const where = (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) === 'claude-desktop' ? ''
      : !isFullscreen
      ? ' It sits above the prompt: the right-side pane needs the fullscreen layout (CLAUDE_CODE_NO_FLICKER=1, outside tmux).'
      : columns < 110 ? ` It sits above the prompt: the right-side pane needs a terminal of at least 110 columns (now ${columns}).` : ''
    return { text: `Crew pane opened.${where}` }
  })

  on('session.measure', async ($, e, next) => {
    leadCost = e.cost?.usd ?? leadCost
    const pct = e.rateLimits.find(r => r.kind === 'five_hour')?.percentUsed
    // A drop means the window rolled over: count from there.
    if (pct !== undefined) five = !five || pct < five.last ? { first: pct, last: pct } : { ...five, last: pct }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, slots)
    const sel = await read($, selected)
    const open = sel ? workers.find(w => w.key === sel) : undefined
    const terminal = e.surface === 'terminal'
    if (open) {
      mounted = undefined   // paint() must not blit the scene over the detail view
      const { Box, Text, Button } = $.ui.resolve(e)
      const now = await $.clock.now()
      const current = await read($, tab)
      const cols = Math.max(46, Math.min(terminal ? 512 : 138, e.props.bodyColumns))
      let hero
      if (e.surface === 'terminal') {
        const { Image, Raster } = $.ui.resolve(e)
        const d = drawDetail(open, cols, now, images)
        hero = (
          <Box width={cols} height={d.rows}>
            <Raster key="detail" columns={cols} rows={d.rows} cells={encode(d.words)} />
            {d.spots.map(s => (
              <Box position="absolute" top={s.y} left={s.x}>
                <Image key={`d${s.key}`} source={imageSource(s.look, $.plugin.root)} columns={SPRITE_COLS} rows={SPRITE_ROWS} alt={s.alt} />
              </Box>
            ))}
          </Box>
        )
      } else {
        const { Svg } = $.ui.resolve(e)
        hero = <Svg key="detail" source={await svgOf($, im => drawDetail(open, cols, now, im), cols)} alt={`${open.name} ${LABEL[open.state]}`} />
      }
      const ago = (t: number) => clock(Math.max(0, now - t))
      const ready = detail.key === open.key
      const body =
        current === 'notes' ? (!ready ? [<Text color={DIM}>reading…</Text>]
          : detail.notes.length === 0 ? [<Text color={DIM}>no notes yet</Text>]
          : detail.notes.map(n => <Text color={TEXT} wrap="wrap">{n.slice(0, 400)}</Text>))
        : current === 'steps' ? (() => {
          const steps = stepsOf(open)
          return steps.length === 0 ? [<Text color={DIM}>none yet</Text>] : steps.map(st => (
            <Text wrap="truncate-end">
              <Text color={st.res === 'ok' ? GOOD : st.res ? BAD : DIM}>{st.res === 'ok' ? '✓' : st.res ? '✗' : '·'} </Text>
              <Text color={DIM}>{ago(st.t).padStart(5)} </Text>
              <Text color={TEXT}>{st.tool} </Text><Text color={DIM}>{st.arg}</Text>
            </Text>
          ))
        })()
        : current === 'report' ? [open.end === undefined ? <Text color={DIM}>still working</Text>
          : !ready || detail.report === undefined ? <Text color={DIM}>reading…</Text>
          : <Text color={TEXT} wrap="wrap">{detail.report ? detail.report.slice(0, REPORT_CHARS) : 'no report (timed out or killed)'}</Text>]
        : [open.accept === undefined ? <Text color={DIM}>{open.end === undefined && open.state !== 'test' ? 'runs after the work' : 'no acceptance command'}</Text>
          : <Text color={open.accept.ok ? GOOD : BAD}>{open.accept.ok ? '✓ passed' : `✗ failed${open.accept.rc !== undefined ? ` (rc ${open.accept.rc})` : ''}`}</Text>,
          ...(ready && detail.test ? [<Text color={DIM} wrap="wrap">{detail.test}</Text>] : [])]
      const resume = open.sid ? `cw ${open.role} -r ${open.sid}` : ''
      return (
        <Box flexDirection="column" backgroundColor={css(PANE_BG)} gap={1}>
          <Box flexDirection="row" gap={1} paddingX={1}>
            <Button key="back" hotkey="b" onPress={() => { selKey = ''; mounted = undefined; void update($, selected, () => '') }}>‹ back</Button>
            {resume && <Button key="copy" hotkey="c" onPress={p => void $.ui.copy({ text: resume, surface: p.surface })
              .then(r => $.ui.toast(r.isCopied ? `copied: ${resume}` : 'could not copy'))}>copy resume</Button>}
          </Box>
          {hero}
          <Box flexDirection="column" paddingX={1}>
            {open.state === 'ask' && open.question && <Text color="#ffe8a3" wrap="wrap">? {open.question}</Text>}
            <Text color={DIM} wrap="wrap">{open.task.slice(0, 600)}</Text>
          </Box>
          <Box flexDirection="row" gap={2} paddingX={1}>
            {TABS.map(t => (
              <Button key={`tab-${t}`} plain onPress={() => void update($, tab, () => t)}>
                <Text color={t === current ? TEXT : DIM} bold={t === current} underline={t === current}>{t}</Text>
              </Button>
            ))}
          </Box>
          <Box flexDirection="column" paddingX={1}>{body}</Box>
        </Box>
      )
    }
    if (sel) { selKey = ''; void update($, selected, () => '') }   // the worker left the crew
    if (!terminal) {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      const now = await $.clock.now()
      svgAt = now
      const cols = Math.max(46, Math.min(138, e.props.bodyColumns))
      const svg = await svgOf($, im => drawScene(workers, cols, now, 256, im, totals), cols)
      const alt = workers.length ? workers.map(w => `${w.name} ${w.role} ${LABEL[w.state]}`).join(', ') : 'no workers'
      return (
        <Box flexDirection="column" gap={1}>
          {svg.length <= 131_072 ? <Svg key="crew" source={svg} alt={alt} />
            : workers.map(w => <Text>{w.name} · {w.role} · {LABEL[w.state]}</Text>)}
          {workers.length > 0 && (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {workers.map(w => <Button key={`open-${w.key}`} onPress={() => openDetail($, w.key)}>{w.name} ›</Button>)}
            </Box>
          )}
        </Box>
      )
    }
    const { Box, Button, Image, Raster, Text } = $.ui.resolve(e)
    const cols = Math.max(24, Math.min(512, e.props.bodyColumns))
    // Draw every card, even past the pane's height: the engine scrolls a body taller than its window.
    // Only the 256-row hard cap still folds workers into one-line rows.
    const maxRows = 256
    const { rows, words, spots, hits } = drawScene(workers, cols, await $.clock.now(), maxRows, images, totals)
    mounted = { cols, rows, maxRows, images, keys: new Set(spots.map(s => s.key)) }
    const raster = <Raster key="crew" columns={cols} rows={rows} cells={encode(words)} />
    // Each card's name is a Button over the same text: a click opens its detail view.
    // Not `h`: JSX compiles to the global h(), which a parameter of that name would shadow.
    const buttons = hits.map(hit => (
      <Box position="absolute" top={hit.y} left={hit.x}>
        <Button key={`open-${hit.key}`} plain onPress={() => openDetail($, hit.key)}>
          <Text color={css(hit.color)} backgroundColor={css(CARD)}>{hit.label}</Text>
        </Button>
      </Box>
    ))
    if (!images) return <Box width={cols} height={rows}>{raster}{buttons}</Box>
    // Each sprite an Image over the blank cells the scene left for it; paint() swaps its frames.
    shown = new Map(spots.map(s => [s.key, lookKey(s.look)]))
    return (
      <Box width={cols} height={rows}>
        {raster}
        {spots.map(s => (
          <Box position="absolute" top={s.y} left={s.x}>
            <Image key={s.key} source={imageSource(s.look, $.plugin.root)} columns={SPRITE_COLS} rows={SPRITE_ROWS} alt={s.alt} />
          </Box>
        ))}
        {buttons}
      </Box>
    )
  })
}
