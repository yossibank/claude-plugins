import type { Gallery, SnapshotCase } from '../types'

import { MAX_IMAGE_ROWS, MIN_IMAGE_ROWS } from './config'

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

export const stamp = (ms: number | undefined) => {
  if (ms === undefined) return 'なし'
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const cellWidth = (text: string) =>
  [...text].reduce((sum, char) => {
    const code = char.codePointAt(0) ?? 0
    return sum + (WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1)
  }, 0)

export const shown = (state: Gallery) => state.cases.filter(one => !state.isChangedOnly || one.status !== 'same')

export const fit = (one: SnapshotCase, columns: number, maxRows: number) => {
  const limit = Math.min(MAX_IMAGE_ROWS, Math.max(MIN_IMAGE_ROWS, maxRows))
  const rows = Math.max(1, Math.round((columns * one.height) / one.width / 2))
  if (rows <= limit) return { columns, rows }
  return { columns: Math.max(1, Math.round((limit * 2 * one.width) / one.height)), rows: limit }
}

export const label = (one: SnapshotCase, set: string) => (one.name.startsWith(`${set}-`) ? one.name.slice(set.length + 1) : one.name)
