import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const ROOT = '/repo'
const AFTER = `${ROOT}/.build/snapshots/review`
const BEFORE = `${ROOT}/.build/snapshots-before/review`

const file = (name: string, mtimeMs: number) => ({ name, kind: 'file' as const, size: 1, mtimeMs, isLink: false })

const engine = (on: On, ran: string[][]) => {
  const dirs = new Map([
    [AFTER, [file('review-balance-narrow.png', 2), file('review-list-narrow.png', 2), file('review-new-narrow.png', 2)]],
    [BEFORE, [file('review-balance-narrow.png', 1), file('review-list-narrow.png', 1)]],
  ])
  const hash: Record<string, string> = {
    [`${AFTER}/review-balance-narrow.png`]: 'b2',
    [`${BEFORE}/review-balance-narrow.png`]: 'b1',
    [`${AFTER}/review-list-narrow.png`]: 'l1',
    [`${BEFORE}/review-list-narrow.png`]: 'l1',
    [`${AFTER}/review-new-narrow.png`]: 'n1',
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'snapshots' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', (_, e) => ({ value: dirs.has(e.path) }))
  on('fs.list', (_, e) => ({ value: dirs.get(e.path ?? '') ?? [] }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' }, text: '' }))
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const files = argv.filter(arg => arg.startsWith('/'))
    const stdout =
      argv[0] === 'shasum'
        ? files.map(path => `${hash[path] ?? 'x'}  ${path}`).join('\n')
        : argv[0] === 'sips'
          ? files.map(path => `${path}\n  pixelWidth: 640\n  pixelHeight: 960`).join('\n')
          : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const PANE = {
  plugin: 'snapshot-gallery',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'snapshot-gallery',
  props: { title: '📸 Snapshots', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('描く前に古い PNG を取っておき、描いた後に前と後を並べる', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(ran).toContainEqual(['rsync', '-a', '--delete', '--include', '*.png', '--exclude', '*', `${AFTER}/`, `${BEFORE}/`])

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^1 \/ 3$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /🟡 変更 1.*⚪ 同じ 1.*🟢 新規 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s+ balance-narrow   list-narrow ›$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /╭─ 後 · 🟡 変更 ─+╮/ })).toBeDefined()
  expect((await ui.find({ type: 'Image', key: '前' }))?.props).toMatchObject({ source: { file: `${BEFORE}/review-balance-narrow.png`, format: 'png' } })
  expect((await ui.find({ type: 'Image', key: '後' }))?.props).toMatchObject({ source: { file: `${AFTER}/review-balance-narrow.png`, format: 'png' } })
  await ui.unmount()
})

test('l で次の場合に移る', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /‹ balance-narrow\s+ list-narrow \s+new-narrow ›/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 \/ 3$/ })).toBeDefined()
  await ui.unmount()
})

test('前と後を pane の高さに収める', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Image', key: '前' }))?.props).toMatchObject({ columns: 40, rows: 30 })
  expect((await ui.find({ type: 'Image', key: '後' }))?.props).toMatchObject({ columns: 40, rows: 30 })
  await ui.unmount()
})

test('高さに余裕があれば pane の幅の半分ずつに描く', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 200 } } })
  expect((await ui.find({ type: 'Image', key: '後' }))?.props).toMatchObject({ columns: 57, rows: 43 })
  await ui.unmount()
})

test('ほかの make では何もしない', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make verify' })

  expect(ran).toEqual([])
})
