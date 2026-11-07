import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Touched } from '../types'

const files = atom({ plugin: 'session-dashboard', key: 'files' } as const, [] as Touched[])

// 覚えておく、書き換えたファイルの数
const FILES_KEPT = 20

// 書き換えたファイルを、新しい順に回数と並べる
const touch = (list: readonly Touched[], path: string): Touched[] => {
  const before = list.find(item => item.path === path)
  return [{ path, count: (before?.count ?? 0) + 1 }, ...list.filter(item => item.path !== path)].slice(0, FILES_KEPT)
}

export async function currentFiles($: EngineInterface) {
  return read($, files)
}

export async function touchFile($: EngineInterface, path: string) {
  await update($, files, now => touch(now, path))
}

export async function resetFiles($: EngineInterface) {
  await update($, files, () => [])
}
