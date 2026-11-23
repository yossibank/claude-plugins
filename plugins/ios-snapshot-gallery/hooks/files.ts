import type { EngineInterface } from 'claude-code'

import type { Gallery, SnapshotCase } from '../types'

import type { Folders } from './config'
import { join } from './path'

const fail = (what: string, stderr: string) => `ios-snapshot-gallery: ${what}に失敗しました: ${stderr.trim().slice(0, 80)}`

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

// index.jsonl の 1 行は { file, title, variant }。読めない行と、ファイルの無い行は飛ばす
async function titles($: EngineInterface, dir: string) {
  const found = new Map<string, { title: string; variant: string }>()
  const path = join(dir, 'index.jsonl')
  if (!(await $.fs.exists(path))) return found
  const text = await $.fs.read(path).catch((error: unknown) => {
    report($, '画面の名前の読み込み')(error)
    return ''
  })
  for (const line of text.split('\n')) {
    try {
      const entry: unknown = JSON.parse(line)
      if (typeof entry !== 'object' || entry === null) continue
      const { file, title, variant } = entry as Record<string, unknown>
      if (typeof file !== 'string' || typeof title !== 'string') continue
      found.set(file, { title, variant: typeof variant === 'string' ? variant : '' })
    } catch {
      continue
    }
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
  // 大きさは、ページで縦横の比を出す後の画像の分だけを取る
  const size = await sizes($, afterFiles)
  const named = await titles($, afterDir)
  // 同じ回に描いた画像で、ハッシュが同じものは先の 1 枚にまとめる
  const firstOfHash = new Map<string, string>()

  const cases = after
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry): SnapshotCase => {
      const afterPath = join(afterDir, entry.name)
      const old = before.get(entry.name)
      const beforePath = old ? join(beforeDir, entry.name) : undefined
      const afterHash = hash.get(afterPath)
      const status = beforePath === undefined ? 'added' : afterHash !== undefined && afterHash === hash.get(beforePath) ? 'same' : 'changed'
      const { width, height } = size.get(afterPath) ?? { width: 1, height: 1 }
      const name = entry.name.replace(/\.png$/, '')
      const found = afterHash === undefined ? undefined : firstOfHash.get(afterHash)
      if (afterHash !== undefined && found === undefined) firstOfHash.set(afterHash, name)
      // 変わった画像はたたまない。たたむと、変わったものが一覧から見えなくなる
      const sameAs = status === 'same' ? found : undefined
      return {
        name,
        after: afterPath,
        before: beforePath,
        status,
        width,
        height,
        afterMs: entry.mtimeMs,
        beforeMs: old?.mtimeMs,
        title: named.get(entry.name)?.title,
        variant: named.get(entry.name)?.variant,
        sameAs,
      }
    })
  const hasChange = cases.some(one => one.status !== 'same')
  const drawn = new Set(after.map(entry => entry.name))
  const removed = [...before.keys()]
    .filter(name => !drawn.has(name))
    .sort((a, b) => a.localeCompare(b))
    .map(name => name.replace(/\.png$/, ''))
  return { set, cases, removed, page: join(afterDir, 'index.html'), isChangedOnly: hasChange }
}
