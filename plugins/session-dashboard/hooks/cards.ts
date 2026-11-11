import type { Claude, Fill, Limit, Repo, Spent, Stats } from '../types'

import { card, changeSegs, keyWidthOf, valueWidth } from './card'
import { cellWidth, gradient } from './cell'
import type { Seg } from './cell'
import { LIMIT_NAMES } from './claude'
import { blend, heat, HEAT, ICON, TN } from './palette'
import { agoOf, durationOf, elapsedOf, paceOf, untilReset } from './time'
import { gradeOf, growthOf, kilo, thousands } from './tokens'

// 割合の列（空白 + 100%）の幅
const PERCENT_COLUMNS = 5
// 戻るまでの時間を出すのに要る棒の最小の幅
const MIN_BAR_COLUMNS = 4
// 使った量の列（6 桁にそろえた量 + 空白）の幅
const AMOUNT_COLUMNS = 7
// 1 時間あたりの費用を出すまでの分数
const RATE_MINUTES = 5
// 推移の棒の字。低い順
const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
// 要約まで、これより少ないターンなら赤くする
const FEW_TURNS = 3
// Session の表に名前を出すツールの数
const TOOLS_SHOWN = 3

const dot: Seg = { text: ' · ', color: TN.comment }
const key = (text: string): Seg[] => [{ text, color: TN.comment }]

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

// upstream との差。↑ はまだ push していない commit、↓ はまだ取り込んでいない commit
const syncSegs = (ahead: number, behind: number): Seg[] => {
  if (ahead + behind === 0) return [{ text: '同期済み', color: TN.comment }]
  return [...(ahead > 0 ? [{ text: `↑${ahead}`, color: TN.green }] : []), ...(ahead > 0 && behind > 0 ? [{ text: ' ' }] : []), ...(behind > 0 ? [{ text: `↓${behind}`, color: TN.red }] : [])]
}

export const repoCard = (git: Repo, now: number, inner: number) =>
  card(
    [{ text: `${ICON.repo} ${git.name}`, color: TN.cyan, bold: true }],
    [
      [key('branch'), [{ text: git.branch === '' ? '—' : git.branch, color: TN.magenta }]],
      [key('diff'), changeSegs(git)],
      ...(git.ahead === undefined || git.behind === undefined ? [] : [[key('sync'), syncSegs(git.ahead, git.behind)] satisfies [Seg[], Seg[]]]),
      ...(git.last === undefined ? [] : [[key('last'), [{ text: agoOf(now - git.last.at * 1000), color: TN.fgDark }, { text: ` ${git.last.subject}`, color: TN.fg }]] satisfies [Seg[], Seg[]]]),
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
    paceNote(limits, now),
  )
}

// 今のペースで戻る時刻まで使った時の予測。出せる窓が無ければ undefined
const paceNote = (limits: readonly Limit[], now: number): Seg[] | undefined => {
  const paces = limits.flatMap(limit => {
    const pace = paceOf(limit.kind, limit.percentUsed, limit.resetsAt, now)
    return pace === null ? [] : [{ name: LIMIT_NAMES[limit.kind] ?? limit.kind, pace }]
  })
  if (paces.length === 0) return undefined
  return [{ text: '予測 ', color: TN.comment }, ...paces.flatMap(({ name, pace }, index): Seg[] => [...(index === 0 ? [] : [dot]), { text: `${name} ${Math.round(pace)}%`, color: heat(pace / 100), bold: pace >= 100 }])]
}

// 自動の要約までの残りと、今の増え方であと何ターンか
const compactRow = (measured: Fill, samples: readonly number[]): [Seg[], Seg[]][] => {
  if (measured.compactAt === undefined) return []
  const left = measured.compactAt - measured.tokens
  if (left <= 0) return [[[{ text: '要約まで', color: TN.fgDark }], [{ text: 'まもなく', color: TN.red, bold: true }]]]
  const growth = growthOf(samples)
  const turns = growth === null ? null : Math.ceil(left / growth)
  return [
    [
      [{ text: '要約まで', color: TN.fgDark }],
      [{ text: `あと ${thousands(left)}`, color: TN.fg }, ...(turns === null ? [] : [dot, { text: `約 ${turns} ターン`, color: turns < FEW_TURNS ? TN.red : TN.fgDark }])],
    ],
  ]
}

// メインのターンごとの文脈の量を、窓に対する高さの棒で並べる。2 回分からだけ出す
const trendRow = (measured: Fill, samples: readonly number[], value: number): [Seg[], Seg[]][] => {
  if (samples.length < 2) return []
  const growth = growthOf(samples)
  const tail = growth === null ? '' : ` +${thousands(Math.round(growth))}/ターン`
  const shown = samples.slice(-Math.max(1, value - cellWidth(tail)))
  const bars = shown.map((tokens): Seg => {
    const ratio = Math.max(0, Math.min(1, tokens / measured.window))
    return { text: SPARKS[Math.round(ratio * (SPARKS.length - 1))] ?? '▁', color: blend([TN.blue, TN.magenta], ratio) }
  })
  return [[[{ text: '推移', color: TN.fgDark }], [...bars, { text: tail, color: TN.comment }]]]
}

export const unmeasuredCard = (inner: number) =>
  card([{ text: `${ICON.context} Context`, color: TN.magenta, bold: true }], [[[], [{ text: 'まだ測っていません。', color: TN.comment }]]], inner)

export const contextCard = (measured: Fill, left: number | null, samples: readonly number[], inner: number) => {
  const grade = gradeOf(measured)
  const legend = [...measured.slices].sort((x, y) => y.tokens - x.tokens)
  const keyWidth = Math.max(4, ...legend.map(slice => cellWidth(slice.name)), measured.compactAt === undefined ? 0 : cellWidth('要約まで'))
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
      ...trendRow(measured, samples, value),
      ...compactRow(measured, samples),
    ],
    inner,
    [
      { text: 'grade ', color: TN.comment },
      { text: grade.name, color: grade.color, bold: true },
      { text: ` · ${ICON.cache} ${left === null ? 'cold' : `${left}m`}`, color: TN.comment },
    ],
  )
}

// セッションで使ったトークンの合計と、入力のうちキャッシュから読めた割合。まだ応答が無ければ空
export const tokensCard = (spent: Spent, inner: number): Seg[][] => {
  const input = spent.input + spent.cacheRead + spent.cacheWrite
  if (input + spent.output === 0) return []
  const hit = input === 0 ? 0 : spent.cacheRead / input
  const value = valueWidth(inner, cellWidth('cache'))
  const percent = `${Math.round(hit * 100)}%`.padStart(4)
  return card(
    [{ text: `${ICON.tokens} Tokens`, color: TN.green, bold: true }],
    [
      [key('in'), [{ text: thousands(input), color: TN.fg }, { text: ` · 新規 ${thousands(spent.input + spent.cacheWrite)}`, color: TN.fgDark }]],
      [key('out'), [{ text: thousands(spent.output), color: TN.fg }]],
      // キャッシュは、よく効いているほど緑にする
      [key('cache'), [...gradient(hit, Math.max(1, value - PERCENT_COLUMNS), [TN.orange, TN.green], TN.line), { text: ` ${percent}`, color: blend([TN.orange, TN.green], hit), bold: true }]],
    ],
    inner,
  )
}

// よく使ったツールを多い順に並べ、失敗の数を添える
const toolSegs = (counted: Stats): Seg[] => {
  const names = Object.entries(counted.byName).sort(([, x], [, y]) => y - x).slice(0, TOOLS_SHOWN)
  return [
    ...names.flatMap(([name, count], index): Seg[] => [...(index === 0 ? [] : [dot]), { text: `${name} ${count}`, color: TN.fgDark }]),
    ...(counted.errors === 0 ? [] : [dot, { text: `失敗 ${counted.errors}`, color: TN.red }]),
  ]
}

export const sessionCard = (ms: number, counted: Stats, spent: number | null, inner: number) => {
  const rate = spent === null || ms < RATE_MINUTES * 60_000 ? '—' : `$${(spent / (ms / 3_600_000)).toFixed(2)}/h`
  return card(
    [{ text: `${ICON.session} Session`, color: TN.teal, bold: true }],
    [
      [key('time'), [{ text: elapsedOf(ms), color: TN.fg }, { text: ` · ${counted.turns} turns`, color: TN.fgDark }]],
      [key('calls'), [{ text: String(counted.calls), color: TN.fg }, { text: ` · ${rate}`, color: TN.orange }]],
      ...(counted.turns === 0
        ? []
        : [[key('turn'), [{ text: `平均 ${durationOf(counted.turnMs / counted.turns)}`, color: TN.fg }, { text: ` · 直近 ${durationOf(counted.lastTurnMs)}`, color: TN.fgDark }]] satisfies [Seg[], Seg[]]]),
      ...(counted.calls === 0 ? [] : [[key('tools'), toolSegs(counted)] satisfies [Seg[], Seg[]]]),
    ],
    inner,
  )
}
