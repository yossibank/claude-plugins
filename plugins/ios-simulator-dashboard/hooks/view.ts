import type { Device, Entry, Log, Sim } from '../types'

import { card } from './card'
import type { Row } from './card'
import { cellWidth, fitSegs } from './cell'
import type { Seg } from './cell'
import { TN } from './palette'

// 履歴に出す件数
const MAX_SHOWN = 6
// UDID は頭だけ出す
const UDID_CHARS = 8

// どれだけ前か。12 秒前・3 分前・2 時間前
export const agoOf = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} 時間前` : `${Math.floor(hours / 24)} 日前`
}

// かかった時間。450ms・1.2s・1m05s
export const tookOf = (ms: number) => {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

// 理由を出す行数
const MAX_REASON_LINES = 3

// 幅ごとに折り返す。maxLines を超えた分は、最後の行で … にする
export const wrap = (text: string, width: number, maxLines: number) => {
  const lines: string[] = ['']
  for (const char of text.replace(/\s+/g, ' ')) {
    if (cellWidth(lines[lines.length - 1] + char) > width) lines.push('')
    lines[lines.length - 1] += char
  }
  return lines.length <= maxLines ? lines : [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]} `]
}

const key = (text: string): Seg[] => [{ text, color: TN.comment }]

const APPEARANCE: Record<Device['appearance'], Seg[]> = {
  light: [{ text: '☀ ライト', color: TN.yellow }],
  dark: [{ text: '☾ ダーク', color: TN.magenta }],
  unknown: [{ text: '不明', color: TN.comment }],
}

const appSegs = (app: NonNullable<Device['app']>): Seg[] => {
  if (!app.isInstalled) return [{ text: '入っていない', color: TN.comment }]
  return [{ text: '入っている', color: TN.green }, { text: ' · ', color: TN.comment }, app.isRunning ? { text: '動いている', color: TN.green } : { text: '止まっている', color: TN.comment }]
}

// 起動中のシミュレータ 1 台の表。bundleId は下の罫線に出す
const deviceCard = (device: Device, bundleId: string, inner: number) => {
  const rows: Row[] = [
    [key('OS'), [{ text: device.os, color: TN.fg }]],
    [key('UDID'), [{ text: device.udid.slice(0, UDID_CHARS), color: TN.fg }]],
    [key('外観'), APPEARANCE[device.appearance]],
  ]
  if (device.app !== undefined) rows.push([key('アプリ'), appSegs(device.app)])
  const title: Seg[] = [{ text: '● ', color: TN.green }, { text: device.name, color: TN.cyan, bold: true }]
  return card(title, rows, inner, device.app === undefined ? undefined : [{ text: bundleId, color: TN.comment }])
}

const simLines = (sim: Sim, bundleId: string, inner: number): Seg[][] => {
  if (sim.status === 'unread') return [fitSegs([{ text: '… シミュレータの状態を読んでいます', color: TN.comment }], inner)]
  if (sim.status === 'failed')
    return [
      fitSegs([{ text: '✖ シミュレータの状態を取れません', color: TN.red, bold: true }], inner),
      ...wrap(sim.reason, Math.max(1, inner - 2), MAX_REASON_LINES).map(line => fitSegs([{ text: `  ${line}`, color: TN.comment }], inner)),
    ]
  if (sim.booted.length === 0)
    return [
      fitSegs([{ text: '○ 起動中のシミュレータはありません', color: TN.yellow }], inner),
      fitSegs([{ text: '  使えるシミュレータ ', color: TN.comment }, { text: `${sim.available} 台`, color: TN.fg }], inner),
    ]
  return sim.booted.flatMap(device => deviceCard(device, bundleId, inner))
}

const entryRow = (entry: Entry, now: number): Row => [
  key(agoOf(now - entry.at)),
  [
    entry.isFailed ? { text: '✖ ', color: TN.red } : { text: '✓ ', color: TN.green },
    { text: entry.label, color: entry.isFailed ? TN.red : TN.fg },
    { text: ` ${tookOf(entry.ms)}`, color: TN.comment },
    ...(entry.target === '' ? [] : [{ text: ` ${entry.target}`, color: TN.blue }]),
  ],
]

const historyCard = (log: Log, now: number, inner: number) => {
  const title: Seg[] = [{ text: 'この会話でしたこと', color: TN.blue, bold: true }]
  if (log.entries.length === 0) return card(title, [[key('—'), [{ text: 'まだ何もしていません', color: TN.comment }]]], inner)
  const hidden = log.entries.length - MAX_SHOWN
  return card(title, log.entries.slice(0, MAX_SHOWN).map(entry => entryRow(entry, now)), inner, hidden > 0 ? [{ text: `ほか ${hidden} 件`, color: TN.comment }] : undefined)
}

const times = (count: number, unit: string): Seg[] => [{ text: `${count} ${unit}`, color: count > 0 ? TN.fg : TN.comment }]

const summaryCard = (log: Log, now: number, inner: number) =>
  card(
    [{ text: 'まとめ', color: TN.blue, bold: true }],
    [
      [key('起動'), times(log.boots, '回')],
      [key('インストール'), times(log.installs, '回')],
      [key('アプリ起動'), times(log.launches, '回')],
      [key('スクショ'), [...times(log.screenshots, '枚'), ...(log.lastScreenshotAt === null ? [] : [{ text: ` · 最後 ${agoOf(now - log.lastScreenshotAt)}`, color: TN.comment }])]],
      [key('失敗'), [{ text: String(log.failures), color: log.failures > 0 ? TN.red : TN.comment }]],
    ],
    inner,
  )

// pane に出す行。上から、シミュレータ・履歴・数字のまとめ
export const linesOf = (sim: Sim, log: Log, bundleId: string, now: number, inner: number): Seg[][] => [
  ...simLines(sim, bundleId, inner),
  ...historyCard(log, now, inner),
  ...summaryCard(log, now, inner),
]
