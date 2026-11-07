import { expect, test, type TestBody } from 'claude-code/testing'

const URL = 'https://github.com/yossibank/kakeibot/pull/346'
const CREATE = ['gh', 'pr', 'create'].join(' ')

type On = Parameters<TestBody>[1]

type Opening = { exitCode?: number; stderr?: string; isMissing?: boolean; toasts?: string[] }

const setup = (on: On, text: string, opened: string[][], opening: Opening = {}) => {
  on('tool.call', () => ({ result: { stdout: text, stderr: '' }, text }))
  on('process.run', (_, e) => {
    opened.push([...e.argv])
    if (opening.isMissing === true) throw new Error('not found')
    return { value: { exitCode: opening.exitCode ?? 0, stdout: '', stderr: opening.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    opening.toasts?.push(e.text)
    return { value: undefined }
  })
}

// 非同期の開く処理が終わって、toast が出るまで待つ
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

test('PR を作った URL を右に開く', async ($, on) => {
  const opened: string[][] = []
  setup(on, `Creating pull request\n${URL}\n`, opened)

  await $.tool.call({ tool: 'Bash', command: `${CREATE} --base main --title t --body-file b.md` })

  expect(opened).toEqual([['terminal-browser', 'open', URL, '--split', 'right']])
})

test('会話が 128 列より狭い時は下に開く', async ($, on) => {
  const opened: string[][] = []
  setup(on, `${URL}\n`, opened)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'pr-browser',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await ui.unmount()
  await $.tool.call({ tool: 'Bash', command: `${CREATE} --title t` })

  expect(opened).toEqual([['terminal-browser', 'open', URL, '--split', 'down']])
})

test('出力の最後の PR の URL を開く', async ($, on) => {
  const opened: string[][] = []
  setup(on, `https://github.com/yossibank/kakeibot/pull/1\n${URL}\n`, opened)

  await $.tool.call({ tool: 'Bash', command: `${CREATE} --title t` })

  expect(opened).toEqual([['terminal-browser', 'open', URL, '--split', 'right']])
})

test('ほかのコマンドの URL は開かない', async ($, on) => {
  const opened: string[][] = []
  setup(on, `${URL}\n`, opened)

  await $.tool.call({ tool: 'Bash', command: 'gh pr view 346 --json url' })

  expect(opened).toEqual([])
})

test('terminal-browser が見つからない時は、toast で知らせる', async ($, on) => {
  const toasts: string[] = []
  setup(on, `${URL}\n`, [], { isMissing: true, toasts })

  await $.tool.call({ tool: 'Bash', command: `${CREATE} --title t` })
  await settle()

  expect(toasts).toEqual(['pr-browser: terminal-browser が見つかりません'])
})

test('terminal-browser が失敗した時は、理由を toast で知らせる', async ($, on) => {
  const toasts: string[] = []
  setup(on, `${URL}\n`, [], { exitCode: 1, stderr: 'no pane\n', toasts })

  await $.tool.call({ tool: 'Bash', command: `${CREATE} --title t` })
  await settle()

  expect(toasts).toEqual(['pr-browser: 開けませんでした: no pane'])
})
