import { expect, test, type TestBody } from 'claude-code/testing'

import { bytesText, detail } from '../hooks/view'

type On = Parameters<TestBody>[1]

const ROOT = '/repo'
const DEFAULT_AFTER = `${ROOT}/.build/snapshots/review`
const DEFAULT_BEFORE = `${ROOT}/.build/snapshots-before/review`
const AFTER = DEFAULT_AFTER
const BEFORE = DEFAULT_BEFORE

const file = (name: string, mtimeMs: number) => ({ name, kind: 'file' as const, size: 1, mtimeMs, isLink: false })

type Setup = { root?: string; after?: string; before?: string; failure?: Record<string, unknown>; exit?: Record<string, number>; missing?: string[]; extra?: string[]; toasts?: string[]; afterMs?: number; beforeMs?: number; isOpenBroken?: boolean; isSipsMissing?: boolean; gone?: string[] }

const engine = (on: On, ran: string[][], setup: Setup = {}) => {
  const root = setup.root ?? ROOT
  const AFTER = setup.after ?? DEFAULT_AFTER
  const BEFORE = setup.before ?? DEFAULT_BEFORE
  const afterMs = setup.afterMs ?? 2
  const beforeMs = setup.beforeMs ?? 1
  const dirs = new Map([
    [AFTER, [file('review-balance-narrow.png', afterMs), file('review-list-narrow.png', afterMs), file('review-new-narrow.png', afterMs)]],
    [BEFORE, [file('review-balance-narrow.png', beforeMs), file('review-list-narrow.png', beforeMs), ...(setup.gone ?? []).map(name => file(name, beforeMs))]],
  ])
  const hash: Record<string, string> = {
    [`${AFTER}/review-balance-narrow.png`]: 'b2',
    [`${BEFORE}/review-balance-narrow.png`]: 'b1',
    [`${AFTER}/review-list-narrow.png`]: 'l1',
    [`${BEFORE}/review-list-narrow.png`]: 'l1',
    [`${AFTER}/review-new-narrow.png`]: 'n1',
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: root }))
  on('command.register', () => ({ value: { command: 'snapshots' } }))
  on('ui.toast', (_, e) => {
    setup.toasts?.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => {
    if (setup.isOpenBroken === true) throw new Error('開けない')
    return { value: { isPlaced: true } }
  })
  on('fs.exists', (_, e) => ({ value: !setup.missing?.includes(e.path) && (dirs.has(e.path) || (setup.extra?.includes(e.path) ?? false)) }))
  on('fs.list', (_, e) => ({ value: dirs.get(e.path ?? '') ?? [] }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' }, text: '', ...setup.failure }))
  on('process.run', (_, e) => {
    if (setup.isSipsMissing === true && e.argv[0] === 'sips') throw new Error('sips が無い')
    const argv = [...e.argv]
    ran.push(argv)
    const files = argv.filter(arg => arg.startsWith('/'))
    const stdout =
      argv[0] === 'shasum'
        ? files.map(path => `${hash[path] ?? 'x'}  ${path}`).join('\n')
        : argv[0] === 'sips'
          ? files.map(path => `${path}\n  pixelWidth: 640\n  pixelHeight: 960`).join('\n')
          : ''
    const mv = argv[1] === `${BEFORE}.pending` ? 'mv-pending' : argv[1] === BEFORE ? 'mv-backup' : 'mv-restore'
    const exitCode = (argv[0] === 'mv' ? setup.exit?.[mv] : setup.exit?.[argv[0] ?? '']) ?? 0
    return { value: { exitCode, stdout: exitCode === 0 ? stdout : '', stderr: exitCode === 0 ? '' : 'boom', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const PANE = {
  plugin: 'ios-snapshot-gallery',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'ios-snapshot-gallery',
  props: { title: '📸 Snapshots', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('描く前に古い PNG を取っておき、描いた後に前と後を並べる', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(ran).toContainEqual(['rsync', '-a', '--delete', '--include', '*.png', '--exclude', '*', `${AFTER}/`, `${BEFORE}.pending/`])
  expect(ran).toContainEqual(['mv', `${BEFORE}.pending`, BEFORE])

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^1 \/ 3$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /🟡 変更 1.*⚪ 同じ 1.*🟢 新規 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s+ balance-narrow   list-narrow ›$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /╭─ 後 · 🟡 変更 ─+╮/ })).toBeDefined()
  expect((await ui.find({ type: 'Image', key: '前' }))?.props).toMatchObject({ source: { file: `${BEFORE}/review-balance-narrow.png`, format: 'png' } })
  expect((await ui.find({ type: 'Image', key: '後' }))?.props).toMatchObject({ source: { file: `${AFTER}/review-balance-narrow.png`, format: 'png' } })
  await ui.unmount()
})

test('k で次の場合に移る', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /‹ balance-narrow\s+ list-narrow \s+new-narrow ›/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 \/ 3$/ })).toBeDefined()
  await ui.unmount()
})

test('Finder で開けなかったら、toast で知らせる', async ($, on) => {
  const toasts: string[] = []
  engine(on, [], { exit: { open: 1 }, toasts })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'finder' })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(toasts).toContain('ios-snapshot-gallery: Finder で開くことに失敗しました: boom')
  await ui.unmount()
})

test('前と後を pane の高さに収める', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Image', key: '前' }))?.props).toMatchObject({ columns: 37, rows: 28 })
  expect((await ui.find({ type: 'Image', key: '後' }))?.props).toMatchObject({ columns: 37, rows: 28 })
  await ui.unmount()
})

test('高さに余裕があれば pane の幅の半分ずつに描く', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 200 } } })
  expect((await ui.find({ type: 'Image', key: '後' }))?.props).toMatchObject({ columns: 57, rows: 43 })
  await ui.unmount()
})

test('ほかの make では何もしない', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make verify' })

  expect(ran).toEqual([])
})

const OPTIONS = {
  commandPattern: 'make\\s+(?:-C\\s+\\S+\\s+)?shots\\s+SET=(\\S+)',
  snapshotsDir: 'out/now',
  beforeDir: 'out/prev',
}

test('options でコマンドとフォルダを変えられる', { options: OPTIONS }, async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { after: `${ROOT}/out/now/review`, before: `${ROOT}/out/prev/review` })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  expect(ran).toEqual([])

  await $.tool.call({ tool: 'Bash', command: 'make shots SET=review' })
  expect(ran).toContainEqual(['mv', `${ROOT}/out/prev/review.pending`, `${ROOT}/out/prev/review`])
})

test('cd の先を基点にする（相対は今の基点から、&& の前だけ）', { options: OPTIONS }, async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { after: '/repo/app/sub/out/now/review', before: '/repo/app/sub/out/prev/review' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'cd app && cd ./sub; make shots SET=review' })
  expect(ran).toContainEqual(['mv', '/repo/app/sub/out/prev/review.pending', '/repo/app/sub/out/prev/review'])
})

test('make -C の先を基点にする', { options: OPTIONS }, async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { after: '/other/out/now/review', before: '/other/out/prev/review' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make -C /other shots SET=review' })
  expect(ran).toContainEqual(['mv', '/other/out/prev/review.pending', '/other/out/prev/review'])

  ran.length = 0
  await $.tool.call({ tool: 'Bash', command: 'cd /other && make -C ../repo shots SET=review' })
  expect(ran).toEqual([])
})

test('make が失敗したら before はそのままで、一時のフォルダを消す', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { failure: { isError: true } })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(ran).toContainEqual(['rsync', '-a', '--delete', '--include', '*.png', '--exclude', '*', `${AFTER}/`, `${BEFORE}.pending/`])
  expect(ran).toContainEqual(['rm', '-rf', `${BEFORE}.pending`])
  expect(ran.some(argv => argv[0] === 'mv' || (argv[0] === 'rm' && argv.at(-1) === BEFORE))).toBe(false)
})

test('初めの値のままで make -C dir snapshot も見張り、基点が dir になる', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { after: '/other/.build/snapshots/review', before: '/other/.build/snapshots-before/review' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make -C /other snapshot SNAPSHOT=review' })
  expect(ran).toContainEqual(['mv', '/other/.build/snapshots-before/review.pending', '/other/.build/snapshots-before/review'])
})

test('セットの名前が上のフォルダを指す時は、写しも消しもしない', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=..' })
  expect(ran.some(argv => argv[0] === 'rm' || argv[0] === 'rsync' || argv[0] === 'mv')).toBe(false)
})

const runCommand = ($: Parameters<TestBody>[0], args: string) =>
  $.command.run({ command: 'snapshots', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

const start = (setup: Setup) => async ($: Parameters<TestBody>[0], on: On, ran: string[][]) => {
  engine(on, ran, setup)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

test('rsync が失敗したら、一時のフォルダを消して before を残し、toast で知らせる', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ exit: { rsync: 23 }, toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['ios-snapshot-gallery: 前の画像の写しに失敗しました: boom'])
  expect(ran).toContainEqual(['rm', '-rf', `${BEFORE}.pending`])
  expect(ran.some(argv => argv[0] === 'mv')).toBe(false)
  expect(ran).not.toContainEqual(['rm', '-rf', BEFORE])
})

test('入れ替えの mv が失敗したら、退避した before を戻す', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ exit: { 'mv-pending': 1 }, toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['ios-snapshot-gallery: 前の画像の入れ替えに失敗しました: boom'])
  expect(ran).toContainEqual(['mv', BEFORE, `${BEFORE}.old`])
  expect(ran).toContainEqual(['mv', `${BEFORE}.old`, BEFORE])
})

test('shasum が失敗したら toast で知らせ、ハッシュが取れない画像は変更にする', async ($, on) => {
  const toasts: string[] = []
  await start({ exit: { shasum: 1 }, toasts })($, on, [])

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts[0]).toBe('ios-snapshot-gallery: ハッシュの取得に失敗しました: boom')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /🟡 変更 2.*⚪ 同じ 0.*🟢 新規 1/ })).toBeDefined()
  await ui.unmount()
})

test('sips が失敗したら toast で知らせる', async ($, on) => {
  const toasts: string[] = []
  await start({ exit: { sips: 1 }, toasts })($, on, [])

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['ios-snapshot-gallery: 画像の大きさの取得に失敗しました: boom'])
})

test('画像を集められなくても、コマンドの結果を返して toast で知らせる', async ($, on) => {
  const toasts: string[] = []
  engine(on, [], { toasts, isSipsMissing: true })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const ran = await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  expect(ran.deny).toBeUndefined()
  expect(toasts.some(text => /^ios-snapshot-gallery: 画像の集め直しに失敗しました: /.test(text))).toBe(true)
})

test('/snapshots は不正なセットの名前を断り、state を上書きしない', async ($, on) => {
  await start({})($, on, [])

  expect(await runCommand($, '../x')).toMatchObject({ text: 'セットの名前が正しくありません' })
  expect(await runCommand($, 'a..b')).toMatchObject({ text: 'セットの名前が正しくありません' })
})

test('/snapshots は画像が 0 件のセットを断り、描いた state を残す', async ($, on) => {
  await start({})($, on, [])
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(await runCommand($, 'empty')).toMatchObject({ text: 'empty の画像がありません' })
  expect(await runCommand($, '')).toMatchObject({ text: 'review のスナップショットを開きました。' })
})

test('戻しの mv も失敗したら、toast を重ねて知らせる', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ exit: { 'mv-pending': 1, 'mv-restore': 1 }, toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['ios-snapshot-gallery: 前の画像の入れ替えに失敗しました: boom', 'ios-snapshot-gallery: 退避の復元に失敗しました: boom'])
  expect(ran).not.toContainEqual(['rm', '-rf', BEFORE])
})

test('退避の mv が失敗したら、before を動かさず入れ替えもしない', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ exit: { 'mv-backup': 1 }, toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['ios-snapshot-gallery: 前の画像の退避に失敗しました: boom'])
  expect(ran).not.toContainEqual(['mv', `${BEFORE}.pending`, BEFORE])
  expect(ran).not.toContainEqual(['mv', `${BEFORE}.old`, BEFORE])
  expect(ran).toContainEqual(['rm', '-rf', `${BEFORE}.pending`])
})

test('.old だけが残っていたら、消さずに before へ戻してから入れ替える', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ missing: [BEFORE], extra: [`${BEFORE}.old`], toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const restore = ran.findIndex(argv => argv[0] === 'mv' && argv[1] === `${BEFORE}.old`)
  expect(restore).toBeGreaterThanOrEqual(0)
  expect(ran.findIndex(argv => argv[0] === 'rm' && argv[2] === `${BEFORE}.old`)).toBeGreaterThan(restore)
  expect(toasts).toEqual([])
})

test('.old を戻せなかったら、入れ替えず .old を消さない', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ missing: [BEFORE], extra: [`${BEFORE}.old`], exit: { 'mv-restore': 1 }, toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['ios-snapshot-gallery: 退避の復元に失敗しました: boom'])
  expect(ran).not.toContainEqual(['mv', `${BEFORE}.pending`, BEFORE])
  expect(ran).not.toContainEqual(['rm', '-rf', `${BEFORE}.old`])
})

// 時刻は端末の時刻帯で表すので、期待する文字は同じ時刻帯の日時から作る
const at = (month: number, day: number, hour: number, minute: number) => new Date(2026, month - 1, day, hour, minute).getTime()

test('前と後の下に、画像を描いた日時を出す。前の画像が無ければ「なし」', async ($, on) => {
  await start({ afterMs: at(11, 7, 9, 5), beforeMs: at(1, 2, 23, 45) })($, on, [])
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^╰─ 01\/02 23:45 ─+╯$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^╰─ 11\/07 09:05 ─+╯$/ })).toBeDefined()
  await ui.press({ key: 'next' })
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /^╰─ なし ─+╯$/ })).toBeDefined()
  await ui.unmount()
})

test('c で変更のあるものだけに絞り、もう一度でもどす', async ($, on) => {
  await start({})($, on, [])
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^1 \/ 3$/ })).toBeDefined()
  await ui.press({ key: 'changed-only' })
  expect(await ui.find({ type: 'Text', text: /^1 \/ 2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /list-narrow/ })).toBeUndefined()
  await ui.press({ key: 'changed-only' })
  expect(await ui.find({ type: 'Text', text: /^1 \/ 3$/ })).toBeDefined()
  await ui.unmount()
})

test('o で後の画像を Finder で開く', async ($, on) => {
  const ran: string[][] = []
  await start({})($, on, ran)
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'finder' })
  expect(ran).toContainEqual(['open', '-R', `${AFTER}/review-balance-narrow.png`])
  await ui.unmount()
})

test('壊れた正規表現は初めの値に戻り、最初の Bash で toast で知らせる', { options: { commandPattern: '(' } }, async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make verify' })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['ios-snapshot-gallery: commandPattern の正規表現が正しくないので、初めの値で見張ります'])
  expect(ran).toContainEqual(['mv', `${BEFORE}.pending`, BEFORE])
})

test('画廊を開けなかったら、toast で知らせる', async ($, on) => {
  const toasts: string[] = []
  await start({ isOpenBroken: true, toasts })($, on, [])

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  for (let i = 0; i < 20; i += 1) await Promise.resolve()

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^ios-snapshot-gallery: 画廊の表示に失敗しました: /)
})

test('設定が空か空白だけの時は、初めの値に戻す', { options: { commandPattern: '  ', snapshotsDir: '', beforeDir: ' ' } }, async ($, on) => {
  const ran: string[][] = []
  await start({})($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make verify' })
  expect(ran).toEqual([])

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  expect(ran).toContainEqual(['mv', `${BEFORE}.pending`, BEFORE])
})

test('見出しに 1 枚 1 文字の並びを、画像の下に大きさとファイルの大きさを出す', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^●·\+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /大きさ 640×960 px · ファイル 1 B$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /🔴/ })).toBeUndefined()
  await ui.unmount()
})

test('前にはあって後に無い画像を、削除として数えて名前を出す', async ($, on) => {
  engine(on, [], { gone: ['review-old-narrow.png'] })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /🟢 新規 1\s+🔴 削除 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /後に無い画像：old-narrow$/ })).toBeDefined()
  await ui.unmount()
})

test('大きさとファイルの大きさは、前と違う時だけ前の値と差を出す', () => {
  const one = { name: 'a', after: '/a.png', status: 'changed', width: 640, height: 960, afterMs: 2, bytes: 4096 } as const
  expect(bytesText(512)).toBe('512 B')
  expect(bytesText(3 * 1024 * 1024)).toBe('3.0 MB')
  expect(detail(one)).toEqual({ size: '640×960 px', resized: '', bytes: '4 KB', gap: '' })
  expect(detail({ ...one, before: '/b.png', beforeBytes: 1024, beforeWidth: 640, beforeHeight: 900 })).toEqual({ size: '640×960 px', resized: '前は 640×900', bytes: '4 KB', gap: '+3 KB' })
  expect(detail({ ...one, before: '/b.png', beforeBytes: 8192, beforeWidth: 640, beforeHeight: 960 })).toEqual({ size: '640×960 px', resized: '', bytes: '4 KB', gap: '−4 KB' })
})
