import { expect, test, type TestBody } from 'claude-code/testing'

import { numstatOf } from '../hooks/facts'
import { cleanMemo, isEmptyParts, nextOf, partsOf, resumeOf, unverifiedOf } from '../hooks/memo'
import { ago, bar, clock, largest, tail } from '../hooks/pane'

declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown

type On = Parameters<TestBody>[1]
type Self = Parameters<TestBody>[0]

const MEMO = '# 引き継ぎ\n- 目的：handoff の mod を出す\n- 次：1. 画面で確かめる 2. PR を作る\n- 未検証：/clear の後\n'

const PANE = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'session-handoff',
    component: 'Pane',
    requestId: 'session-handoff',
    surface,
    props: { title: '🤝 Handoff', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

const HANDOFF = { command: 'handoff', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const TURN = { answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const

type Seen = { files: Map<string, string>; runs: string[]; prompts: string[]; toasts: string[]; commands: string[]; fills: string[]; copies: string[]; opened: string[]; closed: string[] }

const engine = (on: On, { reply = MEMO as string | null, failure = 'empty-reply', tokens = 100_000, files = new Map<string, string>(), untracked = '', status = '', messages = null as unknown[] | null } = {}) => {
  const seen: Seen = { files, runs: [], prompts: [], toasts: [], commands: [], fills: [], copies: [], opened: [], closed: [] }
  on('command.register', () => ({ value: { command: 'handoff' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo/sub' }))
  on('process.run', (_, e) => {
    const args = e.argv.join(' ')
    seen.runs.push(args)
    const stdout = args.includes('--show-toplevel')
      ? '/repo\n'
      : args.includes('--show-current')
        ? 'feat/x\n'
        : args.includes('--numstat')
          ? '12\t3\tplugins/handoff/hooks/register.tsx\n'
          : args.includes('ls-files')
            ? untracked
            : args.includes('--porcelain')
              ? status
              : ''
    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
  on('session.messages', () => ({
    value: (messages ?? [
      { role: 'user', text: 'mod を作って', toolUses: [] },
      {
        role: 'assistant',
        text: '',
        toolUses: [
          { tool: 'Write', input: { file_path: '/repo/plugins/handoff/hooks/register.tsx' } },
          { tool: 'Edit', input: { file_path: '/repo/plugins/handoff/hooks/register.tsx' } },
          { tool: 'Read', input: { file_path: '/repo/README.md' } },
        ],
      },
    ]) as never,
  }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens, window: 1_000_000, breakdown: { rawMaxTokens: 200_000, categories: [{ name: 'System prompt', kind: 'used', tokens: 9000 }, { name: 'Messages', kind: 'used', tokens: tokens - 9000 }] } },
    } as never,
  }))
  on('model.fork', (_, e) => {
    seen.prompts.push(e.prompt)
    return {
      value: (reply === null
        ? { isAnswered: false, reason: failure }
        : { isAnswered: true, text: reply, usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 300 } }) as never,
    }
  })
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: seen.files.has(e.path) }))
  on('fs.stat', () => ({ value: { mtimeMs: 1_000_000 - 2 * 3600_000 } as never }))
  on('fs.read', (_, e) => ({ value: seen.files.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    seen.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    seen.closed.push(e.id)
    return { value: undefined } as never
  })
  on('command.run', (_, e) => {
    seen.commands.push(e.command)
    return { text: '' }
  })
  on('prompt.fill', (_, e) => {
    seen.fills.push(e.text)
    return { isFilled: true }
  })
  on('ui.copy', (_, e) => {
    seen.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('turn.complete', () => ({ text: '' }))
  return seen
}

// void で走らせた書き込みが終わるのを待つ
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

const begin = async ($: Self) => {
  await $.session.start({ cwd: '/repo/sub', surface: 'terminal', isInteractive: true })
}

test('囲みと前置きを外して、メモの本文だけにする', () => {
  expect(cleanMemo('はい。\n```markdown\n# 引き継ぎ\n- 目的：a\n```\n')).toBe('# 引き継ぎ\n- 目的：a\n')
  expect(cleanMemo('前置き\n# 引き継ぎ\n- 次：1. b')).toBe('# 引き継ぎ\n- 次：1. b\n')
})

test('メモから次にすることと未検証を取り出す', () => {
  expect(nextOf(MEMO)).toEqual(['画面で確かめる', 'PR を作る'])
  expect(unverifiedOf(MEMO)).toEqual(['/clear の後'])
  expect(nextOf('# 引き継ぎ\n- 目的：a\n')).toEqual([])
  expect(nextOf('# 引き継ぎ\n- 次：\n  1. a\n  2. b\n- 未検証：c\n')).toEqual(['a', 'b'])
})

test('棒・時間・差分の数え方', () => {
  expect(bar(0.5, 4)).toEqual(['━━', '──'])
  expect(bar(1.5, 4)).toEqual(['━━━━', ''])
  expect(clock(75_000)).toBe('1:15')
  expect(clock(3_725_000)).toBe('1:02:05')
  expect(ago(30_000)).toBe('いま')
  expect(ago(2 * 3600_000)).toBe('2 時間前')
  expect(numstatOf('12\t3\ta.ts\n-\t-\tb.png')).toEqual(
    new Map([
      ['a.ts', { added: 12, removed: 3 }],
      ['b.png', { added: 0, removed: 0 }],
    ]),
  )
  expect(tail('plugins/handoff/hooks/register.tsx', 20)).toBe('…/hooks/register.tsx')
  expect(tail('averyveryverylongname.tsx', 10)).toBe('…gname.tsx')
  expect(tail('a.ts', 14)).toBe('a.ts')
  expect(largest([{ path: 'a', added: 1, removed: 0, isNew: false, isOutside: false }, { path: 'b', added: 5, removed: 2, isNew: false, isOutside: false }]).map(change => change.path)).toEqual(['b', 'a'])
})

test('メモを項目ごとに分ける。決まりの形でなければ空にする', () => {
  const parts = partsOf('# 引き継ぎ\n- 目的：a\n- 決めたこと：b\n- 決めたこと：\n  - c\n  - d\n- 次：1. e 2. f\n- 触ったファイル：x.ts, y.ts\n- 未検証：g\n')
  expect(parts).toEqual({ goal: 'a', decisions: ['b', 'c', 'd'], next: ['e', 'f'], files: ['x.ts, y.ts'], unverified: ['g'] })
  expect(isEmptyParts(parts)).toBe(false)
  expect(isEmptyParts(partsOf('メモは書けませんでした'))).toBe(true)
})

test('字下げした項目も読む。同じ深さの次の項目は続きの行にしない', () => {
  const parts = partsOf('# 引き継ぎ\n  - 目的：a\n  - 決めたこと：b\n    - c\n  - 次：1. e 2. f\n  - 触ったファイル：x.ts\n  - 未検証：g\n')
  expect(parts).toEqual({ goal: 'a', decisions: ['b', 'c'], next: ['e', 'f'], files: ['x.ts'], unverified: ['g'] })
})

test('/handoff で、ペインを開き、触ったファイルを渡してメモを書き、.gitignore に足す', async ($, on) => {
  const seen = engine(on, { files: new Map([['/repo/.gitignore', 'node_modules/']]) })
  await begin($)

  await $.command.run(HANDOFF)
  await settle()

  expect(seen.opened).toEqual(['session-handoff'])
  expect(seen.files.get('/repo/.claude/handoff.md')).toBe(MEMO)
  expect(seen.files.get('/repo/.gitignore')).toBe('node_modules/\n.claude/handoff.md\n')
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('- plugins/handoff/hooks/register.tsx')
  expect(seen.prompts[0]).not.toContain('README.md')
})

test('ファイルの差分は、触ったファイルだけで数え、未追跡のファイルは行の数を足す', async ($, on) => {
  const seen = engine(on, { untracked: 'plugins/handoff/hooks/register.tsx\n', files: new Map([['/repo/plugins/handoff/hooks/register.tsx', 'a\nb\nc\n']]) })
  await begin($)

  await $.command.run(HANDOFF)
  await settle()

  expect(seen.runs).toContain('git -c core.quotepath=false --literal-pathspecs diff --numstat --no-renames HEAD -- plugins/handoff/hooks/register.tsx')
  expect(seen.runs).toContain('git -c core.quotepath=false --literal-pathspecs ls-files --others --exclude-standard -- plugins/handoff/hooks/register.tsx')
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text', text: /^\+\d+ −\d+$/ }))?.text).toBe('+3 −0')
  expect((await ui.find({ type: 'Text', text: /^新規 / }))?.text).toBe('新規 +3 −0')
  await ui.unmount()
})

test('リポジトリの外のファイルは、変更なしではなく外と出す', async ($, on) => {
  engine(on, { messages: [{ role: 'assistant', text: '', toolUses: [{ tool: 'Edit', input: { file_path: '/elsewhere/notes.md' } }] }] })
  await begin($)

  await $.command.run(HANDOFF)
  await settle()

  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: 'リポジトリの外' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '変更なし' })).toBeFalsy()
  await ui.unmount()
})

test('触ったファイルが無ければ、ほかの変更があっても差分は 0 にする', async ($, on) => {
  const seen = engine(on, { tokens: 160_000, messages: [{ role: 'user', text: 'README を読んで', toolUses: [] }] })
  await begin($)

  await $.turn.complete(TURN)
  await settle()

  expect(seen.runs.some(run => run.includes('--numstat'))).toBe(false)
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text', text: /^\+\d+ −\d+$/ }))?.text).toBe('+0 −0')
  await ui.unmount()
})

test('.gitignore にもうあれば、足さない', async ($, on) => {
  const seen = engine(on, { files: new Map([['/repo/.gitignore', '.claude/handoff.md\n']]) })
  await begin($)

  await $.command.run(HANDOFF)
  await settle()

  expect(seen.files.get('/repo/.gitignore')).toBe('.claude/handoff.md\n')
})

test('20 行を超えたら、一度だけ削らせる', async ($, on) => {
  const long = `# 引き継ぎ\n${Array.from({ length: 25 }, (_, i) => `- 決めたこと：${i}`).join('\n')}\n`
  const seen = engine(on, { reply: long })
  await begin($)

  await $.command.run(HANDOFF)
  await settle()

  expect(seen.prompts).toHaveLength(2)
  expect(seen.prompts[1]).toContain('26 行')
})

test('できた後の /handoff は、書き直さずにペインを開き直す', async ($, on) => {
  const seen = engine(on)
  await begin($)
  await $.command.run(HANDOFF)
  await settle()

  await $.command.run(HANDOFF)
  await settle()

  expect(seen.prompts).toHaveLength(1)
  expect(seen.opened).toEqual(['session-handoff', 'session-handoff'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`完成したペインに数字と次にすることを出し、新しい会話で始めると /clear して入力欄にメモを入れる（${surface}）`, async ($, on) => {
    const seen = engine(on)
    await begin($)
    await $.command.run(HANDOFF)
    await settle()

    const ui = await $.ui.mount(PANE(surface))
    expect((await ui.find({ type: 'Text', text: /引き継ぎ完成/ }))?.text).toContain('引き継ぎ完成')
    expect((await ui.find({ type: 'Text', text: /⎇ feat\/x/ }))?.text).toContain('feat/x')
    expect((await ui.find({ type: 'Text', text: /前回/ }))?.text).toBe('前回なし')
    expect((await ui.find({ type: 'Text', text: /^\+12 −3$/ }))?.text).toBe('+12 −3')
    expect((await ui.find({ type: 'Text', text: /PR を作る/ }))?.text).toContain('2')
    expect((await ui.find({ type: 'Text', text: /キャッシュ 90%/ }))?.text).toContain('出力 300')
    expect((await ui.find({ type: 'Text', text: /handoff の mod を出す/ }))?.text).toContain('◎')
    expect((await ui.find({ type: 'Text', text: /\/clear の後/ }))?.text).toContain('⚠')
    expect((await ui.find({ type: 'Text', text: /register\.tsx/ }))?.text).toBe('● …/handoff/hooks/register.tsx')
    expect((await ui.find({ type: 'Text', text: /commit/ }))?.text).toBe('すべて commit 済み')
    expect((await ui.find({ type: 'Text', text: /上限/ }))?.text).toBe('上限 20 行 · 70 字')
    await ui.press({ key: 'copy' })
    expect(seen.copies).toEqual([resumeOf(MEMO)])
    await ui.press({ key: 'begin' })
    await ui.unmount()
    await settle()

    expect(seen.closed).toContain('session-handoff')
    expect(seen.commands).toContain('clear')
    expect(seen.fills).toEqual([resumeOf(MEMO)])
  })

  test(`閾値を超えたらペインを開いて勧め、あとでを押したらその会話では勧めない（${surface}）`, async ($, on) => {
    const seen = engine(on, { tokens: 160_000 })
    await begin($)

    await $.turn.complete(TURN)
    await settle()
    expect(seen.opened).toEqual(['session-handoff'])
    const ui = await $.ui.mount(PANE(surface))
    expect((await ui.find({ type: 'Text', text: /引き継ぎどき/ }))?.text).toContain('引き継ぎどき')
    expect((await ui.find({ type: 'Text', text: /^80%$/ }))?.text).toBe('80%')
    expect((await ui.find({ type: 'Text', text: /→ 約/ }))?.text).toContain('160k → 約 10k')
    expect((await ui.find({ type: 'Text', text: /^160k \/ 200k$/ }))?.text).toBe('160k / 200k')
    expect((await ui.find({ type: 'Text', text: /区切っても残る分/ }))?.text).toContain('会話 151k')
    await ui.press({ key: 'later' })
    await ui.unmount()
    await settle()

    await $.turn.complete(TURN)
    await settle()
    expect(seen.opened).toEqual(['session-handoff'])
  })
}

test('/handoff が重なっても、メモは 1 回だけ書く', async ($, on) => {
  const seen = engine(on)
  await begin($)

  await Promise.all([$.command.run(HANDOFF), $.command.run(HANDOFF)])
  await settle()

  expect(seen.prompts.length).toBe(1)
})

test('失敗した後に閉じるを押したら、その会話では勧めない', async ($, on) => {
  const seen = engine(on, { reply: null, tokens: 160_000 })
  await begin($)
  await $.command.run(HANDOFF)
  await settle()

  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'close' })
  await ui.unmount()
  await settle()
  await $.turn.complete(TURN)
  await settle()

  expect(seen.opened).toEqual(['session-handoff'])
})

test('閾値より下なら勧めない', async ($, on) => {
  const seen = engine(on, { tokens: 100_000 })
  await begin($)

  await $.turn.complete(TURN)
  await settle()

  expect(seen.opened).toEqual([])
})

test('まだモデルに頼んでいなければ、先に 1 つ頼むよう出す', async ($, on) => {
  const seen = engine(on, { reply: null, failure: 'nothing-to-fork' })
  await begin($)

  await $.command.run(HANDOFF)
  await settle()

  expect(seen.toasts[0]).toContain('まだモデルに何も頼んでいない')
  expect(seen.toasts[0]).not.toContain('答えなかった')
})

test('モデルが答えなければ、失敗を出してトーストで知らせる', async ($, on) => {
  const seen = engine(on, { reply: null })
  await begin($)

  await $.command.run(HANDOFF)
  await settle()

  expect(seen.files.has('/repo/.claude/handoff.md')).toBe(false)
  expect(seen.toasts[0]).toContain('empty-reply')
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text', text: /empty-reply/ }))?.text).toContain('empty-reply')
  expect(await ui.find({ type: 'Button', text: /やり直す/ })).toBeDefined()
  await ui.unmount()
})

test('まだ commit していないファイルの数を出す。メモ自身は数えない', async ($, on) => {
  engine(on, { tokens: 160_000, status: ' M plugins/handoff/hooks/register.tsx\n?? notes.md\n?? .claude/handoff.md\n' })
  await begin($)

  await $.turn.complete(TURN)
  await settle()

  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text', text: /未 commit/ }))?.text).toBe('未 commit 2 件')
  await ui.unmount()
})
