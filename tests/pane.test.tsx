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

test('the crew pane draws cards with a details button, opens the detail view and goes back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CW_LOG_DIR: DIR, HOME: '/h' })
  on('fs.list', async () => ({ value: Object.entries(FILES).map(([name, text]) => ({ name, kind: 'file', size: text.length, mtimeMs: NOW - 1000 })) }) as never)
  on('fs.read', async (_$, e) => {
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
    plugin: 'cw-crew', surface: 'terminal', component: 'Pane', requestId: 'cw-crew',
    props: { title: 'Crew', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  await ui.drawn()
  expect(await ui.find({ key: 'open-a' })).toBeDefined()
  await ui.press({ key: 'open-a' })
  await clock.advance(500)
  expect(await ui.find({ type: 'Text', text: /Running the tests now/ })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'open-a' })).toBeDefined()
})
