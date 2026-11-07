import { expect, mock, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type File = { text: string; mtimeMs: number }

const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer') => ({ name, tokens, kind, color: 'text', isDeferred: false })

const T0 = 1_000_000_000
const MINUTE = 60_000
const HANDOFF = '/repo/.claude/handoff.md'

const engine = (on: On, percent: number, window = 200000, isShown = false, files: Record<string, File> = {}, state: { isUsageBroken: boolean; free?: number } = { isUsageBroken: false }) => {
  const clock = mock.clock(on, { now: T0 })
  const counts = { panes: 0 }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo/sub' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: { command: 'context-gauge' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => {
    counts.panes += 1
    return { value: [{ id: 'context-gauge', title: '📊 Context', isShown, isFocused: false, isPlaced: true }] }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/repo\n', stderr: '' } as never }))
  on('fs.stat', (_, e) => {
    const file = files[e.path]
    if (file === undefined) return { deny: 'ENOENT' }
    return { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } as never }
  })
  on('fs.read', (_, e) => {
    const file = files[e.path]
    if (file === undefined) return { deny: 'ENOENT' }
    return { value: file.text as never }
  })
  on('session.usage', () => {
    if (state.isUsageBroken) return { deny: 'usage failed' }
    return {
    value: {
      startedAt: 0,
      rateLimits: [],
      cost: { usd: 0 },
      context: {
        tokens: (percent * window) / 100,
        window,
        percent,
        breakdown: {
          categories: [row('System prompt', 18000, 'used'), row('Messages', 64000, 'used'), row('Free space', state.free ?? 100000, 'free'), row('Autocompact buffer', 18000, 'buffer')],
          totalTokens: 82000,
          maxTokens: 200000,
          rawMaxTokens: 200000,
          percentage: percent,
          gridRows: [],
          model: 'claude-opus-5-5',
        },
      },
    } as never,
    }
  })
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '' }, text: 'ok' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { clock, counts }
}

const start = ($: Parameters<TestBody>[0]) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const BAND = {
  plugin: 'context-gauge',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  viewport: { columns: 80, rows: 40 },
} as const

const PANE = {
  plugin: 'context-gauge',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'context-gauge',
  props: { title: '📊 Context', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const cells = (line: string) => [...line].reduce((sum, char) => sum + (/[ᄀ-ᅟ⺀-꓏가-힣＀-｠]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1), 0)

test('入力欄の上は 1 行で、評価・割合・棒・使用量・キャッシュの残りを出す', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^◆ A {2}41% {2}▰+▱+ {2}82k \/ 200k {2}· {2}⏱ 60m$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /会話|システム|📌/ })).toBeUndefined()
  await ui.unmount()
})

test('入力欄の上: キャッシュが切れたら ⏱ cold', async ($, on) => {
  const { clock } = engine(on, 41)
  await start($)
  await clock.advance(60 * MINUTE)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /82k \/ 200k {2}· {2}⏱ cold$/ })).toBeDefined()
  await ui.unmount()
})

test('入力欄の上: handoff の次は出さない', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '- 次：1. a', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /NEXT/ })).toBeUndefined()
  await ui.unmount()
})

test('入力欄の上: 棒は最大 24 で、狭ければ縮む', async ($, on) => {
  engine(on, 50)
  await start($)

  const wide = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 120 } })
  expect(await wide.find({ type: 'Text', text: /^◆ A.*[▰▱]{24} {2}100k/ })).toBeDefined()
  await wide.unmount()
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 50 } })
  const line = (await narrow.find({ type: 'Text', text: /^◆ A/ }))?.text ?? ''
  expect(cells(line)).toBeLessThanOrEqual(50)
  expect(line).toMatch(/[▰▱]{4,23} {2}100k/)
  await narrow.unmount()
})

const gradeCases: [number, string][] = [
  [140000, 'S'],
  [139999, 'A'],
  [100000, 'A'],
  [99999, 'B'],
  [60000, 'B'],
  [59999, 'C'],
  [30000, 'C'],
  [29999, 'D'],
]
for (const [free, name] of gradeCases) {
  test(`評価: 空き ${free} / 200000 は ${name}`, async ($, on) => {
    engine(on, 41, 200000, false, {}, { isUsageBroken: false, free })
    await start($)

    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Text', text: new RegExp(`^◆ ${name} `) })).toBeDefined()
    await ui.unmount()
  })
}

test('最後のターンの終わりからキャッシュの残りを数える（サブエージェントのターンは数えない）', async ($, on) => {
  const { clock } = engine(on, 85)
  await start($)
  await clock.advance(30 * MINUTE)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)
  await clock.advance(10 * MINUTE)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'end_turn' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /⏱ 50m/ })).toBeDefined()
  await ui.unmount()
})

test('評価の色が付く', async ($, on) => {
  engine(on, 41, 200000, false, {}, { isUsageBroken: false, free: 20000 })
  await start($)

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /^◆ D$/ }))?.props?.color).toBe('#f05a5a')
  await ui.unmount()
})

test('pane: 見出しの右端に評価、割合の棒、使用量を出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^CONTEXT +GRADE A$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^41% {2}▰+▱+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^82\.0k used · 100\.0k free · 200k$/ })).toBeDefined()
  await ui.unmount()
})

test('pane: 種類ごとの行を多い順に、名前・数・割合・棒で出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^● 会話 +64\.0k 32\.0% {2}━+─*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● システム +18\.0k {2}9\.0% {2}━+─*$/ })).toBeDefined()
  await ui.unmount()
})

test('pane: 棒は幅いっぱいで、狭くても収まる', async ($, on) => {
  engine(on, 41)
  await start($)

  for (const columns of [40, 34]) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
    const used = (await ui.find({ type: 'Text', text: /^41% / }))?.text ?? ''
    const row = (await ui.find({ type: 'Text', text: /^● 会話/ }))?.text ?? ''
    expect(cells(used)).toBe(Math.max(32, columns - 2))
    expect(cells(row)).toBeLessThanOrEqual(Math.max(32, columns - 2))
    await ui.unmount()
  }
})

test('pane: キャッシュの残りと棒を出す。切れたら cold と空の棒', async ($, on) => {
  const { clock } = engine(on, 41)
  await start($)
  await clock.advance(30 * MINUTE)

  const ui = await $.ui.mount(PANE)
  const half = (await ui.find({ type: 'Text', text: /^CACHE {2}30m {2}━+─+$/ }))?.text ?? ''
  expect(half.match(/━/g)?.length).toBe(half.match(/─/g)?.length)
  await ui.unmount()
  await clock.advance(30 * MINUTE)
  const again = await $.ui.mount(PANE)
  expect(await again.find({ type: 'Text', text: /^CACHE {2}cold {2}─+$/ })).toBeDefined()
  await again.unmount()
})

test('次: 同じ行に並ぶ形を読む。2 つ目からは字下げする', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '# h\n- 次：1. 画面を直す 2. テストを足す\n- 別', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^NEXT {3}画面を直す$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {7}テストを足す$/ })).toBeDefined()
  await ui.unmount()
})

test('次: 次の行から字下げして続く形を読む', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '- 次：\n  1. a\n  2. b\n\n- 別 3. c', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^NEXT {3}a$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {7}b$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /c$/ })).toBeUndefined()
  await ui.unmount()
})

test('次: handoff に無ければ出さない', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /NEXT/ })).toBeUndefined()
  await ui.unmount()
})

test('次: handoff.md が書き換わったら消える', async ($, on) => {
  const files: Record<string, File> = { [HANDOFF]: { text: '- 次：1. a', mtimeMs: T0 } }
  engine(on, 41, 200000, false, files)
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /NEXT/ })).toBeDefined()
  await ui.unmount()
  files[HANDOFF] = { text: '- 次：1. b', mtimeMs: T0 + 1 }
  const again = await $.ui.mount(PANE)
  expect(await again.find({ type: 'Text', text: /NEXT/ })).toBeUndefined()
  await again.unmount()
})

test('次: /clear の後に読み直す', async ($, on) => {
  const files: Record<string, File> = {}
  engine(on, 41, 200000, false, files)
  await start($)
  files[HANDOFF] = { text: '- 次：1. a', mtimeMs: T0 }
  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /NEXT {3}a/ })).toBeDefined()
  await ui.unmount()
})

test('usage が失敗したら前の値を残す', async ($, on) => {
  const state: { isUsageBroken: boolean; free?: number } = { isUsageBroken: false }
  engine(on, 41, 200000, false, {}, state)
  await start($)
  state.isUsageBroken = true
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /41%/ })).toBeDefined()
  await ui.unmount()
})

test('options: 寿命を変える', { options: { cacheMinutes: '5' } }, async ($, on) => {
  const { clock } = engine(on, 35)
  await start($)
  await clock.advance(6 * MINUTE)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /⏱ cold/ })).toBeDefined()
  await ui.unmount()
})

test('上限が 1M でも 1 行目が帯の幅に収まる', async ($, on) => {
  engine(on, 61, 1_000_000)
  await start($)

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 60 } })
  const line = (await ui.find({ type: 'Text', text: /^◆.*610k \/ 1M/ }))?.text ?? ''
  const total = [...line].reduce((sum, char) => sum + (/[ᄀ-ᅟ⺀-꓏가-힣＀-｠]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1), 0)
  expect(line.length).toBeGreaterThan(0)
  expect(total).toBeLessThanOrEqual(60)
  await ui.unmount()
})

test('session.start を繰り返しても見張りのタイマーは重ならない', async ($, on) => {
  const { clock, counts } = engine(on, 41)
  await start($)
  await start($)
  await start($)
  counts.panes = 0
  await clock.advance(2000)
  expect(counts.panes).toBe(1)
  await clock.advance(4000)
  expect(counts.panes).toBe(3)
})

test('右の pane が見えている間は、入力欄の上に帯を出さない', async ($, on) => {
  engine(on, 41, 200000, true)
  await start($)
  await $.command.run({ command: 'context-gauge', args: '' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /41%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})
