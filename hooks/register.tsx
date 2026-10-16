import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { FRAME_MS, frameFile, imageSource, lookKey } from './creatures'
import {
  buildWorkers, clock, DETAILS, drawScene, encode, isActive, isVisible, LABEL, msysToWin, parseEvents, sceneRows, sceneSvg, SPRITE_COLS, SPRITE_ROWS,
  type Meta, type Run, type State, type Worker,
} from './scene'

const PANE = 'cw-crew'
const DAY = 86_400_000
// cw touches <run>.hb every 30 s while its process lives: a staler one means cw was killed before .done.
const STALE_MS = 90_000
const DIED = 137
const slots = atom({ plugin: 'cw-crew', key: 'slots' } as const, 0)
const selected = atom({ plugin: 'cw-crew', key: 'selected' } as const, '')
const NOTES = 4, STEPS = 10, REPORT_CHARS = 2400
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
let detail: { key: string; size: number; notes: string[]; report?: string } = { key: '', size: -1, notes: [] }

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
    if (selKey) await refreshDetail($, all, byName)
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
  let report: string | undefined
  if (w.end !== undefined) {
    try { report = ((JSON.parse((await readText($, `${id}.json`)) ?? '{}') as { result?: string }).result ?? '').trim() } catch { report = '' }
  }
  detail = { key: w.key, size, notes: notes.slice(-NOTES), report }
  $.ui.invalidate('ui.render')
}

function openDetail($: EngineInterface, key: string) {
  selKey = key
  detail = { key: '', size: -1, notes: [] }
  mounted = undefined
  void update($, selected, () => key)
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
  const { words, spots } = drawScene(workers, at.cols, await $.clock.now(), at.maxRows, at.images)
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, slots)
    const sel = await read($, selected)
    const open = sel ? workers.find(w => w.key === sel) : undefined
    if (open) {
      mounted = undefined   // paint() must not blit the scene over the detail view
      const { Box, Text, Button } = $.ui.resolve(e)
      const now = await $.clock.now()
      const steps = (open.runIds.flatMap(id => runs.get(id)?.events ?? [])).filter(ev => ev.tool).slice(-STEPS)
      const ago = (t: number) => clock(Math.max(0, now - t))
      return (
        <Box flexDirection="column" paddingX={1}>
          <Box flexDirection="row" gap={1}>
            <Button key="back" hotkey="b" onPress={() => { selKey = ''; mounted = undefined; void update($, selected, () => '') }}>‹ back</Button>
            <Text bold>{open.name}</Text>
            <Text dimColor>{open.model} · {LABEL[open.state]} · {clock((open.end ?? now) - open.start)} · {open.turns} turns</Text>
          </Box>
          {open.state === 'ask' && open.question && <Text color="warning" wrap="wrap">? {open.question}</Text>}
          <Text bold>Task</Text>
          <Text dimColor wrap="wrap">{open.task.slice(0, 600)}</Text>
          <Text bold>Latest notes</Text>
          {detail.key !== open.key ? <Text dimColor>reading…</Text>
            : detail.notes.length === 0 ? <Text dimColor>no notes yet</Text>
            : detail.notes.map(n => <Text wrap="wrap">· {n.slice(0, 400)}</Text>)}
          <Text bold>Recent steps</Text>
          {steps.length === 0 ? <Text dimColor>none yet</Text>
            : steps.map(ev => <Text wrap="truncate-end"><Text dimColor>{ago(ev.t)} ago </Text>{ev.tool} {ev.arg ?? ''}</Text>)}
          {detail.key === open.key && detail.report !== undefined && <Text bold>Report</Text>}
          {detail.key === open.key && detail.report !== undefined &&
            <Text wrap="wrap">{detail.report ? detail.report.slice(0, REPORT_CHARS) : 'no report (timed out or killed)'}</Text>}
        </Box>
      )
    }
    if (sel) { selKey = ''; void update($, selected, () => '') }   // the worker left the crew
    if (e.surface !== 'terminal') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const now = await $.clock.now()
      svgAt = now
      const cols = Math.max(46, Math.min(138, e.props.bodyColumns))
      let { rows, words, spots } = drawScene(workers, cols, now, 256, true)
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
      // A frame that would not read, or too many sprites for one Svg: half-block pixels instead.
      if (sprites.length < spots.length || svg.length > 131_072) { ({ rows, words } = drawScene(workers, cols, now, 256, false)); svg = sceneSvg(words, cols, rows) }
      const alt = workers.length ? workers.map(w => `${w.name} ${w.role} ${LABEL[w.state]}`).join(', ') : 'no workers'
      return (
        <Box flexDirection="column" gap={1}>
          {svg.length <= 131_072 ? <Svg key="crew" source={svg} alt={alt} />
            : workers.map(w => <Text>{w.name} · {w.role} · {LABEL[w.state]}</Text>)}
          {workers.length > 0 && (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {workers.map(w => <Button key={`open-${w.key}`} onPress={() => openDetail($, w.key)}>{w.name} {DETAILS}</Button>)}
            </Box>
          )}
        </Box>
      )
    }
    const { Box, Button, Image, Raster } = $.ui.resolve(e)
    const cols = Math.max(24, Math.min(512, e.props.bodyColumns))
    // Draw every card, even past the pane's height: the engine scrolls a body taller than its window.
    // Only the 256-row hard cap still folds workers into one-line rows.
    const maxRows = 256
    const { rows, words, spots, hits } = drawScene(workers, cols, await $.clock.now(), maxRows, images)
    mounted = { cols, rows, maxRows, images, keys: new Set(spots.map(s => s.key)) }
    const raster = <Raster key="crew" columns={cols} rows={rows} cells={encode(words)} />
    // A "details ›" Button on each card's bottom edge opens its detail view.
    // Not `h`: JSX compiles to the global h(), which a parameter of that name would shadow.
    const buttons = hits.map(hit => (
      <Box position="absolute" top={hit.y} left={hit.x}>
        <Button key={`open-${hit.key}`} plain dimColor onPress={() => openDetail($, hit.key)}>{DETAILS}</Button>
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
