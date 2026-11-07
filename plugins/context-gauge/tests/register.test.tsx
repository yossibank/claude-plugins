import { expect, mock, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type File = { text: string; mtimeMs: number }

const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer') => ({ name, tokens, kind, color: 'text', isDeferred: false })

const T0 = 1_000_000_000
const MINUTE = 60_000
const HANDOFF = '/repo/.claude/handoff.md'

const engine = (on: On, percent: number, window = 200000, isShown = false, files: Record<string, File> = {}) => {
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
  on('session.usage', () => ({
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
  }))
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

test('割合と内訳を出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /41%.*82k \/ 200k/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /会話 64k.*システム 18k/ }))).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /頃合い/ })).toBeUndefined()
  await ui.unmount()
})

test('区切り: gh pr merge の番号を理由にする', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 350 --squash' })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^🧹 今が \/clear の頃合い {2}PR #350 をマージした$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /システム 18k/ })).toBeUndefined()
  await ui.unmount()
})

test('区切り: prune-merged.sh は 3 つ目の引数から番号を取る', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.tool.call({ tool: 'Bash', command: './prune-merged.sh kakeibot feat/x 351' })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /PR #351 をマージした/ })).toBeDefined()
  await ui.unmount()
})

test('区切り: 番号が取れなければ汎用の文言にする', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'prune-merged.sh' })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /区切りのコマンドが走った/ })).toBeDefined()
  await ui.unmount()
})

test('PR を作っても /clear を勧めない', async ($, on) => {
  engine(on, 41)
  await start($)
  await $.tool.call({ tool: 'Bash', command: ['gh', 'pr', 'create', '--title', 't'].join(' ') })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /頃合い/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /システム 18k/ })).toBeDefined()
  await ui.unmount()
})

test('キャッシュが切れて黄を超えたら頃合い', async ($, on) => {
  const { clock } = engine(on, 55)
  await start($)
  await clock.advance(60 * MINUTE)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /頃合い {2}キャッシュが切れた（55%）/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {3}続けても安くならない · / })).toBeDefined()
  await ui.unmount()
})

test('キャッシュが切れても黄に届かなければ頃合いでない', async ($, on) => {
  const { clock } = engine(on, 41)
  await start($)
  await clock.advance(90 * MINUTE)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /頃合い/ })).toBeUndefined()
  await ui.unmount()
})

test('赤を超えたら頃合い。キャッシュの残りを分で出す', async ($, on) => {
  const { clock } = engine(on, 85)
  await start($)
  await clock.advance(20 * MINUTE)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /頃合い {2}文脈が 85%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {3}キャッシュ切れまで 40 分 · / })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /キャッシュ切れまで 50 分/ })).toBeDefined()
  await ui.unmount()
})

test('handoff: ファイルが無い・始まりより古い時は先に ctx-handoff', async ($, on) => {
  engine(on, 85, 200000, false, { [HANDOFF]: { text: '- 次：1. a', mtimeMs: T0 - 1 } })
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /handoff.md が古いので先に ctx-handoff/ })).toBeDefined()
  await ui.unmount()
})

test('handoff: ファイルが無ければ古い扱い', async ($, on) => {
  engine(on, 85)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /handoff.md が古いので先に ctx-handoff/ })).toBeDefined()
  await ui.unmount()
})

test('handoff: 空なら古い扱い', async ($, on) => {
  engine(on, 85, 200000, false, { [HANDOFF]: { text: '', mtimeMs: T0 + 1 } })
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /handoff.md が古いので先に ctx-handoff/ })).toBeDefined()
  await ui.unmount()
})

test('handoff: 始まりより新しければ新しい', async ($, on) => {
  const files: Record<string, File> = { [HANDOFF]: { text: 'x', mtimeMs: T0 + 1 } }
  engine(on, 85, 200000, false, files)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /handoff.md は新しい/ })).toBeDefined()
  await ui.unmount()
})

test('handoff: 区切りより古ければ古い、書き直せば新しい', async ($, on) => {
  const files: Record<string, File> = { [HANDOFF]: { text: 'x', mtimeMs: T0 + 1 } }
  const { clock } = engine(on, 41, 200000, false, files)
  await start($)
  await clock.advance(5 * MINUTE)
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 350' })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /handoff.md が古いので先に ctx-handoff/ })).toBeDefined()
  await ui.unmount()
  files[HANDOFF] = { text: 'y', mtimeMs: T0 + 6 * MINUTE }
  const again = await $.ui.mount(BAND)
  expect(await again.find({ type: 'Text', text: /handoff.md は新しい/ })).toBeDefined()
  await again.unmount()
})

test('次: 同じ行に並ぶ形を読む。2 つ目からは字下げする', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '# h\n- 次：1. 画面を直す 2. テストを足す\n- 別', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^📌 次 {2}1\. 画面を直す$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {7}2\. テストを足す$/ })).toBeDefined()
  await ui.unmount()
})

test('次: 次の行から字下げして続く形を読む', async ($, on) => {
  engine(on, 41, 200000, false, { [HANDOFF]: { text: '- 次：\n  1. a\n  2. b\n\n- 別 3. c', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^📌 次 {2}1\. a$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {7}2\. b$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /c$/ })).toBeUndefined()
  await ui.unmount()
})

test('次: 頃合いの 2 行の下に置く。区切りが来たら消える', async ($, on) => {
  engine(on, 85, 200000, false, { [HANDOFF]: { text: '- 次：1. a', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /📌 次 {2}1\. a/ })).toBeDefined()
  await ui.unmount()
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 350' })
  const again = await $.ui.mount(BAND)
  expect(await again.find({ type: 'Text', text: /📌 次/ })).toBeUndefined()
  await again.unmount()
})

test('次: handoff.md が書き換わったら消える', async ($, on) => {
  const files: Record<string, File> = { [HANDOFF]: { text: '- 次：1. a', mtimeMs: T0 } }
  engine(on, 41, 200000, false, files)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /📌 次/ })).toBeDefined()
  await ui.unmount()
  files[HANDOFF] = { text: '- 次：1. b', mtimeMs: T0 + 1 }
  const again = await $.ui.mount(BAND)
  expect(await again.find({ type: 'Text', text: /📌 次/ })).toBeUndefined()
  await again.unmount()
})

test('次: /clear の後に読み直す', async ($, on) => {
  const files: Record<string, File> = {}
  engine(on, 41, 200000, false, files)
  await start($)
  files[HANDOFF] = { text: '- 次：1. a', mtimeMs: T0 }
  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /📌 次 {2}1\. a/ })).toBeDefined()
  await ui.unmount()
})

test('options: 割合と寿命を変える', { options: { cacheMinutes: '5', yellowAt: 30, redAt: 90 } }, async ($, on) => {
  const { clock } = engine(on, 35)
  await start($)
  await clock.advance(6 * MINUTE)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /頃合い {2}キャッシュが切れた（35%）/ })).toBeDefined()
  await ui.unmount()
})

test('80% を超えたら頃合いにする（既定の赤）', async ($, on) => {
  engine(on, 85)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /85%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /頃合い {2}文脈が 85%/ })).toBeDefined()
  await ui.unmount()
})

test('上限が 1M でも 1 行目が帯の幅に収まる', async ($, on) => {
  engine(on, 61, 1_000_000)
  await start($)

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 60 } })
  const line = (await ui.find({ type: 'Text', text: /●.*610k \/ 1M/ }))?.text ?? ''
  const cells = [...line].reduce((sum, char) => sum + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uff00-\uff60]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1), 0)
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

test('右の pane にも頃合いの 2 行と次を出す', async ($, on) => {
  engine(on, 85, 200000, false, { [HANDOFF]: { text: '- 次：1. a', mtimeMs: T0 } })
  await start($)

  const ui = await $.ui.mount({
    plugin: 'context-gauge',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'context-gauge',
    props: { title: '📊 Context', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /^🧹 今が \/clear の頃合い {2}文脈が 85%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {3}キャッシュ切れまで 60 分 · handoff.md は新しい$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^📌 次 {2}1\. a$/ })).toBeDefined()
  await ui.unmount()
})

test('頃合いでない pane は赤の割合で /clear の行を残す', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount({
    plugin: 'context-gauge',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'context-gauge',
    props: { title: '📊 Context', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /^🧹 80% で \/clear$/ })).toBeDefined()
  await ui.unmount()
})

test('右の pane に割合・内訳・空きを出す', async ($, on) => {
  engine(on, 41)
  await start($)

  const ui = await $.ui.mount({
    plugin: 'context-gauge',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'context-gauge',
    props: { title: '📊 Context', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /^╻ ╻ ╺┓  █ ▞$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /会話\s+⣿.*64k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /82k \/ 200k · 空き 100k/ })).toBeDefined()
  await ui.unmount()
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
