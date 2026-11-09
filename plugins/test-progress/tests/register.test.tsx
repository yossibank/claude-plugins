import { expect, mock, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const PASSED_LOG = '\x1b[32m✔\x1b[0m a() (0.1 seconds)\n    \x1b[32m✔\x1b[0m b() (0.1 seconds)\n\x1b[32;1mTest Succeeded\x1b[0m\n'
const FAILED_LOG = '    ✔ a() (0.1 seconds)\n    ✖ monthTotalsSkipFuture(), Expectation failed\nTest Failed\n'

const engine = (on: On, log: string | Error, seen: { toasts: string[]; reads: string[]; store: Map<string, unknown> }, cwd = '/repo', mtimeMs: number | (() => number) = 1_000_000, isClockOwn = false, isLogMissing = false, deny?: string) => {
  on('session.cwd', () => ({ value: cwd }))
  on('tool.call', () => (deny === undefined ? { result: { stdout: '', stderr: '' }, text: '' } : { deny }))
  if (!isClockOwn) on('clock.now', () => ({ value: 1_000_000 }))
  on('fs.exists', () => ({ value: !isLogMissing }))
  on('fs.stat', () => ({ value: { mtimeMs: typeof mtimeMs === 'function' ? mtimeMs() : mtimeMs } as never }))
  on('fs.read', (_, e) => {
    seen.reads.push(e.path)
    if (log instanceof Error) throw log
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

  await $.tool.call({ tool: 'Bash', command: 'make test' })

  expect(seen.reads).toContain('/repo/.build/test.log')
  expect(seen.toasts).toEqual(['✔ make test 2 本通った · 0:00'])
  expect(seen.store.get('total:make test')).toBe(2)
})

test('落ちたら落ちた本数を知らせる', async ($, on) => {
  const seen = fresh()
  engine(on, FAILED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'make -C /work test SIMULATOR=x' })

  expect(seen.reads).toContain('/work/.build/test.log')
  expect(seen.toasts).toEqual(['✖ make test 1 本落ちた · 0:00'])
})

test('裏で走らせた間は、前の回の数で進みの帯を出す', async ($, on) => {
  const seen = fresh()
  seen.store.set('total:make test', 10)
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, '', seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })
  await clock.advance(1000)

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

  await $.tool.call({ tool: 'Bash', command: 'make android-test && make test-build' })

  expect(seen.reads).toEqual([])
  expect(seen.toasts).toEqual([])
})

const OTHER_LOG = 'ok: a\nok: b\nok: c\nbad: login\nDONE\nGOOD\n'
const OTHER = {
  commandPattern: '\\bswift test\\b',
  logPath: 'out/check.log',
  passedLine: '^ok: ',
  failedLine: '^bad: (.+)$',
  finishedLine: '^DONE$',
  succeededLine: '^GOOD$',
}

test('make -C の後ろのフォルダの名前は、見張るコマンドとして当てない', async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'make -C test verify' })

  expect(seen.reads).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('前の回の数は、当たったコマンドごとに分けて覚える', { options: { commandPattern: '\\b(?:make|swift) test\\b' } }, async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'swift test' })

  expect(seen.store.get('total:swift test')).toBe(2)
  expect(seen.store.has('total:make test')).toBe(false)
})

test('options で見張るコマンド・ログの置き場・行の形を変えられる', { options: OTHER }, async ($, on) => {
  const seen = fresh()
  engine(on, OTHER_LOG.replace('bad: login\n', ''), seen)

  await $.tool.call({ tool: 'Bash', command: 'make test' })
  expect(seen.reads).toEqual([])

  await $.tool.call({ tool: 'Bash', command: 'swift test --parallel 2>&1 | tee out/check.log' })
  expect(seen.reads).toContain('/repo/out/check.log')
  expect(seen.toasts).toEqual(['✔ swift test 3 本通った · 0:00'])
  expect(seen.store.get('total:swift test')).toBe(3)
})

test('壊れた正規表現は初めの値に戻る', { options: { passedLine: '(', commandPattern: '(' } }, async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'make test' })
  await $.tool.call({ tool: 'Bash', command: 'make test' })

  expect(seen.toasts).toEqual(['test-progress: commandPattern・passedLine の正規表現が正しくないので、初めの値で見張ります', '✔ make test 2 本通った · 0:00', '✔ make test 2 本通った · 0:00'])
})

test('cd のあとの make は、動かした先を基点にする', async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'cd app && make test' })
  await $.tool.call({ tool: 'Bash', command: 'cd /abs; cd sub && make -C x test' })

  expect(seen.reads).toEqual(['/repo/app/.build/test.log', '/abs/sub/x/.build/test.log'])
})

test('落ちた回は総数を覚えない', { options: OTHER }, async ($, on) => {
  const seen = fresh()
  seen.store.set('total:swift test', 10)
  engine(on, OTHER_LOG.replace('GOOD\n', ''), seen)

  await $.tool.call({ tool: 'Bash', command: 'swift test' })

  expect(seen.toasts).toEqual(['✖ swift test 1 本落ちた · 0:00'])
  expect(seen.store.get('total:swift test')).toBe(10)
  expect(seen.store.has('durationMs:swift test')).toBe(false)
})

test('0 本の回は総数を覚えない', async ($, on) => {
  const seen = fresh()
  seen.store.set('total:make test', 10)
  engine(on, 'Test Succeeded\n', seen)

  await $.tool.call({ tool: 'Bash', command: 'make test' })

  expect(seen.store.get('total:make test')).toBe(10)
})

test('ログが 5 分変わらないと、帯を消して止める', async ($, on) => {
  const seen = fresh()
  seen.store.set('total:make test', 10)
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, '✔ a() (0.1 seconds)\n', seen, '/repo', 1_000_000, true)
  const props = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  const shown = async () => {
    const ui = await $.ui.mount({ plugin: 'test-progress', surface: 'terminal', component: 'AbovePrompt', props, viewport: { columns: 80, rows: 40 } })
    const found = (await ui.find({ type: 'Text', text: /🧪 make test/ })) !== undefined
    await ui.unmount()
    return found
  }

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })
  await clock.advance(60_000)
  expect(await shown()).toBe(true)

  await clock.advance(5 * 60_000)
  expect(await shown()).toBe(false)
  expect(seen.toasts).toEqual([])
  expect(seen.store.get('total:make test')).toBe(10)
})

test('ログが一度も書かれないまま終わったら、ログを書かないコマンドとみなして何も知らせない', async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen, '/repo', 1_000_000, false, true)

  await $.tool.call({ tool: 'Bash', command: 'make test' })

  expect(seen.reads).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(seen.store.get('total:make test')).toBeUndefined()
})

test('ログが古いまま終わった時も、通ったとは言わずに何も知らせない', async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen, '/repo', 0)

  await $.tool.call({ tool: 'Bash', command: 'make test' })

  expect(seen.toasts).toEqual([])
})

test('ログが書かれるまでは、帯を出さない', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, PASSED_LOG, seen, '/repo', 1_000_000, true, true)

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })
  await clock.advance(3000)

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🧪 make test/ })).toBeUndefined()
  await ui.unmount()
})

test('実行を拒まれた時は、トーストを出さずに帯だけを消す', async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen, '/repo', 1_000_000, false, false, 'no')

  await $.tool.call({ tool: 'Bash', command: 'make test' })

  expect(seen.toasts).toEqual([])
  expect(seen.store.get('total:make test')).toBeUndefined()
})

const PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }

const mountBand = ($: Parameters<TestBody>[0]) => $.ui.mount({ plugin: 'test-progress', surface: 'terminal', component: 'AbovePrompt', props: PROPS, viewport: { columns: 80, rows: 40 } })

test('ログが変わり続けても、1 時間たったら帯を消して止める', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  let mtime = 1_000_000
  engine(on, '✔ a() (0.1 seconds)\n', seen, '/repo', () => (mtime += 1000), true)

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })
  await clock.advance(30 * 60_000)
  const during = await mountBand($)
  expect(await during.find({ type: 'Text', text: /🧪 make test/ })).toBeDefined()
  await during.unmount()

  await clock.advance(31 * 60_000)
  const after = await mountBand($)
  expect(await after.find({ type: 'Text', text: /🧪 make test/ })).toBeUndefined()
  await after.unmount()
  expect(seen.toasts).toEqual([])
})

test('落ちたテストは 3 本まで名前を出し、残りは「ほか N 本」にまとめる', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, '✖ one, x\n✖ two, x\n✖ three, x\n✖ four, x\n✖ five, x\n', seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })
  await clock.advance(1000)

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /✖ three/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✖ four/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /ほか 2 本/ })).toBeDefined()
  await ui.unmount()
})

test('見張りが重なっても、後の開始は前の表示と終わりを書き換えない', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, PASSED_LOG.replace(/.*Test Succeeded.*\n/, ''), seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })
  await clock.advance(1000)
  await $.tool.call({ tool: 'Bash', command: 'make test' })

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🧪 make test/ })).toBeDefined()
  await ui.unmount()
  expect(seen.toasts).toEqual(['✔ make test 2 本通った · 0:00'])
})

test('ログを読むのに失敗したら、トーストで知らせて見張りを止める', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, new Error('読めない'), seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })
  await clock.advance(3000)

  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toMatch(/^test-progress: 見張りを止めました: /)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🧪 make test/ })).toBeUndefined()
  await ui.unmount()
})

test('同じ名前の落ちたテストが重なっても、1 本ずつ出す', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, '✖ same, x\n✖ same, y\n', seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })
  await clock.advance(1000)

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🧪 make test/ })).toBeDefined()
  await ui.unmount()
})

test('session.start で、残っていた見張りの行を消す', async ($, on) => {
  const seen = fresh()
  engine(on, '', seen)
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.tool.call({ tool: 'Bash', command: 'make test', run_in_background: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🧪 make test/ })).toBeUndefined()
  await ui.unmount()
})

test('前の処理が長くてログが書かれる前に 5 分たっても、見張りを続ける', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  let mtime = 0
  engine(on, '✔ a() (0.1 seconds)\n', seen, '/repo', () => mtime, true)

  await $.tool.call({ tool: 'Bash', command: 'make verify && make test', run_in_background: true })
  await clock.advance(6 * 60_000)
  mtime = 1_000_000 + 6 * 60_000
  await clock.advance(2000)

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🧪 make test/ })).toBeDefined()
  await ui.unmount()
})

test('run-check.sh の最初の引数のワークツリーを基点にする', async ($, on) => {
  const seen = fresh()
  engine(on, PASSED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: '/s/run-check.sh /wt/a "make test" make test' })
  await $.tool.call({ tool: 'Bash', command: 'cd /wt/b && /s/run-check.sh $PWD "make test" make test' })

  expect(seen.reads).toEqual(['/wt/a/.build/test.log', '/wt/b/.build/test.log'])
})
