import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { checksOf, newsOf, parsePr, repoOf, unresolvedOf } from '../hooks/pr'

const URL = 'https://github.com/yossibank/kakeibot/pull/346'
const CREATE = ['gh', 'pr', 'create'].join(' ')

type On = Parameters<TestBody>[1]

// view は gh pr view の答え（null は PR なし）。threads は未解決のスレッドの答え。gh は gh に渡した引数の記録
type Opening = { exitCode?: number; stderr?: string; isMissing?: boolean; toasts?: string[]; view?: () => string | null; threads?: string; gh?: string[][] }

const setup = (on: On, text: string, opened: string[][], opening: Opening = {}) => {
  on('tool.call', () => ({ result: { stdout: text, stderr: '' }, text }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pr' } }))
  on('turn.complete', () => ({ text: '' }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'gh') {
      opening.gh?.push([...e.argv])
      const stdout = e.argv[1] === 'api' ? (opening.threads ?? null) : (opening.view?.() ?? null)
      return { value: { exitCode: stdout === null ? 1 : 0, stdout: stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    opened.push([...e.argv])
    if (opening.isMissing === true) throw new Error('not found')
    return { value: { exitCode: opening.exitCode ?? 0, stdout: '', stderr: opening.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    opening.toasts?.push(e.text)
    return { value: undefined }
  })
}

declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown

// 非同期の開く処理と、gh での取り直しが終わって、toast が出るまで待つ
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

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
    plugin: 'git-pr-browser',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
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

  expect(toasts).toEqual(['git-pr-browser: terminal-browser が見つかりません'])
})

test('terminal-browser が失敗した時は、理由を toast で知らせる', async ($, on) => {
  const toasts: string[] = []
  setup(on, `${URL}\n`, [], { exitCode: 1, stderr: 'no pane\n', toasts })

  await $.tool.call({ tool: 'Bash', command: `${CREATE} --title t` })
  await settle()

  expect(toasts).toEqual(['git-pr-browser: 開けませんでした: no pane'])
})

const VIEW = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    number: 346,
    title: 'feat: 直す',
    url: URL,
    state: 'OPEN',
    isDraft: false,
    reviewDecision: 'REVIEW_REQUIRED',
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: '' },
    ],
    ...over,
  })
const THREADS = JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] } } } } })
const BAND = {
  plugin: 'git-pr-browser',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  viewport: { columns: 140, rows: 40 },
} as const
const TURN = { answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const
const beneath = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

test('CI の結果を、通った・落ちた・まだ、に分ける', () => {
  expect(
    checksOf([
      { name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'b', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { name: 'c', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'd', status: 'QUEUED', conclusion: '' },
      { context: 'e', state: 'ERROR' },
      { context: 'f', state: 'PENDING' },
    ]),
  ).toEqual({ passed: 2, failed: 2, pending: 2, failedNames: ['c', 'e'] })
  expect(checksOf(null)).toEqual({ passed: 0, failed: 0, pending: 0, failedNames: [] })
  expect(parsePr('gh: not found')).toBe(null)
  expect(repoOf(URL)).toEqual({ owner: 'yossibank', repo: 'kakeibot' })
  expect(unresolvedOf(THREADS)).toBe(2)
  expect(unresolvedOf('{}')).toBe(null)
})

test('変わり目だけを知らせる。初めて取った時は知らせない', () => {
  const base = { ...parsePr(VIEW())!, unresolved: 0 }
  const done = { passed: 2, failed: 0, pending: 0, failedNames: [] }
  expect(newsOf(null, base)).toEqual([])
  expect(newsOf(base, base)).toEqual([])
  expect(newsOf(base, { ...base, checks: { passed: 1, failed: 1, pending: 0, failedNames: ['test'] } })).toEqual(['✖ PR #346 の CI が落ちました: test'])
  expect(newsOf(base, { ...base, checks: done })).toEqual(['✔ PR #346 の CI が通りました（2 件）'])
  expect(newsOf({ ...base, checks: done }, { ...base, checks: done })).toEqual([])
  expect(newsOf(base, { ...base, review: 'APPROVED', unresolved: 2 })).toEqual(['PR #346 のレビュー: 承認済み', 'PR #346 に未解決のコメントが増えました（2 件）'])
  expect(newsOf(base, { ...base, state: 'MERGED' })).toEqual(['✔ PR #346 がマージされました'])
})

test('PR を作ったら、CI・レビュー・未解決のコメントを入力欄の上に出す', async ($, on) => {
  mock.clock(on, { now: 0 })
  const asked: string[][] = []
  setup(on, `${URL}\n`, [], { view: () => VIEW(), threads: THREADS, gh: asked })
  beneath(on)

  await $.tool.call({ tool: 'Bash', command: `${CREATE} --title t` })
  await settle()

  expect(asked[0]).toEqual(['gh', 'pr', 'view', URL, '--json', 'number,title,url,state,isDraft,reviewDecision,statusCheckRollup'])
  expect(asked[1]?.slice(0, 3)).toEqual(['gh', 'api', 'graphql'])
  expect(asked[1]?.slice(-6)).toEqual(['-F', 'owner=yossibank', '-F', 'repo=kakeibot', '-F', 'number=346'])
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /🔀 #346/ }))?.text).toBe('🔀 #346 · CI ✔ 1 ✖ 0 ◌ 1 · レビュー待ち · 未解決 2 · feat: 直す')
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await ui.unmount()
})

test('CI が待ちの間は取り直し、落ちたらトーストで知らせて名前を出す', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const toasts: string[] = []
  let isFailed = false
  setup(on, `${URL}\n`, [], { toasts, view: () => (isFailed ? VIEW({ statusCheckRollup: [{ name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] }) : VIEW()) })
  beneath(on)

  await $.tool.call({ tool: 'Bash', command: `${CREATE} --title t` })
  await settle()
  isFailed = true
  await clock.advance(60_000)
  await settle()

  expect(toasts).toEqual(['✖ PR #346 の CI が落ちました: test'])
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /✖ test/ }))?.text).toBe('   ✖ test')
  await ui.unmount()
})

test('今のブランチに PR が無ければ、帯を出さない。push の後に見つかれば出す', async ($, on) => {
  mock.clock(on, { now: 0 })
  let hasPr = false
  const asked: string[][] = []
  setup(on, '', [], { view: () => (hasPr ? VIEW({ statusCheckRollup: [] }) : null), gh: asked })
  beneath(on)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await settle()
  expect(asked[0]).toEqual(['gh', 'pr', 'view', '--json', 'number,title,url,state,isDraft,reviewDecision,statusCheckRollup'])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /🔀/ })).toBeUndefined()

  hasPr = true
  await $.tool.call({ tool: 'Bash', command: 'git push -u origin feat/x' })
  await settle()
  expect((await ui.find({ type: 'Text', text: /🔀 #346/ }))?.text).toBe('🔀 #346 · CI なし · レビュー待ち · feat: 直す')
  await ui.unmount()
})

test('マージされたら知らせて、帯を消す', async ($, on) => {
  mock.clock(on, { now: 0 })
  const toasts: string[] = []
  let state = 'OPEN'
  setup(on, `${URL}\n`, [], { toasts, view: () => VIEW({ state, statusCheckRollup: [] }) })
  beneath(on)

  await $.tool.call({ tool: 'Bash', command: `${CREATE} --title t` })
  await settle()
  state = 'MERGED'
  await $.turn.complete(TURN)
  await settle()

  expect(toasts).toEqual(['✔ PR #346 がマージされました'])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /🔀/ })).toBeUndefined()
  await ui.unmount()
})

test('/pr で状態を取り直し、ページを開く', async ($, on) => {
  mock.clock(on, { now: 0 })
  const opened: string[][] = []
  setup(on, '', opened, { view: () => VIEW({ statusCheckRollup: [] }) })

  const ran = await $.command.run({ command: 'pr', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 140 } })

  expect(ran).toMatchObject({ text: 'PR #346 を開きました。' })
  expect(opened).toEqual([['terminal-browser', 'open', URL, '--split', 'right']])
})
