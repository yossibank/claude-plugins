import { expect, test } from 'claude-code/testing'

const URL = 'https://github.com/yossibank/kakeibot/pull/346'

const setup = (on: Parameters<Parameters<typeof test>[1]>[1], text: string, opened: string[][]) => {
  on('tool.call', () => ({ result: { stdout: text, stderr: '' }, text }))
  on('process.run', (_, e) => {
    opened.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('gh pr create の URL を右に開く', async ($, on) => {
  const opened: string[][] = []
  setup(on, `Creating pull request\n${URL}\n`, opened)

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --base main --title t --body-file b.md' })
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(opened).toEqual([['terminal-browser', 'open', URL, '--split', 'right']])
})

test('ほかのコマンドの URL は開かない', async ($, on) => {
  const opened: string[][] = []
  setup(on, `${URL}\n`, opened)

  await $.tool.call({ tool: 'Bash', command: 'gh pr view 346 --json url' })
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(opened).toEqual([])
})
