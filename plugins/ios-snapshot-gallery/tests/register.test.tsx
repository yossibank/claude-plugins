import { expect, test, type TestBody } from 'claude-code/testing'

import { page } from '../hooks/page'
import { summary } from '../hooks/register'

type On = Parameters<TestBody>[1]

const ROOT = '/repo'
const DEFAULT_AFTER = `${ROOT}/.build/snapshots/review`
const DEFAULT_BEFORE = `${ROOT}/.build/snapshots-before/review`
const AFTER = DEFAULT_AFTER
const BEFORE = DEFAULT_BEFORE

const file = (name: string, mtimeMs: number) => ({ name, kind: 'file' as const, size: 1, mtimeMs, isLink: false })

type Setup = { root?: string; after?: string; before?: string; failure?: Record<string, unknown>; exit?: Record<string, number>; missing?: string[]; extra?: string[]; toasts?: string[]; notes?: string[]; afterMs?: number; beforeMs?: number; isSipsMissing?: boolean; gone?: string[]; index?: string; writes?: Map<string, string>; hashes?: Record<string, string>; isAllSame?: boolean }

const engine = (on: On, ran: string[][], setup: Setup = {}) => {
  const root = setup.root ?? ROOT
  const AFTER = setup.after ?? DEFAULT_AFTER
  const BEFORE = setup.before ?? DEFAULT_BEFORE
  const afterMs = setup.afterMs ?? 2
  const beforeMs = setup.beforeMs ?? 1
  const dirs = new Map([
    [AFTER, [file('review-balance-narrow.png', afterMs), file('review-list-narrow.png', afterMs), file('review-new-narrow.png', afterMs)]],
    [BEFORE, [file('review-balance-narrow.png', beforeMs), file('review-list-narrow.png', beforeMs), ...(setup.isAllSame === true ? [file('review-new-narrow.png', beforeMs)] : []), ...(setup.gone ?? []).map(name => file(name, beforeMs))]],
  ])
  const hash: Record<string, string> = {
    [`${AFTER}/review-balance-narrow.png`]: 'b2',
    [`${BEFORE}/review-balance-narrow.png`]: 'b1',
    [`${AFTER}/review-list-narrow.png`]: 'l1',
    [`${BEFORE}/review-list-narrow.png`]: 'l1',
    [`${AFTER}/review-new-narrow.png`]: 'n1',
    ...(setup.isAllSame === true ? { [`${AFTER}/review-balance-narrow.png`]: 'b1', [`${BEFORE}/review-new-narrow.png`]: 'n1' } : {}),
    ...setup.hashes,
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: root }))
  on('command.register', () => ({ value: { command: 'snapshots' } }))
  // 描き終えた知らせ（📸 で始まる）は notes に、失敗の知らせは toasts に分ける
  on('ui.toast', (_, e) => {
    ;(e.text.startsWith('📸') ? setup.notes : setup.toasts)?.push(e.text)
    return { value: undefined }
  })
  const index = `${AFTER}/index.jsonl`
  on('fs.exists', (_, e) => ({ value: !setup.missing?.includes(e.path) && (dirs.has(e.path) || (setup.extra?.includes(e.path) ?? false) || (e.path === index && setup.index !== undefined)) }))
  on('fs.read', (_, e) => ({ value: e.path === index ? (setup.index ?? '') : '' }))
  on('fs.write', (_, e) => {
    setup.writes?.set(e.path, e.text)
    return { value: undefined }
  })
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

type Data = { isChangedOnly: boolean; removed: string[]; screens: { title: string; status: string; shots: { name: string; variant: string; status: string; after: string; before?: string; afterAt: string; beforeAt: string; sameAs?: string }[] }[] }

// 書いた一覧のページから、埋め込んだデータを取り出す
const dataOf = (writes: Map<string, string>, path = `${AFTER}/index.html`) => {
  const found = (writes.get(path) ?? '').match(/<script id="data" type="application\/json">(.*?)<\/script>/s)
  return JSON.parse(found?.[1] ?? 'null') as Data
}
const fromPage = (html: string) => dataOf(new Map([['p', html]]), 'p')

test('描く前に古い PNG を取っておき、描いた後に前と後を並べてトーストで知らせる', async ($, on) => {
  const ran: string[][] = []
  const writes = new Map<string, string>()
  const notes: string[] = []
  engine(on, ran, { writes, notes })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(ran).toContainEqual(['rsync', '-a', '--delete', '--include', '*.png', '--exclude', '*', `${AFTER}/`, `${BEFORE}.pending/`])
  expect(ran).toContainEqual(['mv', `${BEFORE}.pending`, BEFORE])

  const shots = dataOf(writes).screens.flatMap(screen => screen.shots)
  expect(shots.map(shot => [shot.name, shot.status])).toEqual([['review-balance-narrow', 'changed'], ['review-list-narrow', 'same'], ['review-new-narrow', 'added']])
  expect(shots[0]).toMatchObject({ before: `file://${BEFORE}/review-balance-narrow.png`, after: `file://${AFTER}/review-balance-narrow.png` })
  expect(notes).toEqual(['📸 review：変更 1・新規 1・同じ 1。一覧をブラウザーで開きました'])
})

test('ブラウザーで開けなかったら、toast で知らせる', async ($, on) => {
  const toasts: string[] = []
  const notes: string[] = []
  engine(on, [], { exit: { open: 1 }, toasts, notes })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts).toEqual(['ios-snapshot-gallery: ブラウザーで開くことに失敗しました: boom'])
  expect(notes).toEqual(['📸 review：変更 1・新規 1・同じ 1。/snapshots で一覧を開けます'])
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
  const notes: string[] = []
  await start({ exit: { shasum: 1 }, toasts, notes })($, on, [])

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(toasts[0]).toBe('ios-snapshot-gallery: ハッシュの取得に失敗しました: boom')
  expect(notes[0]).toMatch(/^📸 review：変更 2・新規 1。/)
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
  expect(await runCommand($, '')).toMatchObject({ text: 'review の一覧をブラウザーで開きました。' })
})

test('/snapshots は、まだ描いていなければ開き方を返す', async ($, on) => {
  await start({})($, on, [])
  expect(await runCommand($, '')).toMatchObject({ text: 'まだ描いたスナップショットがありません。/snapshots <セット> で開けます。' })
})

test('/snapshots <セット> は、そのセットを集めて一覧を書き、ブラウザーで開く', async ($, on) => {
  const ran: string[][] = []
  const writes = new Map<string, string>()
  await start({ writes })($, on, ran)

  expect(await runCommand($, 'review')).toMatchObject({ text: 'review の一覧をブラウザーで開きました。' })
  expect(writes.has(`${AFTER}/index.html`)).toBe(true)
  expect(ran).toContainEqual(['open', `${AFTER}/index.html`])
})

test('/snapshots で開けなかったら、そう返す', async ($, on) => {
  await start({ exit: { open: 1 } })($, on, [])
  expect(await runCommand($, 'review')).toMatchObject({ text: 'review の一覧を開けませんでした。' })
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

test('前と後に、画像を描いた日時を付ける。前の画像が無ければ「なし」', async ($, on) => {
  const writes = new Map<string, string>()
  await start({ afterMs: at(11, 7, 9, 5), beforeMs: at(1, 2, 23, 45), writes })($, on, [])
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const shots = dataOf(writes).screens.flatMap(screen => screen.shots)
  expect(shots[0]).toMatchObject({ beforeAt: '01/02 23:45', afterAt: '11/07 09:05' })
  expect(shots[2]).toMatchObject({ beforeAt: 'なし' })
})

test('変わった画像があれば、一覧を初めから変更と新規に絞る', async ($, on) => {
  const writes = new Map<string, string>()
  await start({ writes })($, on, [])
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  expect(dataOf(writes).isChangedOnly).toBe(true)
})

test('全部同じなら、一覧を絞らない', async ($, on) => {
  const writes = new Map<string, string>()
  const notes: string[] = []
  await start({ writes, notes, isAllSame: true })($, on, [])
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  expect(dataOf(writes).isChangedOnly).toBe(false)
  expect(notes).toEqual(['📸 review：同じ 3。/snapshots で一覧を開けます'])
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

test('設定が空か空白だけの時は、初めの値に戻す', { options: { commandPattern: '  ', snapshotsDir: '', beforeDir: ' ' } }, async ($, on) => {
  const ran: string[][] = []
  await start({})($, on, ran)

  await $.tool.call({ tool: 'Bash', command: 'make verify' })
  expect(ran).toEqual([])

  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  expect(ran).toContainEqual(['mv', `${BEFORE}.pending`, BEFORE])
})

test('前にはあって後に無い画像を、消えたとして数えて一覧に載せる', async ($, on) => {
  const writes = new Map<string, string>()
  const notes: string[] = []
  engine(on, [], { gone: ['review-old-narrow.png'], writes, notes })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  expect(dataOf(writes).removed).toEqual(['review-old-narrow'])
  expect(notes[0]).toMatch(/・消えた 1。/)
})

test('知らせの 1 行は、数が 0 のものを出さない', () => {
  const one = { name: 'set-a', after: '/o/set-a.png', status: 'added', width: 640, height: 960, afterMs: 2 } as const
  expect(summary({ set: 'set', cases: [one], removed: [], page: '/o/index.html', isChangedOnly: true }, true)).toBe('📸 set：新規 1。一覧をブラウザーで開きました')
})

const INDEX = [
  JSON.stringify({ file: 'review-balance-narrow.png', title: '振り返り › 残高', variant: '幅 320・ダーク' }),
  JSON.stringify({ file: 'review-new-narrow.png', title: '振り返り › 新しい月', variant: '幅 320・ダーク' }),
  '壊れた行',
].join('\n')

test('index.jsonl があれば、画面の名前ごとにまとめ、描き方の名前を付ける', async ($, on) => {
  const writes = new Map<string, string>()
  engine(on, [], { index: INDEX, writes })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })

  const screens = dataOf(writes).screens
  expect(screens.map(screen => [screen.title, screen.status])).toEqual([['振り返り › 残高', 'changed'], ['list', 'same'], ['振り返り › 新しい月', 'added']])
  expect(screens[0]?.shots[0]?.variant).toBe('幅 320・ダーク')
})

test('一覧のページは、名前を逃がし、閉じタグを埋め込みの中に作らない', () => {
  const one = { name: 'set-a-light', after: '/o/set-a-light.png', status: 'same', width: 640, height: 960, afterMs: 2, title: '<設定></script>', variant: 'ライト' } as const
  const html = page({ set: '<set>', cases: [one, { ...one, name: 'set-a-dark', after: '/o/set-a-dark.png', variant: 'ダーク', sameAs: 'set-a-light' }], removed: [], page: '/o/index.html', isChangedOnly: false })
  expect(html).toContain('<title>📸 &#60;set&#62;</title>')
  expect(html).not.toContain('<設定>')
  const data = fromPage(html)
  expect(data.screens).toHaveLength(1)
  expect(data.screens[0]?.shots[1]?.sameAs).toBe('<設定></script>（ライト）')
})

test('変わった画像は、先の画像と同じ見た目でも同じとしてまとめない', async ($, on) => {
  const writes = new Map<string, string>()
  // 変更の balance と新規の new を、同じの list と同じ見た目にする
  engine(on, [], { writes, hashes: { [`${AFTER}/review-balance-narrow.png`]: 'l1', [`${AFTER}/review-new-narrow.png`]: 'l1' } })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  const shots = dataOf(writes).screens.flatMap(screen => screen.shots)
  expect(shots.filter(shot => shot.status !== 'same').map(shot => shot.sameAs)).toEqual([undefined, undefined])
})

test('ファイル名の画面は、最後の「-描き方」を外した名前でまとめる', () => {
  const one = { name: 'set-a-narrow', after: '/o/set-a-narrow.png', status: 'added', width: 640, height: 960, afterMs: 2 } as const
  const data = fromPage(page({ set: 'set', cases: [one, { ...one, name: 'set-a-wide', after: '/o/set-a-wide.png' }], removed: [], page: '/o/index.html', isChangedOnly: true }))
  expect(data.screens.map(screen => [screen.title, screen.shots.map(shot => shot.variant)])).toEqual([['a', ['narrow', 'wide']]])
  expect(data.screens[0]?.shots[0]?.before).toBeUndefined()
})

test('変わった画像があれば、描いた後に一覧をブラウザーで開く', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  expect(ran).toContainEqual(['open', `${AFTER}/index.html`])
})

test('全部同じなら、描いた後にブラウザーを開かない', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { isAllSame: true })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  expect(ran.some(argv => argv[0] === 'open')).toBe(false)
})

test('人が見ていないセッションでは、変わった画像があってもブラウザーを開かない', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await $.tool.call({ tool: 'Bash', command: 'make snapshot SNAPSHOT=review' })
  expect(ran.some(argv => argv[0] === 'open')).toBe(false)
})
