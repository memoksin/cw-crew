import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { FRAME_MS, imageSource, lookKey } from './creatures'
import {
  buildWorkers, drawScene, encode, isActive, isVisible, parseEvents, sceneRows, SPRITE_COLS, SPRITE_ROWS,
  type Meta, type Run, type State, type Worker,
} from './scene'

const PANE = 'cw-crew'
const DAY = 86_400_000
const slots = atom({ plugin: 'cw-crew', key: 'slots' } as const, 0)

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
        const live = !byName.has(`${id}.done`) && now / 1000 - meta.start < (meta.tmo ?? 3600) + 2400   // + cw's acceptance run
        metas.set(id, meta.session === session || live ? meta : null)
      }
      const meta = metas.get(id)
      if (!meta) continue
      const run = runs.get(id) ?? { id, meta, events: [], size: -1, final: false }
      if (run.final) continue
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
  } finally {
    polling = false
  }
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
    dir = (await $.env.get('CW_LOG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude/cw-runs`
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
    const where = !isFullscreen
      ? ' It sits above the prompt: the right-side pane needs the fullscreen layout (CLAUDE_CODE_NO_FLICKER=1, outside tmux).'
      : columns < 110 ? ` It sits above the prompt: the right-side pane needs a terminal of at least 110 columns (now ${columns}).` : ''
    return { text: `Crew pane opened.${where}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, slots)
    if (e.surface !== 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {workers.length === 0 && <Text dimColor>no workers</Text>}
          {workers.map(w => <Text>{w.name} · {w.role} · {w.state}</Text>)}
        </Box>
      )
    }
    const { Box, Image, Raster } = $.ui.resolve(e)
    const cols = Math.max(24, Math.min(512, e.props.bodyColumns))
    // Draw every card, even past the pane's height: the engine scrolls a body taller than its window.
    // Only the 256-row hard cap still folds workers into one-line rows.
    const maxRows = 256
    const { rows, words, spots } = drawScene(workers, cols, await $.clock.now(), maxRows, images)
    mounted = { cols, rows, maxRows, images, keys: new Set(spots.map(s => s.key)) }
    const raster = <Raster key="crew" columns={cols} rows={rows} cells={encode(words)} />
    if (!images) return raster
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
      </Box>
    )
  })
}
