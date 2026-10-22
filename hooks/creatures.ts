// The crew's creatures: a round owl per scout, a plum owl in glasses per reviewer, a baby dragon per coder
// (purple and crowned on Opus).
// Drawn in code at 60x32 pixels, 4x the old 15x8 half-block sprites each way, for terminals that
// show images; the same frame downsampled to 15x8 half-blocks for the ones that draw cells only.
// Frames step every FRAME_MS; motion is eased over long loops so nothing jumps more than a pixel or two.

import type { Role, State } from './scene'

export type Pose = State | 'sleep'
export const CLEAR = 0x02000000
export const BIG_W = 60, BIG_H = 32
// Hi-res pixels per logical pixel in the image frames.
export const BIG_S = 2
export const SMALL_W = 15, SMALL_H = 8
export const FRAME_MS = 125
// A see-through black (gen_frames.py writes it with alpha) so the shadow suits any terminal background.
export const SHADOW = 0x03000000

const OUT = 0x2a2140
const EYE = 0x1f1833, IRIS = 0x4a4fa8, SHINE = 0xffffff, BLUSH = 0xff9cc2, TONGUE = 0xff6f91
const TEAR = 0x8fd3ff
const CONFETTI = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4dabf7, 0xcc5de8, 0xffffff]

// Drawn in logical pixels; `s` hi-res pixels per logical one, so curves and outlines come out finer
// while every shape keeps its logical size and place.
export class Canvas {
  px: Uint32Array
  readonly pw: number; readonly ph: number
  constructor(readonly w: number, readonly h: number, readonly s = 1) {
    this.pw = w * s; this.ph = h * s
    this.px = new Uint32Array(this.pw * this.ph).fill(CLEAR)
  }
  at(x: number, y: number) {
    const i = Math.floor(x * this.s + 1e-6), j = Math.floor(y * this.s + 1e-6)
    return i >= 0 && j >= 0 && i < this.pw && j < this.ph ? this.px[j * this.pw + i] ?? CLEAR : CLEAR
  }
  dot(i: number, j: number, c: number, on?: number) {
    if (i < 0 || j < 0 || i >= this.pw || j >= this.ph) return
    if (on !== undefined && this.px[j * this.pw + i] !== on) return
    this.px[j * this.pw + i] = c
  }
  // One logical pixel: an s x s block, placed to the hi-res pixel.
  put(x: number, y: number, c: number, on?: number) {
    const i0 = Math.floor(x * this.s + 1e-6), j0 = Math.floor(y * this.s + 1e-6)
    for (let j = 0; j < this.s; j++) for (let i = 0; i < this.s; i++) this.dot(i0 + i, j0 + j, c, on)
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    const i0 = Math.floor(x * this.s + 1e-6), j0 = Math.floor(y * this.s + 1e-6)
    for (let j = 0; j < Math.round(h * this.s); j++) for (let i = 0; i < Math.round(w * this.s); i++) this.dot(i0 + i, j0 + j, c)
  }
  // Every hi-res pixel whose centre lies in the ellipse; `keep` (in logical units) limits it to some of them.
  oval(cx: number, cy: number, rx: number, ry: number, c: number, keep?: (x: number, y: number) => boolean) {
    const s = this.s
    for (let j = Math.floor((cy - ry) * s); j <= Math.ceil((cy + ry) * s); j++) {
      for (let i = Math.floor((cx - rx) * s); i <= Math.ceil((cx + rx) * s); i++) {
        const dx = ((i + 0.5) / s - cx) / rx, dy = ((j + 0.5) / s - cy) / ry
        if (dx * dx + dy * dy <= 1 && (!keep || keep(i / s, j / s))) this.dot(i, j, c)
      }
    }
  }
  // An oval with a dark rim of its own, so it reads over a body of a near colour.
  rim(cx: number, cy: number, rx: number, ry: number, c: number) {
    this.oval(cx, cy, rx + 1, ry + 1, OUT)
    this.oval(cx, cy, rx, ry, c)
  }
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: number) {
    const side = (px: number, py: number, x0: number, y0: number, x1: number, y1: number) =>
      (px - x1) * (y0 - y1) - (x0 - x1) * (py - y1)
    const s = this.s
    for (let j = Math.floor(Math.min(ay, by, cy) * s); j <= Math.ceil(Math.max(ay, by, cy) * s); j++) {
      for (let i = Math.floor(Math.min(ax, bx, cx) * s); i <= Math.ceil(Math.max(ax, bx, cx) * s); i++) {
        const px = (i + 0.5) / s, py = (j + 0.5) / s
        const d1 = side(px, py, ax, ay, bx, by), d2 = side(px, py, bx, by, cx, cy), d3 = side(px, py, cx, cy, ax, ay)
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) this.dot(i, j, c)
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: number, thick = 1) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * this.s))
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n
      this.rect(x, y, thick, thick, c)
    }
  }
  stamp(rows: string[], pal: Record<string, number>, ox: number, oy: number, k = 1) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = pal[row[x] ?? '.']
        if (c !== undefined) this.rect(ox + x * k, oy + y * k, k, k, c)
      }
    })
  }
  // A one hi-res pixel dark edge around everything drawn so far: the sticker look.
  outline(c: number) {
    const src = this.px.slice(), W = this.pw, H = this.ph
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? CLEAR : src[y * W + x])
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (src[y * W + x] !== CLEAR) continue
      if (at(x - 1, y) !== CLEAR || at(x + 1, y) !== CLEAR || at(x, y - 1) !== CLEAR || at(x, y + 1) !== CLEAR) {
        this.px[y * W + x] = c
      }
    }
  }
  over(o: Canvas) {
    for (let i = 0; i < this.px.length; i++) if ((o.px[i] ?? CLEAR) !== CLEAR) this.px[i] = o.px[i] ?? CLEAR
  }
}

const mix = (a: number, b: number, k: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
// One smooth cycle over `n` frames: 0 at frame 0, 1 halfway, back to 0.
const cyc = (f: number, n: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * f) / n)
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const dim = (c: number) => mix(c, 0x000000, 0.3)
const rnd = (a: number, b: number) => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return x - Math.floor(x)
}

type Pal = {
  body: number; shade: number; light: number; belly: number; mark: number
  wing: number; face: number; beak: number; horn: number
}
const OWL: Pal = {
  body: 0x63c9cf, shade: 0x3d9cad, light: 0xb4f0ea, belly: 0xfff3da, mark: 0xe8cf9f,
  wing: 0x4aa3bd, face: 0xeafaf6, beak: 0xffa938, horn: 0x3d9cad,
}
const REVIEW_OWL: Pal = {
  body: 0xe58fb4, shade: 0xb9628f, light: 0xffd1e3, belly: 0xfff3da, mark: 0xe8b8c8,
  wing: 0xc66f9c, face: 0xfff0f5, beak: 0xffa938, horn: 0xb9628f,
}
const DRAGON: Pal = {
  body: 0xffab52, shade: 0xe27c2f, light: 0xffd79c, belly: 0xfff0c8, mark: 0xf0c084,
  wing: 0xff6f5e, face: 0xffab52, beak: 0, horn: 0xfff4dc,
}
const DRAGON_OPUS: Pal = {
  body: 0xb59cff, shade: 0x8a6fe3, light: 0xe0d6ff, belly: 0xfff0fa, mark: 0xe6c6ef,
  wing: 0xff8fcf, face: 0xb59cff, beak: 0, horn: 0xfff4dc,
}

type Arm = 'down' | 'up' | 'wave' | 'hold' | 'type' | 'chin' | 'point'
type Eyes = 'open' | 'wide' | 'closed' | 'happy' | 'dizzy' | 'squeeze' | 'sad'
type Mouth = 'smile' | 'open' | 'o' | 'frown' | 'flat'
type Body = {
  x: number; y: number; squash: number; look: [number, number]
  eyes: Eyes; mouth: Mouth; left: Arm; right: Arm; phase: number
  hat?: 'crown' | 'nightcap' | 'shell'; glasses?: boolean; flap: number
}
type Frame = { cx: number; cy: number; top: number; bottom: number; rx: number; ry: number; eyY: number }

const owl = (role: Role) => role !== 'coder'
const palOf = (role: Role, opus: boolean) => role === 'scout' ? OWL : role === 'reviewer' ? REVIEW_OWL : opus ? DRAGON_OPUS : DRAGON

function frameOf(b: Body): Frame {
  const top = 8 + b.y + b.squash, bottom = 30.5 + b.y
  const cy = (top + bottom) / 2, ry = (bottom - top) / 2
  return { cx: 16 + b.x, cy, top, bottom, rx: 12.5 + b.squash * 0.5, ry, eyY: cy - 3.5 }
}

function eye(c: Canvas, x: number, y: number, kind: Eyes, look: [number, number], phase: number, side: number, lid: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  switch (kind) {
    case 'open':
    case 'wide':
    case 'sad': {
      const r = kind === 'wide' ? 3.5 : 3.1
      const lx = x + look[0], ly = y + look[1]
      c.oval(lx, ly, r, r + 0.6, EYE)
      c.oval(lx, ly + 1.8, r - 0.9, 1.6, IRIS, (px, py) => c.at(px, py) === EYE)
      c.rect(Math.floor(lx - 1.7), Math.floor(ly - 2.3), 2, 2, SHINE)
      c.put(lx + 1.1, ly + 1.2, SHINE)
      if (kind === 'wide') c.put(lx + 1.4, ly - 2.2, SHINE)
      if (kind === 'sad') {
        // a heavy lid slanting down to the outside
        for (let yy = iy - 5; yy <= iy; yy++) for (let xx = ix - 4; xx <= ix + 4; xx++) {
          const cut = iy - 1 + (xx - ix) * side * 0.4
          if (yy < cut) for (const on of [EYE, IRIS, SHINE]) c.put(xx, yy, lid, on)
        }
        c.line(ix - 3, iy - 1 - 3 * side * 0.4, ix + 3, iy - 1 + 3 * side * 0.4, EYE)
      }
      break
    }
    case 'closed':
      for (const [dx, dy] of [[-2, 0], [-1, 1], [0, 1], [1, 1], [2, 0]] as const) c.put(ix + dx, iy + dy, EYE)
      break
    case 'happy':
      for (const [dx, dy] of [[-2, 1], [-2, 2], [-1, 0], [0, -1], [1, 0], [2, 1], [2, 2]] as const) c.put(ix + dx, iy + dy, EYE)
      break
    case 'squeeze':
      for (const [dx, dy] of [[-2, -2], [-1, -1], [0, 0], [-1, 1], [-2, 2], [-1, -2], [0, -1], [1, 0], [0, 1], [-1, 2]] as const) {
        c.put(ix + dx * -side, iy + dy, EYE)
      }
      break
    case 'dizzy':
      for (let t = 0; t < 4 * Math.PI; t += 0.12) {
        const r = 0.3 + t * 0.26
        c.put(x + r * Math.cos(t * side + phase), y + 0.3 + r * Math.sin(t * side + phase), EYE)
      }
      break
  }
}

function body(c: Canvas, role: Role, pal: Pal, b: Body) {
  const { cx, cy, top, bottom, rx, ry, eyY } = frameOf(b)
  if (role === 'coder') {
    // the tail curls out behind, to the right
    const wag = Math.sin((b.phase * Math.PI) / 8) * 0.8
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const r = 3 - 1.7 * t
      c.oval(cx + 8 + 8.5 * t, bottom - 3 - 9 * t * t + wag * t, r, r, pal.body)
    }
    c.tri(cx + 14.5, bottom - 13 + wag, cx + 18.5, bottom - 15 + wag, cx + 17, bottom - 10 + wag, pal.wing)
    // bat wings behind the shoulders
    for (const s of [-1, 1]) {
      c.tri(cx + s * 7, cy - 6, cx + s * 15.6, cy - 12 - b.flap, cx + s * 10, cy + 1, pal.wing)
      c.tri(cx + s * 11, cy - 4, cx + s * 15.6, cy - 12 - b.flap, cx + s * 15, cy - 1, pal.wing)
    }
  } else {
    for (const s of [-1, 1]) c.tri(cx + s * 4.5, top + 3, cx + s * 10.5, top - 4.5, cx + s * 11.5, top + 6, pal.horn)
  }

  c.oval(cx, cy, rx, ry, pal.shade)
  c.oval(cx - 0.6, cy - 0.9, rx - 1.1, ry - 0.9, pal.body)
  c.oval(cx - 6, top + 3.6, 3.6, 1.7, pal.light)
  c.oval(cx, bottom - 5.8, 7.6, 5.4, pal.belly)
  if (owl(role)) {
    for (const [mx, my] of [[-4, -5], [1, -5], [-2, -2.5], [3, -2.5]] as const) {
      const x = Math.floor(cx + mx), y = Math.floor(bottom + my)
      c.put(x, y, pal.mark); c.put(x + 1, y + 1, pal.mark); c.put(x + 2, y, pal.mark)
    }
    for (const s of [-1, 1]) c.oval(cx + s * 5.5, eyY + 0.4, 5.9, 5.3, pal.face)
  } else {
    for (const dy of [-6.5, -3.5]) c.line(cx - 6, bottom + dy, cx + 5, bottom + dy, pal.mark)
    for (const y of [bottom - 6.5, bottom - 3.5]) for (let x = cx - 8; x <= cx + 8; x++) {
      if (c.at(x, y) === pal.mark && (c.at(x, y - 1) !== pal.belly || c.at(x, y + 1) !== pal.belly)) c.put(x, y, pal.belly)
    }
    for (const s of [-1, 1]) c.tri(cx + s * 4.5, top + 2.2, cx + s * 8.5, top - 5, cx + s * 8.6, top + 2.8, pal.horn)
  }

  // feet
  for (const s of [-1, 1]) {
    if (owl(role)) c.oval(cx + s * 5, bottom, 2.6, 1.3, pal.beak)
    else c.oval(cx + s * 6, bottom - 0.3, 3, 1.6, pal.shade)
  }

  for (const s of [-1, 1]) c.oval(cx + s * 8.6, eyY + 4.2, 1.8, 1, BLUSH)
  for (const [s, x] of [[-1, cx - 5.5], [1, cx + 5.5]] as const) eye(c, x, eyY, b.eyes, b.look, (b.phase * Math.PI) / 8, s, pal.face)
  if (b.glasses) {
    for (const s of [-1, 1]) {
      const gx = cx + s * 5.5
      c.oval(gx, eyY, 4.9, 4.9, OUT, (x, y) => {
        const dx = x + 0.5 - gx, dy = y + 0.5 - eyY
        return dx * dx + dy * dy > 3.9 * 3.9
      })
    }
    c.line(cx - 1, eyY - 1, cx, eyY - 1, OUT)
  }

  const my = Math.floor(eyY + 3)
  const mx = Math.floor(cx)
  if (owl(role)) {
    if (b.mouth === 'open' || b.mouth === 'o') {
      c.rect(mx - 2, my, 4, 1, pal.beak); c.rect(mx - 2, my + 1, 4, 2, EYE)
      c.put(mx - 2, my + 1, pal.beak); c.put(mx + 1, my + 1, pal.beak); c.rect(mx - 1, my + 3, 2, 1, pal.beak)
      if (b.mouth === 'open') c.rect(mx - 1, my + 2, 2, 1, TONGUE)
    } else {
      c.rect(mx - 2, my, 4, 1, pal.beak); c.rect(mx - 1, my + 1, 2, 1, pal.beak)
      if (b.mouth === 'frown') c.rect(mx - 1, my + 2, 2, 1, mix(pal.beak, EYE, 0.3))
    }
  } else {
    c.put(mx - 2, my - 1, pal.shade); c.put(mx + 1, my - 1, pal.shade)
    const y = my + 1
    if (b.mouth === 'smile') {
      for (const [dx, dy] of [[-3, 0], [-2, 1], [-1, 0], [0, 0], [1, 1], [2, 0]] as const) c.put(mx + dx, y + dy, EYE)
    } else if (b.mouth === 'open') {
      c.oval(cx, y + 1.2, 2.4, 1.9, EYE)
      c.oval(cx, y + 2.4, 1.6, 0.8, TONGUE, (px, py) => c.at(px, py) === EYE)
      c.put(mx - 2, y, SHINE)
    } else if (b.mouth === 'o') {
      c.oval(cx, y + 0.8, 1.3, 1.4, EYE)
    } else if (b.mouth === 'frown') {
      for (const [dx, dy] of [[-2, 1], [-1, 0], [0, 0], [1, 1]] as const) c.put(mx + dx, y + dy, EYE)
    } else {
      c.rect(mx - 1, y, 2, 1, EYE)
    }
  }

  if (b.hat === 'crown') {
    c.stamp([
      'Y...YY...Y',
      'YY.YYYY.YY',
      'YYYYPPYYYY',
      'yyyyyyyyyy',
    ], { Y: 0xffd447, y: 0xe0a422, P: 0xff5fa2 }, mx - 5, Math.floor(top) - 4)
  } else if (b.hat === 'nightcap') {
    const t = Math.floor(top)
    c.tri(mx - 8, t + 2, mx + 8, t + 2, mx + 11, t - 6, 0x6c7bff)
    c.tri(mx - 2, t - 1, mx + 6, t - 1, mx + 11, t - 6, 0x8f9bff)
    c.rect(mx - 8, t + 1, 17, 2, 0xf4f1ff)
    c.oval(mx + 12, t - 6.5, 2.2, 2.2, 0xf4f1ff)
  } else if (b.hat === 'shell') {
    const t = Math.floor(top)
    // the top of the eggshell, its broken edge jagged
    c.oval(cx, t + 2, 7, 5, 0xfff6e6, (x, y) => y < t + 1 || (y === t + 1 && x % 2 === 0))
    c.oval(cx - 3, t - 1, 1.2, 0.8, pal.body)
  }
}

function arm(c: Canvas, role: Role, pal: Pal, b: Body, side: number, kind: Arm) {
  const { cx, cy, eyY } = frameOf(b)
  // owls have wings, dragons stubby paws: smaller, in the body's shade
  const col = owl(role) ? pal.wing : pal.shade
  const k = owl(role) ? 1 : 0.75
  const s = side
  const limb = (x: number, y: number, rx: number, ry: number) => c.rim(x, y, rx * k, ry * k, col)
  switch (kind) {
    case 'down': limb(cx + s * (owl(role) ? 11.2 : 10), cy + 3, 2.5, 4.8); break
    case 'up': limb(cx + s * 12.4, cy - 8.5, 2.3, 4.5); break
    case 'wave':
      if (b.phase % 8 < 4) limb(cx + s * 12.4, cy - 8.5, 2.3, 4.5)
      else limb(cx + s * 13.8, cy - 7, 2.3, 4.2)
      break
    case 'hold': limb(cx + s * 12.6, cy + 3, 4.6, 2.3); break
    case 'type': limb(cx + s * 12.2, cy + 4.5 - (Math.floor(b.phase / 2) % 2 ? 1.5 : 0), 4.2, 2.2); break
    case 'chin': c.rim(cx + s * 4.5, eyY + 7, 2.2, 1.6, col); break
    case 'point':
      limb(cx + s * 11.5, cy - 2, 2.4, 3.2)
      limb(cx + s * 13.8, cy - 6.5, 2.2, 2.4)
      c.oval(cx + s * 11.5, cy - 2, 2.4 * k, 3.2 * k, col)
      break
  }
}

function sparkle(c: Canvas, x: number, y: number, size: number, col = 0xffffff) {
  if (size <= 0) return
  c.put(x, y, col)
  for (let k = 1; k <= size; k++) {
    const t = k === size ? mix(col, 0x8888aa, 0.35) : col
    c.put(x + k, y, t); c.put(x - k, y, t); c.put(x, y + k, t); c.put(x, y - k, t)
  }
}

function star(c: Canvas, x: number, y: number) {
  c.stamp(['..y..', '.yyy.', 'yyWyy', '.yyy.', '.y.y.'], { y: 0xffe066, W: 0xfffbe0 }, Math.floor(x) - 2, Math.floor(y) - 2)
}

const Z5 = ['#####', '...#.', '..#..', '.#...', '#####']
const Z4 = ['####', '..#.', '.#..', '####']
const QUESTION = ['.###.', '#...#', '...#.', '..#..', '..#..', '.....', '..#..']

// Which frame a state shows at `now`: `seed` puts each worker's loop at its own phase.
// Counts are frames of FRAME_MS. An intro plays once from the state's start; then the loop runs,
// or, with no loop, the intro's last frame holds.
export const LOOP: Record<Pose, number> = {
  boot: 0, resumed: 0, think: 32, read: 48, write: 48, bash: 32, web: 32, test: 32,
  blocked: 16, error: 32, ask: 32, done: 1, failed: 1, sleep: 32,
}
export const INTRO: Partial<Record<Pose, number>> = { boot: 12, resumed: 12, blocked: 8, done: 16, failed: 8 }
export const BLINKS: Pose[] = ['think', 'read', 'write', 'bash', 'web', 'test', 'ask']
// Working creatures breathe on a 2 s cycle; every loop above is a multiple of it.
const BREATHE: Pose[] = ['think', 'read', 'write', 'bash', 'web', 'test', 'ask', 'error', 'blocked']
export type Look = { role: Role; opus: boolean; state: Pose; frame: number; blink: boolean }

export function lookAt(role: Role, model: string, state: Pose, now: number, stateAt: number, seed: number): Look {
  // Only coders wear the Opus crown: frames/ holds no crowned owls.
  const opus = role === 'coder' && /opus/i.test(model)
  const tick = Math.floor(now / FRAME_MS) + seed
  const intro = INTRO[state] ?? 0, loop = LOOP[state]
  const step = Math.floor(Math.max(0, now - stateAt) / FRAME_MS)
  const frame = step < intro ? step : loop ? intro + (loop > 1 ? tick % loop : 0) : intro - 1
  const blink = BLINKS.includes(state) && tick % 31 === 0
  return { role, opus, state, frame, blink }
}
export const lookKey = (l: Look) => `${l.role}${l.opus ? '+' : ''}:${l.state}:${l.frame}${l.blink ? 'b' : ''}`
export const frameCount = (state: Pose) => (INTRO[state] ?? 0) + LOOP[state]

export function drawLook({ role, opus, state, frame: f, blink }: Look): Canvas {
  const pal = palOf(role, opus)
  const c = new Canvas(BIG_W, BIG_H, BIG_S)
  const fx = new Canvas(BIG_W, BIG_H, BIG_S)
  const b: Body = {
    x: 0, y: 0, squash: 0, look: [0, 0], eyes: 'open', mouth: 'smile', left: 'down', right: 'down',
    phase: f, hat: opus ? 'crown' : undefined, flap: 0,
  }
  let creature = true
  let mid: () => void = () => {}
  let front: () => void = () => {}

  switch (state) {
    case 'boot': {
      if (f <= 6) {
        creature = false
        const ox = [0, 0, -1, 0, 1, 0, -1][f] ?? 0
        c.oval(16 + ox, 19.5, 10.5, 12.5, 0xfff6e6)
        c.oval(17.5 + ox, 21, 9, 11, 0xf1e2c8, (x, y) => (x - 16 - ox) * 0.6 + (y - 19.5) > 6)
        for (const [x, y, rx, ry] of [[11.5, 14, 2.2, 1.6], [20.5, 23, 2.8, 2.1], [12.5, 26, 1.6, 1.3], [21.5, 12, 1.4, 1.1]] as const) {
          c.oval(x + ox, y, rx, ry, pal.body)
        }
        c.oval(12.5 + ox, 11, 1.4, 2.6, 0xffffff)
        const crack: [number, number][] = [[6, 17], [8, 20], [10, 16], [13, 21], [15, 17], [18, 21], [21, 16], [24, 20], [26, 17]]
        const n = Math.max(0, Math.floor((f - 1) * 1.6))
        for (let i = 0; i < Math.min(n, crack.length - 1); i++) {
          const p = crack[i], q = crack[i + 1]
          if (p && q) c.line(p[0] + ox, p[1], q[0] + ox, q[1], OUT)
        }
        if (f >= 3) for (let i = 0; i < 3; i++) sparkle(fx, 36 + rnd(i, f) * 20, 4 + rnd(f, i) * 22, 1, i % 2 ? pal.body : 0xffffff)
      } else {
        const out = f >= 10
        b.eyes = out ? 'happy' : 'wide'
        b.mouth = out ? 'open' : 'o'
        b.left = out ? 'up' : 'down'; b.right = out ? 'up' : 'down'
        b.y = f === 10 ? -1.5 : f === 11 ? -0.5 : 0
        if (out) b.hat = 'shell'
        front = () => {
          if (!out) {
            // the lower half of the shell still around the belly, the cap flying off up and to the right
            c.oval(16, 23, 12.5, 9, 0xfff6e6, (x, y) => y >= 26 + (x % 2))
            for (let x = 4; x <= 28; x++) c.put(x, 25 + (x % 2), OUT)
            const t = ease((f - 6) / 3)
            const tx = 30 + 16 * t, ty = 9 - 7 * t
            c.oval(tx, ty + 3, 6, 4, 0xfff6e6, (_, y) => y < ty + 4)
            c.oval(tx - 2, ty + 1.5, 1.5, 1, pal.body)
          } else {
            c.oval(40, 29.5, 4, 2.5, 0xfff6e6, (_, y) => y >= 29)
            c.oval(50, 30, 3, 2, 0xfff6e6, (_, y) => y >= 30)
          }
          for (let i = 0; i < 5; i++) sparkle(fx, 34 + rnd(i, f) * 24, 3 + rnd(f, i) * 24, 1 + ((i + f) % 2), [0xffffff, 0xffe066, pal.body][i % 3])
        }
      }
      break
    }

    case 'think': {
      b.look = [0.6 + 0.5 * Math.sin((f * Math.PI) / 16), -1]; b.right = 'chin'; b.mouth = 'flat'
      mid = () => {
        const dy = Math.round(cyc(f, 32))
        for (const [x, y, rx, ry] of [[41.5, 8.5, 5, 4.5], [48, 6.5, 6, 5.2], [54.5, 8.5, 4.6, 4.2], [45, 12, 5.5, 3.2], [51.5, 12, 5.5, 3.2]] as const) {
          c.oval(x, y + dy, rx, ry, 0xf4f1ff)
        }
        c.oval(34.5, 18.5, 1.6, 1.6, 0xf4f1ff)
        c.oval(37.5, 15 + dy * 0.5, 2.2, 2.1, 0xf4f1ff)
        // the dots light one a second, each fading in
        for (let i = 0; i < 3; i++) c.rect(42 + i * 5, 8 + dy, 3, 3, mix(0xd5d0ea, 0x6a5acd, ease((f - 8 * i - 5) / 3)))
      }
      break
    }

    case 'read': {
      // the eyes follow the highlighted line down the left page, then the right, then the page turns
      const line = Math.min(7, Math.floor(f / 5))
      b.look = [line < 4 ? 0.2 : 1.4, 0.4 + (line % 4) * 0.35]; b.glasses = true; b.right = 'hold'; b.mouth = 'flat'
      mid = () => {
        c.rect(31, 16, 27, 14, OUT)
        c.rect(32, 27, 25, 2, 0xc4664d)
        c.rect(32, 17, 12, 10, 0xfffaf0); c.rect(45, 17, 11, 10, 0xfffaf0)
        c.rect(44, 17, 1, 10, 0xd9cbb2); c.rect(43, 17, 1, 10, 0xece2cf)
        for (let i = 0; i < 4; i++) {
          for (const [x0, w0, k] of [[33, 9, 0], [46, 9, 1]] as const) {
            const len = 5 + Math.floor(rnd(i + k * 4, 0) * (w0 - 4))
            c.rect(x0, 18 + i * 2 + 1, len, 1, f < 40 && line === i + k * 4 ? 0x4d9bf0 : 0xa7adbf)
          }
        }
        const turn = f >= 41 && f <= 46 ? Math.floor((f - 41) / 2) : -1
        if (turn >= 0) {
          const x = [46, 43, 35][turn] ?? 46, w = turn === 1 ? 2 : 9, y = turn === 1 ? 10 : 14
          c.rect(x - 1, y - 1, w + 2, 27 - y + 1, OUT)
          c.rect(x, y, w, 27 - y, 0xfff3dd)
        }
      }
      break
    }

    case 'write':
    case 'bash': {
      const code: [number, number, number][][] = [
        [[0, 3, 0xff7aa2], [4, 5, 0x7cc7ff], [10, 2, 0xc9c9e6]],
        [[2, 4, 0x7ee0a1], [7, 6, 0xffd166]],
        [[2, 3, 0xff7aa2], [6, 7, 0x7cc7ff]],
        [[4, 8, 0xc9c9e6], [13, 2, 0xffd166]],
        [[0, 1, 0xc9c9e6]],
      ]
      if (state === 'write') {
        // types the snippet out over ~4 s, then rests with the cursor blinking
        const budget0 = Math.floor(f * 1.25)
        const typing = budget0 < 41
        b.right = typing ? 'type' : 'hold'
        mid = () => {
          c.rect(34, 6, 22, 18, OUT)
          c.rect(35, 7, 20, 16, 0x3b4252)
          c.rect(36, 8, 18, 14, 0x1e2230)
          let budget = budget0
          code.forEach((segs, row) => {
            for (const [x, w, col] of segs) {
              const shown = Math.max(0, Math.min(w, budget))
              budget -= w
              c.rect(37 + x, 10 + row * 2, shown, 1, col)
              if (shown > 0 && shown < w) c.rect(37 + x + shown, 9 + row * 2, 1, 2, 0xffffff)
            }
          })
          if (!typing && f % 8 < 4) c.rect(39, 17, 1, 2, 0xffffff)
          c.rect(31, 24, 28, 5, OUT)
          c.rect(32, 25, 26, 3, 0xc5ccd8)
          for (let x = 33; x < 57; x += 2) c.put(x, 26, 0x8f99aa)
          c.rect(36, 24, 18, 1, 0x8f99aa)
          if (typing) for (let i = 0; i < 3; i++) {
            const ph = (f + i * 5) % 16
            fx.rect(38 + i * 7, 5 - ph * 0.35, 2, 1, [0xff7aa2, 0x7ee0a1, 0x7cc7ff][i] ?? 0xffffff)
          }
        }
        b.look = [1, 0.2 + Math.min(4, Math.floor(budget0 / 9)) * 0.25]
      } else {
        // a line every second scrolls up; the prompt types between them
        const s = Math.floor(f / 8), inLine = f % 8
        const typed = Math.min(3, Math.floor(inLine / 2))
        b.look = [1, 0.6]; b.right = inLine < 6 ? 'type' : 'hold'
        mid = () => {
          c.rect(33, 2, 26, 22, OUT)
          c.rect(34, 3, 24, 3, 0x4c566a)
          c.put(36, 4, 0xff5f56); c.put(38, 4, 0xffbd2e); c.put(40, 4, 0x27c93f)
          c.rect(34, 6, 24, 17, 0x0d1117)
          for (let row = 0; row < 4; row++) {
            const k = (row + s) % 4
            const len = 6 + Math.floor(rnd(k, 3) * 14)
            c.rect(36, 8 + row * 3, len, 1, k % 3 === 0 ? 0x81c784 : 0x8b949e)
          }
          c.stamp(['#..', '.#.', '#..'], { '#': 0x81c784 }, 36, 19)
          c.rect(40, 20, typed * 2, 1, 0xe6edf3)
          if (f % 8 < 4) c.rect(40 + typed * 2, 19, 2, 3, 0xe6edf3)
          c.rect(31, 25, 24, 5, OUT)
          c.rect(32, 26, 22, 3, 0x9aa5b1)
          for (let x = 33; x < 53; x += 2) c.put(x, 27, 0x6b7584)
        }
      }
      break
    }

    case 'web': {
      b.look = [1, -1]; b.right = 'point'; b.mouth = 'o'
      mid = () => {
        const gx = 47, gy = 13, r = 8.5
        c.oval(gx, gy, r + 1, r + 1, OUT)
        c.oval(gx, gy, r, r, 0x3a86ff, (x, y) => {
          const nx = (x + 0.5 - gx) / r, ny = (y + 0.5 - gy) / r
          const lon = Math.asin(Math.max(-1, Math.min(1, nx / Math.sqrt(Math.max(0.0001, 1 - ny * ny))))) + (f * Math.PI) / 16
          const lat = Math.asin(ny)
          const land = Math.sin(lon * 2 + 1) * Math.cos(lat * 2.5) + Math.sin(lon * 3 + lat * 3) * 0.6 > 0.45
          if (land) c.put(x, y, nx > 0.55 ? 0x3a9e5c : 0x52d17c)
          return !land
        })
        c.oval(gx, gy, r, r, 0x2a64c8, (x, y) => c.at(x, y) === 0x3a86ff && (x + 0.5 - gx) / r > 0.55)
        c.rect(gx - 4, gy - 6, 2, 2, 0xd8ecff)
        c.rect(gx - 1, gy + 10, 2, 3, 0x9aa5b1)
        c.rect(gx - 5, gy + 13, 10, 2, 0x9aa5b1)
        const arcs = 1 + Math.min(2, Math.floor((f % 16) / 5))
        for (let k = 0; k < arcs; k++) {
          const rr = 3 + k * 2.5
          const col = k === arcs - 1 ? dim(0x4dd0e1) : 0x4dd0e1
          for (let a = -0.2; a <= Math.PI / 2 + 0.2; a += 0.08) fx.put(gx + 4 + rr * Math.cos(a - Math.PI / 2), gy - 6 + rr * Math.sin(a - Math.PI / 2), col)
        }
      }
      break
    }

    case 'test': {
      // a clipboard of checks ticking green one by one; the row being run pulses yellow
      const row = Math.min(4, Math.floor((f + 1) / 7))
      b.look = [1, -0.4 + Math.min(3, row) * 0.45]; b.glasses = true; b.right = 'hold'; b.mouth = row >= 4 ? 'smile' : 'flat'
      mid = () => {
        c.rect(34, 3, 23, 28, OUT)
        c.rect(35, 4, 21, 26, 0xc68a4f)
        c.rect(37, 7, 17, 21, 0xfffaf0)
        c.rect(41, 1, 9, 4, OUT)
        c.rect(42, 2, 7, 2, 0x9aa5b1)
        for (let i = 0; i < 4; i++) {
          const y = 8 + i * 5
          const done = i < row, now = i === row
          c.rect(38, y, 5, 5, OUT)
          c.rect(39, y + 1, 3, 3, done ? 0xd7f5df : now ? mix(0xfff3c4, 0xffd166, cyc(f, 4)) : 0xffffff)
          if (done) c.stamp(['..#', '#.#', '.#.'], { '#': 0x2e9e4f }, 39, y + 1)
          c.rect(44, y + 2, 5 + Math.floor(rnd(i, 1) * 5), 1, done ? 0x6b7584 : 0xa7adbf)
        }
        if (row >= 4) for (let k = 0; k < 3; k++) sparkle(fx, 36 + rnd(k, 9) * 20, 2 + rnd(9, k) * 6, (f + k) % 3 ? 1 : 2, k % 2 ? 0x7bd88f : 0xffffff)
      }
      break
    }

    case 'resumed': {
      // the answer lands: two little hops under a lighting bulb
      b.eyes = 'wide'; b.mouth = 'open'; b.left = 'up'; b.right = 'up'
      b.y = -2.5 * Math.sin((Math.PI * (f % 6)) / 6)
      b.flap = f % 4 < 2 ? 1 : 0
      mid = () => {
        const gx = 47, gy = 11
        const lit = ease(f / 4)
        c.oval(gx, gy, 7.2, 7.4, mix(0xd8dce6, 0xffe066, lit))
        c.oval(gx + 1.5, gy + 1.5, 5.5, 5.5, mix(0xb8bdca, 0xffd23f, lit), (x, y) => (x - gx) + (y - gy) > 3)
        c.oval(gx - 2.5, gy - 3, 1.4, 2.2, 0xfffbe0)
        c.line(gx - 2, gy + 2, gx - 1, gy + 4, 0xff9f1c); c.line(gx - 1, gy + 4, gx, gy + 2, 0xff9f1c)
        c.line(gx, gy + 2, gx + 1, gy + 4, 0xff9f1c)
        c.rect(gx - 4, gy + 7, 8, 6, OUT)
        c.rect(gx - 3, gy + 7, 6, 5, 0xb0b8c4)
        c.rect(gx - 3, gy + 8, 6, 1, 0x7f889a); c.rect(gx - 3, gy + 10, 6, 1, 0x7f889a)
        const len = f < 3 ? 0 : 1 + Math.min(2, Math.floor((f - 3) / 2))
        for (let k = 0; k < 8; k++) {
          if (k === 2) continue
          const a = (k * Math.PI) / 4 - Math.PI / 2
          for (let d = 0; d < len; d++) fx.put(gx + Math.cos(a) * (10 + d), gy + Math.sin(a) * (10 + d), 0xfff3b0)
        }
      }
      break
    }

    case 'ask': {
      b.eyes = 'wide'; b.look = [1, -1]; b.mouth = 'open'; b.right = 'wave'
      mid = () => {
        const dy = Math.round(cyc(f, 32))
        c.oval(47, 11 + dy, 10, 9.5, 0xfffaf0)
        c.tri(36.5, 13 + dy, 40, 17 + dy, 33, 21 + dy, 0xfffaf0)
        c.stamp(QUESTION, { '#': 0xff9f1c }, 42, 4 + dy, 2)
        const tw = f % 16
        if (tw >= 2 && tw <= 5) sparkle(fx, 57, 2, tw === 3 || tw === 4 ? 2 : 1, 0xffd166)
        if (tw >= 10 && tw <= 12) sparkle(fx, 36, 3, 1, 0xffd166)
      }
      break
    }

    case 'blocked': {
      b.eyes = 'squeeze'; b.mouth = 'frown'
      if (f < 8) b.x = [-1, 1, -1, 1, -0.6, 0.6, -0.3, 0][f] ?? 0
      const g = Math.max(0, f - 8)
      mid = () => {
        const gx = 47, gy = 13
        c.oval(gx, gy, 9, 9, OUT)
        c.oval(gx, gy, 8, 8, f < 8 ? 0xff4d5e : mix(0xd93a4b, 0xff4d5e, cyc(g, 16)))
        c.rect(gx - 6, gy - 1, 12, 3, 0xffffff)
        const fr = frameOf(b)
        const ph = (g + 10) % 16
        fx.oval(fr.cx + 10, fr.top + 3 + ph * 0.35, 1.2, 1.7, TEAR)
        fx.put(fr.cx + 9.6, fr.top + 2 + ph * 0.35, TEAR)
      }
      break
    }

    case 'error': {
      // a slow dizzy spin: half the usual phase rate
      b.eyes = 'dizzy'; b.mouth = 'flat'; b.phase = f / 2
      b.x = 0.8 * Math.sin((2 * Math.PI * f) / 32)
      mid = () => {
        c.tri(47, 3, 36, 22.5, 58, 22.5, OUT)
        c.tri(47, 5.5, 38, 21.5, 56, 21.5, mix(0xff9f43, 0xffc078, cyc(f, 32)))
        c.rect(46, 10, 2, 6, OUT); c.rect(46, 17, 2, 2, OUT)
        const fr = frameOf(b)
        for (let k = 0; k < 3; k++) {
          const a = (f * Math.PI) / 16 + (k * 2 * Math.PI) / 3
          star(fx, fr.cx + 11 * Math.cos(a), fr.top - 0.5 + 2.2 * Math.sin(a))
        }
      }
      break
    }

    case 'done': {
      if (f < 16) {
        // two hops, a squash on each landing, confetti drifting down
        const h = f % 8
        b.eyes = 'happy'; b.mouth = 'open'; b.left = 'up'; b.right = 'wave'
        b.y = -3 * Math.sin((Math.PI * h) / 8)
        b.squash = h === 0 ? 1 : 0
        b.flap = f % 4 < 2 ? 2 : 0
        front = () => {
          for (let i = 0; i < 16; i++) {
            const x = rnd(i, 7) * 60 + Math.sin((f + i) * 0.6) * 1.2, y = (rnd(i, 3) * 32 + f) % 32
            const col = CONFETTI[i % CONFETTI.length] ?? 0xffffff
            if ((i + Math.floor(f / 2)) % 2) fx.rect(x, y, 2, 1, col)
            else fx.rect(x, y, 1, 2, col)
          }
        }
      } else {
        b.eyes = 'happy'; b.mouth = 'smile'
        mid = () => {
          const gx = 46, gy = 15
          c.oval(gx, gy, 8, 8, 0x5cd67a)
          c.oval(gx + 1, gy + 1, 6.5, 6.5, 0x43bd62, (x, y) => (x - gx) + (y - gy) > 4)
          c.line(41, 15, 44, 18, 0xffffff, 2); c.line(44, 18, 50, 11, 0xffffff, 2)
          sparkle(fx, 56, 4, 2, 0xffffff); sparkle(fx, 36, 5, 1, 0xfff3b0)
        }
      }
      break
    }

    case 'failed': {
      // sinks down over a second, then holds
      b.eyes = 'sad'; b.mouth = 'frown'; b.squash = ease(Math.min(f, 7) / 7)
      mid = () => {
        const gx = 46, gy = 15
        c.oval(gx, gy, 8, 8, 0xff5c6c)
        c.oval(gx + 1, gy + 1, 6.5, 6.5, 0xe5485a, (x, y) => (x - gx) + (y - gy) > 4)
        c.line(42, 11, 49, 18, 0xffffff, 2); c.line(49, 11, 42, 18, 0xffffff, 2)
        const fr = frameOf(b)
        for (const [s, off] of [[-1, 0], [1, 3]] as const) {
          const ph = Math.min(f, 7 + off) - off
          if (ph >= 0) fx.rect(fr.cx + s * 5.5 + (s < 0 ? -3 : 2), fr.eyY + 3 + Math.min(ph, 4) * 0.8, 1, 2, TEAR)
        }
      }
      break
    }

    case 'sleep': {
      b.eyes = 'closed'; b.mouth = 'o'; b.hat = 'nightcap'
      b.squash = 0.2 + 0.9 * cyc(f, 32)
      front = () => {
        const fr = frameOf(b)
        const r = 0.9 + 2.2 * cyc(f, 32)
        fx.oval(fr.cx + 4.5, fr.eyY + 6.5 - r * 0.3, r, r, 0xbfe9ff)
        fx.put(fr.cx + 4 - r * 0.4, fr.eyY + 5.5 - r * 0.6, 0xffffff)
        for (let k = 0; k < 3; k++) {
          const p = ((f + k * 11) % 32) / 32
          const col = mix(0xc6b3ff, 0x2a2d3d, p * 0.9)
          fx.stamp(k === 0 ? Z4 : Z5, { '#': col }, Math.floor(35 + k * 7 + p * 4), Math.floor(21 - k * 7 - p * 5))
        }
      }
      break
    }
  }

  if (BREATHE.includes(state)) b.squash += 0.7 * cyc(f, 16)
  if (blink && (b.eyes === 'open' || b.eyes === 'wide')) b.eyes = 'closed'
  if (role === 'reviewer') b.glasses = true
  if (creature) {
    body(c, role, pal, b)
    mid()
    arm(c, role, pal, b, -1, b.left)
    arm(c, role, pal, b, 1, b.right)
    front()
  }
  c.outline(OUT)
  c.over(fx)
  // A soft shadow that shrinks as the creature leaves the ground.
  const out = new Canvas(BIG_W, BIG_H, BIG_S)
  const lift = Math.max(0, -b.y)
  out.oval(creature ? frameOf(b).cx : 16, 31.2, 11.5 - lift * 1.4, 1.6, SHADOW)
  out.over(c)
  return out
}

// ---------- the half-block fallback: 15x8, a small hand-made creature and the props as icons ----------

const SMALL_BODY: Record<Role, string[]> = {
  scout: [
    '.h....h.',
    '.hBBBBh.',
    'BFFBBFFB',
    'BFFBBFFB',
    'BBByyBBB',
    'WBccccBW',
    'WBccccBW',
    '..o..o..',
  ],
  reviewer: [
    '.h....h.',
    '.hBBBBh.',
    'BggBBggB',
    'BFFggFFB',
    'BBByyBBB',
    'WBccccBW',
    'WBccccBW',
    '..o..o..',
  ],
  coder: [
    'H......H',
    'wHBBBBHw',
    'wBBBBBBw',
    '.BBBBBB.',
    '.BBBBBB.',
    '.BccccBt',
    '.BccccBt',
    '..d..d..',
  ],
}

const ICON = {
  ask: ['.##.', '#..#', '..#.', '.#..', '....', '.#..'],
  bang: ['#', '#', '#', '.', '#'],
  check: ['....#', '...#.', '#.#..', '.#...'],
  cross: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  bulb: ['.###.', '#####', '#####', '.###.', '.###.'],
  globe: ['.###.', '#####', '#####', '#####', '.###.'],
  bubble: ['.#####.', '#######', '.#####.'],
  stop: ['.###.', '#####', '#...#', '#####', '.###.'],
  warn: ['..#..', '.###.', '.#.#.', '#####'],
  z: ['###', '..#', '.#.', '###'],
}
const LAND = ['01100011', '11110011', '01110001', '00110110', '00011100']

export function drawSmall({ role, opus, state, frame: big, blink }: Look): Canvas {
  // The icons keep their own short cycles at half the big frames' rate.
  const f = state === 'boot' ? (big < 7 ? Math.floor((big * 5) / 7) : big < 10 ? 5 : 7)
    : state === 'done' ? (big < 16 ? big >> 1 : 8)
    : big >> 1
  const p = new Canvas(SMALL_W, SMALL_H)
  const pal = palOf(role, opus)
  const theme = role === 'scout' ? 0x4fd1c5 : role === 'reviewer' ? 0xff8fb8 : opus ? 0xb59cff : 0xffb347
  const colors: Record<string, number> = {
    h: pal.horn, H: pal.horn, B: pal.body, F: pal.face, y: pal.beak, c: pal.belly, o: pal.beak,
    w: pal.wing, t: pal.body, d: pal.shade, g: OUT,
  }
  const celebrating = state === 'done' && f < 8
  const ox = state === 'blocked' && f < 2 ? f : 0
  const oy = celebrating && f % 4 >= 1 && f % 4 <= 3 ? -1 : 0

  if (state === 'boot' && f < 5) {
    // the egg, cracking
    p.stamp(['..##..', '.####.', '######', '######', '######', '.####.'], { '#': 0xfff6e6 }, 1 + (f === 1 ? -1 : f === 3 ? 1 : 0), 1)
    p.put(2, 3, pal.body); p.put(5, 5, pal.body)
    if (f >= 2) for (let x = 1; x < 1 + (f - 1) * 2 && x < 7; x++) p.put(x, 3 + (x % 2), OUT)
    if (f >= 2) p.put(9 + (f * 3) % 5, (f * 5) % 7, 0xffffff)
    return p
  }

  p.stamp(SMALL_BODY[role], colors, ox, oy)
  if (opus) { p.put(ox + 3, oy, 0xffd447); p.put(ox + 4, oy, 0xffd447) }
  if (state === 'sleep') { p.put(ox + 2, oy, 0x6c7bff); p.put(ox + 3, oy, 0x6c7bff); p.put(ox + 4, oy, 0x6c7bff); p.put(ox + 5, oy, 0xf4f1ff) }
  if (state === 'boot') { p.put(ox + 2, oy, 0xfff6e6); p.put(ox + 3, oy, 0xfff6e6); p.put(ox + 4, oy, 0xfff6e6); p.put(ox + 5, oy, 0xfff6e6) }

  // eyes: one dark pixel each, a lid line when shut
  const eyeRow = oy + 3
  const shut = blink || state === 'sleep' || state === 'blocked' || (state === 'done') || (state === 'boot' && f === 7)
  const up = state === 'think' || state === 'ask' || state === 'web' || state === 'resumed'
  const dx = state === 'read' || state === 'write' || state === 'bash' || state === 'test' ? 1 : 0
  for (const x of [2, 5]) {
    if (state === 'error') p.put(ox + x, eyeRow, f % 2 ? 0xff8a65 : EYE)
    else if (shut) { p.put(ox + x - 1, eyeRow, EYE); p.put(ox + x, eyeRow, EYE) }
    else p.put(ox + x + (x === 2 ? dx : 0) - (x === 5 && dx ? 0 : 0), eyeRow - (up ? 1 : 0), EYE)
    if (state === 'failed') p.put(ox + x, eyeRow + 1 + (f % 2), TEAR)
  }
  if (state !== 'failed' && role === 'coder') { p.put(ox + 1, oy + 4, BLUSH); p.put(ox + 6, oy + 4, BLUSH) }
  if (role === 'coder' && (state === 'done' || state === 'ask' || state === 'resumed')) { p.put(ox + 3, oy + 4, EYE); p.put(ox + 4, oy + 4, EYE) }

  const limb = owl(role) ? pal.wing : pal.shade
  const armUp = (x: number) => { p.put(ox + x, oy + 2, limb); p.put(ox + x, oy + 3, limb) }
  const armDown = (x: number) => { p.put(ox + x, oy + 5, limb); p.put(ox + x, oy + 6, limb) }
  armDown(0)

  switch (state) {
    case 'write':
    case 'bash': {
      p.put(7, 5 - (f % 2), limb)
      if (state === 'bash') {
        for (let y = 0; y < 6; y++) for (let x = 9; x < 15; x++) p.put(x, y, y === 0 ? 0x4c566a : 0x0d1117)
        p.put(10, 2, 0x81c784); p.put(11, 3, 0x81c784); p.put(10, 4, 0x81c784)
        if (f % 2 === 0) p.put(13, 4, 0xe6edf3)
        for (let x = 9; x < 14; x++) p.put(x, 7, 0x9aa5b1)
      } else {
        for (let y = 1; y < 6; y++) for (let x = 9; x < 15; x++) p.put(x, y, y === 1 || x === 9 || x === 14 ? 0x3b4252 : 0x1e2230)
        for (let i = 0; i < 3; i++) p.put(10 + i, 2 + i, [0xff7aa2, 0x7ee0a1, 0x7cc7ff][(i + f) % 3] ?? theme)
        for (let x = 8; x < 15; x++) p.put(x, 6, 0xc5ccd8)
        p.put(10 + (f % 4), 0, theme)
      }
      break
    }
    case 'read':
      p.put(7, 5, limb)
      for (let y = 3; y <= 7; y++) for (let x = 8; x <= 14; x++) p.put(x, y, x === 11 ? 0xd9cbb2 : 0xfffaf0)
      for (const y of [4, 6]) {
        const hot = Math.floor(f / 4) % 2
        p.put(9, y, hot && y === 4 ? 0x4d9bf0 : 0xa7adbf); p.put(12, y, 0xa7adbf); p.put(13, y, y === 6 && !hot ? 0x4d9bf0 : 0xa7adbf)
      }
      break
    case 'test':
      p.put(7, 5, limb)
      for (let y = 1; y < 8; y++) for (let x = 9; x < 15; x++) p.put(x, y, x === 9 || x === 14 || y === 1 || y === 7 ? 0xc68a4f : 0xfffaf0)
      p.put(11, 0, 0x9aa5b1); p.put(12, 0, 0x9aa5b1)
      for (let i = 0; i < 3; i++) {
        const y = 2 + i * 2
        p.put(10, y, f % 4 > i ? 0x43bd62 : f % 4 === i ? 0xffd166 : 0xa7adbf)
        p.put(11, y, 0xa7adbf); p.put(12, y, 0xa7adbf)
      }
      break
    case 'web':
      armUp(7)
      ICON.globe.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === '#') {
          const land = LAND[y]?.[(x + f) % 8] === '1'
          p.put(9 + x, 1 + y, land ? 0x52d17c : 0x3a86ff)
        }
      })
      p.put(f % 4 < 2 ? 14 : 13, 0, 0x4dd0e1)
      break
    case 'ask':
      if (f % 4 < 2) armUp(7); else { p.put(7, 1, limb); p.put(7, 2, limb) }
      p.stamp(ICON.ask, { '#': 0xffd166 }, 10, f % 4 < 2 ? 0 : 1)
      break
    case 'resumed':
      armUp(7); armUp(0)
      p.stamp(ICON.bulb.slice(0, 3), { '#': 0xffe066 }, 10, 0)
      p.stamp(ICON.bulb.slice(3), { '#': 0x9aa5b1 }, 10, 3)
      if (f % 2) { p.put(9, 0, 0xfff3b0); p.put(14, 1, 0xfff3b0); p.put(9, 2, 0xfff3b0) }
      break
    case 'blocked':
      armDown(7)
      p.stamp(ICON.stop, { '#': f < 2 || f % 4 < 2 ? 0xff4d5e : 0xd93a4b }, 10, 1)
      p.put(12, 3, 0xffffff); p.put(11, 3, 0xffffff); p.put(13, 3, 0xffffff)
      p.put(ox + 7, 1 + (f % 3), TEAR)
      break
    case 'error':
      armDown(7)
      p.stamp(ICON.warn, { '#': 0xff9f43 }, 10, 2)
      p.put(12, 3, OUT)
      p.put(ox + 1 + (f % 6), 0, 0xffe066)
      break
    case 'done':
      if (celebrating) {
        armUp(0); armUp(7)
        for (let i = 0; i < 10; i++) {
          const x = Math.floor(rnd(i, 7) * 15), y = Math.floor((rnd(i, 3) * 8 + f) % 8)
          if (p.at(x, y) === CLEAR) p.put(x, y, CONFETTI[i % CONFETTI.length] ?? 0xffffff)
        }
      } else {
        armDown(7)
        p.stamp(ICON.check, { '#': 0x7bd88f }, 10, 2)
        if (f % 16 < 2) p.put(14, 0, 0xffffff)
      }
      break
    case 'failed':
      armDown(7)
      p.stamp(ICON.cross, { '#': 0xff5c6c }, 10, 1)
      break
    case 'sleep': {
      armDown(7)
      p.stamp(ICON.z, { '#': 0xb39ddb }, 9, 4)
      if (f % 8 >= 3) p.stamp(ICON.z, { '#': 0x8f7fbf }, 12, 0)
      break
    }
    case 'boot':
      armUp(0); armUp(7)
      p.put(10, 6, 0xfff6e6); p.put(11, 7, 0xfff6e6); p.put(12, 7, 0xfff6e6)
      p.put(9 + (f % 3) * 2, 1, 0xffffff)
      break
    default: {
      // think: paw at the chin, a thought bubble filling dot by dot
      p.put(6, 4, limb)
      p.put(8, 3, 0xe6e6f0)
      p.stamp(ICON.bubble, { '#': 0xf4f1ff }, 8, 0)
      const lit = Math.floor(f / 4)
      for (let i = 0; i < 3; i++) p.put(9 + i * 2, 1, i < lit ? 0x6a5acd : 0xc8c8d8)
    }
  }
  return p
}

// Frames are pure in their Look, so each is drawn once; a long session sees a few hundred.
const BIG = new Map<string, Canvas>()
const SMALL = new Map<string, Canvas>()
const cached = <T>(m: Map<string, T>, key: string, make: () => T): T => {
  const hit = m.get(key)
  if (hit) return hit
  if (m.size > 800) m.clear()
  const v = make()
  m.set(key, v)
  return v
}
export const bigSprite = (l: Look) => cached(BIG, lookKey(l), () => drawLook(l))
export const smallSprite = (l: Look) => cached(SMALL, lookKey(l), () => drawSmall(l))

// Every distinct frame is a small PNG under frames/ (made by tools/gen_frames.sh); the terminal reads the
// file itself and a source equal to the last one sends nothing, so a blit carries only a path.
export const frameFile = (l: Look) => `${l.role}${l.opus ? '_opus' : ''}-${l.state}-${l.frame}${l.blink ? 'b' : ''}.png`
export const imageSource = (l: Look, root: string) => ({ file: `${root}/frames/${frameFile(l)}`, format: 'png' as const })

export const ALL_POSES: Pose[] = [
  'boot', 'resumed', 'think', 'read', 'write', 'bash', 'web', 'test', 'blocked', 'error', 'ask', 'done', 'failed', 'sleep',
]
