import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { cellWidth } from '../hooks/cell'

type On = Parameters<TestBody>[1]

const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer') => ({ name, tokens, kind, color: 'text', isDeferred: false })

const T0 = 1_000_000_000
const MINUTE = 60_000
const GIT: Record<string, string> = {
  'branch --show-current': 'feat/dash\n',
  'diff HEAD': '10\t2\ta.ts\n2\t1\tb.ts\n-\t-\timg.png\n',
  'status --porcelain': ' M a.ts\n?? new.ts\n',
}

type State = {
  isUsageBroken: boolean
  free?: number
  raw?: number
  isUnanswered?: boolean
  isRepoMissing?: boolean
  isVersionBroken?: boolean
  isPanesBroken?: boolean
}

const engine = (on: On, percent: number, window = 200000, isShown = false, state: State = { isUsageBroken: false }) => {
  const clock = mock.clock(on, { now: T0 })
  const counts = { panes: 0, breakdowns: 0 }
  const toasts: string[] = []
  // /clear で替わるセッションの id。テストが書き換える
  const session = { id: 's1' }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: '/repo/sub' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: { command: 'session-dashboard' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.panes', () => {
    counts.panes += 1
    if (state.isPanesBroken === true) return { deny: 'panes failed' }
    return { value: [{ id: 'session-dashboard', title: '📊 Session', isShown, isFocused: false, isPlaced: true }] }
  })
  on('session.repo', () => ({ value: state.isRepoMissing === true ? null : { root: '/repo', remote: 'git@github.com:owner/app.git', internal: false, name: null } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.version', () => (state.isVersionBroken === true ? { deny: 'version failed' } : { value: { version: '2.1.319', base: '2.1.319' } }))
  on('process.run', (_, e) => {
    const stdout = GIT[e.argv.slice(1, 3).join(' ')] ?? '/repo\n'
    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
  on('session.usage', (_, e) => {
    if ((e as { breakdown?: string }).breakdown === 'summary') counts.breakdowns += 1
    if (state.isUsageBroken) return { deny: 'usage failed' }
    return {
    value: {
      startedAt: 0,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(T0 + 130 * MINUTE).toISOString() },
        { kind: 'seven_day', percentUsed: 43, resetsAt: new Date(T0 + (3 * 24 + 5) * 60 * MINUTE).toISOString() },
      ],
      cost: { usd: 1.236 },
      context: {
        ...(state.isUnanswered === true ? {} : { tokens: (percent * window) / 100, percent }),
        window,
        breakdown: {
          categories: [row('System prompt', 18000, 'used'), row('Messages', 64000, 'used'), row('Free space', state.free ?? 100000, 'free'), row('Autocompact buffer', 18000, 'buffer')],
          totalTokens: 82000,
          maxTokens: 200000,
          rawMaxTokens: state.raw ?? 200000,
          percentage: percent,
          gridRows: [],
          model: 'claude-opus-5-5',
        },
      },
    } as never,
    }
  })
  on('tool.call', (_, e) => {
    return { result: { stdout: 'ok', stderr: '' }, text: 'ok' } as never
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  return { clock, counts, toasts, session }
}

const start = ($: Parameters<TestBody>[0]) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const BAND = {
  plugin: 'session-dashboard',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  viewport: { columns: 80, rows: 40 },
} as const

const PANE = {
  plugin: 'session-dashboard',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'session-dashboard',
  props: { title: '📊 Session', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const cells = cellWidth

type Engine = Parameters<TestBody>[0]

const lines = async ($: Engine, columns = 46) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
  const found = (await ui.findAll({ type: 'Text' })).map(element => element.text).filter(text => /^[╭│╰].*[╮│╯]$/u.test(text))
  await ui.unmount()
  return [...new Set(found)]
}

const bandLines = async ($: Engine, columns = 100) => {
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns } })
  const found = (await ui.findAll({ type: 'Text' })).map(element => element.text).filter(text => /^│ .* │$/u.test(text))
  await ui.unmount()
  return [...new Set(found)]
}

const done = (turnId = 't1', agentId?: string) => ({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'end_turn', ...(agentId === undefined ? {} : { agentId }) }) as never

test('pane: どの行も幅いっぱいで、はみ出さない', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'x', description: 'とても長い説明がずっと続いていて pane の幅には収まらない' } as never)

  for (const columns of [46, 30, 22]) {
    const found = await lines($, columns)
    expect(found.length).toBeGreaterThan(20)
    for (const line of found) expect(cells(line)).toBe(columns - 2)
  }
})

test('pane: 表が描けないほど狭ければ、罫線を外して幅に収める', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 12 } })
  const texts = (await ui.findAll({ type: 'Text' })).map(element => element.text)
  await ui.unmount()
  expect(texts.some(text => /^model Op/.test(text))).toBe(true)
  for (const text of texts) expect(cells(text)).toBeLessThanOrEqual(10)
})

test('pane: 名前の知らない上限も、割合を出したまま幅に収める', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'weekly_opus', percentUsed: 20 }], cost: { usd: 1 }, changed: ['rateLimits'] } as never)

  const line = (await lines($)).find(text => /weekly_opus/.test(text)) ?? ''
  expect(line).toMatch(/ 20% │$/)
  expect(cells(line)).toBe(44)
})

test('pane: Claude の表に、モデルと費用を出し、版を下の罫線に埋める', async ($, on) => {
  engine(on, 41)
  await start($)

  const found = await lines($)
  expect(found.some(line => /^╭─ . Claude ─+╮$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ model │ Opus 5\.5 +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ cost {2}│ \$1\.24 +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^╰─+ v2\.1\.319 ─╯$/u.test(line))).toBe(true)
})

test('pane: リポジトリの表の題に名前を、行にブランチと色の付いた差分を出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const found = await lines($)
  expect(found.some(line => /^╭─ . owner\/app ─+╮$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ branch │ feat\/dash +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ diff {3}│ \+12 -3 \?1 +│$/u.test(line))).toBe(true)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^\+12$/ }))?.props?.color).toBe('#9ece6a')
  await ui.unmount()
})

test('pane: 上限は窓ごとに 1 行で、棒の長さをそろえ、割合と戻るまでの時間を出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const found = await lines($)
  const five = found.find(line => /^│ 5h │ ━+ {2}62% 2h10m │$/u.test(line)) ?? ''
  const seven = found.find(line => /^│ 7d │ ━+ {2}43% {2}3d5h │$/u.test(line)) ?? ''
  expect(five.length).toBeGreaterThan(0)
  expect(five.match(/━/g)?.length).toBe(seven.match(/━/g)?.length)
})

test('pane: 狭ければ、上限の戻るまでの時間を落とす', async ($, on) => {
  engine(on, 41)
  await start($)

  expect((await lines($, 22)).some(line => /^│ 5h │ ━+ {2}62% │$/u.test(line))).toBe(true)
})

test('session.measure で上限と費用を書き換える', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 91 }], cost: { usd: 3 }, changed: ['rateLimits', 'cost'] } as never)

  const found = await lines($)
  expect(found.some(line => /^│ cost {2}│ \$3\.00 +│$/u.test(line))).toBe(true)
  expect(found.some(line => /91%/.test(line))).toBe(true)
  expect(found.some(line => /7d/.test(line))).toBe(false)
})

test('pane: 文脈の表の題に割合を、行に使った量と種類を多い順に出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const found = await lines($)
  expect(found.some(line => /^╭─ . Context 41% ─+╮$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ used {5}│ ━+ 82k\/200k │$/u.test(line))).toBe(true)
  const talk = found.findIndex(line => /^│ 会話 {5}│ {2}64\.0k ━+ *│$/u.test(line))
  const system = found.findIndex(line => /^│ システム │ {2}18\.0k ━+ *│$/u.test(line))
  expect(talk).toBeGreaterThan(0)
  expect(system).toBeGreaterThan(talk)
})

test('pane: 応答の前は、見積もりの合計を要約の窓に対する割合で出す', async ($, on) => {
  engine(on, 8, 1000000, false, { isUsageBroken: false, raw: 400000, isUnanswered: true })
  await start($)

  const found = await lines($)
  expect(found.some(line => /^╭─ . Context 21% ─+╮$/u.test(line))).toBe(true)
  expect(found.some(line => /━+ 82k\/400k │$/u.test(line))).toBe(true)
})

const gradeCases: [number, string, string][] = [
  [140000, 'S', '#7ee0ff'],
  [139999, 'A', '#7fe0a0'],
  [100000, 'A', '#7fe0a0'],
  [99999, 'B', '#e8d27a'],
  [60000, 'B', '#e8d27a'],
  [59999, 'C', '#f0a050'],
  [30000, 'C', '#f0a050'],
  [29999, 'D', '#f05a5a'],
]
for (const [free, name, color] of gradeCases) {
  test(`評価: 空き ${free} / 200000 は ${name}`, async ($, on) => {
    engine(on, 41, 200000, false, { isUsageBroken: false, free })
    await start($)

    expect((await lines($)).some(line => new RegExp(`^╰─+ grade ${name} · . 60m ─╯$`, 'u').test(line))).toBe(true)
    const ui = await $.ui.mount(PANE)
    expect((await ui.find({ type: 'Text', text: new RegExp(`^${name}$`) }))?.props?.color).toBe(color)
    await ui.unmount()
  })
}

test('キャッシュは最後のターンの終わりから数え、サブエージェントのターンは数えない。切れたら cold', async ($, on) => {
  const { clock } = engine(on, 85)
  await start($)
  await clock.advance(30 * MINUTE)
  await $.turn.complete(done('t1'))
  await clock.advance(10 * MINUTE)
  await $.turn.complete(done('t2', 'a1'))

  expect((await lines($)).some(line => /grade . · . 50m ─╯$/u.test(line))).toBe(true)
  await clock.advance(50 * MINUTE)
  expect((await lines($)).some(line => /grade . · . cold ─╯$/u.test(line))).toBe(true)
})

test('options: キャッシュの寿命を変える', { options: { cacheMinutes: '5' } }, async ($, on) => {
  const { clock } = engine(on, 35)
  await start($)
  await clock.advance(6 * MINUTE)

  expect((await lines($)).some(line => /· . cold ─╯$/u.test(line))).toBe(true)
})

test('options: キャッシュの寿命が数でなければ、既定の 60 分で数える', { options: { cacheMinutes: 'x' } }, async ($, on) => {
  const { clock } = engine(on, 35)
  await start($)
  await clock.advance(6 * MINUTE)

  expect((await lines($)).some(line => /· . 54m ─╯$/u.test(line))).toBe(true)
})

test('サブエージェントのターンが終わっても、文脈を測り直さない', async ($, on) => {
  const { counts } = engine(on, 41)
  await start($)
  const before = counts.breakdowns
  await $.turn.complete(done('t2', 'a1'))
  expect(counts.breakdowns).toBe(before)

  await $.turn.complete(done())
  expect(counts.breakdowns).toBe(before + 1)
})

test('usage が失敗したら前の値を残す', async ($, on) => {
  const state: { isUsageBroken: boolean; free?: number } = { isUsageBroken: false }
  engine(on, 41, 200000, false, state)
  await start($)
  state.isUsageBroken = true
  await $.turn.complete(done())

  expect((await lines($)).some(line => /Context 41%/.test(line))).toBe(true)
})

test('/clear で state が空になっても、Claude・リポジトリ・上限の表を出し直す', async ($, on) => {
  // /clear は新しいセッションとして続き、state は初めの値に戻り、session.start は来ない
  const cleared = new Set<string>()
  on('state.set', (_, e, next) => {
    cleared.delete((e as { key: string }).key)
    return next(e)
  })
  on('state.get', (_, e, next) => (cleared.has((e as { key: string }).key) ? ({ value: { value: undefined, version: 0 } } as never) : next(e)))
  const { session } = engine(on, 41)
  await start($)
  for (const key of ['claude', 'repo', 'fill']) cleared.add(key)
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })

  const found = await lines($)
  expect(found.some(line => /Claude/.test(line))).toBe(true)
  expect(found.some(line => /owner\/app/.test(line))).toBe(true)
  expect(found.some(line => /│ 5h /.test(line))).toBe(true)
})

test('/clear: classic.SessionStart が届かなくても、見張りでセッションの替わり目を見て出し直す', async ($, on) => {
  const cleared = new Set<string>()
  on('state.set', (_, e, next) => {
    cleared.delete((e as { key: string }).key)
    return next(e)
  })
  on('state.get', (_, e, next) => (cleared.has((e as { key: string }).key) ? ({ value: { value: undefined, version: 0 } } as never) : next(e)))
  const { clock, session } = engine(on, 41)
  await start($)
  for (const key of ['claude', 'repo', 'fill']) cleared.add(key)
  session.id = 's2'
  await clock.advance(2000)

  const found = await lines($)
  expect(found.some(line => /Claude/.test(line))).toBe(true)
  expect(found.some(line => /owner\/app/.test(line))).toBe(true)
})

test('/clear: 見張りより先に次のターンが来ても、それまでの費用を数えない', async ($, on) => {
  const { clock, session } = engine(on, 41)
  await start($)
  session.id = 's2'
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 1.236 }, changed: ['cost'] } as never)
  await clock.advance(30 * MINUTE)

  expect((await lines($)).some(line => /\$0\.00\/h/u.test(line))).toBe(true)
})

test('測る前は、文脈の表に「まだ測っていません」と出す', async ($, on) => {
  engine(on, 41, 0)
  await start($)

  expect((await lines($)).some(line => /まだ測っていません。/.test(line))).toBe(true)
})

test('入力欄の上: 待っている間は、│ で区切った 1 行だけを出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const found = await bandLines($)
  expect(found).toHaveLength(1)
  expect(found[0]).toMatch(/^│ Opus 5\.5 │ . feat\/dash │ \+12 -3 \?1 │ ctx 41% │ 5h 62% │ 7d 43% │ . 60m │$/u)
})

test('入力欄の上: 狭ければブランチを … で縮めて幅に収める', async ($, on) => {
  engine(on, 41)
  await start($)

  const line = (await bandLines($, 72))[0] ?? ''
  expect(line).toMatch(/│ . feat… │ \+12/u)
  expect(cells(line)).toBe(70)
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
  await $.command.run({ command: 'session-dashboard', args: '' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})

test('Session: 経った時間・ターン・呼び出しの数と、1 時間あたりの費用を出す', async ($, on) => {
  const { clock } = engine(on, 41)
  await start($)
  expect((await lines($)).some(line => /│ calls +│ 0 · — +│$/u.test(line))).toBe(true)

  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Bash', command: 'ls', description: '一覧' } as never)
  await $.tool.call({ tool: 'TaskList' } as never)
  await $.turn.complete(done())
  await clock.advance(30 * MINUTE)

  const found = await lines($)
  expect(found.some(line => /│ time +│ 30m · 1 turns +│$/u.test(line))).toBe(true)
  // 始めた時の $1.236 から増えていないので $0.00/h
  expect(found.some(line => /│ calls +│ 1 · \$0\.00\/h +│$/u.test(line))).toBe(true)
})

test('Session: /clear の後は、それまでの費用を 1 時間あたりの費用に数えない', async ($, on) => {
  const { clock, session } = engine(on, 41)
  await start($)
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 1.236 }, changed: ['cost'] } as never)
  await clock.advance(30 * MINUTE)

  expect((await lines($)).some(line => /│ calls +│ 0 · \$0\.00\/h +│$/u.test(line))).toBe(true)
})

test('turn.step: メインのターンでモデルを書き換える', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })) void _

  expect((await lines($)).some(line => /^│ model │ Sonnet 5\.5 +│$/u.test(line))).toBe(true)
})

test('リポジトリが無ければ、リポジトリの表もブランチも出さない', async ($, on) => {
  engine(on, 41, 200000, false, { isUsageBroken: false, isRepoMissing: true })
  await start($)

  expect((await lines($)).some(line => /owner\/app|branch/.test(line))).toBe(false)
  expect((await bandLines($))[0]).not.toMatch(/feat\/dash/)
})

test('版を取れなかったら、覚えずに次の読み直しでもう一度取る', async ($, on) => {
  const state: State = { isUsageBroken: false, isVersionBroken: true }
  const { session } = engine(on, 41, 200000, false, state)
  await start($)
  expect((await lines($)).some(line => /v2\.1\.319/.test(line))).toBe(false)

  state.isVersionBroken = false
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect((await lines($)).some(line => /v2\.1\.319/.test(line))).toBe(true)
})

test('pane の見張りに失敗したら、同じ失敗は 1 度だけトーストで知らせる', async ($, on) => {
  const { clock, toasts } = engine(on, 41, 200000, false, { isUsageBroken: false, isPanesBroken: true })
  await start($)
  await clock.advance(6000)

  expect(toasts.filter(text => /pane の見張り.*panes failed/.test(text))).toHaveLength(1)
})
