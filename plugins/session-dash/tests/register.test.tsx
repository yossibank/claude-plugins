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

const engine = (on: On, percent: number, window = 200000, isShown = false, files: Record<string, File> = {}, state: { isUsageBroken: boolean; free?: number; hold?: Promise<never> } = { isUsageBroken: false }) => {
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
  on('tool.call', (_, e) => {
    if (state.hold !== undefined && e.tool === 'Bash') return state.hold
    return (e.tool === 'TaskCreate' ? { result: { task: { id: '1', subject: 'x' } }, text: 'ok' } : { result: { stdout: 'ok', stderr: '' }, text: 'ok' }) as never
  })
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

type Engine = Parameters<TestBody>[0]

const lines = async ($: Engine, columns = 46) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
  const found = (await ui.findAll({ type: 'Text' })).map(element => element.text).filter(text => /^[╭│╰].*[╮│╯]$/u.test(text))
  await ui.unmount()
  return [...new Set(found)]
}

const bandLines = async ($: Engine, columns = 100) => {
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns } })
  const found = (await ui.findAll({ type: 'Text' })).map(element => element.text).filter(text => /^(● .*|│ .* │)$/u.test(text))
  await ui.unmount()
  return [...new Set(found)]
}

const working = async ($: Engine) => {
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TaskCreate', subject: '画面を直す', description: 'd', activeForm: '画面を直しています' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' } as never)
}

const done = (turnId = 't1', agentId?: string) => ({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'end_turn', ...(agentId === undefined ? {} : { agentId }) }) as never

const holding = () => {
  let release = () => {}
  const hold = new Promise<never>(resolve => {
    release = () => resolve({ result: { stdout: 'ok', stderr: '' }, text: 'ok' } as never)
  })
  return { hold, release: () => release() }
}

test('pane: どの行も幅いっぱいで、はみ出さない', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '- 次：1. 画面を直す', mtimeMs: T0 } })
  await start($)
  await working($)
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
    engine(on, 41, 200000, false, {}, { isUsageBroken: false, free })
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

test('usage が失敗したら前の値を残す', async ($, on) => {
  const state: { isUsageBroken: boolean; free?: number } = { isUsageBroken: false }
  engine(on, 41, 200000, false, {}, state)
  await start($)
  state.isUsageBroken = true
  await $.turn.complete(done())

  expect((await lines($)).some(line => /Context 41%/.test(line))).toBe(true)
})

test('次: 同じ行に並ぶ形を読み、番号を付けて出す', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '# h\n- 次：1. 画面を直す 2. テストを足す\n- 別', mtimeMs: T0 } })
  await start($)

  const found = await lines($)
  expect(found.some(line => /^╭─ . Next ─+╮$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ 1 │ 画面を直す +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ 2 │ テストを足す +│$/u.test(line))).toBe(true)
})

test('次: 次の行から字下げして続く形を読む', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '- 次：\n  1. a\n  2. b\n\n- 別 3. c', mtimeMs: T0 } })
  await start($)

  const found = await lines($)
  expect(found.some(line => /^│ 2 │ b +│$/u.test(line))).toBe(true)
  expect(found.some(line => /│ c +│$/u.test(line))).toBe(false)
})

test('次: handoff に無ければ出さず、/clear の後に読み直し、書き換わったら消える', async ($, on) => {
  const files: Record<string, File> = {}
  engine(on, 41, 200000, false, files)
  await start($)
  expect((await lines($)).some(line => /Next/.test(line))).toBe(false)

  files[HANDOFF] = { text: '- 次：1. a', mtimeMs: T0 }
  await $.classic.SessionStart({ source: 'clear' })
  expect((await lines($)).some(line => /^│ 1 │ a +│$/u.test(line))).toBe(true)

  files[HANDOFF] = { text: '- 次：1. b', mtimeMs: T0 + 1 }
  expect((await lines($)).some(line => /Next/.test(line))).toBe(false)
})

test('今の作業: 作業中の Task と、終わったツールを ✓ で出し、ターンが終わったら待つ', async ($, on) => {
  engine(on, 41)
  await start($)
  await working($)
  await $.tool.call({ tool: 'Bash', command: 'make verify', description: '確かめる' } as never)

  const found = await lines($)
  expect(found.some(line => /^╭─ . Now ─+╮$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ 作業 │ 画面を直しています +│$/u.test(line))).toBe(true)
  expect(found.some(line => /^│ 実行 │ ✓ Bash: 確かめる +│$/u.test(line))).toBe(true)

  await $.turn.complete(done())
  const idle = await lines($)
  expect(idle.some(line => /^│ 状態 │ 待っています +│$/u.test(line))).toBe(true)
  expect(idle.some(line => /Bash/.test(line))).toBe(false)
})

test('今の作業: ツールが動いている間は ● と経った秒数を出す', async ($, on) => {
  const { hold, release } = holding()
  const { clock } = engine(on, 41, 200000, false, {}, { isUsageBroken: false, hold })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  const call = $.tool.call({ tool: 'Bash', command: 'make test', description: 'テストする' } as never)
  await clock.advance(3000)

  expect((await lines($)).some(line => /^│ 実行 │ ● Bash: テストする · 3s +│$/u.test(line))).toBe(true)
  release()
  await call
  expect((await lines($)).some(line => /^│ 実行 │ ✓ Bash: テストする +│$/u.test(line))).toBe(true)
})

test('今の作業: 重なった呼び出しの片方が終わったら、残っている方を出す', async ($, on) => {
  const { hold, release } = holding()
  engine(on, 41, 200000, false, {}, { isUsageBroken: false, hold })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  const call = $.tool.call({ tool: 'Bash', command: 'make test', description: 'テストする', tool_use_id: 'b1' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'foo', agentId: 'a1', tool_use_id: 'g1' } as never)

  expect((await lines($)).some(line => /^│ 実行 │ ● Bash: テストする · 0s +│$/u.test(line))).toBe(true)
  release()
  await call
})

test('今の作業: サブエージェントの呼び出しには ↳ を付ける', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Grep', pattern: 'foo', agentId: 'a1' } as never)

  expect((await lines($)).some(line => /^│ 実行 │ ✓ ↳ Grep: foo +│$/u.test(line))).toBe(true)
})

test('今の作業: 長い行は … で幅に収める', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Bash', command: 'x', description: 'とても長い説明がずっと続いていて pane の幅には収まらない' } as never)

  const line = (await lines($)).find(text => /Bash: /.test(text)) ?? ''
  expect(line).toMatch(/… *│$/)
  expect(cells(line)).toBe(44)
})

test('今の作業: 名前の無い Task は出さない', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', status: 'in_progress' } as never)

  expect((await lines($)).some(line => /^│ 作業 │ 待っています +│$/u.test(line))).toBe(true)
})

test('/clear と session.start のやり直しの後は、今の作業を忘れる', async ($, on) => {
  engine(on, 41)
  await start($)
  await working($)
  await $.classic.SessionStart({ source: 'clear' })
  expect((await lines($)).some(line => /画面を直しています/.test(line))).toBe(false)

  await working($)
  await start($)
  expect((await lines($)).some(line => /画面を直しています/.test(line))).toBe(false)
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

test('入力欄の上: 作業中は、今の作業の行を上に足す', async ($, on) => {
  engine(on, 41)
  await start($)
  await working($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts' } as never)

  const found = await bandLines($)
  expect(found[0]).toBe('● 画面を直しています │ ✓ Edit: a.ts')
  await $.turn.complete(done())
  expect(await bandLines($)).toHaveLength(1)
})

test('入力欄の上: 今の作業の行がちょうど埋まっても、後ろを切った印に … を付ける', async ($, on) => {
  engine(on, 41)
  await start($)
  await working($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts' } as never)

  const line = (await bandLines($, 22))[0] ?? ''
  expect(line).toMatch(/…$/)
  expect(cells(line)).toBeLessThanOrEqual(20)
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
  await $.command.run({ command: 'session-dash', args: '' } as never)

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

test('Tasks: 一覧を済み・作業中・まだの印と、済みの数で出す', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: '原因を確かめる', activeForm: '確かめています', status: 'completed' },
    { content: '直す', activeForm: '直しています', status: 'in_progress' },
    { content: 'テストを通す', activeForm: '通しています', status: 'pending' },
  ] } as never)

  const found = await lines($)
  expect(found.some(line => /Tasks 1\/3/.test(line))).toBe(true)
  expect(found.some(line => /│ ✓ │ 原因を確かめる +│$/u.test(line))).toBe(true)
  expect(found.some(line => /│ ● │ 直す +│$/u.test(line))).toBe(true)
  expect(found.some(line => /│ · │ テストを通す +│$/u.test(line))).toBe(true)
  expect(found.some(line => /│ 作業 │ 直しています +│$/u.test(line))).toBe(true)
})

test('Tasks: 消した Task は一覧から外し、多すぎれば古い済みのものから落とす', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.tool.call({ tool: 'TodoWrite', todos: Array.from({ length: 10 }, (_, index) => ({ content: `項目${index}`, status: index < 3 ? 'completed' : 'pending' })) } as never)

  const found = await lines($)
  expect(found.some(line => /項目0|項目1 /.test(line))).toBe(false)
  expect(found.some(line => /│ ✓ │ 項目2 +│$/u.test(line))).toBe(true)
  expect(found.some(line => /│ · │ 項目9 +│$/u.test(line))).toBe(true)
  expect(found.some(line => /\+2 ─╯$/u.test(line))).toBe(true)

  await working($)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'deleted' } as never)
  expect((await lines($)).some(line => /画面を直す/.test(line))).toBe(false)
})

test('Files: 書き換えたファイルを新しい順に、回数とフォルダを添えて出す', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/a.ts' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.md' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/c.ts' } as never)

  const found = await lines($)
  const at = (pattern: RegExp) => found.findIndex(line => pattern.test(line))
  expect(at(/│ ×2 │ a\.ts hooks +│$/u)).toBeGreaterThan(-1)
  expect(at(/│ ×1 │ b\.md repo +│$/u)).toBeGreaterThan(at(/a\.ts hooks/))
  expect(found.some(line => /c\.ts/.test(line) && /×/.test(line))).toBe(false)
})

test('Session: /clear の後は、それまでの費用を 1 時間あたりの費用に数えない', async ($, on) => {
  const { clock } = engine(on, 41)
  await start($)
  await $.classic.SessionStart({ source: 'clear' })
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 1.236 }, changed: ['cost'] } as never)
  await clock.advance(30 * MINUTE)

  expect((await lines($)).some(line => /│ calls +│ 0 · \$0\.00\/h +│$/u.test(line))).toBe(true)
})
