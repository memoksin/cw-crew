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
}
export type Meta = {
  role: Role; model: string; session: string; resume: string; task: string
  start: number; tmo: number; web: boolean; pid: number; effort?: string; effort_src?: string
  name?: string   // fleet name from cwgo (CW_NAME): shown instead of a generated one
}
export type Run = { id: string; meta: Meta; events: Ev[]; rc?: number; doneAt?: number; question?: string }

export type Worker = {
  key: string; role: Role; model: string; name: string; task: string; effort: string
  start: number; runStart: number; resumed: boolean
  state: State; stateAt: number; arg: string; trail: Kind[]; times: number[]; lastAt: number; tmo: number
  blocked: number; question?: string; end?: number; turns: number; out: number
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

type RunView = Pick<Worker, 'state' | 'stateAt' | 'arg' | 'blocked' | 'end' | 'turns' | 'out' | 'lastAt'> & { trail: Kind[]; times: number[] }

const ACCEPT_MS = 1_830_000   // cw's CW_ACCEPT_TMO default (1800 s) plus slack

export function runState(run: Run, now: number): RunView {
  const start = run.meta.start * 1000
  const trail: Kind[] = [], times: number[] = []
  let arg = '', lastTool: Ev | undefined, lastDenied: Ev | undefined, lastError: Ev | undefined
  let result: Ev | undefined, accept: Ev | undefined, accepted: Ev | undefined, blocked = 0
  for (const ev of run.events) {
    if (ev.e === 'tool') {
      lastTool = ev
      arg = ev.arg ?? ''
      trail.push(kindOf(ev.tool ?? '', arg))
      times.push(ev.t)
    } else if (ev.e === 'denied') { lastDenied = ev; blocked++ }
    else if (ev.e === 'error') lastError = ev
    else if (ev.e === 'result') result = ev
    else if (ev.e === 'accept') accept = ev
    else if (ev.e === 'accept_end') accepted = ev
  }
  const lastAt = run.events[run.events.length - 1]?.t ?? start
  const base = { arg, trail, times, blocked, lastAt, turns: result?.turns ?? 0, out: result?.out ?? 0 }
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
  for (const run of sorted) {
    const view = runState(run, now)
    const prev = run.meta.resume ? bySid.get(run.meta.resume) : undefined
    const role = run.meta.role === 'coder' ? 'coder' : 'scout'
    const w: Worker = {
      key: prev?.key ?? run.id,
      role,
      model: run.meta.model,
      effort: run.meta.effort ?? '',
      name: prev?.name ?? (run.meta.name || NAMES[role][used[role]++ % NAMES[role].length] + (used[role] > 10 ? String(Math.ceil(used[role] / 10)) : '')),
      task: prev?.task ?? run.meta.task,
      start: prev?.start ?? run.meta.start * 1000,
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
    }
    const at = prev ? workers.indexOf(prev) : -1
    if (at >= 0) workers[at] = w
    else workers.push(w)
    // A run that dies before its result (killed, timeout) never maps its sid, so the next resume
    // of the same sid still finds `prev`; point it at the newest run or two workers share a key.
    if (prev) for (const [k, v] of bySid) if (v === prev) bySid.set(k, w)
    const sid = [...run.events].reverse().find(ev => ev.e === 'result')?.sid
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
  constructor(public w: number, public h: number) {
    this.glyph = new Uint32Array(w * h).fill(0x20)
    this.fg = new Uint32Array(w * h).fill(DEF)
    this.bg = new Uint32Array(w * h).fill(DEF)
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

const LABEL: Record<State, string> = {
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
const TEXT = 0xe6e6f0, DIM = 0x8a8fa3, FAINT = 0x4a4e5c
// Everything sits on the terminal's own background (an Image's cells always show it); this is only
// what chips and fades mix toward, a neutral dark grey close to most dark themes.
const BASE = 0x262626
const EDGE = 0x3c3f4c
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

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))
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

// A path reads by its file name: the folders dim, the name bright. A command shows whole.
function target(g: Grid, x: number, y: number, arg: string, max: number, bright: number, faint: number) {
  if (max < 2 || !arg) return 0
  const s = shorten(arg, max)
  const cut = /\s/.test(arg.trim()) ? 0 : s.lastIndexOf('/') + 1
  const n = g.text(x, y, s.slice(0, cut), faint, max)
  return n + g.text(x + n, y, s.slice(cut), bright, max - n)
}

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
    if (!k || !kd) g.put(x + i, y, '▁', mix(FAINT, BASE, 0.35))
    else g.put(x + i, y, BARS[Math.min(BARS.length - 1, k - 1)] ?? '▇', mix(KIND_COLOR[kd], BASE, fade))
  }
}

type Place = (look: Look, x: number, y: number, alt: string) => void

function card(g: Grid, w: Worker, x0: number, y0: number, W: number, now: number, place: Place) {
  const f = Math.floor(now / FRAME_MS)
  const opus = /opus/i.test(w.model)
  const theme = opus ? OPUS_THEME : THEME[w.role]
  const sc = STATE_COLOR[w.state]
  const over = w.end !== undefined && w.state !== 'ask'
  // A finished card steps back: its words sink toward the panel.
  const fade = over ? 0.4 : 0
  const ink = (c: number) => mix(c, BASE, fade)
  const accent =
    w.state === 'ask' ? mix(dim(sc, 0.5), sc, pulse(now, 1600))
    : w.state === 'blocked' || w.state === 'error' ? mix(dim(sc, 0.45), sc, pulse(now, 700))
    : over ? dim(sc, 0.7)
    : mix(dim(theme, 0.75), theme, pulse(now + hash(w.key) * 37, 2400))

  // A rounded frame on the terminal's background; its left side in the state's colour.
  const R = x0 + W - 1, B = y0 + CARD_H - 1
  const edge = over ? mix(EDGE, BASE, 0.4) : EDGE
  for (let x = x0 + 1; x < R; x++) g.put(x, y0, '─', edge)
  for (let y = y0 + 1; y < B; y++) { g.put(x0, y, '┃', accent); g.put(R, y, '│', edge) }
  g.put(x0, y0, '┎', accent); g.put(R, y0, '╮', edge)
  g.put(x0, B, '┖', accent); g.put(R, B, '╯', edge)

  // The bottom edge is a bar: the run's time budget while it works (amber, then red, as it runs
  // out), the countdown until a finished card leaves, full and breathing while a question waits.
  const inner = W - 2
  let frac = 0, bar = theme
  if (w.state === 'ask') { frac = 1; bar = mix(dim(sc, 0.55), sc, pulse(now, 1600)) }
  else if (over) { frac = 1 - (now - (w.end ?? now)) / KEEP_MS; bar = dim(sc, 0.6) }
  else {
    frac = (now - w.runStart) / Math.max(1, w.tmo * 1000)
    bar = frac > 0.9 ? 0xff5c5c : frac > 0.75 ? 0xffb347 : dim(theme, 0.8)
  }
  const fill = Math.round(Math.max(0, Math.min(1, frac)) * inner)
  for (let i = 0; i < inner; i++) g.put(x0 + 1 + i, B, i < fill ? '━' : '─', i < fill ? bar : edge)

  place(lookAt(w.role, w.model, w.state, now, w.stateAt, hash(w.key)), x0 + 2, y0 + 1, `${w.name} ${LABEL[w.state]}`)

  const X = x0 + MW + 3, TW = R - X - 1
  if (TW < 8) return
  const row = (i: number) => y0 + 1 + i

  // 1: who — name, model chip, effort pips; the clock on the right
  const elapsed = clock((w.end ?? now) - w.start)
  const clockX = R - 1 - elapsed.length
  g.text(clockX, row(0), elapsed, over ? ink(DIM) : TEXT)
  let x = X + g.text(X, row(0), w.name, ink(theme), clockX - X - 1)
  const room = () => clockX - x - 2
  if (room() > 4) x += 1 + g.pill(x + 1, row(0), w.model.toUpperCase(), ink(theme), mix(BASE, theme, over ? 0.12 : 0.22), room())
  const eff = EFFORT[w.effort]
  if (eff && room() > 4) {
    x += 1
    for (let i = 0; i < 3; i++) g.put(x + i, row(0), i < eff[0] ? '●' : '○', i < eff[0] ? ink(eff[1]) : mix(FAINT, BASE, 0.3))
    x += 3
  }
  if (w.resumed && room() > 2) g.put(x + 1, row(0), '↻', ink(0xffe082))

  // 2: what it is doing now, and on what
  const icon =
    w.state === 'done' ? '✓' : w.state === 'failed' ? '✗' : w.state === 'ask' ? '?'
    : w.state === 'blocked' || w.state === 'error' ? '!' : SPIN[f % SPIN.length] ?? ' '
  g.put(X, row(1), icon, ink(sc))
  let lx = X + 2 + g.text(X + 2, row(1), LABEL[w.state], ink(sc), TW - 2)
  const quiet = !w.end ? now - w.lastAt : 0
  if (quiet > QUIET_MS && w.state === 'think') {
    lx += g.text(lx, row(1), ` · ${clock(quiet)} sessiz`, mix(0xffb347, BASE, 0.25 * pulse(now, 2000)), X + TW - lx)
  } else if (w.arg && w.state !== 'ask' && X + TW - lx > 6) {
    lx += 1 + g.text(lx + 1, row(1), '·', FAINT)
    target(g, lx + 1, row(1), w.arg, X + TW - lx - 1, ink(0xc9d6e6), ink(0x6d7891))
  }

  // 3–4: the question while one waits; else the task and the activity strip
  if (w.state === 'ask' && w.question) {
    wrap(w.question, TW, 2).forEach((line, i) => g.text(X, row(2 + i), line, 0xffe8a3))
    return
  }
  wrap(w.task, TW, 1).forEach(line => g.text(X, row(2), line, ink(DIM)))
  const stats = over ? `${w.turns} turns · ${kilo(w.out)} tok`
    : `${w.trail.length} tools${w.blocked ? ` · ${w.blocked} blocked` : ''}`
  const sw = [...stats].length
  const strip = TW - sw - 2
  if (strip >= 6) activity(g, w, X, row(3), strip, now, fade)
  g.text(X + TW - sw, row(3), stats, w.blocked && !w.end ? 0xff9e9e : ink(DIM))
}

function line(g: Grid, w: Worker, x0: number, y: number, W: number, now: number) {
  const f = Math.floor(now / FRAME_MS)
  const sc = STATE_COLOR[w.state]
  const icon =
    w.state === 'done' ? '✓' : w.state === 'failed' ? '✗' : w.state === 'ask' ? '?'
    : w.state === 'blocked' || w.state === 'error' ? '!' : SPIN[f % SPIN.length] ?? ' '
  const R = x0 + W - 1
  const elapsed = clock((w.end ?? now) - w.start)
  g.text(R - elapsed.length, y, elapsed, w.end ? DIM : TEXT)
  const end = R - elapsed.length - 1
  let x = x0 + 1
  g.put(x, y, icon, sc); x += 2
  x += g.text(x, y, w.name, /opus/i.test(w.model) ? OPUS_THEME : THEME[w.role], end - x)
  x += 1 + g.text(x + 1, y, LABEL[w.state], sc, end - x - 1)
  const rest = w.state === 'ask' ? (w.question ?? '') : w.arg || w.task
  if (end - x > 4) g.text(x + 1, y, shorten(rest, end - x - 2), DIM)
}

function header(g: Grid, ws: Worker[], now: number) {
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
    active ? [`● ${active} working`, 0x81c784, true] : ['○ idle', DIM, true], [`? ${asking} asking`, 0xffd166, asking > 0],
    [`✓ ${done}`, 0x7bd88f, done > 0], [`✗ ${failed}`, 0xff5c5c, failed > 0],
  ]
  // the activity of the whole crew over the last two minutes, and its rate
  const SPAN = 12, B = 10_000
  const from = Math.ceil(now / B) * B - SPAN * B
  const per = new Array<number>(SPAN).fill(0)
  let minute = 0
  for (const w of ws) for (const tt of w.times) {
    const b = Math.floor((tt - from) / B)
    if (b >= 0 && b < SPAN) per[b] = (per[b] ?? 0) + 1
    if (now - tt < 60_000) minute++
  }
  const rate = `${minute}/dk`
  const sparkW = SPAN + 1 + rate.length
  const right = g.w - 1 - sparkW
  for (const [s, c, on] of chips) {
    if (!on) continue
    const wdt = [...s].length + 2
    if (x + 1 + wdt >= right - 1) break
    x += 1 + g.pill(x + 1, 0, s, c === 0xffd166 ? mix(c, 0xffffff, 0.2 * pulse(now, 1600)) : c, mix(BASE, c, 0.18))
  }
  if (right > x + 1 && ws.length) {
    const top = Math.max(1, ...per)
    per.forEach((k, i) => g.put(right + i, 0, k ? (BARS[Math.min(BARS.length - 1, Math.ceil((k / top) * BARS.length) - 1)] ?? '▇') : '▁',
      k ? mix(0x4fd1c5, 0xb39ddb, i / SPAN) : FAINT))
    g.text(right + SPAN + 1, 0, rate, minute ? DIM : FAINT)
  }
  const head = ((now / 18) % (g.w + 30)) - 15
  for (let i = 0; i < g.w; i++) {
    const d = Math.abs(i - head)
    g.put(i, 1, '─', d < 10 ? mix(0x2c2f3a, hue, (1 - d / 10) ** 2) : 0x2c2f3a)
  }
}

// `images`: leave each sprite's cells blank and list it in `spots`, for an Image laid over them.
export function drawScene(
  ws: Worker[], cols: number, now: number, maxRows?: number, images = false,
): { rows: number; words: Uint32Array; spots: Spot[] } {
  const fit = layout(ws.length, cols, maxRows)
  const rows = fit.rows
  const g = new Grid(cols, rows)
  const spots: Spot[] = []
  const place: Place = (look, x, y, alt) => {
    if (images) spots.push({ key: `s${spots.length}`, x, y, look, alt })
    else g.pixels(smallSprite(look), x, y)
  }
  header(g, ws, now)
  if (ws.length === 0) {
    const half = Math.floor(cols / 2)
    for (const [i, role] of (['scout', 'coder'] as Role[]).entries()) {
      const cx = Math.max(0, (i ? half : 0) + Math.floor((half - MW) / 2))
      place(lookAt(role, role === 'scout' ? 'haiku' : 'sonnet', 'sleep', now, 0, i * 5), cx, HEADER_H + 1, `${role} uyuyor`)
      const label = role === 'scout' ? 'scout · haiku' : 'coder · sonnet'
      g.text(Math.max(0, (i ? half : 0) + Math.floor((half - label.length) / 2)), HEADER_H + 2 + MH, label, dim(THEME[role], 0.8))
    }
    const msg = 'no workers · /orchestrate wakes them'
    g.text(Math.max(0, Math.floor((cols - [...msg].length) / 2)), HEADER_H + MH + 3, msg, FAINT)
    return { rows, words: g.words(), spots }
  }
  const per = perRow(cols)
  const W = Math.floor(cols / per)
  const cw = per > 1 ? W - 1 : W
  // Overflowing: questions and live workers keep the cards, finished ones drop to lines first.
  const list = fit.cards < ws.length ? [...ws].sort((a, b) => RANK(a) - RANK(b)) : ws
  list.slice(0, fit.cards).forEach((w, i) => card(g, w, (i % per) * W, HEADER_H + Math.floor(i / per) * CARD_H, cw, now, place))
  const top = HEADER_H + Math.ceil(fit.cards / per) * CARD_H
  list.slice(fit.cards, fit.cards + fit.lines * per)
    .forEach((w, i) => line(g, w, (i % per) * W, top + Math.floor(i / per), W, now))
  if (fit.more > 0) {
    const msg = `+${fit.more} more · enlarge the pane`
    g.text(Math.max(0, Math.floor((cols - [...msg].length) / 2)), rows - 1, msg, DIM)
  }
  return { rows, words: g.words(), spots }
}
