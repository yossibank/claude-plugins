import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { cellWidth } from '../hooks/cell'
import { FRAME_MS, FRAMES, LOOP_TICKS, sceneOf, SPRITE_COLUMNS, SPRITE_ROWS, spriteCells, stillCells } from '../hooks/sprite'
import { describe, firstLineOf } from '../hooks/tool'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const T0 = 1_000_000_000

type State = {
  agents?: { id: string; status: string; type?: string; description?: string }[]
  hold?: Promise<never>
  isShown?: boolean
  usage?: Record<string, unknown>
  // エラーを返すツールの名前
  failing?: string
  // turn.step が流す応答の文字
  said?: string
  compacting?: Promise<never>
  // hold で止めるツールの名前。無ければ Bash
  held?: string
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
    if (state.hold !== undefined && e.tool === (state.held ?? 'Bash')) return state.hold
    if (e.tool === state.failing) return { isError: true, result: undefined, text: 'failed' } as never
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
    if (state.said !== undefined) yield { kind: 'text', index: 0, text: state.said } as never
    return { turnId: e.turnId, index: e.index, answer: state.said ?? '', toolUses: [], stopReason: 'end_turn', usage: state.usage ?? null } as never
  })
  on('session.compact', () => state.compacting ?? ({ skip: 'test' } as never))
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
  props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
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

const wordsOf = (cells: string) => new Uint32Array(Uint8Array.from(atob(cells), char => char.charCodeAt(0)).buffer)

const decode = (cells: string) => {
  const words = wordsOf(cells)
  return Array.from({ length: words.length / 3 }, (_, index) => String.fromCodePoint(words[index * 3]!)).join('')
}

// マスごとの前景の色
const colorsOf = (cells: string) => {
  const words = wordsOf(cells)
  return Array.from({ length: words.length / 3 }, (_, index) => words[index * 3 + 1]!)
}

// 行ごとに分けた字。air は頭の上の 1 行、body はその下の体の 3 行
const rowsOf = (cells: string) => {
  const glyphs = [...decode(cells)]
  return Array.from({ length: SPRITE_ROWS }, (_, row) => glyphs.slice(row * SPRITE_COLUMNS, (row + 1) * SPRITE_COLUMNS).join(''))
}
const airOf = (cells: string) => rowsOf(cells)[0]!
const bodyOf = (cells: string) => rowsOf(cells).slice(1).join('')
const bodyColorsOf = (cells: string) => colorsOf(cells).slice(SPRITE_COLUMNS)

test('sprite: 止まったアイコンは Claude Code のロゴと同じ字で、1 色を前景に詰める', async () => {
  expect(bodyOf(stillCells('#d77757'))).toBe(FRAMES[0]!.join(''))
  expect(FRAMES.every(frame => frame.every(row => [...row].length === SPRITE_COLUMNS))).toBe(true)
  expect(new Set(colorsOf(stillCells('#d77757')))).toEqual(new Set([0xd77757]))
})

test('sprite: 止まったアイコンは、待ち・完了・失敗の印を頭の上に添える', async () => {
  expect(airOf(stillCells('#565f89', 'idle'))).toBe('     zZ  ')
  expect(airOf(stillCells('#7aa2f7', 'done'))).toBe('    ✓    ')
  expect(airOf(stillCells('#f7524a', 'failed'))).toBe('    ✗    ')
  // 印は体と別の色で塗る
  expect(colorsOf(stillCells('#7aa2f7', 'done'))[4]).toBe(0x9ece6a)
})

test('sprite: 動くアイコンは、立つ・かがむ・まばたきを替えながら 1 周で元に戻る', async () => {
  const poses = new Set(Array.from({ length: LOOP_TICKS }, (_, tick) => bodyOf(spriteCells(tick, '#d77757'))))
  expect(poses).toEqual(new Set(FRAMES.map(frame => frame.join(''))))
  expect(bodyOf(spriteCells(0, '#d77757'))).toBe(FRAMES[0]!.join(''))
  expect(spriteCells(LOOP_TICKS, '#d77757')).toBe(spriteCells(0, '#d77757'))
})

test('sprite: 動くアイコンは、光の帯で体のマスごとに色を変え、コマごとに帯を動かす', async () => {
  expect(new Set(bodyColorsOf(spriteCells(8, '#d77757'))).size).toBeGreaterThan(6)
  // 帯のいちばん明るいマスは、コマが進むと右へ動く
  const brightest = (tick: number) => {
    const row = bodyColorsOf(spriteCells(tick, '#d77757')).slice(SPRITE_COLUMNS, SPRITE_COLUMNS * 2)
    return row.indexOf(Math.max(...row))
  }
  expect(brightest(12)).toBeGreaterThan(brightest(8))
})

test('sprite: きらめきは、決まった動きの無い時に、頭の上の行で場所を替えながら光る', async () => {
  const seen = new Set<number>()
  for (let tick = 0; tick < LOOP_TICKS; tick += 1) {
    const cells = spriteCells(tick, '#d77757')
    expect(/[.+*]/.test(bodyOf(cells))).toBe(false)
    const at = airOf(cells).search(/[.+*]/)
    if (at >= 0) seen.add(at)
  }
  expect(seen).toEqual(new Set([1, 6, 3, 7]))
})

test('sprite: どの動きのどのコマも、9 桁で、体は 3 行に収まる', async () => {
  for (const action of ['plain', 'think', 'type', 'read', 'web', 'play', 'idle', 'done', 'failed'] as const) {
    for (let tick = 0; tick < LOOP_TICKS * 3; tick += 1) {
      const scene = sceneOf(action, tick)
      expect(scene.body.length).toBe(3)
      for (const row of [scene.air, scene.inks, ...scene.body]) expect([...row].length).toBe(SPRITE_COLUMNS)
    }
  }
})

test('sprite: パソコンを打つ動きは、腕を交互に下ろし、頭の上に打った字を伸ばす', async () => {
  const arms = (tick: number) => sceneOf('type', tick).body[1]
  expect(arms(0)).not.toBe(arms(2))
  expect(arms(0)).toBe(arms(4))
  expect(airOf(spriteCells(0, '#d77757', 'type'))).toBe('>_       ')
  expect(airOf(spriteCells(4, '#d77757', 'type'))).toBe('>==_     ')
})

test('sprite: ヘディングの動きは、落ちてきたボールを、かがんで待ち、跳んで打ち上げる', async () => {
  const rows = (tick: number) => rowsOf(spriteCells(tick, '#d77757', 'play'))
  // ボールが頭の上にあり、立っている
  expect(rows(0)).toEqual(['    o    ', ...FRAMES[0]!])
  // かがんで待つ
  expect(rows(2)).toEqual(['    o    ', ...FRAMES[1]!])
  // 跳ぶと体が 1 行上がり、ボールは上へ消えて、足元に影が出る
  expect(rows(4)).toEqual([...FRAMES[0]!, '   ▔▔▔   '])
  // 降りて、ボールが落ちてくるのを待つ
  expect(rows(8)).toEqual(['         ', ...FRAMES[0]!])
  expect(rows(14)).toEqual(rows(0))
})

test('firstLineOf: 記号を外した最初の行と、その行が改行で閉じたかを返す', async () => {
  expect(firstLineOf('\n## 直し')).toEqual({ line: '直し', isClosed: false })
  expect(firstLineOf('## 直します\n続き')).toEqual({ line: '直します', isClosed: true })
  expect(firstLineOf('  \n')).toEqual({ line: null, isClosed: false })
})

test('describe: 親のフォルダ・読む範囲・探す場所・MCP の最初の引数まで出す', async () => {
  expect(describe({ tool: 'Read', file_path: '/repo/hooks/view.ts', offset: 40, limit: 20 })).toBe('Read: hooks/view.ts:40-59')
  expect(describe({ tool: 'Edit', file_path: '/repo/hooks/view.ts' })).toBe('Edit: hooks/view.ts')
  expect(describe({ tool: 'Grep', pattern: 'mainCard', path: '/repo/plugins/hooks' })).toBe('Grep: mainCard in plugins/hooks')
  expect(describe({ tool: 'Grep', pattern: 'mainCard', glob: '*.ts' })).toBe('Grep: mainCard in *.ts')
  expect(describe({ tool: 'mcp__slack__search', tool_use_id: 'u1', limit: 5, query: '仕様' })).toBe('search: 仕様')
  expect(describe({ tool: 'AskUserQuestion', questions: [] })).toBe('AskUserQuestion')
})

test('pane: 待っている間は、メインのカードを灰色の止まったアイコンで出す', async ($, on) => {
  engine(on)
  await start($)

  const { texts, rasters } = await paneOf($)
  expect(texts.some(text => /^Claude +待っています$/.test(text))).toBe(true)
  expect(rasters.map(raster => raster.key)).toEqual(['main'])
  expect(rasters[0]!.cells).toBe(stillCells('#565f89', 'idle'))
})

test('pane: 作業中はメインのアイコンを Claude の色で動かし、時計で次のコマに差し替える', async ($, on) => {
  const { clock, blits } = engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })

  const { rasters } = await paneOf($)
  // 動いているツールが無い間は、考えている動き
  expect(rasters[0]!.cells).toBe(spriteCells(0, '#d77757', 'think'))
  await clock.advance(FRAME_MS)
  expect(blits.at(-1)).toMatchObject({ requestId: 'agent-progress', key: 'main', cells: spriteCells(1, '#d77757', 'think') })

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
  expect(texts).toContain('✓ Read: repo/a.swift')
  const byKey = new Map(rasters.map(raster => [raster.key, raster.cells]))
  expect(byKey.get('worker-a1')).toBe(stillCells('#7aa2f7', 'done'))
  // 動いているアイコンは、経った 2 秒の分だけコマが進んでいる
  expect(byKey.get('worker-a2')).toBe(spriteCells(2000 / FRAME_MS, '#9ece6a', 'think'))
})

test('pane: 失敗・停止したサブエージェントは、赤いアイコンと ✗ で出す', async ($, on) => {
  engine(on, { agents: [{ id: 'a1', status: 'failed' }] })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '探す', prompt: 'p' } as never)
  await $.turn.complete(done())

  const { texts, rasters } = await paneOf($)
  expect(texts).toContain('✗ 失敗・停止しました')
  expect(rasters.find(raster => raster.key === 'worker-a1')!.cells).toBe(stillCells('#f7524a', 'failed'))
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

test('pane: メインのカードに、終わったツールの履歴・失敗の印・ツールの内訳を出す', async ($, on) => {
  const { hold, release } = holding()
  const { clock } = engine(on, { hold, failing: 'Edit' })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.swift' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/b.swift' } as never)
  const call = $.tool.call({ tool: 'Bash', command: 'make test', description: 'テストを走らせる' } as never)
  await clock.advance(3000)

  const { texts } = await paneOf($)
  expect(texts).toContain('✓ Read: repo/a.swift')
  expect(texts).toContain('✗ Edit: repo/b.swift')
  expect(texts).toContain('● Bash: テストを走らせる · 3s')
  expect(texts).toContain('ツール 3 · 失敗 1')
  // 内訳は、色分けした割合の棒と、その下の名前で出す。棒はアイコンと枠を除いた幅いっぱい
  const bar = texts.find(text => /^━+$/.test(text))
  expect(cellWidth(bar ?? '')).toBe(48 - 2 - 4 - SPRITE_COLUMNS - 1)
  expect(texts).toContain('Read 1 · Edit 1 · Bash 1')
  release()
  await call

  // 終わったツールは履歴に移り、かかった時間を添える
  expect((await paneOf($)).texts).toContain('✓ Bash: テストを走らせる · 3s')
})

test('pane: ターンが終わったら、メインのカードに終わり方とかかった時間を出す', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await clock.advance(5000)
  await $.turn.complete({ ...(done() as object), reason: 'answer' } as never)
  expect((await paneOf($)).texts.some(text => /^Claude +✓ 完了 5s$/.test(text))).toBe(true)

  await $.turn.start({ turnId: 't2', text: 'go' })
  await clock.advance(2000)
  await $.turn.complete({ ...(done('t2') as object), isAborted: true, reason: 'aborted' } as never)
  expect((await paneOf($)).texts.some(text => /^Claude +■ 中断 2s$/.test(text))).toBe(true)
})

test('pane: サブエージェントのカードに、動いている間は発言を、終わったら報告の最初の行を出す', async ($, on) => {
  engine(on, { agents: [{ id: 'a1', status: 'completed' }], said: '## 構成を調べます\n続き' })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '探す', prompt: 'p' } as never)
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' } as never)) void _
  expect((await paneOf($)).texts).toContain('› 構成を調べます')

  await $.turn.complete({ ...(done('t2', 'a1') as object), answer: '原因は view.ts でした\n詳しくは…' } as never)
  const { texts } = await paneOf($)
  expect(texts).toContain('✓ 原因は view.ts でした')
  expect(texts).not.toContain('› 構成を調べます')
})

test('pane: 会話を要約している間は、メインのカードにそう出す', async ($, on) => {
  const compacting = new Promise<never>(() => {})
  engine(on, { compacting })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  void $.session.compact({ trigger: 'auto', messages: [] } as never)
  await Promise.resolve()

  expect((await paneOf($)).texts).toContain('会話を要約しています…')
})

test('入力欄の上: 作業の一覧があれば、済みの数を添える', async ($, on) => {
  engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: '調べる', status: 'completed' },
    { content: '直す', activeForm: '直しています', status: 'in_progress' },
  ] } as never)

  const ui = await $.ui.mount(BAND)
  const texts = (await ui.findAll({ type: 'Text' })).map(element => element.text)
  await ui.unmount()
  expect(texts).toContain('● 直しています │ Tasks 1/2')
})

test('pane: サブエージェントがいる間は、メインと足した合計を出す', async ($, on) => {
  engine(on, { usage: USAGE })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void _
  expect((await paneOf($)).texts.some(text => text.startsWith('Σ 合計'))).toBe(false)

  await $.agent.spawn({ subagentType: 'Explore', description: '探す', prompt: 'p' } as never)
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' } as never)) void _
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.swift' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.swift', agentId: 'a1' } as never)

  expect((await paneOf($)).texts).toContain('Σ 合計 2 体 · in 96.4k · out 6.2k · ツール 2')
})

test('pane: 広い pane ではカードを枠で囲み、狭い pane では枠を付けない', async ($, on) => {
  engine(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })

  const framed = async (columns: number) => {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
    const boxes = (await ui.findAll({ type: 'Box' })).map(element => element.props as { borderStyle?: string; borderColor?: string })
    await ui.unmount()
    return boxes.filter(box => box.borderStyle === 'round').map(box => box.borderColor)
  }
  expect(await framed(48)).toEqual(['#d77757'])
  expect(await framed(32)).toEqual([])
})

test('pane: アイコンは、動いているツールに合わせて動きを替える', async ($, on) => {
  const { hold, release } = holding()
  const { clock, blits } = engine(on, { hold, agents: [{ id: 'a1', status: 'running' }] })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.agent.spawn({ subagentType: 'Explore', description: '探す', prompt: 'p' } as never)
  const call = $.tool.call({ tool: 'Bash', command: 'make test' } as never)
  const read = $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)
  await clock.advance(FRAME_MS)

  // メインもサブエージェントも Bash が動いているので、パソコンを打つ
  const { rasters } = await paneOf($)
  expect(rasters.map(raster => airOf(raster.cells))).toEqual(['>_       ', '>_       '])
  await clock.advance(FRAME_MS)
  expect(blits.at(-1)).toMatchObject({ key: 'worker-a1', cells: spriteCells(2, '#7aa2f7', 'type') })
  release()
  await Promise.all([call, read])
})

test('pane: サブエージェントを待つだけの間は、メインのアイコンがヘディングをする', async ($, on) => {
  const { hold, release } = holding()
  const { clock } = engine(on, { hold, held: 'Agent' })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  const waiting = $.tool.call({ tool: 'Agent', description: '探す', prompt: 'p' } as never)
  await clock.advance(FRAME_MS)

  const main = (await paneOf($)).rasters.find(raster => raster.key === 'main')!
  expect(airOf(main.cells)).toBe('    o    ')
  release()
  await waiting
})
