import { expect, test } from 'claude-code/testing'

import {
  ALL_POSES, BIG_H, BIG_W, CLEAR, bigSprite, frameCount, imageSource, lookAt, lookKey, smallSprite, SMALL_H, SMALL_W,
} from '../hooks/creatures'
import { msysToWin, buildWorkers, DETAILS, drawScene, layout, runState, sceneRows, sceneSvg, type Meta, type Run } from '../hooks/scene'

const T0 = 1_791_562_000
const meta = (over: Partial<Meta> = {}): Meta => ({
  role: 'scout', model: 'haiku', session: 's', resume: '', task: 'Find callers', start: T0, tmo: 1200, web: false, pid: 1, ...over,
})

test('a question parks the worker and a resume continues the same one', async () => {
  const asked: Run = {
    id: 'a', meta: meta(), rc: 0, question: 'snake_case or camelCase?',
    events: [
      { e: 'init', t: T0 * 1000 + 100 },
      { e: 'tool', tool: 'Bash', arg: 'rg -n speed src', t: T0 * 1000 + 500 },
      { e: 'result', ok: true, sid: 'sid-1', turns: 3, out: 50, t: T0 * 1000 + 900 },
    ],
  }
  const now = T0 * 1000 + 5000
  const [w] = buildWorkers([asked], now)
  expect(w?.state).toBe('ask')
  expect(w?.question).toBe('snake_case or camelCase?')

  const resumed: Run = {
    id: 'b', meta: meta({ resume: 'sid-1', start: T0 + 10, task: 'ANSWER: snake_case' }),
    events: [{ e: 'init', t: (T0 + 10) * 1000 + 50 }, { e: 'tool', tool: 'Edit', arg: 'src/player.gd', t: (T0 + 10) * 1000 + 200 }],
  }
  const later = buildWorkers([resumed, asked], (T0 + 12) * 1000)
  expect(later.length).toBe(1)
  expect(later[0]?.name).toBe(w?.name)
  expect(later[0]?.task).toBe('Find callers')
  expect(later[0]?.resumed).toBe(true)
  expect(later[0]?.state).toBe('write')
  expect(later[0]?.trail).toEqual(['read', 'write'])
})

test('a permission denial shows as blocked, then fades to thinking', async () => {
  const run: Run = {
    id: 'c', meta: meta({ role: 'coder', model: 'sonnet' }),
    events: [
      { e: 'init', t: T0 * 1000 + 100 },
      { e: 'tool', tool: 'Bash', arg: 'rm -rf build', t: T0 * 1000 + 1000 },
      { e: 'denied', t: T0 * 1000 + 1100 },
      { e: 'text', t: T0 * 1000 + 1200 },
    ],
  }
  expect(runState(run, T0 * 1000 + 2000).state).toBe('blocked')
  expect(runState(run, T0 * 1000 + 9000).state).toBe('think')
  expect(runState(run, T0 * 1000 + 9000).blocked).toBe(1)
})

test('a resume that replays the old result first keeps working', async () => {
  const run: Run = {
    id: 'r', meta: meta({ resume: 'sid-1', tmo: 7200 }),
    events: [
      { e: 'init', sid: 'sid-1', t: T0 * 1000 + 100 },
      { e: 'result', ok: true, sub: 'success', sid: 'sid-1', turns: 0, t: T0 * 1000 + 101 },
      { e: 'init', sid: 'sid-1', t: T0 * 1000 + 110 },
      { e: 'tool', tool: 'Bash', arg: 'ls', t: T0 * 1000 + 3000 },
    ],
  }
  const view = runState(run, T0 * 1000 + 600_000)
  expect(view.end).toBe(undefined)
  expect(view.state).toBe('read')
})

test('a run that died without a result is failed', async () => {
  const run: Run = { id: 'd', meta: meta({ tmo: 10 }), events: [{ e: 'init', t: T0 * 1000 }] }
  expect(runState(run, (T0 + 100) * 1000).state).toBe('failed')
  expect(runState({ ...run, rc: 142 }, (T0 + 5) * 1000).state).toBe('failed')
})

test('the scene fills exactly cols x rows cells of printable glyphs', async () => {
  const runs: Run[] = ['scout', 'coder', 'coder'].map((role, i) => ({
    id: `r${i}`, meta: meta({ role: role as Meta['role'], start: T0 + i }), events: [{ e: 'think', t: T0 * 1000 + 50 }],
  }))
  const ws = buildWorkers(runs, T0 * 1000 + 4000)
  for (const cols of [40, 60, 100]) {
    for (const list of [ws, []]) {
      const { rows, words } = drawScene(list, cols, T0 * 1000 + 4000)
      expect(rows).toBe(sceneRows(list.length, cols))
      expect(words.length).toBe(cols * rows * 3)
      for (let i = 0; i < words.length; i += 3) expect((words[i] ?? 0) >= 0x20).toBe(true)
    }
  }
})

test('an overflowing crew fits the pane: cards, then one-line rows, then a +N row', async () => {
  const runs: Run[] = Array.from({ length: 9 }, (_, i) => ({
    id: `o${i}`, meta: meta({ start: T0 + i }), events: [{ e: 'think', t: T0 * 1000 + 50 }],
    ...(i < 4 ? { rc: 0 } : {}),
  }))
  const now = T0 * 1000 + 4000
  const ws = buildWorkers(runs, now)
  expect(layout(9, 60, 256)).toEqual({ rows: 2 + 9 * 6, cards: 9, lines: 0, more: 0 })
  expect(layout(9, 60, 20)).toEqual({ rows: 16, cards: 1, lines: 8, more: 0 })
  expect(layout(9, 60, 6)).toEqual({ rows: 6, cards: 0, lines: 3, more: 6 })
  for (const maxRows of [3, 6, 12, 20, 40]) {
    const { rows, words } = drawScene(ws, 60, now, maxRows)
    expect(rows <= maxRows).toBe(true)
    expect(words.length).toBe(60 * rows * 3)
  }
})

test('two resumes of one sid, the first killed before its result, stay one worker', async () => {
  const first: Run = {
    id: 'k1', meta: meta({ role: 'coder' }), rc: 0,
    events: [{ e: 'init', t: T0 * 1000 + 100 }, { e: 'result', ok: true, sid: 'sid-k', turns: 5, out: 10, t: T0 * 1000 + 900 }],
  }
  const killed: Run = {
    id: 'k2', meta: meta({ role: 'coder', resume: 'sid-k', start: T0 + 10 }), rc: 143,
    events: [{ e: 'init', t: (T0 + 10) * 1000 + 100 }, { e: 'error', t: (T0 + 20) * 1000 }],
  }
  const again: Run = {
    id: 'k3', meta: meta({ role: 'coder', resume: 'sid-k', start: T0 + 30 }), rc: 0,
    events: [{ e: 'init', t: (T0 + 30) * 1000 + 100 }, { e: 'result', ok: true, sid: 'sid-k', turns: 2, out: 5, t: (T0 + 40) * 1000 }],
  }
  const ws = buildWorkers([first, killed, again], (T0 + 50) * 1000)
  expect(ws.length).toBe(1)
  expect(ws[0]?.state).toBe('done')
  expect(new Set(ws.map(w => w.key)).size).toBe(ws.length)
})

test('a timed-out run chains its resume through the init sid; a renamed resume shows its own name, task and clock', async () => {
  const timedOut: Run = {
    id: 't1', meta: meta({ role: 'coder', name: 'camera_assist', task: 'Camera assist' }), rc: 142,
    events: [{ e: 'init', sid: 'sid-t', t: T0 * 1000 + 100 }, { e: 'tool', tool: 'Edit', arg: 'src/main.gd', t: T0 * 1000 + 500 }],
  }
  const finish: Run = {
    id: 't2', meta: meta({ role: 'coder', name: 'camera_assist', resume: 'sid-t', start: T0 + 100, task: 'You hit the time limit' }), rc: 0,
    events: [{ e: 'init', sid: 'sid-t', t: (T0 + 100) * 1000 + 50 }, { e: 'result', ok: true, sid: 'sid-t', turns: 3, out: 5, t: (T0 + 200) * 1000 }],
  }
  const fix: Run = {
    id: 't3', meta: meta({ role: 'coder', name: 'camera_fix', resume: 'sid-t', start: T0 + 300, task: 'Playtest fixes' }),
    events: [{ e: 'init', sid: 'sid-t', t: (T0 + 300) * 1000 + 50 }],
  }
  const now = (T0 + 360) * 1000
  const ws = buildWorkers([timedOut, finish, fix], now)
  expect(ws.length).toBe(1)
  expect(ws[0]?.name).toBe('camera_fix')
  expect(ws[0]?.task).toBe('Playtest fixes')
  expect(ws[0]?.start).toBe((T0 + 300) * 1000)
  expect(ws[0]?.resumed).toBe(true)
  const [plain] = buildWorkers([timedOut, finish], now)
  expect(plain?.name).toBe('camera_assist')
  expect(plain?.task).toBe('Camera assist')
})

test('each card gets a details button spot on its bottom edge, inside the card', async () => {
  const runs: Run[] = ['x', 'y'].map((id, i) => ({
    id, meta: meta({ role: 'coder', name: id, start: T0 + i }), events: [{ e: 'init', t: (T0 + i) * 1000 }],
  }))
  const now = (T0 + 5) * 1000
  const ws = buildWorkers(runs, now)
  expect(ws.map(w => w.runIds)).toEqual([['x'], ['y']])
  const cols = 100
  const { hits, rows } = drawScene(ws, cols, now)
  expect(hits.map(h => h.key)).toEqual(ws.map(w => w.key))
  for (const h of hits) {
    expect(h.y).toBeLessThan(rows)
    expect(h.x + DETAILS.length).toBeLessThan(cols)
  }
})

test('a turn-limited run that cw auto-continues is never shown as failed', async () => {
  const seg: Run = {
    id: 'm1', meta: meta({ role: 'coder', model: 'sonnet' }),
    events: [
      { e: 'tool', tool: 'Write', arg: 'a.txt', t: T0 * 1000 + 300 },
      { e: 'result', ok: false, sub: 'error_max_turns', sid: 'sid-m', turns: 3, out: 9, t: T0 * 1000 + 900 },
    ],
  }
  const [w] = buildWorkers([seg], T0 * 1000 + 1500)
  expect(w?.state === 'failed').toBe(false)
  const cont: Run = { id: 'm2', meta: meta({ role: 'coder', model: 'sonnet', resume: 'sid-m', start: T0 + 2 }), events: [] }
  const both = buildWorkers([cont, seg], (T0 + 2) * 1000 + 500)
  expect(both.length).toBe(1)
  expect(both[0]?.name).toBe(w?.name)
  // without auto-continue cw writes .done (rc 1): then it is failed
  const [stopped] = buildWorkers([{ ...seg, rc: 1, doneAt: T0 * 1000 + 950 }], T0 * 1000 + 1500)
  expect(stopped?.state).toBe('failed')
})

test('every role, model and state has a drawn sprite at both sizes in every frame', async () => {
  for (const [role, opus] of [['scout', false], ['coder', false], ['coder', true]] as const) {
    for (const state of ALL_POSES) {
      for (let frame = 0; frame < frameCount(state); frame++) {
        const look = { role, opus, state, frame, blink: false }
        const big = bigSprite(look), small = smallSprite(look)
        expect([big.w, big.h, small.w, small.h]).toEqual([BIG_W, BIG_H, SMALL_W, SMALL_H])
        expect(big.px.filter(c => c !== CLEAR).length > 300).toBe(true)
        expect(small.px.filter(c => c !== CLEAR).length > 20).toBe(true)
      }
    }
  }
  const src = imageSource({ role: 'coder', opus: true, state: 'done', frame: 3, blink: false }, '/mod')
  expect(src).toEqual({ file: '/mod/frames/coder_opus-done-3.png', format: 'png' })
})

test('finished workers hold still after their intro', () => {
  for (const state of ['done', 'failed'] as const) {
    const keys = new Set<string>()
    for (let t = 0; t < 20_000; t += 250) keys.add(lookKey(lookAt('scout', 'haiku', state, 1_000_000 + t, 0, 3)))
    expect(keys.size).toBe(1)
  }
})

test('frames loop on the clock, a state change restarts its intro, Opus shows in the key', async () => {
  const at = T0 * 1000
  expect(lookAt('coder', 'sonnet', 'boot', at + 50, at, 0).frame).toBe(0)
  expect(lookAt('coder', 'sonnet', 'boot', at + 5000, at, 0).frame).toBe(11)
  expect(lookAt('coder', 'sonnet', 'done', at + 200, at, 0).frame < 16).toBe(true)
  expect(lookAt('coder', 'sonnet', 'done', at + 9000, at, 0).frame).toBe(16)
  expect(lookKey(lookAt('coder', 'opus', 'think', at, at, 0))).not.toBe(lookKey(lookAt('coder', 'sonnet', 'think', at, at, 0)))
  const keys = new Set(Array.from({ length: 16 }, (_, i) => lookKey(lookAt('scout', 'haiku', 'read', at + i * 250, at, 3))))
  expect(keys.size >= 15).toBe(true)
})

test('in image mode each card leaves its sprite cells blank and lists one Image spot', async () => {
  const runs: Run[] = ['scout', 'coder', 'coder'].map((role, i) => ({
    id: `i${i}`, meta: meta({ role: role as Meta['role'], start: T0 + i }), events: [{ e: 'think', t: T0 * 1000 + 50 }],
  }))
  const now = T0 * 1000 + 4000
  const ws = buildWorkers(runs, now)
  const cells = drawScene(ws, 140, now)
  const pics = drawScene(ws, 140, now, undefined, true)
  expect(cells.spots.length).toBe(0)
  expect(pics.rows).toBe(cells.rows)
  expect(pics.spots.map(s => s.key)).toEqual(['s0', 's1', 's2'])
  for (const s of pics.spots) {
    for (let y = s.y; y < s.y + 4; y++) for (let x = s.x; x < s.x + 15; x++) {
      expect(pics.words[(y * 140 + x) * 3]).toBe(0x20)
    }
  }
  expect(drawScene([], 60, now, undefined, true).spots.length).toBe(2)
})

test('the acceptance run after the result shows as testing, then done or failed', async () => {
  const base = { id: 't', meta: meta({ role: 'coder', model: 'sonnet' }) }
  const evs = [
    { e: 'init', t: T0 * 1000 + 100 },
    { e: 'result', ok: true, sid: 'sid-t', turns: 9, out: 10, t: T0 * 1000 + 900 },
    { e: 'accept', t: T0 * 1000 + 1000 },
  ]
  const testing = runState({ ...base, events: evs }, T0 * 1000 + 60_000)
  expect(testing.state).toBe('test')
  expect(testing.end).toBe(undefined)
  const passed = runState({ ...base, rc: 0, events: [...evs, { e: 'accept_end', ok: true, t: T0 * 1000 + 90_000 }] }, T0 * 1000 + 91_000)
  expect(passed.state).toBe('done')
  expect(passed.end).toBe(T0 * 1000 + 90_000)
  const failed = runState({ ...base, rc: 0, events: [...evs, { e: 'accept_end', ok: false, t: T0 * 1000 + 90_000 }] }, T0 * 1000 + 91_000)
  expect(failed.state).toBe('failed')
  expect(frameCount('test')).toBe(32)
})

test('motion is gentle: a loop frame moves few pixels from the one before it', async () => {
  for (const state of ['think', 'read', 'write', 'bash', 'web', 'test', 'ask', 'sleep'] as const) {
    let worst = 0
    for (let frame = 1; frame < frameCount(state); frame++) {
      const a = bigSprite({ role: 'coder', opus: false, state, frame: frame - 1, blink: false }).px
      const b = bigSprite({ role: 'coder', opus: false, state, frame, blink: false }).px
      let n = 0
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
      worst = Math.max(worst, n)
    }
    // the old 4 fps loops changed up to ~25% of a frame per step
    expect(worst < bigSprite({ role: 'coder', opus: false, state, frame: 0, blink: false }).px.length * 0.14).toBe(true)
  }
})

test('a card shows the activity strip, the quiet warning and a budget bar', async () => {
  const run: Run = {
    id: 'q', meta: meta({ tmo: 100 }),
    events: [{ e: 'init', t: T0 * 1000 + 100 }, { e: 'tool', tool: 'Read', arg: 'src/a.gd', t: T0 * 1000 + 2000 }, { e: 'text', t: T0 * 1000 + 3000 }],
  }
  const now = T0 * 1000 + 80_000
  const ws = buildWorkers([run], now)
  expect(ws[0]?.lastAt).toBe(T0 * 1000 + 3000)
  const { words } = drawScene(ws, 60, now)
  const text = String.fromCodePoint(...Array.from({ length: words.length / 3 }, (_, i) => words[i * 3] ?? 32))
  expect(text.includes('sessiz')).toBe(true)
  expect(text.includes('▃') || text.includes('▂')).toBe(true)
  // 80 s of a 100 s budget: the bar is amber
  const B = 2 + 5, fg = (x: number) => words[(B * 60 + x) * 3 + 1]
  expect(fg(2)).toBe(0xffb347)
})

test('sceneSvg turns half-blocks into rects and text into text', () => {
  const D = 0x01000000
  const words = Uint32Array.of(0x2580, 0xff0000, 0x00ff00, 0x41, D, D, 0x3c, 0x0000ff, D)
  const svg = sceneSvg(words, 3, 1)
  expect(svg).toContain('<path fill="#ff0000" d="M0 0h6v6h-6z"/>')
  expect(svg).toContain('<path fill="#00ff00" d="M0 6h6v6h-6z"/>')
  expect(svg).toContain('>A</text>')
  expect(svg).toContain('>&lt;</text>')
})

test('sceneSvg never puts a space in a text run, so no surface can stretch one', () => {
  const D = 0x01000000, c = 0x4fd1c5
  // Same colour on both sides of a gap: one run would span it.
  const words = Uint32Array.of(0x2503, c, D, 0x20, D, D, 0x20, D, D, 0x64, c, D)
  const svg = sceneSvg(words, 4, 1)
  expect(svg).toContain('textLength="6" lengthAdjust="spacingAndGlyphs">┃</text>')
  expect(svg).toContain('x="18" y="9.5" fill="#4fd1c5" textLength="6" lengthAdjust="spacingAndGlyphs">d</text>')
  expect(/<text[^>]*>[^<]* [^<]*<\/text>/.test(svg)).toBe(false)
})

test('msysToWin maps /c/... to C:/... and leaves other paths alone', () => {
  expect(msysToWin('/c/Users/x/.claude/cw-runs')).toBe('C:/Users/x/.claude/cw-runs')
  expect(msysToWin('/d')).toBe('D:')
  for (const p of ['/Users/x', '/home/x', 'C:/Users/x', '/runs', '']) expect(msysToWin(p)).toBe(p)
})
