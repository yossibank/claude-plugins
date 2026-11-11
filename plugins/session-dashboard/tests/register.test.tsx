import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { cellWidth } from '../hooks/cell'
import { dayOf } from '../hooks/daily'

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
  // git の出力の上書き。鍵は引数の頭の 2 つ
  git?: Record<string, string>
  // 自動の要約が始まるトークン数
  compactAt?: number
  // 文脈の割合の上書き。テストがターンの間に書き換える
  percent?: number
  // turn.step が返す usage
  usage?: Record<string, unknown>
  // エラーを返すツールの名前
  failing?: string
  // store に初めから入っている値。鍵はローカルの日付
  stored?: Record<string, unknown>
  isStoreBroken?: boolean
}

const engine = (on: On, percent: number, window = 200000, isShown = false, state: State = { isUsageBroken: false }, now = T0) => {
  const clock = mock.clock(on, { now })
  const counts = { panes: 0, breakdowns: 0 }
  const toasts: string[] = []
  // /clear で替わるセッションの id。テストが書き換える
  const session = { id: 's1' }
  // プラグインの store。テストが書き換えて、ほかのセッションの書き込みを真似る
  const store: Record<string, unknown> = { ...state.stored }
  on('store.keys', () => (state.isStoreBroken === true ? { deny: 'store failed' } : { value: Object.keys(store) }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined } as never
  })
  on('store.delete', (_, e) => {
    delete store[e.key]
    return { value: undefined } as never
  })
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
    const stdout = { ...GIT, ...state.git }[e.argv.slice(1, 3).join(' ')] ?? '/repo\n'
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
        ...(state.isUnanswered === true ? {} : { tokens: ((state.percent ?? percent) * window) / 100, percent: state.percent ?? percent }),
        window,
        breakdown: {
          categories: [row('System prompt', 18000, 'used'), row('Messages', 64000, 'used'), row('Free space', state.free ?? 100000, 'free'), row('Autocompact buffer', 18000, 'buffer')],
          totalTokens: 82000,
          maxTokens: 200000,
          rawMaxTokens: state.raw ?? 200000,
          percentage: percent,
          gridRows: [],
          model: 'claude-opus-5-5',
          ...(state.compactAt === undefined ? { isAutoCompactEnabled: false } : { isAutoCompactEnabled: true, autoCompactThreshold: state.compactAt }),
        },
      },
    } as never,
    }
  })
  on('tool.call', (_, e) => {
    if (e.tool === state.failing) return { isError: true, result: undefined, text: 'failed' } as never
    return { result: { stdout: 'ok', stderr: '' }, text: 'ok' } as never
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: state.usage ?? null } as never
  })
  return { clock, counts, toasts, session, store }
}

const start = ($: Parameters<TestBody>[0]) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const BAND = {
  plugin: 'session-dashboard',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
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

test('pane: リポジトリの表に、upstream との差と最後の commit を出す', async ($, on) => {
  const git = { 'rev-list --left-right': '1\t2\n', 'log -1': `${(T0 - 3 * 60 * MINUTE) / 1000}\tfix: 直す\n` }
  engine(on, 41, 200000, false, { isUsageBroken: false, git })
  await start($)

  const found = await lines($)
  expect(found.some(line => /^│ sync {3}│ ↑2 ↓1 +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ last {3}│ 3h前 fix: 直す +│$/u.test(line))).toBe(true)
})

test('pane: upstream と揃っていれば「同期済み」と出し、upstream が無ければ行を出さない', async ($, on) => {
  const state: State = { isUsageBroken: false, git: { 'rev-list --left-right': '0\t0\n' } }
  engine(on, 41, 200000, false, state)
  await start($)
  expect((await lines($)).some(line => /^│ sync {3}│ 同期済み +│$/u.test(line))).toBe(true)

  state.git = {}
  await $.turn.complete(done())
  expect((await lines($)).some(line => /sync|last/.test(line))).toBe(false)
})

test('pane: 上限の表の下の罫線に、今のペースで戻る時刻まで使った時の予測を出す', async ($, on) => {
  engine(on, 41)
  await start($)

  // 5h は 300 分のうち 170 分で 62%、7d は 10080 分のうち 5460 分で 43%
  expect((await lines($)).some(line => /^╰─+ 予測 5h 109% · 7d 79% ─╯$/u.test(line))).toBe(true)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^5h 109%$/ }))?.props?.bold).toBe(true)
  await ui.unmount()
})

test('pane: 窓の長さが分からない上限には、予測を出さない', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'weekly_opus', percentUsed: 20, resetsAt: new Date(T0 + MINUTE).toISOString() }], cost: { usd: 1 }, changed: ['rateLimits'] } as never)

  expect((await lines($)).some(line => /予測/.test(line))).toBe(false)
})

test('pane: 文脈の表に、自動の要約までの残りと、ターンごとの推移からあと何ターンかを出す', async ($, on) => {
  const state: State = { isUsageBroken: false, compactAt: 180000 }
  engine(on, 41, 200000, false, state)
  await start($)

  // 推移が無い間は、残りだけを出す
  const before = await lines($)
  expect(before.some(line => /^│ 要約まで │ あと 98k +│$/u.test(line))).toBe(true)
  expect(before.some(line => /推移/.test(line))).toBe(false)

  await $.turn.complete(done())
  state.percent = 46
  await $.turn.complete(done('t2'))

  // 82k から 92k に増えたので、1 ターンで 10k。残り 88k は 9 ターン分
  const found = await lines($)
  expect(found.some(line => /^│ 推移 {5}│ ▄▄ \+10k\/ターン +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ 要約まで │ あと 88k · 約 9 ターン +│$/u.test(line))).toBe(true)
})

test('pane: 自動の要約のしきい値を超えていたら「まもなく」と出す', async ($, on) => {
  engine(on, 95, 200000, false, { isUsageBroken: false, compactAt: 180000 })
  await start($)

  expect((await lines($)).some(line => /^│ 要約まで │ まもなく +│$/u.test(line))).toBe(true)
})

test('pane: Tokens の表に、入力・出力の合計と、キャッシュから読めた割合を出す', async ($, on) => {
  const usage = { input_tokens: 1200, cache_read_input_tokens: 40000, cache_creation_input_tokens: 7000, output_tokens: 3100, model: 'claude-opus-5-5' }
  engine(on, 41, 200000, false, { isUsageBroken: false, usage })
  await start($)
  expect((await lines($)).some(line => /Tokens/.test(line))).toBe(false)

  await $.turn.start({ turnId: 't1', text: 'go' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void _
  // サブエージェントの分も合計に足す
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'a1' } as never)) void _

  const found = await lines($)
  expect(found.some(line => /^╭─ . Tokens ─+╮$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ in {4}│ 96k · 新規 16k +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ out {3}│ 6k +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ cache │ ━+ {2}83% │$/u.test(line))).toBe(true)
})

test('Session: ターンの平均と直近の時間、よく使ったツールと失敗の数を出す', async ($, on) => {
  engine(on, 41, 200000, false, { isUsageBroken: false, failing: 'Read' })
  await start($)
  expect((await lines($)).some(line => /│ (turn|tools) +│/u.test(line))).toBe(false)

  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pwd' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/none.ts' } as never)
  await $.tool.call({ tool: 'mcp__slack__search', query: 'x' } as never)
  await $.turn.complete({ ...(done() as object), durationMs: 90_000 } as never)
  await $.turn.start({ turnId: 't2', text: 'go' })
  await $.turn.complete({ ...(done('t2') as object), durationMs: 30_000 } as never)

  const found = await lines($, 60)
  expect(found.some(line => /│ turn {2}│ 平均 1m00s · 直近 30s +│$/u.test(line))).toBe(true)
  expect(found.some(line => /│ tools │ Bash 2 · Read 1 · search 1 · 失敗 1 +│$/u.test(line))).toBe(true)
})

test('/clear で、トークンの合計と文脈の推移を忘れる', async ($, on) => {
  const usage = { input_tokens: 1200, cache_read_input_tokens: 40000, cache_creation_input_tokens: 7000, output_tokens: 3100, model: 'claude-opus-5-5' }
  const { session } = engine(on, 41, 200000, false, { isUsageBroken: false, usage })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void _
  await $.turn.complete(done())
  await $.turn.complete(done('t2'))
  expect((await lines($)).some(line => /Tokens|推移/.test(line))).toBe(true)

  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect((await lines($)).some(line => /Tokens|推移/.test(line))).toBe(false)
})

const DAY = 24 * 60 * MINUTE
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const USAGE = { input_tokens: 1200, cache_read_input_tokens: 40000, cache_creation_input_tokens: 7000, output_tokens: 3100, model: 'claude-opus-5-5' }

// 1 回の応答（入力 48,200・出力 3,100）の後に、費用を usd にして、メインのターンを終える
const turn = async ($: Engine, turnId: string, usd?: number) => {
  await $.turn.start({ turnId, text: 'go' })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void _
  if (usd !== undefined) await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd }, changed: ['cost'] } as never)
  await $.turn.complete(done(turnId))
}

test('Daily: 今日と直近 7 日の合計、平均、日ごとの棒と曜日を出し、今日の棒は色を変える', async ($, on) => {
  const stored = { [dayOf(T0 - DAY)]: { usd: 2, input: 100000, output: 5000 } }
  const { store } = engine(on, 41, 200000, false, { isUsageBroken: false, usage: USAGE, stored })
  await start($)
  // 今日の分が無くても、ほかの日があれば出す
  expect((await lines($)).some(line => /^│ today │ \$0\.00 · in 0 · out 0 +│$/u.test(line))).toBe(true)

  // 始めた時の $1.236 から $1.00 増えた
  await turn($, 't1', 2.236)

  expect(store[dayOf(T0)]).toEqual({ usd: 1, input: 48200, output: 3100 })
  const found = await lines($)
  expect(found.some(line => /^╭─ . Daily ─+╮$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ today │ \$1\.00 · in 48k · out 3k +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ week {2}│ \$3\.00 · in 148k · out 8k +│$/u.test(line))).toBe(true)
  // 使った 2 日で割った平均は $1.50。今日の $1.00 はその 0.7 倍
  expect(found.some(line => /^│ avg {3}│ \$1\.50\/日 · 平均の 0\.7 倍 +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ days {2}│ ▁▁ ▁▁ ▁▁ ▁▁ ▁▁ ██ ▅▅ +│$/u.test(line))).toBe(true)
  expect(found.some(line => new RegExp(`^│ {7}│ (?:. ){6}${WEEKDAYS[new Date(T0).getDay()]} +│$`, 'u').test(line))).toBe(true)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^▅▅$/ }))?.props?.color).toBe('#ff9e64')
  expect((await ui.find({ type: 'Text', text: /^██$/ }))?.props?.color).toBe('#7aa2f7')
  await ui.unmount()
})

test('Daily: 直近 7 日に何も無ければ表を出さず、14 日より古い日は store から消す', async ($, on) => {
  const stored = { [dayOf(T0 - 13 * DAY)]: { usd: 1, input: 10, output: 1 }, [dayOf(T0 - 14 * DAY)]: { usd: 1, input: 10, output: 1 }, other: 'x' }
  const { store } = engine(on, 41, 200000, false, { isUsageBroken: false, stored })
  await start($)
  await $.turn.complete(done())

  expect((await lines($)).some(line => /Daily|today/.test(line))).toBe(false)
  expect(Object.keys(store).sort()).toEqual([dayOf(T0 - 13 * DAY), 'other'].sort())
})

test('Daily: 描き直しても、ターンが続けて終わっても、増えた分だけを足す', async ($, on) => {
  const { store } = engine(on, 41, 200000, false, { isUsageBroken: false, usage: USAGE })
  await start($)
  await turn($, 't1', 2.236)
  await lines($)
  await lines($)
  await $.turn.complete(done('t2'))
  await $.turn.complete(done('t3'))
  expect(store[dayOf(T0)]).toEqual({ usd: 1, input: 48200, output: 3100 })

  await turn($, 't4', 2.486)
  expect(store[dayOf(T0)]).toEqual({ usd: 1.25, input: 96400, output: 6200 })
})

test('Daily: 日付が変わったら、増えた分を新しい日に足し、前の日は変えない', async ($, on) => {
  // 時計を進める重さは進めた時間に比例するので、どのタイムゾーンでもローカルの 23 時 50 分から始め、0 時 1 分まで進める
  const day = new Date(T0)
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 50).getTime()
  const { clock, store } = engine(on, 41, 200000, false, { isUsageBroken: false, usage: USAGE }, from)
  await start($)
  await turn($, 't1', 2.236)
  const next = from + 11 * MINUTE
  await clock.advance(next - clock.now())
  await turn($, 't2', 2.736)

  expect(dayOf(next)).not.toBe(dayOf(from))
  expect(store[dayOf(from)]).toEqual({ usd: 1, input: 48200, output: 3100 })
  expect(store[dayOf(next)]).toEqual({ usd: 0.5, input: 48200, output: 3100 })
  const found = await lines($)
  expect(found.some(line => /^│ today │ \$0\.50 · in 48k · out 3k +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ week {2}│ \$1\.50 · in 96k · out 6k +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ days {2}│ ▁▁ ▁▁ ▁▁ ▁▁ ▁▁ ██ ▅▅ +│$/u.test(line))).toBe(true)
})

test('Daily: /clear でセッションの合計が 0 に戻っても減らさず、その後に増えた分だけを足す', async ($, on) => {
  const { session, store } = engine(on, 41, 200000, false, { isUsageBroken: false, usage: USAGE })
  await start($)
  await turn($, 't1', 2.236)
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  await $.turn.complete(done('t2'))
  expect(store[dayOf(T0)]).toEqual({ usd: 1, input: 48200, output: 3100 })

  // 費用が 0 に戻ると、増えた分は負になる。足さずに、0 から数え直す
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 0 }, changed: ['cost'] } as never)
  await $.turn.complete(done('t3'))
  expect(store[dayOf(T0)]).toEqual({ usd: 1, input: 48200, output: 3100 })

  await turn($, 't4', 0.5)
  expect(store[dayOf(T0)]).toEqual({ usd: 1.5, input: 96400, output: 6200 })
})

test('Daily: ほかのセッションが store に足した値を消さずに、その上に足す', async ($, on) => {
  const { store } = engine(on, 41, 200000, false, { isUsageBroken: false, usage: USAGE })
  await start($)
  await turn($, 't1', 2.236)

  // ほかのセッションが、今日と昨日に足した
  store[dayOf(T0)] = { usd: 6, input: 1048200, output: 13100 }
  store[dayOf(T0 - DAY)] = { usd: 3, input: 500000, output: 20000 }
  await turn($, 't2', 2.736)

  expect(store[dayOf(T0)]).toEqual({ usd: 6.5, input: 1096400, output: 16200 })
  expect(store[dayOf(T0 - DAY)]).toEqual({ usd: 3, input: 500000, output: 20000 })
  const found = await lines($)
  expect(found.some(line => /^│ today │ \$6\.50 · in 1\.1M · out 16k +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ week {2}│ \$9\.50 · in 1\.6M · out 36k +│$/u.test(line))).toBe(true)
  expect(found.some(line => /平均の 1\.4 倍/.test(line))).toBe(true)
})

test('Daily: 狭ければ、すき間、棒の太さと曜日の順に落として幅に収める', async ($, on) => {
  const stored = { [dayOf(T0 - DAY)]: { usd: 2, input: 100000, output: 5000 }, [dayOf(T0)]: { usd: 1, input: 48200, output: 3100 } }
  engine(on, 41, 200000, false, { isUsageBroken: false, stored })
  await start($)

  for (const columns of [46, 30, 22]) for (const line of await lines($, columns)) expect(cells(line)).toBe(columns - 2)
  const middle = await lines($, 30)
  expect(middle.some(line => /^│ days {2}│ ▁▁▁▁▁▁▁▁▁▁██▅▅ +│$/u.test(line))).toBe(true)
  expect(middle.some(line => new RegExp(`^│ {7}│ .{6}${WEEKDAYS[new Date(T0).getDay()]} +│$`, 'u').test(line))).toBe(true)
  const narrow = await lines($, 22)
  expect(narrow.some(line => /^│ days {2}│ ▁▁▁▁▁█▅ +│$/u.test(line))).toBe(true)
  expect(narrow.some(line => /^│ {7}│/u.test(line))).toBe(false)

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 12 } })
  const texts = (await ui.findAll({ type: 'Text' })).map(element => element.text)
  await ui.unmount()
  expect(texts.some(text => /^today \$1/.test(text))).toBe(true)
  for (const text of texts) expect(cells(text)).toBeLessThanOrEqual(10)
})

test('Daily: store に失敗したらトーストで知らせ、直ったら足せなかった分も足す', async ($, on) => {
  const state: State = { isUsageBroken: false, usage: USAGE, isStoreBroken: true }
  const { store, toasts } = engine(on, 41, 200000, false, state)
  await start($)
  await turn($, 't1', 2.236)
  expect(toasts.some(text => /日ごとの合計の保存.*store failed/.test(text))).toBe(true)
  expect(store[dayOf(T0)]).toBeUndefined()

  state.isStoreBroken = false
  await turn($, 't2', 2.736)
  expect(store[dayOf(T0)]).toEqual({ usd: 1.5, input: 96400, output: 6200 })
})
