import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { cellWidth } from '../hooks/cell'
import { FRAMES, SPRITE_COLUMNS, spriteCells } from '../hooks/sprite'
import { firstLineOf } from '../hooks/tool'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const T0 = 1_000_000_000

type State = {
  agents?: { id: string; status: string; type?: string; description?: string }[]
  hold?: Promise<never>
  isShown?: boolean
  usage?: Record<string, unknown>
}

const engine = (on: On, state: State = {}) => {
  const clock = mock.clock(on, { now: T0 })
  const blits: { key: string; cells: string }[] = []
  // /clear で替わるセッションの id。テストが書き換える
  const session = { id: 's1' }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: session.id }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: { command: 'agent-progress' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.blit', (_, e) => {
    blits.push(e as never)
    return { value: {} } as never
  })
  on('ui.panes', () => ({ value: [{ id: 'agent-progress', title: '🤖 Agents', isShown: state.isShown ?? false, isFocused: false, isPlaced: true }] }))
  on('tool.call', (_, e) => {
    if (state.hold !== undefined && e.tool === 'Bash') return state.hold
    return (e.tool === 'TaskCreate' ? { result: { task: { id: String(Math.random()).slice(2, 6) } }, text: 'ok' } : { result: { stdout: 'ok', stderr: '' }, text: 'ok' }) as never
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  let spawned = 0
  on('agent.spawn', () => {
    spawned += 1
    return { model: 'haiku', agentId: `a${spawned}` } as never
  })
  on('agent.list', () => ({ value: (state.agents ?? []) as never }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: state.usage ?? null } as never
  })
  return { clock, blits, session }
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const PANE = {
  plugin: 'agent-progress',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'agent-progress',
  props: { title: '🤖 Agents', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const BAND = {
  plugin: 'agent-progress',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  viewport: { columns: 80, rows: 40 },
} as const

// pane の文字の行（Text の中の Text を除いた、1 行ずつ）と、Raster の cells
const paneOf = async ($: Engine, columns = 48) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
  const texts = (await ui.findAll({ type: 'Text' })).map(element => element.text)
  const rasters = (await ui.findAll({ type: 'Raster' })).map(element => element.props as { key: string; cells: string })
  await ui.unmount()
  return { texts: [...new Set(texts)], rasters }
}

const done = (turnId = 't1', agentId?: string) => ({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'end_turn', ...(agentId === undefined ? {} : { agentId }) }) as never

const holding = () => {
  let release = () => {}
  const hold = new Promise<never>(resolve => {
    release = () => resolve({ result: { stdout: 'ok', stderr: '' }, text: 'ok' } as never)
  })
  return { hold, release: () => release() }
}

const decode = (cells: string) => {
  const bytes = Uint8Array.from(atob(cells), char => char.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  return Array.from({ length: words.length / 3 }, (_, index) => String.fromCodePoint(words[index * 3]!)).join('')
}

test('sprite: 立つコマは Claude Code のロゴと同じ字で、色を前景に詰める', async () => {
  expect(decode(spriteCells(0, '#d77757'))).toBe(FRAMES[0]!.join(''))
  expect(FRAMES.every(frame => frame.every(row => [...row].length === SPRITE_COLUMNS))).toBe(true)
  const bytes = Uint8Array.from(atob(spriteCells(0, '#d77757')), char => char.charCodeAt(0))
  expect(new Uint32Array(bytes.buffer)[1]).toBe(0xd77757)
})

test('firstLineOf: 記号を外した最初の行と、その行が改行で閉じたかを返す', async () => {
  expect(firstLineOf('\n## 直し')).toEqual({ line: '直し', isClosed: false })
  expect(firstLineOf('## 直します\n続き')).toEqual({ line: '直します', isClosed: true })
  expect(firstLineOf('  \n')).toEqual({ line: null, isClosed: false })
})

test('pane: 待っている間は、メインのカードを灰色の止まったアイコンで出す', async ($, on) => {
  engine(on)
  await start($)

  const { texts, rasters } = await paneOf($)
  expect(texts.some(text => /^Claude +待っています$/.test(text))).toBe(true)
  expect(rasters.map(raster => raster.key)).toEqual(['main'])
  expect(rasters[0]!.cells).toBe(spriteCells(0, '#565f89'))
})

test('pane: 作業中はメインのアイコンを Claude の色で動かし、時計で次のコマに差し替える', async ($, on) => {
  const { clock, blits } = engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })

  const { rasters } = await paneOf($)
  expect(rasters[0]!.cells).toBe(spriteCells(0, '#d77757'))
  await clock.advance(250)
  expect(blits.at(-1)).toMatchObject({ requestId: 'agent-progress', key: 'main', cells: spriteCells(1, '#d77757') })

  await $.turn.complete(done())
  const count = blits.length
  await clock.advance(1000)
  expect(blits.length).toBe(count)
})

test('pane: ツールが動いている間は、メインのカードに ● と経った秒数を出す', async ($, on) => {
  const { hold, release } = holding()
  const { clock } = engine(on, { hold })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  const call = $.tool.call({ tool: 'Bash', command: 'make test', description: 'テストを走らせる' } as never)
  await clock.advance(3000)

  const { texts } = await paneOf($)
  expect(texts).toContain('● Bash: テストを走らせる · 3s')
  release()
  await call
})

test('pane: サブエージェントは Running と Finished に分け、色違いのアイコンと種類・題・ツールの回数を出す', async ($, on) => {
  const { clock } = engine(on, { agents: [{ id: 'a1', status: 'completed' }] })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '画面を調べる', prompt: 'p' } as never)
  await $.agent.spawn({ subagentType: 'implementer', description: 'ボタンを直す', prompt: 'p' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.swift', agentId: 'a1' } as never)
  await clock.advance(2000)
  await $.turn.complete(done('t2', 'a1'))

  const { texts, rasters } = await paneOf($)
  expect(texts.some(text => /^▌Running · 1$/.test(text))).toBe(true)
  expect(texts.some(text => /^▌Finished · 1$/.test(text))).toBe(true)
  expect(texts.some(text => /^implementer +2s$/.test(text))).toBe(true)
  expect(texts).toContain('ボタンを直す')
  expect(texts).toContain('ツール 0')
  expect(texts).toContain('ツール 1')
  expect(texts).toContain('✓ Read: a.swift')
  const byKey = new Map(rasters.map(raster => [raster.key, raster.cells]))
  expect(byKey.get('worker-a1')).toBe(spriteCells(0, '#7aa2f7'))
  expect(byKey.get('worker-a2')).toBe(spriteCells(0, '#9ece6a'))
})

test('pane: 失敗・停止したサブエージェントは、赤いアイコンと ✗ で出す', async ($, on) => {
  engine(on, { agents: [{ id: 'a1', status: 'failed' }] })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '探す', prompt: 'p' } as never)
  await $.turn.complete(done())

  const { texts, rasters } = await paneOf($)
  expect(texts).toContain('✗ 失敗・停止しました')
  expect(rasters.find(raster => raster.key === 'worker-a1')!.cells).toBe(spriteCells(0, '#f7524a'))
})

test('pane: 終わったサブエージェントは、次のメインの turn.start で消える', async ($, on) => {
  engine(on, { agents: [{ id: 'a1', status: 'completed' }] })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '探す', prompt: 'p' } as never)
  await $.turn.complete(done())
  await $.turn.start({ turnId: 't2', text: 'next' })

  const { rasters } = await paneOf($)
  expect(rasters.map(raster => raster.key)).toEqual(['main'])
})

test('pane: 作業の一覧は、済みの数と割合の棒、作業中の項目、印付きの一覧で出す', async ($, on) => {
  engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: '調べる', status: 'completed' },
    { content: '直す', activeForm: '直しています', status: 'in_progress' },
    { content: '確かめる', status: 'pending' },
    { content: '出す', status: 'pending' },
  ] } as never)

  const { texts } = await paneOf($)
  expect(texts.some(text => /^Tasks 1\/4 ━+  25%$/.test(text))).toBe(true)
  expect(texts).toContain('Now: 直しています')
  expect(texts).toContain('✓ 調べる')
  expect(texts).toContain('● 直す')
  expect(texts).toContain('· 確かめる')
})

const USAGE = { input_tokens: 1200, cache_read_input_tokens: 40000, cache_creation_input_tokens: 7000, output_tokens: 3100, model: 'claude-opus-5-5' }

test('pane: メインのカードに、モデル・ターンの経過時間・入力と出力のトークンを出す', async ($, on) => {
  const { clock } = engine(on, { usage: USAGE })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void _
  for await (const _ of $.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 2 })) void _
  await clock.advance(134_000)

  const { texts } = await paneOf($)
  expect(texts.some(text => /^Claude  Opus 5\.5 +2m14s$/.test(text))).toBe(true)
  expect(texts).toContain('in 96.4k · out 6.2k')
})

test('pane: サブエージェントのカードに、モデルとそのトークンを出す', async ($, on) => {
  engine(on, { usage: { ...USAGE, model: 'claude-sonnet-5-5' } })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '探す', prompt: 'p' } as never)
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' } as never)) void _

  const { texts } = await paneOf($)
  expect(texts.some(text => /^Explore  Sonnet 5\.5 +0s$/.test(text))).toBe(true)
  expect(texts).toContain('in 48.2k · out 3.1k · ツール 0')
})

test('pane: 長い作業と題は、切らずに幅で折り返して出す', async ($, on) => {
  engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'x', activeForm: 'あいうえおかきくけこさしすせそたちつてとなにぬねの', status: 'in_progress' }] } as never)

  const { texts } = await paneOf($, 32)
  const width = 32 - 2 - SPRITE_COLUMNS - 1
  const wrapped = texts.filter(text => /^[あ-の]+$/.test(text))
  // メインのカードの作業は、アイコンの右の幅（全角 10 字）で 3 行に折り返す。後ろの行は Tasks の Now: の続き
  const main = wrapped.slice(0, 3)
  expect(main.join('')).toBe('あいうえおかきくけこさしすせそたちつてとなにぬねの')
  for (const text of main) expect(cellWidth(text)).toBeLessThanOrEqual(width)
  expect(texts.some(text => text.includes('…'))).toBe(false)
})

test('pane: どの文字の行も、アイコンの右の幅に収まる', async ($, on) => {
  engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'general-purpose', description: 'とても長い題がずっと続いていて pane の幅には収まらない', prompt: 'p' } as never)

  for (const columns of [48, 30]) {
    const { texts } = await paneOf($, columns)
    for (const text of texts) expect(cellWidth(text)).toBeLessThanOrEqual(columns - 2)
  }
})

test('入力欄の上: pane を閉じている作業中だけ、今の作業とサブエージェントの数を 1 行で出す', async ($, on) => {
  const { hold, release } = holding()
  const { clock } = engine(on, { hold })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '探す', prompt: 'p' } as never)
  const call = $.tool.call({ tool: 'Bash', command: 'x', description: 'ビルドする' } as never)
  await clock.advance(1000)

  const ui = await $.ui.mount(BAND)
  const texts = (await ui.findAll({ type: 'Text' })).map(element => element.text)
  await ui.unmount()
  expect(texts).toContain('● Bash: ビルドする · 1s │ サブエージェント 1')
  release()
  await call
})

test('入力欄の上: pane が見えている間は出さない', async ($, on) => {
  const { clock } = engine(on, { isShown: true })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await clock.advance(2000)

  const ui = await $.ui.mount(BAND)
  const texts = (await ui.findAll({ type: 'Text' })).map(element => element.text)
  await ui.unmount()
  expect(texts).toEqual(['engine'])
})

test('/clear: classic.SessionStart で、それまでのサブエージェントを忘れる', async ($, on) => {
  const { session } = engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '画面を調べる', prompt: 'p' } as never)
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })

  const { texts } = await paneOf($)
  expect(texts.some(text => /^▌Running/.test(text))).toBe(false)
  expect(texts.some(text => /^Claude +待っています$/.test(text))).toBe(true)
})

test('/clear: classic.SessionStart が届かなくても、見張りでセッションの替わり目を見て忘れる', async ($, on) => {
  const { clock, session } = engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '画面を調べる', prompt: 'p' } as never)
  session.id = 's2'
  await clock.advance(2000)

  const { texts } = await paneOf($)
  expect(texts.some(text => /^▌Running/.test(text))).toBe(false)
})

test('/clear: 見張りより先に次のターンが来ても、始める前に忘れる', async ($, on) => {
  const { session } = engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '画面を調べる', prompt: 'p' } as never)
  session.id = 's2'
  await $.turn.start({ turnId: 't2', text: 'next' })

  const { texts } = await paneOf($)
  expect(texts.some(text => /^▌Running/.test(text))).toBe(false)
})

test('セッションが替わらなければ、classic.SessionStart が来ても忘れない', async ($, on) => {
  engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '画面を調べる', prompt: 'p' } as never)
  await $.classic.SessionStart({ source: 'compact' })

  const { texts } = await paneOf($)
  expect(texts.some(text => /^▌Running · 1$/.test(text))).toBe(true)
})
