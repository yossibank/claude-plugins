import { expect, test } from 'claude-code/testing'

const URL = 'https://github.com/yossibank/kakeibot/pull/346'
const CREATE = ['gh', 'pr', 'create'].join(' ')

type On = Parameters<Parameters<typeof test>[1]>[1]

const setup = (on: On, text: string, opened: string[][]) => {
  on('tool.call', () => ({ result: { stdout: text, stderr: '' }, text }))
  on('process.run', (_, e) => {
    opened.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('PR を作った URL を右に開く', async ($, on) => {
  const opened: string[][] = []
  setup(on, `Creating pull request\n${URL}\n`, opened)

  await $.tool.call({ tool: 'Bash', command: `${CREATE} --base main --title t --body-file b.md` })
  await settle()

  expect(opened).toEqual([['terminal-browser', 'open', URL, '--split', 'right']])
})

test('会話が 128 列より狭い時は下に開く', async ($, on) => {
  const opened: string[][] = []
  setup(on, `${URL}\n`, opened)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine')
  })

  const ui = await $.ui.mount({
    plugin: 'pr-browser',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10 },
    viewport: { columns: 100, rows: 40 },
  })
  await ui.unmount()
  await $.tool.call({ tool: 'Bash', command: `${CREATE} --title t` })
  await settle()

  expect(opened).toEqual([['terminal-browser', 'open', URL, '--split', 'down']])
})

test('ほかのコマンドの URL は開かない', async ($, on) => {
  const opened: string[][] = []
  setup(on, `${URL}\n`, opened)

  await $.tool.call({ tool: 'Bash', command: 'gh pr view 346 --json url' })
  await settle()

  expect(opened).toEqual([])
})
