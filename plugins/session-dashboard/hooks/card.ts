import type { Repo } from '../types'

import { fitSegs, padSegs, segWidth } from './cell'
import type { Seg } from './cell'
import { TN } from './palette'

// 2 列の表の罫線と余白が取る幅（│ 空白 / 空白 │ 空白 / 空白 │）
const TABLE_COLUMNS = 7
// 題と下の note を埋める罫線の外側が取る幅（╭─ 空白 / 空白 ╮）
const TITLE_COLUMNS = 5
// これより狭い値の列では、表を描かない
const MIN_VALUE_COLUMNS = 4

export const valueWidth = (inner: number, keyWidth: number) => Math.max(1, inner - keyWidth - TABLE_COLUMNS)

export const keyWidthOf = (rows: [Seg[], Seg[]][]) => Math.max(1, ...rows.map(([key]) => segWidth(key)))

// 題を上の罫線に、note を下の罫線に埋めた 2 列の表
export const card = (title: Seg[], rows: [Seg[], Seg[]][], inner: number, note?: Seg[]): Seg[][] => {
  const line = TN.line
  const keyWidth = keyWidthOf(rows)
  const value = valueWidth(inner, keyWidth)
  // 表が描けないほど狭ければ、罫線を外して 1 行ずつ並べる
  if (value < MIN_VALUE_COLUMNS)
    return [fitSegs(title, inner), ...rows.map(([key, cell]) => fitSegs([...key, { text: ' ' }, ...cell], inner)), ...(note === undefined ? [] : [fitSegs(note, inner)])]
  const head = fitSegs(title, Math.max(1, inner - TITLE_COLUMNS))
  const out: Seg[][] = [[{ text: '╭─ ', color: line }, ...head, { text: ` ${'─'.repeat(Math.max(0, inner - TITLE_COLUMNS - segWidth(head)))}╮`, color: line }]]
  for (const [key, cell] of rows)
    out.push([{ text: '│ ', color: line }, ...padSegs(key, keyWidth), { text: ' │ ', color: line }, ...padSegs(cell, value), { text: ' │', color: line }])
  if (note === undefined) out.push([{ text: `╰${'─'.repeat(keyWidth + 2)}┴${'─'.repeat(value + 2)}╯`, color: line }])
  else {
    const tail = fitSegs(note, Math.max(1, inner - TITLE_COLUMNS))
    out.push([{ text: `╰${'─'.repeat(Math.max(0, inner - TITLE_COLUMNS - segWidth(tail)))} `, color: line }, ...tail, { text: ' ─╯', color: line }])
  }
  return out
}

export const changeSegs = (git: Repo, palette: { green: string; red: string; yellow: string; comment: string } = TN): Seg[] => {
  const parts: Seg[] = [
    ...(git.added > 0 ? [{ text: `+${git.added}`, color: palette.green }] : []),
    ...(git.deleted > 0 ? [{ text: `-${git.deleted}`, color: palette.red }] : []),
    ...(git.untracked > 0 ? [{ text: `?${git.untracked}`, color: palette.yellow }] : []),
  ]
  return parts.length === 0 ? [{ text: 'なし', color: palette.comment }] : parts.flatMap((part, index) => (index === 0 ? [part] : [{ text: ' ' }, part]))
}
