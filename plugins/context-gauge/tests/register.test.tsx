import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer') => ({ name, tokens, kind, color: 'text', isDeferred: false })

const engine = (on: On, percent: number, window = 200000, isShown = false) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-gauge' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'context-gauge', title: '📊 Context', isShown, isFocused: false, isPlaced: true }] }))
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
  on('tool.call', (_, e) => {
    const text = 'https://github.com/owner/repo/pull/350\n'
    return { result: { stdout: text, stderr: '' }, text }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const BAND = {
  plugin: 'context-gauge',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  viewport: { columns: 80, rows: 40 },
} as const

test('割合と内訳を出す', async ($, on) => {
  engine(on, 41)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /41%.*82k \/ 200k/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /会話 64k.*システム 18k/ }))).toBeDefined()
  await ui.unmount()
})

test('PR を作ったら /clear の頃合いを出す', async ($, on) => {
  engine(on, 41)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: ['gh', 'pr', 'create', '--title', 't'].join(' ') })

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /PR #350 → \/clear/ }))).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /システム 18k/ })).toBeUndefined()
  await ui.unmount()
})

test('80% を超えたら /clear の頃合いを出す', async ($, on) => {
  engine(on, 85)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /85%.*🧹 \/clear/ })).toBeDefined()
  await ui.unmount()
})

test('上限が 1M でも 1 行目が帯の幅に収まる', async ($, on) => {
  engine(on, 61, 1_000_000)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 60 } })
  const line = (await ui.find({ type: 'Text', text: /●.*610k \/ 1M/ }))?.text ?? ''
  const cells = [...line].reduce((sum, char) => sum + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uff00-\uff60]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1), 0)
  expect(line.length).toBeGreaterThan(0)
  expect(cells).toBeLessThanOrEqual(60)
  await ui.unmount()
})

test('右の pane に割合・内訳・空きを出す', async ($, on) => {
  engine(on, 41)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

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
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'context-gauge', args: '' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /41%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})
