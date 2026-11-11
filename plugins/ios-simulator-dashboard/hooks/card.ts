import { fitSegs, padSegs, segWidth } from './cell'
import type { Seg } from './cell'
import { TN } from './palette'

// 2 列の表の罫線と余白が取る幅（│ 空白 / 空白 │ 空白 / 空白 │）
const TABLE_COLUMNS = 7
// 題と下の note を埋める罫線の外側が取る幅（╭─ 空白 / 空白 ╮）
const TITLE_COLUMNS = 5
// これより狭い値の列では、表を描かない
const MIN_VALUE_COLUMNS = 4

export type Row = [Seg[], Seg[]]

// 題を上の罫線に、note を下の罫線に埋めた 2 列の表
export const card = (title: Seg[], rows: Row[], inner: number, note?: Seg[]): Seg[][] => {
  const line = TN.line
  const keyWidth = Math.max(1, ...rows.map(([key]) => segWidth(key)))
  const value = Math.max(1, inner - keyWidth - TABLE_COLUMNS)
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
