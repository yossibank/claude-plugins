import { expect, mock, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type File = { text: string; mtimeMs: number }

const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer') => ({ name, tokens, kind, color: 'text', isDeferred: false })

const T0 = 1_000_000_000
const MINUTE = 60_000
const HANDOFF = '/repo/.claude/handoff.md'
const GIT: Record<string, string> = {
  'branch --show-current': 'feat/dash\n',
  'diff HEAD': '10\t2\ta.ts\n2\t1\tb.ts\n-\t-\timg.png\n',
  'status --porcelain': ' M a.ts\n?? new.ts\n',
}

const engine = (on: On, percent: number, window = 200000, isShown = false, files: Record<string, File> = {}, state: { isUsageBroken: boolean; free?: number } = { isUsageBroken: false }) => {
  const clock = mock.clock(on, { now: T0 })
  const counts = { panes: 0 }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo/sub' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: { command: 'session-dash' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => {
    counts.panes += 1
    return { value: [{ id: 'session-dash', title: '📊 Session', isShown, isFocused: false, isPlaced: true }] }
  })
  on('session.repo', () => ({ value: { root: '/repo', remote: 'git@github.com:owner/app.git', internal: false, name: null } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.version', () => ({ value: { version: '2.1.319', base: '2.1.319' } }))
  on('process.run', (_, e) => {
    const stdout = GIT[e.argv.slice(1, 3).join(' ')] ?? '/repo\n'
    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
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
      rateLimits: [
        { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(T0 + 130 * MINUTE).toISOString() },
        { kind: 'seven_day', percentUsed: 43, resetsAt: new Date(T0 + (3 * 24 + 5) * 60 * MINUTE).toISOString() },
      ],
      cost: { usd: 1.236 },
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
  on('tool.call', (_, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: '1', subject: 'x' } }, text: 'ok' } : { result: { stdout: 'ok', stderr: '' }, text: 'ok' }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { clock, counts }
}

const start = ($: Parameters<TestBody>[0]) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const BAND = {
  plugin: 'session-dash',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  viewport: { columns: 80, rows: 40 },
} as const

const PANE = {
  plugin: 'session-dash',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'session-dash',
  props: { title: '📊 Session', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
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
    expect(cells(used)).toBe(columns - 2)
    expect(cells(row)).toBeLessThanOrEqual(columns - 2)
    await ui.unmount()
  }

  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 24 } })
  const head = (await narrow.find({ type: 'Text', text: /^CONTEXT / }))?.text ?? ''
  const used = (await narrow.find({ type: 'Text', text: /^41% / }))?.text ?? ''
  expect(cells(head)).toBe(22)
  expect(cells(used)).toBe(22)
  for (const pattern of [/^LIMIT /, /^ {7}7d /, /^REPO /, /^CLAUDE /]) {
    const line = (await narrow.find({ type: 'Text', text: pattern }))?.text ?? ''
    expect(line.length).toBeGreaterThan(0)
    expect(cells(line)).toBeLessThanOrEqual(22)
  }
  await narrow.unmount()
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
  await $.command.run({ command: 'session-dash', args: '' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /41%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})

test('pane: モデル・版・費用、リポジトリ・ブランチ・差分を出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 50 } })
  expect(await ui.find({ type: 'Text', text: /^CLAUDE Opus 5\.5 · v2\.1\.319 · \$1\.24$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^REPO {3}owner\/app {2}⚡feat\/dash {2}\+12 -3 \?1$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^\+12$/ }))?.props?.color).toBe('#7fe0a0')
  await ui.unmount()
})

test('pane: 上限は窓ごとに 1 行で、割合・棒・戻るまでの時間を出し、幅に収める', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount(PANE)
  const five = (await ui.find({ type: 'Text', text: /^LIMIT {2}5h ▰+▱+ 62% 2h10m$/ }))?.text ?? ''
  expect(cells(five)).toBe(38)
  expect(await ui.find({ type: 'Text', text: /^ {7}7d ▰+▱+ 43% 3d5h$/ })).toBeDefined()
  await ui.unmount()
})

test('session.measure で上限と費用を書き換える', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 91 }], cost: { usd: 3 }, changed: ['rateLimits', 'cost'] } as never)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^CLAUDE .*\$3\.00$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^▰+$/ }))?.props?.color).toBe('#f05a5a')
  expect(await ui.find({ type: 'Text', text: /7d/ })).toBeUndefined()
  await ui.unmount()
})

test('今の作業: 作業中の Task とツールを 2 行で出し、ターンが終わったら待つ', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TaskCreate', subject: '画面を直す', description: 'd', activeForm: '画面を直しています' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' } as never)
  await $.tool.call({ tool: 'Bash', command: 'make verify', description: '確かめる' } as never)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^NOW {4}画面を直しています$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {7}Bash: 確かめる$/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)
  const idle = await $.ui.mount(PANE)
  expect(await idle.find({ type: 'Text', text: /^ {7}待っています$/ })).toBeDefined()
  expect(await idle.find({ type: 'Text', text: /Bash/ })).toBeUndefined()
  await idle.unmount()
})

test('今の作業: サブエージェントの呼び出しには ↳ を付ける', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Grep', pattern: 'foo', agentId: 'a1' } as never)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^ {7}↳ Grep: foo$/ })).toBeDefined()
  await ui.unmount()
})

test('今の作業: 長い行は … で幅に収める', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Bash', command: 'x', description: 'とても長い説明がずっと続いていて pane の幅には収まらない' } as never)

  const ui = await $.ui.mount(PANE)
  const line = (await ui.find({ type: 'Text', text: /Bash: / }))?.text ?? ''
  expect(line.endsWith('…')).toBe(true)
  expect(cells(line)).toBeLessThanOrEqual(38)
  await ui.unmount()
})

test('入力欄の上: 作業中だけ、今の作業を 2 行足す', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: '直す', activeForm: '直しています', status: 'in_progress' }] } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^▸ 直しています$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}Edit: a\.ts$/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)
  const idle = await $.ui.mount(BAND)
  expect(await idle.find({ type: 'Text', text: /直しています|Edit/ })).toBeUndefined()
  await idle.unmount()
})

test('/clear の後は今の作業を忘れる', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TaskCreate', subject: '古い作業', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' } as never)
  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /古い作業/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^NOW {4}待っています$/ })).toBeDefined()
  await ui.unmount()
})

test('入力欄の上: モデル・ブランチ・差分・上限の 1 行を足す', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^Opus 5\.5 · ⚡feat\/dash \+12 -3 \?1 · 5h 62% · 7d 43%$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^62%$/ }))?.props?.color).toBe('#7fe0a0')
  await ui.unmount()
})

test('入力欄の上: 狭ければブランチを … で縮めて幅に収める', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 48 } })
  const line = (await ui.find({ type: 'Text', text: /^Opus 5\.5 · ⚡/ }))?.text ?? ''
  expect(line).toMatch(/⚡fe.*… \+12/)
  expect(cells(line)).toBeLessThanOrEqual(46)
  await ui.unmount()
})

test('今の作業: 名前の無い Task は出さず、直前の行を残す', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', status: 'in_progress' } as never)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^NOW {4}待っています$/ })).toBeDefined()
  await ui.unmount()
})

test('session.start をやり直したら今の作業を忘れる', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TaskCreate', subject: '古い作業', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' } as never)
  await start($)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /古い作業/ })).toBeUndefined()
  await ui.unmount()
})
