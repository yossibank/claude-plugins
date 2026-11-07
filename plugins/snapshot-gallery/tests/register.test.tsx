import { expect, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const ROOT = '/repo'
const DEFAULT_AFTER = `${ROOT}/.build/snapshots/review`
const DEFAULT_BEFORE = `${ROOT}/.build/snapshots-before/review`
const AFTER = DEFAULT_AFTER
const BEFORE = DEFAULT_BEFORE

const file = (name: string, mtimeMs: number) => ({ name, kind: 'file' as const, size: 1, mtimeMs, isLink: false })

type Setup = { root?: string; after?: string; before?: string; failure?: Record<string, unknown>; exit?: Record<string, number>; missing?: string[]; extra?: string[]; toasts?: string[] }

const engine = (on: On, ran: string[][], setup: Setup = {}) => {
  const root = setup.root ?? ROOT
  const AFTER = setup.after ?? DEFAULT_AFTER
  const BEFORE = setup.before ?? DEFAULT_BEFORE
  const dirs = new Map([
    [AFTER, [file('review-balance-narrow.png', 2), file('review-list-narrow.png', 2), file('review-new-narrow.png', 2)]],
    [BEFORE, [file('review-balance-narrow.png', 1), file('review-list-narrow.png', 1)]],
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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', (_, e) => ({ value: !setup.missing?.includes(e.path) && (dirs.has(e.path) || (setup.extra?.includes(e.path) ?? false)) }))
  on('fs.list', (_, e) => ({ value: dirs.get(e.path ?? '') ?? [] }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' }, text: '', ...setup.failure }))
  on('process.run', (_, e) => {
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
  plugin: 'snapshot-gallery',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'snapshot-gallery',
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

test('l で次の場合に移る', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /‹ balance-narrow\s+ list-narrow \s+new-narrow ›/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 \/ 3$/ })).toBeDefined()
  await ui.unmount()
})

test('前と後を pane の高さに収める', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Image', key: '前' }))?.props).toMatchObject({ columns: 40, rows: 30 })
  expect((await ui.find({ type: 'Image', key: '後' }))?.props).toMatchObject({ columns: 40, rows: 30 })
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

const start = (setup: Setup) => async ($: Parameters<TestBody>[0], on: On, ran: string[][]) => {
  engine(on, ran, setup)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

test('rsync が失敗したら、一時のフォルダを消して before を残し、toast で知らせる', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ exit: { rsync: 23 }, toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['snapshot-gallery: 前の画像の写しに失敗しました: boom'])
  expect(ran).toContainEqual(['rm', '-rf', `${BEFORE}.pending`])
  expect(ran.some(argv => argv[0] === 'mv')).toBe(false)
  expect(ran).not.toContainEqual(['rm', '-rf', BEFORE])
})

test('入れ替えの mv が失敗したら、退避した before を戻す', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ exit: { 'mv-pending': 1 }, toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['snapshot-gallery: 前の画像の入れ替えに失敗しました: boom'])
  expect(ran).toContainEqual(['mv', BEFORE, `${BEFORE}.old`])
  expect(ran).toContainEqual(['mv', `${BEFORE}.old`, BEFORE])
})

test('shasum が失敗したら toast で知らせ、ハッシュが取れない画像は変更にする', async ($, on) => {
  const toasts: string[] = []
  await start({ exit: { shasum: 1 }, toasts })($, on, [])

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts[0]).toBe('snapshot-gallery: ハッシュの取得に失敗しました: boom')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /🟡 変更 2.*⚪ 同じ 0.*🟢 新規 1/ })).toBeDefined()
  await ui.unmount()
})

test('sips が失敗したら toast で知らせる', async ($, on) => {
  const toasts: string[] = []
  await start({ exit: { sips: 1 }, toasts })($, on, [])

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['snapshot-gallery: 画像の大きさの取得に失敗しました: boom'])
})

test('/snapshots は不正なセットの名前を断り、state を上書きしない', async ($, on) => {
  await start({})($, on, [])

  expect(await $.command.run({ command: 'snapshots', args: '../x' })).toMatchObject({ text: 'セットの名前が正しくありません' })
  expect(await $.command.run({ command: 'snapshots', args: 'a..b' })).toMatchObject({ text: 'セットの名前が正しくありません' })
})

test('/snapshots は画像が 0 件のセットを断り、描いた state を残す', async ($, on) => {
  await start({})($, on, [])
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(await $.command.run({ command: 'snapshots', args: 'empty' })).toMatchObject({ text: 'empty の画像がありません' })
  expect(await $.command.run({ command: 'snapshots', args: '' })).toMatchObject({ text: 'review のスナップショットを開きました。' })
})

test('戻しの mv も失敗したら、toast を重ねて知らせる', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ exit: { 'mv-pending': 1, 'mv-restore': 1 }, toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['snapshot-gallery: 前の画像の入れ替えに失敗しました: boom', 'snapshot-gallery: 退避の復元に失敗しました: boom'])
  expect(ran).not.toContainEqual(['rm', '-rf', BEFORE])
})

test('退避の mv が失敗したら、before を動かさず入れ替えもしない', async ($, on) => {
  const ran: string[][] = []
  const toasts: string[] = []
  await start({ exit: { 'mv-backup': 1 }, toasts })($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['snapshot-gallery: 前の画像の退避に失敗しました: boom'])
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

  expect(toasts).toEqual(['snapshot-gallery: 退避の復元に失敗しました: boom'])
  expect(ran).not.toContainEqual(['mv', `${BEFORE}.pending`, BEFORE])
  expect(ran).not.toContainEqual(['rm', '-rf', `${BEFORE}.old`])
})
