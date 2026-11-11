import type { EngineInterface } from 'claude-code'

import type { Gallery, SnapshotCase } from '../types'

import type { Folders } from './config'
import { join } from './path'

const fail = (what: string, stderr: string) => `snapshot-gallery: ${what}に失敗しました: ${stderr.trim().slice(0, 80)}`

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

// 捨てる処理の失敗を toast で知らせる。.catch に渡す
export function report($: EngineInterface, what: string) {
  return (error: unknown) => $.ui.toast(fail(what, errorText(error)))
}

// 終了コードが 0 でなければ toast で知らせて false を返す。起動できなかった時も同じ
export async function succeeded($: EngineInterface, argv: string[], what: string) {
  try {
    const { exitCode, stderr } = await $.process.run(argv)
    if (exitCode === 0) return true
    $.ui.toast(fail(what, stderr))
  } catch (error) {
    $.ui.toast(fail(what, errorText(error)))
  }
  return false
}

// 一時のフォルダを消す。消せなくても先へ進む
export function discard($: EngineInterface, path: string) {
  return $.process.run(['rm', '-rf', path]).catch(() => undefined)
}

export async function pngs($: EngineInterface, dir: string) {
  if (!(await $.fs.exists(dir))) return []
  const entries = await $.fs.list(dir)
  return entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.png'))
}

async function hashes($: EngineInterface, files: string[]) {
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

async function sizes($: EngineInterface, files: string[]) {
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

export async function collect($: EngineInterface, root: string, set: string, dirs: Folders): Promise<Gallery> {
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
