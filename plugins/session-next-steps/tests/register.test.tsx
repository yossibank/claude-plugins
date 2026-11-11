import { expect, test, type TestBody } from 'claude-code/testing'

import { DEFAULTS } from '../hooks/config'
import { checkOf, cut } from '../hooks/steps'

declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown

type On = Parameters<TestBody>[1]
type Self = Parameters<TestBody>[0]

const BAND = (bodyColumns = 80, hasSurvey = false) =>
  ({
    plugin: 'session-next-steps',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    viewport: { columns: bodyColumns + 5, rows: 40 },
  }) as const

const TURN = { answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const

type World = {
  isRepo?: boolean
  status?: string
  // upstream より先の commit の数。upstream が無い時は null
  ahead?: number | null
  // どのリモートにも無い commit の数
  alone?: number
  remotes?: string
  branch?: string
  // 'none' は PR なし、'found' は PR あり、'missing' は gh が無い、'broken' は gh がほかの理由で失敗
  pr?: 'none' | 'found' | 'missing' | 'broken'
  tokens?: number
  // 失敗させる Bash のコマンド
  failing?: RegExp
  isFilled?: boolean
}

const engine = (on: On, world: World = {}) => {
  const { isRepo = true, status = '', ahead = 0, alone = 0, remotes = 'origin', branch = 'main', pr = 'found', tokens = 10_000, failing, isFilled = true } = world
  const seen = { runs: [] as string[], fills: [] as string[], toasts: [] as string[] }
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } as never })
  const ng = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr } as never })
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => {
    const args = e.argv.join(' ')
    seen.runs.push(args)
    if (e.argv[0] === 'gh') {
      if (pr === 'missing') throw new Error('spawn gh ENOENT')
      if (pr === 'broken') return ng('gh: To get started with GitHub CLI, please run: gh auth login')
      return pr === 'found' ? ok('{"number":12}') : ng('no pull requests found for branch "feat/x"')
    }
    if (args.includes('--is-inside-work-tree')) return isRepo ? ok('true\n') : ng('fatal: not a git repository')
    if (args.includes('--porcelain')) return ok(status)
    if (args.includes('@{upstream}..HEAD')) return ahead === null ? ng('fatal: no upstream configured') : ok(`${ahead}\n`)
    if (args.includes('--not --remotes')) return ok(`${alone}\n`)
    if (args === 'git remote') return ok(remotes)
    if (args.includes('--show-current')) return ok(`${branch}\n`)
    if (args.includes('symbolic-ref')) return ok('origin/main\n')
    return ng('unknown')
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens, window: 1_000_000, breakdown: { rawMaxTokens: 200_000, categories: [] } } } as never,
  }))
  on('tool.call', (_, e) => {
    const isFailed = failing !== undefined && e.tool === 'Bash' && failing.test(e.command)
    return (isFailed ? { result: undefined, text: 'Exit code 2', isError: true } : { result: { stdout: '', stderr: '' }, text: '' }) as never
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.fill', (_, e) => {
    seen.fills.push(e.text)
    return { isFilled }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return seen
}

// void で走らせた調べが終わるのを待つ
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

const finish = async ($: Self) => {
  await $.turn.complete(TURN)
  await settle()
}

// 帯のボタンの字を、上から順に返す
const rows = async ($: Self, bodyColumns = 80) => {
  const ui = await $.ui.mount(BAND(bodyColumns))
  const texts = (await ui.findAll({ type: 'Button' })).map(button => button.text)
  await ui.unmount()
  return texts
}

const edit = ($: Self, path: string) => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })

test('最後のテストが失敗していたら、直すよう勧める', async ($, on) => {
  engine(on, { failing: /make -C \/repo test/ })

  await $.turn.start({ text: '直して', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'make build' })
  await $.tool.call({ tool: 'Bash', command: 'make -C /repo test' })
  await finish($)

  const ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: '➡ 次の一手' })).toBeDefined()
  expect((await ui.find({ key: 'step-fix' }))?.text).toMatch(/^落ちた所を直して\s+make -C \/repo test が失敗した$/)
  expect(await ui.find({ key: 'step-check' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('失敗の後に通っていたら、直すよう勧めない', async ($, on) => {
  engine(on, { failing: /make test/ })

  await $.tool.call({ tool: 'Bash', command: 'make test' })
  await $.tool.call({ tool: 'Bash', command: 'make verify' })
  await finish($)

  expect(await rows($)).toEqual([])
})

test('書き換えた後に確かめていなければ、テストを走らせるよう勧める', async ($, on) => {
  engine(on)

  await $.tool.call({ tool: 'Bash', command: 'make test' })
  await edit($, '/repo/a.ts')
  await edit($, '/repo/a.ts')
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "make test を通す"' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/c.ts' })
  await finish($)

  expect(await rows($)).toEqual([expect.stringMatching(/^make test を走らせて\s+2 ファイルを書き換えた後、まだ確かめていない$/), '隠す'])
})

test('書き換えた後に確かめていたら、テストを勧めない。次のターンには前のターンの書き換えを持ち越さない', async ($, on) => {
  engine(on)

  await edit($, '/repo/a.ts')
  await $.tool.call({ tool: 'Bash', command: 'cd /repo && npm run test' })
  await finish($)
  expect(await rows($)).toEqual([])

  await edit($, '/repo/a.ts')
  await finish($)
  expect(await rows($)).toHaveLength(2)

  await $.turn.start({ text: '次', turnId: 't2' })
  expect(await rows($)).toEqual([])
  await finish($)
  expect(await rows($)).toEqual([])
})

test('未 commit の変更があれば、commit を勧める', async ($, on) => {
  engine(on, { status: ' M a.ts\n?? b.ts\n' })

  await finish($)

  expect(await rows($)).toEqual([expect.stringMatching(/^変更を commit して\s+未 commit 2 件$/), '隠す'])
})

test('push していない commit があれば、push を勧める', async ($, on) => {
  engine(on, { ahead: 2 })
  await finish($)
  expect(await rows($)).toEqual([expect.stringMatching(/^push して\s+push していない commit 2 つ$/), '隠す'])
})

test('upstream が無いブランチは、どのリモートにも無い commit を数える', async ($, on) => {
  const seen = engine(on, { ahead: null, alone: 3, branch: 'feat/x', pr: 'none' })
  await finish($)
  expect(await rows($)).toEqual([expect.stringMatching(/^push して\s+push していない commit 3 つ$/), '隠す'])
  // push していないブランチでは、PR を調べない
  expect(seen.runs.some(run => run.startsWith('gh '))).toBe(false)
})

test('push 済みのブランチに PR が無ければ、PR を勧める', async ($, on) => {
  const seen = engine(on, { branch: 'feat/x', pr: 'none' })

  await finish($)

  expect(seen.runs).toContain('gh pr view --json number')
  expect(await rows($)).toEqual([expect.stringMatching(/^PR を作って\s+push 済みで、PR がまだ無い$/), '隠す'])
})

test('PR がある時は、PR を勧めない', async ($, on) => {
  const seen = engine(on, { branch: 'feat/x', pr: 'found' })
  await finish($)
  await finish($)
  expect(await rows($)).toEqual([])
  // PR があると分かったブランチは、次から gh を呼ばない
  expect(seen.runs.filter(run => run.startsWith('gh '))).toHaveLength(1)
})

test('既定のブランチでは、gh を呼ばない', async ($, on) => {
  const seen = engine(on, { branch: 'main', pr: 'none' })
  await finish($)
  expect(await rows($)).toEqual([])
  expect(seen.runs.some(run => run.startsWith('gh '))).toBe(false)
})

for (const pr of ['missing', 'broken'] as const) {
  test(`gh が使えない時（${pr}）は、PR の候補を黙って飛ばす`, async ($, on) => {
    const seen = engine(on, { branch: 'feat/x', pr, status: ' M a.ts\n' })

    await finish($)

    expect(await rows($)).toEqual([expect.stringMatching(/^変更を commit して/), '隠す'])
    expect(seen.toasts).toEqual([])
  })
}

test('文脈が contextPercent 以上なら、/handoff を勧めて入力欄に入れる', async ($, on) => {
  const seen = engine(on, { tokens: 140_000 })

  await finish($)

  const ui = await $.ui.mount(BAND())
  expect((await ui.find({ key: 'step-handoff' }))?.text).toMatch(/^\/handoff で区切る\s+文脈 70%$/)
  await ui.press({ key: 'step-handoff' })
  await settle()
  expect(seen.fills).toEqual(['/handoff'])
  await ui.unmount()
})

test('文脈が contextPercent より下なら、/handoff を勧めない', { options: { contextPercent: 80 } }, async ($, on) => {
  engine(on, { tokens: 140_000 })
  await finish($)
  expect(await rows($)).toEqual([])
})

test('優先の高い順に、maxSteps 個までで切る', async ($, on) => {
  engine(on, { status: ' M a.ts\n', ahead: 1, tokens: 190_000 })

  await edit($, '/repo/a.ts')
  await finish($)

  const ui = await $.ui.mount(BAND())
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(button => button.text.split(/\s{2,}/)[0])).toEqual(['make test を走らせて', '変更を commit して', 'push して', '隠す'])
  expect(buttons.map(button => button.props.hotkey)).toEqual(['1', '2', '3', '0'])
  await ui.unmount()
})

test('maxSteps と testCommand を変えられる', { options: { maxSteps: 1, testCommand: 'swift test' } }, async ($, on) => {
  engine(on, { status: ' M a.ts\n', ahead: 1 })

  await edit($, '/repo/a.ts')
  await finish($)

  expect(await rows($)).toEqual([expect.stringMatching(/^swift test を走らせて/), '隠す'])
})

test('ボタンを押すと、指示の文が入力欄に入る。帯は残る', async ($, on) => {
  const seen = engine(on, { status: ' M a.ts\n', failing: /make test/ })

  await $.tool.call({ tool: 'Bash', command: 'make test' })
  await finish($)

  const ui = await $.ui.mount(BAND())
  await ui.press({ key: 'step-fix' })
  await ui.press({ key: 'step-commit' })
  await settle()
  expect(seen.fills).toEqual(['make test の落ちた所を直して', '変更を commit して'])
  expect(seen.toasts).toEqual([])
  expect(await ui.find({ key: 'step-commit' })).toBeDefined()
  await ui.unmount()
})

test('入力欄に入れられなかった時は、トーストで知らせる', async ($, on) => {
  const seen = engine(on, { status: ' M a.ts\n', isFilled: false })

  await finish($)

  const ui = await $.ui.mount(BAND())
  await ui.press({ key: 'step-commit' })
  await settle()
  expect(seen.toasts).toEqual(['session-next-steps: 入力欄に入れられませんでした。「変更を commit して」と打ってください'])
  await ui.unmount()
})

test('0 で隠したら、次のターンの終わりまで出さない', async ($, on) => {
  engine(on, { status: ' M a.ts\n' })

  await finish($)
  const ui = await $.ui.mount(BAND())
  await ui.press({ key: 'hide' })
  await settle()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()

  await finish($)
  expect(await rows($)).toHaveLength(2)
})

test('次の指示を送ったら、帯を消す', async ($, on) => {
  engine(on, { status: ' M a.ts\n' })

  await finish($)
  expect(await rows($)).toHaveLength(2)

  await $.prompt.submit({ text: '変更を commit して', wait: false, origin: { kind: 'composer' } })
  expect(await rows($)).toEqual([])
})

test('調べている間に次の指示を送ったら、古い結果を出さない', async ($, on) => {
  engine(on, { status: ' M a.ts\n' })

  await $.turn.complete(TURN)
  await $.prompt.submit({ text: '次', wait: false, origin: { kind: 'composer' } })
  await settle()

  expect(await rows($)).toEqual([])
})

test('リポジトリの外では、git の候補を出さない', async ($, on) => {
  const seen = engine(on, { isRepo: false, status: ' M a.ts\n', ahead: 2, tokens: 150_000 })

  await edit($, '/tmp/a.ts')
  await finish($)

  expect((await rows($)).map(text => text.split(/\s{2,}/)[0])).toEqual(['make test を走らせて', '/handoff で区切る', '隠す'])
  expect(seen.runs).toEqual(['git rev-parse --is-inside-work-tree'])
})

test('サブエージェントの呼び出しとターンの終わりは見ない', async ($, on) => {
  engine(on, { status: ' M a.ts\n' })

  await $.turn.complete({ ...TURN, agentId: 'a1' })
  await settle()

  expect(await rows($)).toEqual([])
})

test('survey が帯を持っている間は出さない', async ($, on) => {
  engine(on, { status: ' M a.ts\n' })

  await finish($)

  const ui = await $.ui.mount(BAND(80, true))
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('幅が狭い時は、理由を切るか出さない', async ($, on) => {
  engine(on, { status: ' M a.ts\n' })

  await edit($, '/repo/a.ts')
  await finish($)

  expect((await rows($, 44))[0]).toMatch(/^make test を走らせて\s+\d ファイルを書き換.*…$/)
  expect(await rows($, 24)).toEqual(['make test を走らせて', '変更を commit して', '隠す'])
})

test('壊れた正規表現は初めの値に戻し、最初に 1 度だけ知らせる', { options: { checkPattern: '(' } }, async ($, on) => {
  const seen = engine(on, { failing: /make test/ })

  await $.tool.call({ tool: 'Bash', command: 'make test' })
  await $.tool.call({ tool: 'Bash', command: 'make test' })
  await finish($)

  expect(seen.toasts).toEqual(['session-next-steps: checkPattern の正規表現が正しくないので、初めの値で見ます'])
  expect((await rows($))[0]).toMatch(/^落ちた所を直して/)
})

test('既定の checkPattern は、テストとビルドのコマンドに当たる', () => {
  const check = new RegExp(DEFAULTS.checkPattern)
  const hit = (command: string) => checkOf(command, check)
  expect(hit('make test')).toBe('make test')
  expect(hit('/usr/bin/make -C /repo verify 2>&1 | tail -5')).toBe('make -C /repo verify')
  expect(hit('cd app && npm run test:unit')).toBe('npm run test:unit')
  expect(hit('swift build')).toBe('swift build')
  expect(hit('xcodebuild -scheme App test')).toBe('xcodebuild')
  expect(hit('npx -y -p typescript tsc -p .')).toBe('tsc')
  expect(hit('claude plugin test plugins/x')).toBe('claude plugin test')
  expect(hit('make install')).toBeUndefined()
  expect(hit('make latest')).toBeUndefined()
  expect(hit('git commit -m "make test を通す"')).toBeUndefined()
  expect(hit('cat Makefile; ls tests')).toBeUndefined()
})

test('全角の字を 2 桁と数えて切る', () => {
  expect(cut('未 commit 5 件', 20)).toBe('未 commit 5 件')
  expect(cut('まだ確かめていない', 9)).toBe('まだ確か…')
})
