import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const PASSED_LOG = '\x1b[32m✔\x1b[0m a() (0.1 seconds)\n    \x1b[32m✔\x1b[0m b() (0.1 seconds)\n\x1b[32;1mTest Succeeded\x1b[0m\n'
const FAILED_LOG = '    ✔ a() (0.1 seconds)\n    ✖ monthTotalsSkipFuture(), Expectation failed\nTest Failed\n'

const engine = (on: On, log: string, seen: { toasts: string[]; reads: string[]; store: Map<string, unknown> }) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' }, text: '' }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { mtimeMs: 1_000_000 } as never }))
  on('fs.read', (_, e) => {
    seen.reads.push(e.path)
    return { value: log }
  })
  on('store.get', (_, e) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_, e) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const fresh = () => ({ toasts: [] as string[], reads: [] as string[], store: new Map<string, unknown>() })

test('通ったら本数をトーストで知らせ、次の回のために数を覚える', async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make test' })

  expect(seen.reads).toContain('/repo/.build/test.log')
  expect(seen.toasts).toEqual(['✔ make test 2 本通った · 0:00'])
  expect(seen.store.get('total')).toBe(2)
})

test('落ちたら落ちた本数を知らせる', async ($, on) => {
  const seen = fresh()
  engine(on, FAILED_LOG, seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make -C /work test SIMULATOR=x' })

  expect(seen.reads).toContain('/work/.build/test.log')
  expect(seen.toasts).toEqual(['✖ make test 1 本落ちた · 0:00'])
})

test('裏で走らせた間は、前の回の数で進みの帯を出す', async ($, on) => {
  const seen = fresh()
  seen.store.set('total', 10)
  engine(on, '', seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })

  const ui = await $.ui.mount({
    plugin: 'test-progress',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    viewport: { columns: 80, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: /🧪 make test.*0 \/ 10/ })).toBeDefined()
  expect(seen.toasts).toEqual([])
  await ui.unmount()
})

test('make test 以外では何もしない', async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make android-test && make test-build' })

  expect(seen.reads).toEqual([])
  expect(seen.toasts).toEqual([])
})
