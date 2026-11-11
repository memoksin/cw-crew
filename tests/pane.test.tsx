import { expect, mock, test } from 'claude-code/testing'

const DIR = '/runs'
const NOW = 1_791_800_000_000
const meta = (name: string) => JSON.stringify({
  role: 'coder', model: 'claude-sonnet-5-5', session: 's', resume: '', task: `Task of ${name}`,
  start: NOW / 1000 - 30, tmo: 3600, web: false, pid: 1, name,
})
const FILES: Record<string, string> = {
  'a.meta': meta('alpha'),
  'a.events': '{"e":"init","sid":"sid-a","t":1791799971000}\n{"e":"tool","tool":"Bash","arg":"tests/run.sh x","t":1791799975000}\n',
  'a.jsonl': '{"type":"assistant","message":{"content":[{"type":"text","text":"Running the tests now."}]}}\n',
}

// fs.stat over a test's files; a missing one is denied like a missing path.
const statOf = (files: Record<string, string>, mtime: (name: string) => number = () => NOW - 1000) => async (_$: unknown, e: { path: string }) => {
  const name = e.path.slice(e.path.lastIndexOf('/') + 1)
  return (name in files ? { value: { kind: 'file', size: files[name]!.length, mtimeMs: mtime(name), isLink: false } } : { deny: `no ${name}` }) as never
}

test('first sight announces recent completions and failed tests, but not old runs', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CW_LOG_DIR: DIR, HOME: '/h' })
  const files: Record<string, string> = {}
  for (const [id, name, age, failed] of [['a', 'recent', 1000, false], ['b', 'old', 20_000, false], ['c', 'tested', 1000, true]] as const) {
    files[`${id}.meta`] = meta(name)
    files[`${id}.done`] = '0'
    files[`${id}.events`] = JSON.stringify({ e: 'result', ok: true, t: NOW - age }) + '\n'
      + (failed ? JSON.stringify({ e: 'accept_end', ok: false, rc: 1, t: NOW - age }) + '\n' : '')
  }
  on('fs.list', async () => ({ value: Object.entries(files).map(([name, text]) => ({ name, kind: 'file', size: text.length, mtimeMs: NOW - 1000 })) }) as never)
  on('fs.stat', statOf(files))
  on('fs.read', async (_$, e) => {
    const name = e.path.slice(DIR.length + 1)
    return name in files ? { value: files[name] } as never : { deny: `no ${name}` } as never
  })
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('session.id', async () => ({ value: 's' }) as never)
  on('session.start', async (_$, e) => e as never)
  for (const ev of ['command.register', 'ui.status', 'ui.log', 'ui.blit'] as const) on(ev, async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(500)
  expect(toasts).toEqual(['✓ recent (coder) done', '✗ tested (coder) failed its test'])
  await clock.advance(500)
  expect(toasts.length).toBe(2)
})

for (const surface of ['terminal', 'desktop'] as const) test(`${surface}: the crew pane draws cards with a details button, opens the detail view and goes back`, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CW_LOG_DIR: DIR, HOME: '/h' })
  on('fs.list', async () => ({ value: Object.entries(FILES).map(([name, text]) => ({ name, kind: 'file', size: text.length, mtimeMs: NOW - 1000 })) }) as never)
  on('fs.stat', statOf(FILES))
  on('fs.read', async (_$, e) => {
    if (e.path.includes('/frames/')) return { value: { base64: 'UE5H' } } as never
    const name = e.path.slice(DIR.length + 1)
    if (!(name in FILES)) return { deny: `no ${name}` } as never
    return { value: FILES[name] } as never
  })
  on('session.id', async () => ({ value: 's' }) as never)
  on('session.start', async (_$, e) => e as never)
  for (const ev of ['command.register', 'ui.status', 'ui.toast', 'ui.log'] as const) on(ev, async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.blit', async () => ({ value: {} }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(500)
  const ui = await $.ui.mount({
    plugin: 'cw-crew', surface, component: 'Pane', requestId: 'cw-crew',
    props: { title: 'Crew', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  await ui.drawn()
  expect(await ui.find({ key: 'open-a' })).toBeDefined()
  if (surface === 'desktop') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('href="data:image/png;base64,UE5H"')
  await ui.press({ key: 'open-a' })
  await clock.advance(500)
  expect(await ui.find({ type: 'Text', text: /Running the tests now/ })).toBeDefined()
  await ui.press({ key: 'tab-steps' })
  expect(await ui.find({ type: 'Text', text: /tests\/run\.sh x/ })).toBeDefined()
  expect(await ui.find({ key: 'copy' })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'open-a' })).toBeDefined()
})

test('windows: with only USERPROFILE set the pane reads runs from ~/.claude/cw-runs', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:\\Users\\x' })
  const listed: string[] = []
  on('fs.list', async (_$, e) => {
    listed.push(e.path)
    return { value: Object.entries(FILES).map(([name, text]) => ({ name, kind: 'file', size: text.length, mtimeMs: NOW - 1000 })) } as never
  })
  on('fs.stat', statOf(FILES))
  on('fs.read', async (_$, e) => {
    if (e.path.includes('/frames/')) return { value: { base64: 'UE5H' } } as never
    const name = e.path.slice(e.path.lastIndexOf('/') + 1)
    if (!(name in FILES) || !e.path.includes('C:/Users/x/.claude/cw-runs/')) return { deny: `no ${e.path}` } as never
    return { value: FILES[name] } as never
  })
  on('session.id', async () => ({ value: 's' }) as never)
  on('session.start', async (_$, e) => e as never)
  for (const ev of ['command.register', 'ui.status', 'ui.toast', 'ui.log'] as const) on(ev, async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.blit', async () => ({ value: {} }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(500)
  // A non-Windows host resolves C:/ as relative to the cwd, so match the tail.
  expect(listed[0]?.endsWith('C:/Users/x/.claude/cw-runs')).toBe(true)
  const ui = await $.ui.mount({
    plugin: 'cw-crew', surface: 'terminal', component: 'Pane', requestId: 'cw-crew',
    props: { title: 'Crew', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  await ui.drawn()
  expect(await ui.find({ key: 'open-a' })).toBeDefined()
})

test('a request the lead closed (cwopen -x renames .ask) lowers the hand', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CW_LOG_DIR: DIR, HOME: '/h' })
  const files: Record<string, string> = {
    ...FILES, 'a.done': '0', 'a.ask': 'PERMISSION: Bash(rm x)',
    'a.events': `${FILES['a.events']}{"e":"result","ok":true,"sub":"success","sid":"sid-a","turns":2,"denied":1,"out":10,"t":1791799990000}\n`,
  }
  on('fs.list', async () => ({ value: Object.entries(files).map(([name, text]) => ({ name, kind: 'file', size: text.length, mtimeMs: NOW - 1000 })) }) as never)
  on('fs.stat', statOf(files))
  on('fs.read', async (_$, e) => {
    const name = e.path.slice(DIR.length + 1)
    return name in files ? { value: files[name] } as never : { deny: `no ${name}` } as never
  })
  const status: (string | undefined)[] = []
  on('ui.status', async (_$, e) => { status.push((e as { text?: string }).text); return { value: undefined } as never })
  on('session.id', async () => ({ value: 's' }) as never)
  on('session.start', async (_$, e) => e as never)
  for (const ev of ['command.register', 'ui.toast', 'ui.log', 'ui.blit'] as const) on(ev, async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(500)
  expect(status.at(-1)).toMatch(/waiting for an answer/)
  delete files['a.ask']
  files['a.closed'] = 'PERMISSION: Bash(rm x)'
  await clock.advance(500)
  expect(status.at(-1)).toBeUndefined()
})

test('a run whose heartbeat went stale (cw killed, no .done) stops counting as working, and comes back if it beats again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CW_LOG_DIR: DIR, HOME: '/h' })
  const files: Record<string, string> = { ...FILES, 'a.hb': '' }
  let hbAt = NOW - 200_000
  on('fs.list', async () => ({ value: Object.entries(files).map(([name, text]) => ({ name, kind: 'file', size: text.length, mtimeMs: name === 'a.hb' ? hbAt : NOW - 1000 })) }) as never)
  on('fs.stat', statOf(files, name => (name === 'a.hb' ? hbAt : NOW - 1000)))
  on('fs.read', async (_$, e) => {
    const name = e.path.slice(DIR.length + 1)
    return name in files ? { value: files[name] } as never : { deny: `no ${name}` } as never
  })
  const status: (string | undefined)[] = []
  on('ui.status', async (_$, e) => { status.push((e as { text?: string }).text); return { value: undefined } as never })
  on('session.id', async () => ({ value: 's' }) as never)
  on('session.start', async (_$, e) => e as never)
  for (const ev of ['command.register', 'ui.toast', 'ui.log', 'ui.blit'] as const) on(ev, async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(500)
  expect(status.some(s => s?.includes('working'))).toBe(false)
  hbAt = NOW
  await clock.advance(500)
  expect(status.at(-1)).toMatch(/1 working/)
})

test('after the first poll only live/ is listed, and a new worker shows up through its marker', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CW_LOG_DIR: DIR, HOME: '/h' })
  const files: Record<string, string> = { ...FILES }
  let live: string[] = []
  const listed: string[] = []
  on('fs.list', async (_$, e) => {
    listed.push(e.path)
    const all = e.path === `${DIR}/live` ? live.map(name => [name, '']) : Object.entries(files)
    return { value: all.map(([name, text]) => ({ name, kind: 'file', size: text!.length, mtimeMs: NOW - 1000 })) } as never
  })
  on('fs.stat', statOf(files))
  on('fs.read', async (_$, e) => {
    const name = e.path.slice(DIR.length + 1)
    return name in files ? { value: files[name] } as never : { deny: `no ${name}` } as never
  })
  const status: (string | undefined)[] = []
  on('ui.status', async (_$, e) => { status.push((e as { text?: string }).text); return { value: undefined } as never })
  on('session.id', async () => ({ value: 's' }) as never)
  on('session.start', async (_$, e) => e as never)
  for (const ev of ['command.register', 'ui.toast', 'ui.log', 'ui.blit'] as const) on(ev, async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await clock.advance(500)
  expect(status.at(-1)).toMatch(/1 working/)
  files['b.meta'] = meta('beta')
  files['b.events'] = '{"e":"init","sid":"sid-b","t":1791799980000}\n'
  live = ['b']
  await clock.advance(500)
  expect(status.at(-1)).toMatch(/2 working/)
  expect(listed[0]).toBe(DIR)
  expect(listed.slice(1).every(p => p === `${DIR}/live`)).toBe(true)
})
