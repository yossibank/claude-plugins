import type { EngineInterface } from 'claude-code'

const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x26a1, 0x26a1],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
]

export const cellWidth = (text: string) =>
  [...text].reduce((sum, char) => {
    const code = char.codePointAt(0) ?? 0
    return sum + (WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1)
  }, 0)

// 幅に収まらなければ末尾を … にする
const fit = (text: string, width: number) => {
  if (cellWidth(text) <= width) return text
  let out = ''
  for (const char of text) {
    if (cellWidth(out + char) > width - 1) break
    out += char
  }
  return `${out}…`
}

export type Seg = { text: string; color?: string; bold?: boolean }

export const segWidth = (segs: readonly Seg[]) => segs.reduce((sum, seg) => sum + cellWidth(seg.text), 0)

// 幅に収まらなければ、はみ出す所から … にする
export const fitSegs = (segs: readonly Seg[], width: number): Seg[] => {
  if (segWidth(segs) <= width) return [...segs]
  const out: Seg[] = []
  let used = 0
  for (const seg of segs) {
    const cells = cellWidth(seg.text)
    if (used + cells < width) {
      out.push(seg)
      used += cells
      continue
    }
    // ちょうど収まっても後ろが切れるので、… で終える
    out.push({ ...seg, text: fit(`${seg.text} `, width - used) })
    break
  }
  return out
}

export const padSegs = (segs: readonly Seg[], width: number): Seg[] => {
  const fitted = fitSegs(segs, width)
  return [...fitted, { text: ' '.repeat(Math.max(0, width - segWidth(fitted))) }]
}

type TextElement = ReturnType<EngineInterface['ui']['resolve']>['Text']

export const draw = (Text: TextElement, segs: readonly Seg[], key: string) => (
  <Text key={key}>
    {segs.map((seg, index) => (
      <Text key={String(index)} {...(seg.color === undefined ? {} : { color: seg.color })} {...(seg.bold === true ? { bold: true } : {})}>
        {seg.text}
      </Text>
    ))}
  </Text>
)
