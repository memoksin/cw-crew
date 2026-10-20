// Pure drawing: cw run files -> worker states -> one Raster of text and half-block pixel art,
// or of text alone with each sprite listed for an Image laid over it.

import { CLEAR, FRAME_MS, SMALL_H, SMALL_W, lookAt, smallSprite, type Canvas, type Look } from './creatures'

export type Role = 'scout' | 'coder'
export type Kind = 'read' | 'write' | 'bash' | 'web'
export type State =
  | 'boot' | 'resumed' | 'think' | Kind | 'test' | 'blocked' | 'error' | 'ask' | 'done' | 'failed'

export type Ev = {
  e: string; t: number; tool?: string; arg?: string
  ok?: boolean; sub?: string; sid?: string; turns?: number; denied?: number; out?: number
  ctx?: number; mid?: string                            // assistant steps: context size, message id
  cost?: number; cin?: number; nin?: number; win?: number // result: USD, cached / new input tokens, context window
  add?: number; del?: number; files?: number; rc?: number // diff; accept_end
}
export type Meta = {
  role: Role; model: string; session: string; resume: string; task: string
  start: number; tmo: number; web: boolean; pid: number; effort?: string; effort_src?: string
  name?: string   // fleet name from cwgo (CW_NAME): shown instead of a generated one
  effort_p?: string; maxt?: number; branch?: string; wt?: string
  cont?: boolean  // an auto-continue after the turn limit
}
export type Run = { id: string; meta: Meta; events: Ev[]; rc?: number; doneAt?: number; question?: string }

export type Worker = {
  key: string; role: Role; model: string; name: string; task: string; effort: string
  start: number; runStart: number; resumed: boolean
  state: State; stateAt: number; arg: string; trail: Kind[]; times: number[]; lastAt: number; tmo: number
  blocked: number; question?: string; end?: number; turns: number; out: number
  runIds: string[]   // the chain's runs, oldest first: the detail view reads their files
  effortSrc: string; effortP: string; branch: string; wt: string; sid: string
  runTurns: number; maxTurns: number; conts: number   // the turn limit holds per run
  ctx: number; win: number                            // the newest step's context, the model's window
  cost?: number; cin: number; nin: number
  add: number; del: number; files: number
  accept?: { ok: boolean; rc?: number }
}

const NAMES: Record<Role, string[]> = {
  scout: ['KIRI', 'SORA', 'MOCHI', 'YUZU', 'HOSHI', 'NORI', 'TOFU', 'MISO', 'KOJI', 'UME'],
  coder: ['BOLT', 'RIVET', 'PIXEL', 'FORGE', 'GIZMO', 'BYTE', 'FLUX', 'SPARK', 'COG', 'WELD'],
}

const READ_CMD = /^\s*(rg|fd|eza|ls|wc|head|tail|cat|bat|grep|find|sed -n|git (log|show|diff|status|blame))\b/

export function kindOf(tool: string, arg: string): Kind {
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return 'read'
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'write'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web'
  return READ_CMD.test(arg) ? 'read' : 'bash'
}

export function parseEvents(text: string): Ev[] {
  const out: Ev[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* a half-written last line; read again next poll */ }
  }
  return out
}

type RunView = Pick<Worker, 'state' | 'stateAt' | 'arg' | 'blocked' | 'end' | 'turns' | 'out' | 'lastAt'
  | 'runTurns' | 'ctx' | 'win' | 'cost' | 'cin' | 'nin' | 'add' | 'del' | 'files' | 'accept'> & { trail: Kind[]; times: number[] }

const ACCEPT_MS = 1_830_000   // cw's CW_ACCEPT_TMO default (1800 s) plus slack

export function runState(run: Run, now: number): RunView {
  const start = run.meta.start * 1000
  const trail: Kind[] = [], times: number[] = []
  let arg = '', lastTool: Ev | undefined, lastDenied: Ev | undefined, lastError: Ev | undefined
  let result: Ev | undefined, accept: Ev | undefined, accepted: Ev | undefined, blocked = 0
  let ctx = 0, add = 0, del = 0, files = 0
  const mids = new Set<string>()
  for (const ev of run.events) {
    if (ev.ctx) ctx = ev.ctx
    if (ev.mid) mids.add(ev.mid)
    if (ev.e === 'tool') {
      lastTool = ev
      arg = ev.arg ?? ''
      trail.push(kindOf(ev.tool ?? '', arg))
      times.push(ev.t)
    } else if (ev.e === 'denied') { lastDenied = ev; blocked++ }
    else if (ev.e === 'error') lastError = ev
    else if (ev.e === 'result') result = ev
    // A resume replays the old session's result before its own init: only a result after the last init ends the run
    else if (ev.e === 'init') result = undefined
    else if (ev.e === 'accept') accept = ev
    else if (ev.e === 'accept_end') accepted = ev
    else if (ev.e === 'diff') { add += ev.add ?? 0; del += ev.del ?? 0; files += ev.files ?? 0 }
  }
  const lastAt = run.events[run.events.length - 1]?.t ?? start
  const base = {
    arg, trail, times, blocked, lastAt, turns: result?.turns ?? 0, out: result?.out ?? 0,
    runTurns: result?.turns ?? mids.size, ctx, win: result?.win ?? 0, cost: result?.cost,
    cin: result?.cin ?? 0, nin: result?.nin ?? 0, add, del, files,
    accept: accepted ? { ok: accepted.ok !== false, rc: accepted.rc } : undefined,
  }
  // cw auto-continues a turn-limited run without writing .done: that result is not the end
  const continuing = result?.sub === 'error_max_turns' && run.rc === undefined
  // cw runs the acceptance command after the result and writes .done only when it ends
  if (accept && !accepted && run.rc === undefined && now - accept.t < ACCEPT_MS) {
    return { ...base, state: 'test', stateAt: accept.t }
  }
  if ((result && !continuing) || run.rc !== undefined) {
    const end = accepted?.t ?? result?.t ?? run.doneAt ?? now
    const ok = !!result?.ok && (run.rc ?? 0) === 0 && accepted?.ok !== false
    const state: State = run.question && ok ? 'ask' : ok ? 'done' : 'failed'
    return { ...base, state, stateAt: end, end }
  }
  if (now > start + (run.meta.tmo + 30) * 1000) return { ...base, state: 'failed', stateAt: now, end: now }
  const last = run.events[run.events.length - 1]
  if (run.meta.resume && now - start < 1600) return { ...base, state: 'resumed', stateAt: start }
  if (!last || now - start < 1500) return { ...base, state: 'boot', stateAt: start }
  if (lastDenied && now - lastDenied.t < 4000) return { ...base, state: 'blocked', stateAt: lastDenied.t }
  if (lastError && now - lastError.t < 2500) return { ...base, state: 'error', stateAt: lastError.t }
  if (lastTool && (last === lastTool || now - lastTool.t < 1500)) {
    return { ...base, state: trail[trail.length - 1] ?? 'bash', stateAt: lastTool.t }
  }
  return { ...base, state: 'think', stateAt: last.t }
}

// One worker per chain of runs: a run started with `-r <sid>` continues the worker whose run ended with that sid.
export function buildWorkers(runs: Run[], now: number): Worker[] {
  const sorted = [...runs].sort((a, b) => a.meta.start - b.meta.start || a.id.localeCompare(b.id))
  const bySid = new Map<string, Worker>()
  const workers: Worker[] = []
  const used: Record<Role, number> = { scout: 0, coder: 0 }
  // A live run learns its model's context window from any finished run of that model.
  const windows = new Map<string, number>()
  for (const run of sorted) for (const ev of run.events) if (ev.win) windows.set(run.meta.model, ev.win)
  for (const run of sorted) {
    const view = runState(run, now)
    const prev = run.meta.resume ? bySid.get(run.meta.resume) : undefined
    const role = run.meta.role === 'coder' ? 'coder' : 'scout'
    // A resume started under its own fleet name (cwgo NAME -r sid) is a new job on the same creature:
    // show that name, task and clock, as cwls does.
    const renamed = !!prev && !!run.meta.name && run.meta.name !== prev.name
    const w: Worker = {
      key: prev?.key ?? run.id,
      role,
      model: run.meta.model,
      effort: run.meta.effort ?? '',
      name: renamed ? run.meta.name! : prev?.name ?? (run.meta.name || NAMES[role][used[role]++ % NAMES[role].length] + (used[role] > 10 ? String(Math.ceil(used[role] / 10)) : '')),
      task: renamed ? run.meta.task : prev?.task ?? run.meta.task,
      start: renamed ? run.meta.start * 1000 : prev?.start ?? run.meta.start * 1000,
      runStart: run.meta.start * 1000,
      tmo: run.meta.tmo,
      resumed: !!prev,
      ...view,
      trail: [...(prev?.trail ?? []), ...view.trail],
      times: [...(prev?.times ?? []), ...view.times],
      blocked: (prev?.blocked ?? 0) + view.blocked,
      turns: (prev?.turns ?? 0) + view.turns,
      out: (prev?.out ?? 0) + view.out,
      question: view.state === 'ask' ? run.question : undefined,
      runIds: [...(prev?.runIds ?? []), run.id],
      effortSrc: run.meta.effort_src ?? '', effortP: run.meta.effort_p ?? '',
      branch: run.meta.branch || prev?.branch || '', wt: run.meta.wt || prev?.wt || '',
      sid: [...run.events].reverse().find(ev => ev.sid)?.sid ?? prev?.sid ?? '',
      maxTurns: run.meta.maxt ?? (role === 'coder' ? 80 : 40),
      conts: (prev?.conts ?? 0) + (run.meta.cont ? 1 : 0),
      // A resume continues the same conversation: until its first step the context is the last run's.
      ctx: view.ctx || prev?.ctx || 0,
      win: view.win || prev?.win || windows.get(run.meta.model) || (/\[1m\]/i.test(run.meta.model) ? 1_000_000 : 200_000),
      cost: prev?.cost === undefined && view.cost === undefined ? undefined : (prev?.cost ?? 0) + (view.cost ?? 0),
      cin: (prev?.cin ?? 0) + view.cin, nin: (prev?.nin ?? 0) + view.nin,
      add: (prev?.add ?? 0) + view.add, del: (prev?.del ?? 0) + view.del, files: (prev?.files ?? 0) + view.files,
    }
    const at = prev ? workers.indexOf(prev) : -1
    if (at >= 0) workers[at] = w
    else workers.push(w)
    // A run that dies before its result (killed, timeout) never maps its sid, so the next resume
    // of the same sid still finds `prev`; point it at the newest run or two workers share a key.
    if (prev) for (const [k, v] of bySid) if (v === prev) bySid.set(k, w)
    // init carries the sid too, so a run that timed out before its result still chains its resume.
    const sid = [...run.events].reverse().find(ev => ev.sid)?.sid
    if (sid) bySid.set(sid, w)
  }
  return workers
}

export const KEEP_MS = 120_000
export const isVisible = (w: Worker, now: number) =>
  w.end === undefined || w.state === 'ask' || now - w.end < KEEP_MS
export const isActive = (w: Worker) => w.end === undefined

// ---------- pixels ----------

const DEF = 0x01000000
// A sprite fills MW x MH cells: one 60x32 Image where the terminal shows pictures, else
// 15x8 half-block pixels (one pixel = one half-block, no scaling). Creature left, props right.
const MW = SMALL_W, MH = SMALL_H / 2

export const THEME: Record<Role, number> = { scout: 0x4fd1c5, coder: 0xffb347 }
const OPUS_THEME = 0xb59cff

const hash = (s: string) => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 997
}
const dim = (c: number, k: number) =>
  (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k)
const mix = (a: number, b: number, k: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
// 0..1..0 once every `ms`: colours breathe instead of blinking.
const pulse = (now: number, ms: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (now % ms)) / ms)

// Where a sprite goes in the scene: `key` names its Image, `look` the frame it shows.
export type Spot = { key: string; x: number; y: number; look: Look; alt: string }
export const SPRITE_COLS = MW, SPRITE_ROWS = MH

// ---------- cells ----------

export class Grid {
  glyph: Uint32Array; fg: Uint32Array; bg: Uint32Array
  constructor(public w: number, public h: number, bg = DEF) {
    this.glyph = new Uint32Array(w * h).fill(0x20)
    this.fg = new Uint32Array(w * h).fill(DEF)
    this.bg = new Uint32Array(w * h).fill(bg)
  }
  // No `bg`: the cell keeps the one it has, so text and pixels sit on a filled panel.
  put(x: number, y: number, ch: string, fg: number, bg?: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = y * this.w + x
    this.glyph[i] = ch.codePointAt(0) ?? 0x20
    this.fg[i] = fg
    if (bg !== undefined) this.bg[i] = bg
  }
  fill(x: number, y: number, w: number, h: number, bg: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.put(i, j, ' ', DEF, bg)
  }
  text(x: number, y: number, s: string, fg: number, max = this.w - x, bg?: number) {
    const chars = [...s]
    for (let i = 0; i < Math.min(chars.length, max); i++) this.put(x + i, y, chars[i] ?? ' ', fg, bg)
    return Math.max(0, Math.min(chars.length, max))
  }
  // A rounded chip: half-circle caps around the text, the text on the chip's colour.
  pill(x: number, y: number, s: string, fg: number, bg: number, max = this.w - x) {
    if (max < 3) return 0
    this.put(x, y, '▐', bg)
    const n = this.text(x + 1, y, s, fg, max - 2, bg)
    this.put(x + 1 + n, y, '▌', bg)
    return n + 2
  }
  pixels(p: Canvas, x0: number, y0: number) {
    for (let r = 0; r < p.h / 2; r++) for (let x = 0; x < p.w; x++) {
      const top = p.px[r * 2 * p.w + x] ?? CLEAR, bot = p.px[(r * 2 + 1) * p.w + x] ?? CLEAR
      if (top === CLEAR && bot === CLEAR) continue
      if (top === CLEAR) this.put(x0 + x, y0 + r, '▄', bot)
      else if (bot === CLEAR) this.put(x0 + x, y0 + r, '▀', top)
      else if (top === bot) this.put(x0 + x, y0 + r, '█', top)
      else this.put(x0 + x, y0 + r, '▀', top, bot)
    }
  }
  words(): Uint32Array {
    const out = new Uint32Array(this.w * this.h * 3)
    for (let i = 0; i < this.w * this.h; i++) {
      out[i * 3] = this.glyph[i] ?? 0x20; out[i * 3 + 1] = this.fg[i] ?? DEF; out[i * 3 + 2] = this.bg[i] ?? DEF
    }
    return out
  }
}

export const encode = (words: Uint32Array): string =>
  (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()

export const LABEL: Record<State, string> = {
  boot: 'waking up', resumed: 'answered', think: 'thinking', read: 'reading', write: 'writing',
  bash: 'command', web: 'on the web', test: 'testing', blocked: 'blocked', error: 'error', ask: 'asking',
  done: 'done', failed: 'failed',
}
export const STATE_COLOR: Record<State, number> = {
  boot: 0xffffff, resumed: 0xffe082, think: 0xb39ddb, read: 0x64b5f6, write: 0xffb347, bash: 0x81c784,
  web: 0x4dd0e1, test: 0x9be7ff, blocked: 0xff6b6b, error: 0xff8a65, ask: 0xffd166, done: 0x7bd88f, failed: 0xff5c5c,
}
const KIND_COLOR: Record<Kind, number> = { read: 0x64b5f6, write: 0xffb347, bash: 0x81c784, web: 0x4dd0e1 }
const EFFORT: Record<string, [number, number]> = { low: [1, 0x81c784], medium: [2, 0xffd166], high: [3, 0xff8a65] }
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
// The pane paints its own background and each worker is a filled card on it. The sprite frames are
// transparent: an Image's box shows one colour even where the terminal letterboxes it (tall cells).
export const PANE = 0x16171d, CARD = 0x20222b
const TEXT = 0xe6e6f0, DIM = 0x8a8fa3, FAINT = 0x4d5162
// Budgets read as memobar's do: under half green, to 80% yellow, from 80% red.
const GOOD = 0x7bd88f, WARN = 0xffd166, BAD = 0xff5c5c
export const level = (f: number) => (f >= 0.8 ? BAD : f >= 0.5 ? WARN : GOOD)
const BRANCH = 0x9be7ff, JEV = 0xb39ddb
const BUCKET_MS = 4000
const QUIET_MS = 45_000

export const CARD_H = 6
const HEADER_H = 2
const EMPTY_H = 8

export const perRow = (cols: number) => Math.max(1, Math.min(3, Math.floor(cols / 46)))

// The engine scrolls a pane body taller than its window; past 256 rows the scene folds:
// as many full cards as fit, the rest as one-line rows, then a "+N" row.
export type Layout = { rows: number; cards: number; lines: number; more: number }
export function layout(n: number, cols: number, maxRows = 256): Layout {
  const cap = Math.max(1, Math.min(256, maxRows))
  const per = perRow(cols)
  const full = HEADER_H + (n === 0 ? EMPTY_H : Math.ceil(n / per) * CARD_H)
  if (full <= cap || n === 0) return { rows: Math.min(full, cap), cards: n, lines: 0, more: 0 }
  for (let k = Math.ceil(n / per) - 1; k >= 0; k--) {
    const cards = Math.min(n, k * per)
    const lines = Math.ceil((n - cards) / per)
    const rows = HEADER_H + k * CARD_H + lines
    if (rows <= cap) return { rows, cards, lines, more: 0 }
  }
  const lines = Math.max(0, cap - HEADER_H - 1)
  return { rows: cap, cards: 0, lines, more: n - lines * per }
}
export const sceneRows = (n: number, cols: number, maxRows?: number) => layout(n, cols, maxRows).rows

const RANK = (w: Worker) => (w.state === 'ask' ? 0 : !w.end ? 1 : w.state === 'failed' ? 2 : 3)

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
// Token counts as memobar writes them: 950, 50.0k, 1.2M.
export const kilo = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))
export const usd = (n: number) => (n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`)
export const shortModel = (m: string) => /haiku|sonnet|opus|fable/i.exec(m)?.[0].toLowerCase() ?? m
const shorten = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return [...one].length <= n ? one : '…' + [...one].slice(-(n - 1)).join('')
}
function wrap(s: string, width: number, lines: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of s.replace(/^[#>*\s\d.]*(goal:)?\s*/i, '').split(/\s+/)) {
    if (!word) continue
    const next = cur ? `${cur} ${word}` : word
    if ([...next].length <= width) { cur = next; continue }
    if (cur) out.push(cur)
    cur = [...word].slice(0, width).join('')
    if (out.length === lines) break
  }
  if (cur && out.length < lines) out.push(cur)
  if (out.length === lines && [...out.join(' ')].length < [...s].length - 2) {
    const last = [...(out[lines - 1] ?? '')]
    out[lines - 1] = last.slice(0, Math.max(0, width - 1)).join('') + '…'
  }
  return out.slice(0, lines)
}

// MSYS path (/c/Users/x) -> C:/Users/x so $.fs can read it; other paths pass through.
export const msysToWin = (p: string) => p.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d: string) => `${d.toUpperCase()}:`)

// A path reads by its file name: the folders dim, the name bright. A command shows whole.
function target(g: Grid, x: number, y: number, arg: string, max: number, bright: number, faint: number) {
  if (max < 2 || !arg) return 0
  const s = shorten(arg, max)
  const cut = /\s/.test(arg.trim()) ? 0 : Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1
  const n = g.text(x, y, s.slice(0, cut), faint, max)
  return n + g.text(x + n, y, s.slice(cut), bright, max - n)
}

// The three limits a run can hit. The turn limit and the clock hold per run; the context is the conversation's.
export type Gauge = { name: 'context' | 'turns' | 'time'; short: string; f: number; value: string; note: string }
export function gauges(w: Worker, now: number): Gauge[] {
  const ms = (w.end ?? now) - w.runStart, tmo = Math.max(1, w.tmo * 1000)
  const c = w.win ? w.ctx / w.win : 0
  return [
    { name: 'context', short: 'ctx', f: c, value: `${Math.round(c * 100)}%`, note: w.ctx ? `${kilo(w.ctx)} / ${kilo(w.win)}` : '' },
    { name: 'turns', short: 'turns', f: w.runTurns / Math.max(1, w.maxTurns), value: `${w.runTurns}/${w.maxTurns}`, note: w.conts ? `continued ×${w.conts}` : '' },
    { name: 'time', short: 'time', f: ms / tmo, value: w.end !== undefined ? clock(ms) : `${clock(tmo - ms)} left`, note: `of ${clock(tmo)}` },
  ]
}
const worst = (gs: Gauge[]) => gs.reduce((a, b) => (b.f > a.f ? b : a))

const BARS = '▂▃▅▆▇'
// Tools per BUCKET_MS bucket, newest on the right, each bar in the colour of its last tool's kind:
// the worker's rhythm at a glance, and a flat line when it has gone quiet.
function activity(g: Grid, w: Worker, x: number, y: number, n: number, now: number, fade: number) {
  if (n <= 0) return
  const anchor = Math.ceil((w.end ?? now) / BUCKET_MS) * BUCKET_MS
  const from = anchor - n * BUCKET_MS
  const count = new Array<number>(n).fill(0), kind = new Array<Kind | undefined>(n)
  w.times.forEach((t, i) => {
    const b = Math.floor((t - from) / BUCKET_MS)
    if (b < 0 || b >= n) return
    count[b] = (count[b] ?? 0) + 1
    kind[b] = w.trail[i]
  })
  for (let i = 0; i < n; i++) {
    const t0 = from + i * BUCKET_MS
    if (t0 + BUCKET_MS < w.start) continue
    const k = count[i] ?? 0, kd = kind[i]
    if (!k || !kd) g.put(x + i, y, '▁', mix(FAINT, CARD, 0.45))
    else g.put(x + i, y, BARS[Math.min(BARS.length - 1, k - 1)] ?? '▇', mix(KIND_COLOR[kd], CARD, fade))
  }
}

// A filled panel with rounded corners: quarter blocks on the top and bottom rows, half blocks on the
// sides, so its edges sit half a cell in and stacked panels get one row of pane between them.
function panel(g: Grid, x0: number, y0: number, W: number, H: number) {
  const R = x0 + W - 1, B = y0 + H - 1
  for (let x = x0 + 1; x < R; x++) { g.put(x, y0, '▄', CARD); g.put(x, B, '▀', CARD) }
  g.put(x0, y0, '▗', CARD); g.put(R, y0, '▖', CARD); g.put(x0, B, '▝', CARD); g.put(R, B, '▘', CARD)
  for (let y = y0 + 1; y < B; y++) { g.put(x0, y, '▐', CARD); g.put(R, y, '▌', CARD) }
  g.fill(x0 + 1, y0 + 1, W - 2, H - 2, CARD)
}

type Place = (look: Look, x: number, y: number, alt: string) => void
// Where a card's name is: a Button laid over it opens the worker's detail view.
export type Hit = { key: string; x: number; y: number; label: string; color: number }

const iconOf = (w: Worker, f: number) =>
  w.state === 'done' ? '✓' : w.state === 'failed' ? '✗' : w.state === 'ask' ? '?'
  : w.state === 'blocked' || w.state === 'error' ? '!' : SPIN[f % SPIN.length] ?? ' '
const themeOf = (w: Worker) => (/opus/i.test(w.model) ? OPUS_THEME : THEME[w.role])

function card(g: Grid, w: Worker, x0: number, y0: number, W: number, now: number, place: Place, hits?: Hit[]) {
  const f = Math.floor(now / FRAME_MS)
  const theme = themeOf(w)
  const sc = STATE_COLOR[w.state]
  const over = w.end !== undefined && w.state !== 'ask'
  // A finished card steps back: its words sink toward the panel.
  const fade = over ? 0.4 : 0
  const ink = (c: number) => mix(c, CARD, fade)
  const accent =
    w.state === 'ask' ? mix(dim(sc, 0.5), sc, pulse(now, 1600))
    : w.state === 'blocked' || w.state === 'error' ? mix(dim(sc, 0.45), sc, pulse(now, 700))
    : over ? mix(sc, CARD, 0.45)
    : mix(dim(theme, 0.75), theme, pulse(now + hash(w.key) * 37, 2400))
  const gs = gauges(w, now)
  const top = worst(gs)

  panel(g, x0, y0, W, CARD_H)
  const R = x0 + W - 1, B = y0 + CARD_H - 1
  for (let y = y0 + 1; y < B; y++) g.put(x0, y, '▐', accent)

  // The bottom edge fills as a bar: while it works, the limit closest to running out in its budget
  // colour; the countdown until a finished card leaves; full and breathing while a question waits.
  let frac = 0, bar = GOOD
  if (w.state === 'ask') { frac = 1; bar = mix(dim(sc, 0.55), sc, pulse(now, 1600)) }
  else if (over) { frac = 1 - (now - (w.end ?? now)) / KEEP_MS; bar = mix(sc, CARD, 0.72) }
  else { frac = top.f; bar = mix(level(top.f), CARD, top.f >= 0.8 ? 0.1 : top.f >= 0.5 ? 0.35 : 0.6) }
  const inner = W - 2
  const fill = Math.round(Math.max(0, Math.min(1, frac)) * inner)
  for (let i = 0; i < fill; i++) g.put(x0 + 1 + i, B, '▀', bar)

  place(lookAt(w.role, w.model, w.state, now, w.stateAt, hash(w.key)), x0 + 2, y0 + 1, `${w.name} ${LABEL[w.state]}`)

  const X = x0 + MW + 4, TW = R - X - 1
  if (TW < 8) return
  const row = (i: number) => y0 + 1 + i

  // 1: who: name (it opens the details), model, effort; the clock on the right
  const elapsed = clock((w.end ?? now) - w.start)
  const clockX = R - 1 - elapsed.length
  g.text(clockX, row(0), elapsed, over ? ink(DIM) : TEXT)
  let x = X + g.text(X, row(0), w.name, ink(theme), clockX - X - 1)
  hits?.push({ key: w.key, x: X, y: row(0), label: w.name, color: ink(theme) })
  const room = () => clockX - x - 2
  if (room() > 2) x += g.text(x, row(0), ' ›', ink(DIM), room())
  if (room() > 7) x += 2 + g.text(x + 2, row(0), shortModel(w.model), ink(DIM), room() - 2)
  const eff = EFFORT[w.effort]
  if (eff && room() > 4) {
    x += 1
    for (let i = 0; i < 3; i++) g.put(x + i, row(0), i < eff[0] ? '●' : '○', i < eff[0] ? ink(eff[1]) : mix(FAINT, CARD, 0.3))
    x += 3
    // ✦: Jev chose the effort, not the role default
    if (w.effortSrc === 'jev' && room() > 1) x += g.text(x, row(0), '✦', ink(JEV))
  }
  if (w.resumed && room() > 2) g.put(x + 1, row(0), '↻', ink(0xffe082))

  // 2: what it is doing now and on what; once over, what it left behind
  g.put(X, row(1), iconOf(w, f), ink(sc))
  let lx = X + 2 + g.text(X + 2, row(1), LABEL[w.state], ink(sc), TW - 2)
  const end = X + TW
  const quiet = !w.end ? now - w.lastAt : 0
  if (over) {
    if ((w.add || w.del) && end - lx > 8) {
      lx += 2 + g.text(lx + 2, row(1), `+${w.add}`, ink(GOOD))
      lx += 1 + g.text(lx + 1, row(1), `−${w.del}`, ink(BAD))
    }
    if (w.accept && end - lx > 7) lx += 2 + g.text(lx + 2, row(1), w.accept.ok ? '✓ test' : '✗ test', ink(w.accept.ok ? GOOD : BAD))
  } else if (quiet > QUIET_MS && w.state === 'think') {
    g.text(lx, row(1), ` · quiet ${clock(quiet)}`, mix(WARN, CARD, 0.25 * pulse(now, 2000)), end - lx)
  } else if (w.arg && w.state !== 'ask' && end - lx > 6) {
    lx += 1 + g.text(lx + 1, row(1), '·', FAINT)
    target(g, lx + 1, row(1), w.arg, end - lx - 1, ink(0xc9d6e6), ink(0x6d7891))
  }

  // 3–4: the question while one waits; else the task, then the rhythm and what needs an eye
  if (w.state === 'ask' && w.question) {
    wrap(w.question, TW, 2).forEach((line, i) => g.text(X, row(2 + i), line, 0xffe8a3))
    return
  }
  let tx = X
  if (w.wt && TW > 20) tx += 2 + g.text(X, row(2), `⎇ ${w.wt}`, ink(BRANCH), 16)
  wrap(w.task, X + TW - tx, 1).forEach(line => g.text(tx, row(2), line, ink(DIM)))

  const flags: [string, number][] = []
  if (over) flags.push([w.cost !== undefined ? usd(w.cost) : `${w.turns} turns`, ink(DIM)])
  else {
    if (w.blocked) flags.push([`! ${w.blocked}`, 0xff9e9e])
    if (top.f >= 0.5) flags.push([`${top.short} ${top.value}`, level(top.f)])
  }
  let rx = X + TW
  for (const [s, c] of flags.reverse()) {
    rx -= [...s].length
    g.text(rx, row(3), s, c)
    rx -= 2
  }
  const strip = rx - X
  if (strip >= 6) activity(g, w, X, row(3), strip, now, fade)
}

function line(g: Grid, w: Worker, x0: number, y: number, W: number, now: number) {
  const sc = STATE_COLOR[w.state]
  const R = x0 + W - 1
  const elapsed = clock((w.end ?? now) - w.start)
  g.text(R - elapsed.length, y, elapsed, w.end ? DIM : TEXT)
  const end = R - elapsed.length - 1
  let x = x0 + 1
  g.put(x, y, iconOf(w, Math.floor(now / FRAME_MS)), sc); x += 2
  x += g.text(x, y, w.name, themeOf(w), end - x)
  x += 1 + g.text(x + 1, y, LABEL[w.state], sc, end - x - 1)
  const rest = w.state === 'ask' ? (w.question ?? '') : w.arg || w.task
  if (end - x > 4) g.text(x + 1, y, shorten(rest, end - x - 2), DIM)
}

// What the whole crew has cost, and its rough share of the 5-hour limit (from the lead's readings).
export type Totals = { cost?: number; limit?: number }

function header(g: Grid, ws: Worker[], now: number, totals: Totals) {
  // the crew's colours drift through the title's diamond and the rule's travelling glow
  const hues = [0x4fd1c5, 0x64b5f6, 0xb39ddb, 0xffb347, 0xffd166]
  const t = (now / 1600) % hues.length
  const hue = mix(hues[Math.floor(t)] ?? 0x4fd1c5, hues[(Math.floor(t) + 1) % hues.length] ?? 0x4fd1c5, t % 1)
  g.put(1, 0, '◆', hue)
  let x = 3 + g.text(3, 0, 'CREW', TEXT)
  const active = ws.filter(w => !w.end).length
  const asking = ws.filter(w => w.state === 'ask').length
  const done = ws.filter(w => w.state === 'done').length
  const failed = ws.filter(w => w.state === 'failed').length
  const chips: [string, number, boolean][] = [
    [`● ${active}`, GOOD, active > 0], [`? ${asking}`, WARN, asking > 0],
    [`✓ ${done}`, GOOD, done > 0], [`✗ ${failed}`, BAD, failed > 0],
  ]
  // right: the crew's activity over the last two minutes, then what it has spent
  const SPAN = 12, BK = 10_000
  const from = Math.ceil(now / BK) * BK - SPAN * BK
  const per = new Array<number>(SPAN).fill(0)
  for (const w of ws) for (const tt of w.times) {
    const b = Math.floor((tt - from) / BK)
    if (b >= 0 && b < SPAN) per[b] = (per[b] ?? 0) + 1
  }
  const money = totals.cost !== undefined && totals.cost > 0 ? usd(totals.cost) : ''
  const share = totals.limit !== undefined && totals.limit >= 0.5 ? `5h ~${Math.round(totals.limit)}%` : ''
  let right = g.w - 1
  if (share) { right -= [...share].length; g.text(right, 0, share, DIM); right -= 2 }
  if (money) { right -= [...money].length; g.text(right, 0, money, TEXT); right -= 2 }
  if (!active && !asking) x += 1 + g.text(x + 1, 0, 'idle', DIM)
  for (const [s, c, on] of chips) {
    if (!on) continue
    if (x + 1 + [...s].length + 2 >= right - 1) break
    x += 1 + g.pill(x + 1, 0, s, c === WARN ? mix(c, 0xffffff, 0.2 * pulse(now, 1600)) : c, mix(PANE, c, 0.16))
  }
  // the counts first; the sparkline takes what room is left
  const n = Math.min(SPAN, right - x - 2)
  if (ws.length && n >= 6) {
    const most = Math.max(1, ...per)
    per.slice(SPAN - n).forEach((k, i) => g.put(right - n + i, 0, k ? (BARS[Math.min(BARS.length - 1, Math.ceil((k / most) * BARS.length) - 1)] ?? '▇') : '▁',
      k ? mix(0x4fd1c5, 0xb39ddb, i / n) : FAINT))
  }
  const head = ((now / 18) % (g.w + 30)) - 15
  for (let i = 0; i < g.w; i++) {
    const d = Math.abs(i - head)
    g.put(i, 1, '─', d < 10 ? mix(0x24262f, hue, 0.7 * (1 - d / 10) ** 2) : 0x24262f)
  }
}

// `images`: leave each sprite's cells blank and list it in `spots`, for an Image laid over them.
// `hits`: where each card's name is, for a Button laid over it.
export function drawScene(
  ws: Worker[], cols: number, now: number, maxRows?: number, images = false, totals: Totals = {},
): { rows: number; words: Uint32Array; spots: Spot[]; hits: Hit[] } {
  const fit = layout(ws.length, cols, maxRows)
  const rows = fit.rows
  const g = new Grid(cols, rows, PANE)
  const spots: Spot[] = []
  const hits: Hit[] = []
  const place: Place = (look, x, y, alt) => {
    if (images) spots.push({ key: `s${spots.length}`, x, y, look, alt })
    else g.pixels(smallSprite(look), x, y)
  }
  header(g, ws, now, totals)
  if (ws.length === 0) {
    panel(g, 0, HEADER_H, cols, EMPTY_H)
    const half = Math.floor(cols / 2)
    for (const [i, role] of (['scout', 'coder'] as Role[]).entries()) {
      const cx = Math.max(0, (i ? half : 0) + Math.floor((half - MW) / 2))
      place(lookAt(role, role === 'scout' ? 'haiku' : 'sonnet', 'sleep', now, 0, i * 5), cx, HEADER_H + 1, `${role} asleep`)
      const label = role === 'scout' ? 'scout · haiku' : 'coder · sonnet'
      g.text(Math.max(0, (i ? half : 0) + Math.floor((half - label.length) / 2)), HEADER_H + 1 + MH, label, dim(THEME[role], 0.8))
    }
    const msg = 'no workers · /orchestrate wakes them'
    g.text(Math.max(0, Math.floor((cols - [...msg].length) / 2)), HEADER_H + MH + 2, msg, FAINT)
    return { rows, words: g.words(), spots, hits }
  }
  const per = perRow(cols)
  const W = Math.floor(cols / per)
  const cw = per > 1 ? W - 1 : W
  // Overflowing: questions and live workers keep the cards, finished ones drop to lines first.
  const list = fit.cards < ws.length ? [...ws].sort((a, b) => RANK(a) - RANK(b)) : ws
  list.slice(0, fit.cards).forEach((w, i) => card(g, w, (i % per) * W, HEADER_H + Math.floor(i / per) * CARD_H, cw, now, place, hits))
  const top = HEADER_H + Math.ceil(fit.cards / per) * CARD_H
  list.slice(fit.cards, fit.cards + fit.lines * per)
    .forEach((w, i) => line(g, w, (i % per) * W, top + Math.floor(i / per), W, now))
  if (fit.more > 0) {
    const msg = `+${fit.more} more · enlarge the pane`
    g.text(Math.max(0, Math.floor((cols - [...msg].length) / 2)), rows - 1, msg, DIM)
  }
  return { rows, words: g.words(), spots, hits }
}

// The detail view's head: the worker's card, then a panel of its three limits as bars and its numbers.
export const DETAIL_ROWS = CARD_H + 7
export function drawDetail(w: Worker, cols: number, now: number, images = false): { rows: number; words: Uint32Array; spots: Spot[] } {
  const g = new Grid(cols, DETAIL_ROWS, PANE)
  const spots: Spot[] = []
  const place: Place = (look, x, y, alt) => {
    if (images) spots.push({ key: `s${spots.length}`, x, y, look, alt })
    else g.pixels(smallSprite(look), x, y)
  }
  card(g, w, 0, 0, cols, now, place)
  const y0 = CARD_H
  panel(g, 0, y0, cols, 7)
  const R = cols - 1
  const VW = Math.min(24, Math.max(10, cols - 30))
  const vx = R - 1 - VW, bx = 12, bw = vx - 2 - bx
  gauges(w, now).forEach((ga, i) => {
    const y = y0 + 1 + i
    g.text(3, y, ga.name, DIM)
    const c = level(ga.f)
    const n = Math.round(Math.max(0, Math.min(1, ga.f)) * bw)
    for (let k = 0; k < bw; k++) g.put(bx + k, y, k < n ? '━' : '─', k < n ? c : FAINT)
    const v = g.text(vx, y, ga.value, TEXT, VW)
    if (ga.note) g.text(vx + v + 2, y, ga.note, DIM, VW - v - 2)
  })
  const cache = w.cin + w.nin ? Math.round((100 * w.cin) / (w.cin + w.nin)) : undefined
  const chosen = w.effortSrc === 'jev' ? /\d+/.exec(w.effortP.split(' ').find(p => p[0] === w.effort[0]) ?? '')?.[0] : undefined
  const effort = w.effort + (w.effortSrc === 'jev' ? ` · jev${chosen ? ` ${chosen}%` : ''}` : w.effortSrc === 'flag' ? ' · set' : '')
  // Only what is known: cost, cache and output arrive with the run's result.
  const stats: [string, string | false, number][][] = [
    [['cost', w.cost !== undefined && usd(w.cost), TEXT], ['cache', cache !== undefined && `${cache}%`, TEXT],
      ['out', w.out > 0 && kilo(w.out), TEXT], ['blocked', w.blocked > 0 && String(w.blocked), 0xff9e9e]],
    [['effort', effort, w.effortSrc === 'jev' ? JEV : TEXT], ['branch', w.wt || w.branch, BRANCH],
      ['diff', w.files > 0 && `+${w.add} −${w.del} · ${w.files} files`, TEXT]],
  ]
  stats.forEach((items, i) => {
    let x = 3
    const y = y0 + 4 + i
    for (const [k, v, c] of items) {
      if (!v) continue
      if (x + k.length + 2 + [...v].length > R - 1) break
      x += g.text(x, y, k, DIM) + 1
      x += g.text(x, y, v, c) + 3
    }
  })
  return { rows: DETAIL_ROWS, words: g.words(), spots }
}

// ---------- svg (surfaces with no Raster: desktop, editor, mobile) ----------

// One cell is CW x CH; each half-block pixel (CW x CH/2) comes out square. Every cell splits into
// 2x2 quarters so ▀▄█▌▐ map to rects, merged into runs and one path per colour; other glyphs are text.
const CW = 6, CH = 12
const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const QUARTERS: Record<number, number> = {
  0x2580: 0b1100, 0x2584: 0b0011, 0x2588: 0b1111, 0x258c: 0b1010, 0x2590: 0b0101,
  0x2596: 0b0010, 0x2597: 0b0001, 0x2598: 0b1000, 0x259d: 0b0100,
}

// `sprites`: PNG frames laid over the blank cells drawScene(images = true) left, as data URIs.
export type SvgSprite = { x: number; y: number; base64: string }
export function sceneSvg(words: Uint32Array, cols: number, rows: number, sprites: SvgSprite[] = [], scale = 1.5): string {
  const q = new Int32Array(cols * 2 * rows * 2).fill(-1)
  const texts: string[] = []
  for (let y = 0; y < rows; y++) {
    // Runs end at spaces: a surface may collapse them, and textLength would then stretch the rest.
    let run = '', runX = 0, runFg = -1
    const flush = () => {
      if (run) {
        const n = [...run].length
        texts.push(`<text x="${runX * CW}" y="${y * CH + 9.5}" fill="${hex(runFg)}" textLength="${n * CW}" lengthAdjust="spacingAndGlyphs">${esc(run)}</text>`)
      }
      run = ''; runFg = -1
    }
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 3
      const g = words[i] ?? 0x20, fg = words[i + 1] ?? DEF, bg = words[i + 2] ?? DEF
      const fill = (mask: number, c: number) => {
        if (c === DEF) return
        for (let k = 0; k < 4; k++) if (mask & (8 >> k)) q[(y * 2 + (k >> 1)) * cols * 2 + x * 2 + (k & 1)] = c & 0xffffff
      }
      fill(0b1111, bg)
      const mask = QUARTERS[g]
      if (mask !== undefined) { fill(mask, fg === DEF ? TEXT : fg); flush(); continue }
      const c = fg === DEF ? TEXT : fg & 0xffffff
      if (g === 0x20) { flush(); continue }
      if (run && c !== runFg) flush()
      if (!run) { runX = x; runFg = c }
      run += String.fromCodePoint(g)
    }
    flush()
  }
  const paths = new Map<number, string>()
  const W = cols * 2
  for (let j = 0; j < rows * 2; j++) {
    for (let i = 0; i < W;) {
      const c = q[j * W + i] ?? -1
      let k = i + 1
      while (k < W && q[j * W + k] === c) k++
      if (c >= 0) {
        const w = ((k - i) * CW) / 2
        paths.set(c, `${paths.get(c) ?? ''}M${(i * CW) / 2} ${(j * CH) / 2}h${w}v${CH / 2}h-${w}z`)
      }
      i = k
    }
  }
  const vw = cols * CW, vh = rows * CH
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw * scale}" height="${vh * scale}">` +
    `<rect width="${vw}" height="${vh}" rx="6" fill="${hex(PANE)}"/>` +
    [...paths].map(([c, d]) => `<path fill="${hex(c)}" d="${d}"/>`).join('') +
    sprites.map(s => `<image x="${s.x * CW}" y="${s.y * CH}" width="${MW * CW}" height="${MH * CH}" style="image-rendering:pixelated" href="data:image/png;base64,${s.base64}"/>`).join('') +
    `<g font-family="ui-monospace,Menlo,Consolas,monospace" font-size="10">${texts.join('')}</g></svg>`
}
