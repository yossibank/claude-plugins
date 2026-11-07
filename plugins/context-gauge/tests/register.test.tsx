import { expect, mock, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type File = { text: string; mtimeMs: number }

const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer') => ({ name, tokens, kind, color: 'text', isDeferred: false })

const T0 = 1_000_000_000
const MINUTE = 60_000
const HANDOFF = '/repo/.claude/handoff.md'

const engine = (on: On, percent: number, window = 200000, isShown = false, files: Record<string, File> = {}, state = { isUsageBroken: false }) => {
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
          categories: [row('System prompt', 18000, 'used'), row('Messages', 64000, 'used'), row('Free space', 100000, 'free'), row('Autocompact buffer', 18000, 'buffer')],
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

test('入力欄の上は 1 行で、割合・棒・使用量・キャッシュの残りを出す', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /82k \/ 200k · キャッシュ 60 分/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /41%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⣿+/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⣀+/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /会話|システム|頃合い|📌/ })).toBeUndefined()
  await ui.unmount()
})

test('入力欄の上: キャッシュが切れたら末尾を「キャッシュ切れ」にする', async ($, on) => {
  const { clock } = engine(on, 41)
  await start($)
  await clock.advance(60 * MINUTE)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /82k \/ 200k · キャッシュ切れ/ })).toBeDefined()
  await ui.unmount()
})

test('入力欄の上: handoff の次は出さない', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '- 次：1. a', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /📌/ })).toBeUndefined()
  await ui.unmount()
})

test('最後のターンの終わりからキャッシュの残りを数える（サブエージェントのターンは数えない）', async ($, on) => {
  const { clock } = engine(on, 85)
  await start($)
  await clock.advance(30 * MINUTE)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)
  await clock.advance(10 * MINUTE)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'end_turn' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /キャッシュ 50 分/ })).toBeDefined()
  await ui.unmount()
})

test('割合の色: 黄と赤の割合で変わる', async ($, on) => {
  engine(on, 85)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /^85%$/ }))?.props?.color).toBe('error')
  await ui.unmount()
})

test('pane: 割合・使用量・空きを出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^╻ ╻ ╺┓  █ ▞$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /82k \/ 200k · 空き 100k/ })).toBeDefined()
  await ui.unmount()
})

test('pane: 積み上げ棒は幅いっぱいで、種類ごとの行を多い順に出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount(PANE)
  const bar = (await ui.find({ type: 'Text', text: /^[⣿⣀]{38}$/ }))?.text ?? ''
  expect([...bar].length).toBe(38)
  expect(await ui.find({ type: 'Text', text: /● 会話 +64k +32%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● システム +18k +9%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⣿.*64k/ })).toBeUndefined()
  await ui.unmount()
})

test('pane: キャッシュの残りを出す。切れたら切れていると出す', async ($, on) => {
  const { clock } = engine(on, 41)
  await start($)
  await clock.advance(20 * MINUTE)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^⏱ キャッシュ切れまで 40 分$/ })).toBeDefined()
  await ui.unmount()
  await clock.advance(40 * MINUTE)
  const again = await $.ui.mount(PANE)
  expect(await again.find({ type: 'Text', text: /^⏱ キャッシュは切れています$/ })).toBeDefined()
  expect(await again.find({ type: 'Text', text: /頃合い|\/clear/ })).toBeUndefined()
  await again.unmount()
})

test('次: 同じ行に並ぶ形を読む。2 つ目からは字下げする', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '# h\n- 次：1. 画面を直す 2. テストを足す\n- 別', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^📌 次 {2}1\. 画面を直す$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {7}2\. テストを足す$/ })).toBeDefined()
  await ui.unmount()
})

test('次: 次の行から字下げして続く形を読む', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '- 次：\n  1. a\n  2. b\n\n- 別 3. c', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^📌 次 {2}1\. a$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {7}2\. b$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /c$/ })).toBeUndefined()
  await ui.unmount()
})

test('次: handoff に無ければ出さない', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /📌/ })).toBeUndefined()
  await ui.unmount()
})

test('次: handoff.md が書き換わったら消える', async ($, on) => {
  const files: Record<string, File> = { [HANDOFF]: { text: '- 次：1. a', mtimeMs: T0 } }
  engine(on, 41, 200000, false, files)
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /📌 次/ })).toBeDefined()
  await ui.unmount()
  files[HANDOFF] = { text: '- 次：1. b', mtimeMs: T0 + 1 }
  const again = await $.ui.mount(PANE)
  expect(await again.find({ type: 'Text', text: /📌 次/ })).toBeUndefined()
  await again.unmount()
})

test('次: /clear の後に読み直す', async ($, on) => {
  const files: Record<string, File> = {}
  engine(on, 41, 200000, false, files)
  await start($)
  files[HANDOFF] = { text: '- 次：1. a', mtimeMs: T0 }
  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /📌 次 {2}1\. a/ })).toBeDefined()
  await ui.unmount()
})

test('usage が失敗したら前の値を残す', async ($, on) => {
  const state = { isUsageBroken: false }
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
  expect(await ui.find({ type: 'Text', text: /キャッシュ切れ/ })).toBeDefined()
  await ui.unmount()
})

test('options: 黄と赤の割合を変える', { options: { yellowAt: 30, redAt: 90 } }, async ($, on) => {
  engine(on, 35)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /^35%$/ }))?.props?.color).toBe('warning')
  await ui.unmount()
})

test('options: 赤が黄より小さければ既定に戻す', { options: { yellowAt: 70, redAt: 20 } }, async ($, on) => {
  engine(on, 60)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /^60%$/ }))?.props?.color).toBe('warning')
  await ui.unmount()
})

test('上限が 1M でも 1 行目が帯の幅に収まる', async ($, on) => {
  engine(on, 61, 1_000_000)
  await start($)

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 60 } })
  const line = (await ui.find({ type: 'Text', text: /●.*610k \/ 1M/ }))?.text ?? ''
  const cells = [...line].reduce((sum, char) => sum + (/[ᄀ-ᅟ⺀-꓏가-힣＀-｠]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1), 0)
  expect(line.length).toBeGreaterThan(0)
  expect(cells).toBeLessThanOrEqual(60)
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
