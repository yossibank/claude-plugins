import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Gallery, SnapshotCase } from '../types'

const PANE = 'snapshot-gallery'
const TITLE = '📸 Snapshots'
const MAX_IMAGE_ROWS = 255
const MIN_IMAGE_ROWS = 6
const CHROME_ROWS = 10
const STATUS = {
  changed: { mark: '🟡', word: '変更', color: 'warning' },
  same: { mark: '⚪', word: '同じ', color: 'inactive' },
  added: { mark: '🟢', word: '新規', color: 'success' },
} as const
const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x26aa, 0x26ab],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
]

const gallery = atom({ plugin: 'snapshot-gallery', key: 'gallery' } as const, null, {
  shape: 'gallery-3',
})

const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

type Folders = { after: string; before: string }

const unquote = (text: string) => text.replace(/^(['"])(.*)\1$/, '$2')

const go = (base: string, dir: string) => {
  const target = unquote(dir)
  const parts: string[] = []
  for (const part of (target.startsWith('/') ? target : join(base, target)).split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

// コマンドの区切り（&& ; ||）ごとに、match の位置の区切りまで cd と make -C を順に当てて基点を動かす
const moveBase = (start: string, command: string, at: number) => {
  let base = start
  let from = 0
  for (const cut of [...command.matchAll(/&&|;|\|\||\n/g), { index: command.length, 0: '' }]) {
    const end = cut.index ?? command.length
    const part = command.slice(from, end)
    const cd = part.match(/^\s*cd\s+(\S+)/)
    if (cd?.[1] !== undefined) base = go(base, cd[1])
    if (at >= from && at < end) {
      const make = part.match(/\bmake\b[^|]*?\s-C\s*(\S+)/)
      return make?.[1] === undefined ? base : go(base, make[1])
    }
    from = end + cut[0].length
  }
  return base
}

const folders = (options: PluginOptions): Folders => ({
  after: String(options.snapshotsDir ?? '.build/snapshots'),
  before: String(options.beforeDir ?? '.build/snapshots-before'),
})

const watcher = (options: PluginOptions) => {
  try {
    return new RegExp(String(options.commandPattern ?? 'make\\s+(?:-C\\s+\\S+\\s+)?snapshot\\s+SNAPSHOT=([\\w.-]+)'))
  } catch {
    return null
  }
}

const pngs = async ($: EngineInterface, dir: string) => {
  if (!(await $.fs.exists(dir))) return []
  const entries = await $.fs.list(dir)
  return entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.png'))
}

const isSetName = (set: string) => /^[\w-][\w.-]*$/.test(set) && !set.includes('..')

const fail = (what: string, stderr: string) => `snapshot-gallery: ${what}に失敗しました: ${stderr.trim().slice(0, 80)}`

// 終了コードが 0 でなければ toast で知らせて false を返す。起動できなかった時も同じ
const succeeded = async ($: EngineInterface, argv: string[], what: string) => {
  try {
    const { exitCode, stderr } = await $.process.run(argv)
    if (exitCode === 0) return true
    $.ui.toast(fail(what, stderr))
  } catch (error) {
    $.ui.toast(fail(what, error instanceof Error ? error.message : String(error)))
  }
  return false
}

const hashes = async ($: EngineInterface, files: string[]) => {
  if (files.length === 0) return new Map<string, string>()
  const { exitCode, stdout, stderr } = await $.process.run(['shasum', '-a', '1', ...files])
  if (exitCode !== 0) $.ui.toast(fail('ハッシュの取得', stderr))
  return new Map(
    stdout
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [hash = '', ...path] = line.split('  ')
        return [path.join('  '), hash] as const
      }),
  )
}

const sizes = async ($: EngineInterface, files: string[]) => {
  const found = new Map<string, { width: number; height: number }>()
  if (files.length === 0) return found
  const { exitCode, stdout, stderr } = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', ...files])
  if (exitCode !== 0) $.ui.toast(fail('画像の大きさの取得', stderr))
  let file = ''
  for (const line of stdout.split('\n')) {
    const width = line.match(/pixelWidth: (\d+)/)
    const height = line.match(/pixelHeight: (\d+)/)
    if (width) found.set(file, { width: Number(width[1]), height: found.get(file)?.height ?? 0 })
    else if (height) found.set(file, { width: found.get(file)?.width ?? 0, height: Number(height[1]) })
    else if (line.length > 0 && !line.startsWith(' ')) file = line
  }
  return found
}

const collect = async ($: EngineInterface, root: string, set: string, dirs: Folders): Promise<Gallery> => {
  const afterDir = join(root, dirs.after, set)
  const beforeDir = join(root, dirs.before, set)
  const after = await pngs($, afterDir)
  const before = new Map((await pngs($, beforeDir)).map(entry => [entry.name, entry]))
  const afterFiles = after.map(entry => join(afterDir, entry.name))
  const beforeFiles = [...before.keys()].map(name => join(beforeDir, name))
  const hash = await hashes($, [...afterFiles, ...beforeFiles])
  const size = await sizes($, afterFiles)

  const cases = after
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry): SnapshotCase => {
      const afterPath = join(afterDir, entry.name)
      const old = before.get(entry.name)
      const beforePath = old ? join(beforeDir, entry.name) : undefined
      const afterHash = hash.get(afterPath)
      const status = beforePath === undefined ? 'added' : afterHash !== undefined && afterHash === hash.get(beforePath) ? 'same' : 'changed'
      const { width, height } = size.get(afterPath) ?? { width: 1, height: 1 }
      return {
        name: entry.name.replace(/\.png$/, ''),
        after: afterPath,
        before: beforePath,
        status,
        width,
        height,
        afterMs: entry.mtimeMs,
        beforeMs: old?.mtimeMs,
      }
    })
  const first = cases.findIndex(one => one.status !== 'same')
  return { set, cases, index: Math.max(0, first), isChangedOnly: false }
}

const stamp = (ms: number | undefined) => {
  if (ms === undefined) return 'なし'
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const cellWidth = (text: string) =>
  [...text].reduce((sum, char) => {
    const code = char.codePointAt(0) ?? 0
    return sum + (WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1)
  }, 0)

const shown = (state: Gallery) => state.cases.filter(one => !state.isChangedOnly || one.status !== 'same')

const fit = (one: SnapshotCase, columns: number, maxRows: number) => {
  const limit = Math.min(MAX_IMAGE_ROWS, Math.max(MIN_IMAGE_ROWS, maxRows))
  const rows = Math.max(1, Math.round((columns * one.height) / one.width / 2))
  if (rows <= limit) return { columns, rows }
  return { columns: Math.max(1, Math.round((limit * 2 * one.width) / one.height)), rows: limit }
}

const label = (one: SnapshotCase, set: string) => (one.name.startsWith(`${set}-`) ? one.name.slice(set.length + 1) : one.name)

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE })

export const register: Register = (on, options) => {
  const dirs = folders(options)
  const pattern = watcher(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'snapshots', description: 'スナップショットの画廊を開く。引数にセットの名前を渡せる' })
    return next(e)
  })

  on('command.run', { command: 'snapshots' }, async ($, e) => {
    const set = e.args.trim()
    if (set.length > 0) {
      if (!isSetName(set)) return { text: 'セットの名前が正しくありません' }
      const found = await collect($, await $.session.cwd(), set, dirs)
      if (found.cases.length === 0) return { text: `${set} の画像がありません` }
      await update($, gallery, () => found)
    }
    const state = await read($, gallery)
    if (state === null) return { text: 'まだ描いたスナップショットがありません。/snapshots <セット> で開けます。' }
    await open($)
    return { text: `${state.set} のスナップショットを開きました。` }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const found = pattern === null ? null : e.command.match(pattern)
    if (found === null) return next(e)

    const base = moveBase(await $.session.cwd(), e.command, found.index ?? 0)
    const set = found[1] ?? ''
    if (!isSetName(set)) return next(e)
    const afterDir = join(base, dirs.after, set)
    const beforeDir = join(base, dirs.before, set)
    const pending = `${beforeDir}.pending`
    const backup = `${beforeDir}.old`
    let isCopied = (await pngs($, afterDir)).length > 0
    if (isCopied) {
      const isReady =
        (await succeeded($, ['rm', '-rf', pending], '一時のフォルダの削除')) &&
        (await succeeded($, ['mkdir', '-p', pending], '一時のフォルダの作成')) &&
        (await succeeded($, ['rsync', '-a', '--delete', '--include', '*.png', '--exclude', '*', `${afterDir}/`, `${pending}/`], '前の画像の写し'))
      if (!isReady) {
        await $.process.run(['rm', '-rf', pending]).catch(() => undefined)
        isCopied = false
      }
    }

    let ran
    try {
      ran = await next(e)
    } catch (error) {
      if (isCopied) await $.process.run(['rm', '-rf', pending])
      throw error
    }
    if (ran.deny !== undefined || ran.isError === true) {
      if (isCopied) await $.process.run(['rm', '-rf', pending])
      return ran
    }
    if (isCopied) {
      // before は退避してから入れ替え、失敗したら戻す
      const hasBefore = await $.fs.exists(beforeDir)
      const isKept = hasBefore && (await succeeded($, ['rm', '-rf', backup], '古い退避の削除')) && (await succeeded($, ['mv', beforeDir, backup], '前の画像の退避'))
      const isSwapped = (!hasBefore || isKept) && (await succeeded($, ['mv', pending, beforeDir], '前の画像の入れ替え'))
      if (isSwapped) {
        if (isKept) await succeeded($, ['rm', '-rf', backup], '退避の削除')
      } else {
        if (isKept) await $.process.run(['mv', backup, beforeDir]).catch(() => undefined)
        await $.process.run(['rm', '-rf', pending]).catch(() => undefined)
      }
    }

    const drawn = await collect($, base, set, dirs)
    if (drawn.cases.length > 0) {
      await update($, gallery, () => drawn)
      void open($)
    }
    return ran
  })

  on('ui.focus', { requestId: PANE }, ($, e, next) => (e.origin.kind === 'person' && e.element !== undefined ? {} : next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Image = 'Image' in elements ? elements.Image : undefined
    const state = await read($, gallery)

    if (state === null) return <Text dimColor>まだ描いたスナップショットがありません。</Text>

    const list = shown(state)
    const current = list[Math.min(state.index, list.length - 1)]
    const count = (status: keyof typeof STATUS) => state.cases.filter(one => one.status === status).length
    const select = (to: number) => update($, gallery, old => (old === null ? old : { ...old, index: Math.max(0, Math.min(to, shown(old).length - 1)) }))
    const position = current === undefined ? 0 : list.indexOf(current)
    const previous = list[position - 1]
    const following = list[position + 1]

    const half = Math.floor((e.props.bodyColumns - 1) / 2)
    const size = current === undefined ? { columns: half - 2, rows: MIN_IMAGE_ROWS } : fit(current, Math.max(8, half - 2), e.props.scroll.bodyRows - CHROME_ROWS)
    const line = (rows: number) => Array.from({ length: rows }, () => '│').join('\n')

    const picture = (path: string | undefined, ms: number | undefined, key: string, title: string, titleWidth: number, isAfter: boolean) => (
      <Box flexDirection="column">
        <Text>
          <Text dimColor>╭─ </Text>
          <Text bold={isAfter} dimColor={!isAfter}>{key}</Text>
          {isAfter && current !== undefined && <Text color={STATUS[current.status].color}>{title}</Text>}
          <Text dimColor> {'─'.repeat(Math.max(0, size.columns - 3 - titleWidth))}╮</Text>
        </Text>
        <Box flexDirection="row">
          <Text dimColor>{line(size.rows)}</Text>
          {path === undefined ? (
            <Box width={size.columns} height={size.rows} justifyContent="center" alignItems="center">
              <Text dimColor>前の画像なし</Text>
            </Box>
          ) : Image === undefined ? (
            <Box width={size.columns} height={size.rows}>
              <Text dimColor>{path}</Text>
            </Box>
          ) : (
            <Image key={key} source={{ file: path, format: 'png', generation: ms === undefined ? undefined : Math.round(ms) }} columns={size.columns} rows={size.rows} alt={key} />
          )}
          <Text dimColor>{line(size.rows)}</Text>
        </Box>
        <Text dimColor>{`╰─ ${stamp(ms)} ${'─'.repeat(Math.max(0, size.columns - 3 - cellWidth(stamp(ms))))}╯`}</Text>
      </Box>
    )
    const afterTitle = current === undefined ? '' : ` · ${STATUS[current.status].mark} ${STATUS[current.status].word}`

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              📸 <Text bold>{state.set}</Text>
            </Text>
            <Text dimColor>{list.length === 0 ? '0 / 0' : `${position + 1} / ${list.length}`}</Text>
          </Box>
          <Text>
            {(['changed', 'same', 'added'] as const).map(status => (
              <Text>
                {STATUS[status].mark} <Text dimColor>{STATUS[status].word}</Text> {count(status)}{'   '}
              </Text>
            ))}
          </Text>
        </Box>
        <Text>
          {'  '}
          {previous !== undefined && <Text dimColor>‹ {label(previous, state.set)}  </Text>}
          {current !== undefined && (
            <Text bold inverse>
              {' '}{label(current, state.set)}{' '}
            </Text>
          )}
          {following !== undefined && <Text dimColor>  {label(following, state.set)} ›</Text>}
          {list.length === 0 && <Text dimColor>変わったものはありません</Text>}
        </Text>
        <Text> </Text>
        <Box flexDirection="row" gap={1}>
          {current !== undefined && picture(current.before, current.beforeMs, '前', '', 2, false)}
          {current !== undefined && picture(current.after, current.afterMs, '後', afterTitle, 2 + cellWidth(afterTitle), true)}
        </Box>
        <Text> </Text>
        <Box flexDirection="row" gap={2}>
          <Button key="previous" plain hotkey="j" onPress={() => void select(position - 1)}>‹ 前</Button>
          <Button key="next" plain hotkey="k" onPress={() => void select(position + 1)}>次 ›</Button>
          <Button key="changed-only" plain hotkey="c" onPress={() => void update($, gallery, old => (old === null ? old : { ...old, isChangedOnly: !old.isChangedOnly, index: 0 }))}>
            {state.isChangedOnly ? 'すべて' : '変更だけ'}
          </Button>
          {current !== undefined && (
            <Button key="finder" plain hotkey="o" onPress={() => void $.process.run(['open', '-R', current.after])}>Finder</Button>
          )}
          <Text dimColor>↑↓ スクロール</Text>
        </Box>
      </Box>
    )
  })
}
