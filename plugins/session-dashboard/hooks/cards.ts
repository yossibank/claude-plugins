import type { Claude, Fill, Limit, Repo } from '../types'

import { card, changeSegs, keyWidthOf, valueWidth } from './card'
import { cellWidth, gradient } from './cell'
import type { Seg } from './cell'
import { LIMIT_NAMES } from './claude'
import { heat, HEAT, ICON, TN } from './palette'
import { elapsedOf, untilReset } from './time'
import { gradeOf, kilo, thousands } from './tokens'

// 割合の列（空白 + 100%）の幅
const PERCENT_COLUMNS = 5
// 戻るまでの時間を出すのに要る棒の最小の幅
const MIN_BAR_COLUMNS = 4
// 使った量の列（6 桁にそろえた量 + 空白）の幅
const AMOUNT_COLUMNS = 7
// 1 時間あたりの費用を出すまでの分数
const RATE_MINUTES = 5

export const claudeCard = (info: Claude, inner: number) =>
  card(
    [{ text: `${ICON.model} Claude`, color: TN.blue, bold: true }],
    [
      [[{ text: 'model', color: TN.comment }], [{ text: info.model, color: TN.fg }]],
      [[{ text: 'cost', color: TN.comment }], [{ text: info.usd === null ? '—' : `$${info.usd.toFixed(2)}`, color: TN.orange }]],
    ],
    inner,
    info.version === '' ? undefined : [{ text: `v${info.version}`, color: TN.comment }],
  )

export const repoCard = (git: Repo, inner: number) =>
  card(
    [{ text: `${ICON.repo} ${git.name}`, color: TN.cyan, bold: true }],
    [
      [[{ text: 'branch', color: TN.comment }], [{ text: git.branch === '' ? '—' : git.branch, color: TN.magenta }]],
      [[{ text: 'diff', color: TN.comment }], changeSegs(git)],
    ],
    inner,
  )

export const limitCard = (limits: readonly Limit[], now: number, inner: number) => {
  const keys = limits.map((limit): Seg[] => [{ text: LIMIT_NAMES[limit.kind] ?? limit.kind, color: TN.fg }])
  const value = valueWidth(inner, keyWidthOf(keys.map((key): [Seg[], Seg[]] => [key, []])))
  const resets = limits.map(limit => untilReset(limit.resetsAt, now))
  // 棒の長さをそろえるため、戻るまでの時間は一番長いものの幅で取る
  const resetWidth = Math.max(0, ...resets.map(until => cellWidth(until)))
  const isResetShown = resetWidth > 0 && value - PERCENT_COLUMNS - resetWidth - 1 >= MIN_BAR_COLUMNS
  return card(
    [{ text: `${ICON.limit} Limit`, color: TN.yellow, bold: true }],
    limits.map((limit, index): [Seg[], Seg[]] => {
      const percent = `${Math.round(limit.percentUsed)}%`.padStart(4)
      // 棒が 4 も取れなければ、戻るまでの時間を落とす
      const reset = isResetShown ? ` ${' '.repeat(resetWidth - cellWidth(resets[index] ?? ''))}${resets[index] ?? ''}` : ''
      const columns = Math.max(1, value - PERCENT_COLUMNS - (isResetShown ? resetWidth + 1 : 0))
      return [
        keys[index] ?? [],
        [...gradient(limit.percentUsed / 100, columns, HEAT, TN.line), { text: ` ${percent}`, color: heat(limit.percentUsed / 100), bold: true }, { text: reset, color: TN.comment }],
      ]
    }),
    inner,
  )
}

export const unmeasuredCard = (inner: number) =>
  card([{ text: `${ICON.context} Context`, color: TN.magenta, bold: true }], [[[], [{ text: 'まだ測っていません。', color: TN.comment }]]], inner)

export const contextCard = (measured: Fill, left: number | null, inner: number) => {
  const grade = gradeOf(measured)
  const legend = [...measured.slices].sort((x, y) => y.tokens - x.tokens)
  const keyWidth = Math.max(4, ...legend.map(slice => cellWidth(slice.name)))
  const value = valueWidth(inner, keyWidth)
  const top = Math.max(...legend.map(slice => slice.tokens), 1)
  const total = `${thousands(measured.tokens)}/${thousands(measured.window)}`
  return card(
    [{ text: `${ICON.context} Context ${measured.percent}%`, color: TN.magenta, bold: true }],
    [
      [[{ text: 'used', color: TN.comment }], [...gradient(measured.percent / 100, Math.max(1, value - cellWidth(total) - 1), [TN.blue, TN.magenta], TN.line), { text: ` ${total}`, color: TN.fg }]],
      ...legend.map((slice): [Seg[], Seg[]] => [
        [{ text: slice.name, color: TN.fgDark }],
        [{ text: kilo(slice.tokens).padStart(6), color: TN.fg }, { text: ' ' }, ...gradient(slice.tokens / top, Math.max(1, value - AMOUNT_COLUMNS), [TN.magenta, TN.magenta], TN.bgHighlight, '━', ' ')],
      ]),
    ],
    inner,
    [
      { text: 'grade ', color: TN.comment },
      { text: grade.name, color: grade.color, bold: true },
      { text: ` · ${ICON.cache} ${left === null ? 'cold' : `${left}m`}`, color: TN.comment },
    ],
  )
}

export const sessionCard = (ms: number, turns: number, calls: number, spent: number | null, inner: number) => {
  const rate = spent === null || ms < RATE_MINUTES * 60_000 ? '—' : `$${(spent / (ms / 3_600_000)).toFixed(2)}/h`
  return card(
    [{ text: `${ICON.session} Session`, color: TN.teal, bold: true }],
    [
      [[{ text: 'time', color: TN.comment }], [{ text: elapsedOf(ms), color: TN.fg }, { text: ` · ${turns} turns`, color: TN.fgDark }]],
      [[{ text: 'calls', color: TN.comment }], [{ text: String(calls), color: TN.fg }, { text: ` · ${rate}`, color: TN.orange }]],
    ],
    inner,
  )
}
