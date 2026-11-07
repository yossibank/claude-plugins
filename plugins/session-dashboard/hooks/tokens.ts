import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Fill } from '../types'


const fill = atom({ plugin: 'session-dashboard', key: 'fill' } as const, null, { shape: 'fill-2' })

const GRADES = [
  { name: 'S', from: 0.7, color: '#7ee0ff' },
  { name: 'A', from: 0.5, color: '#7fe0a0' },
  { name: 'B', from: 0.3, color: '#e8d27a' },
  { name: 'C', from: 0.15, color: '#f0a050' },
  { name: 'D', from: 0, color: '#f05a5a' },
] as const
const NAMES: Record<string, string> = {
  'System prompt': 'システム',
  'System tools': 'ツール',
  'MCP tools': 'MCP',
  'Custom agents': 'エージェント',
  'Memory files': 'メモリ',
  Skills: 'スキル',
  Messages: '会話',
}

export const thousands = (tokens: number) => {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

export async function currentFill($: EngineInterface) {
  return read($, fill)
}

export async function measure($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  if (usage === undefined) return
  const { context } = usage
  const rows = context.breakdown?.categories ?? []
  const of = (kind: string) => rows.filter(row => row.kind === kind).reduce((sum, row) => sum + row.tokens, 0)
  // 分母は /context と同じ、要約に入る手前までの窓にする。0 は測る前の印なので残す
  const window = context.window === 0 ? 0 : (context.breakdown?.rawMaxTokens ?? context.window)
  const tokens = context.tokens ?? context.breakdown?.totalTokens ?? 0
  const measured: Fill = {
    slices: rows
      .filter(row => row.kind === 'used' && row.tokens > 0)
      .map(row => ({ name: NAMES[row.name] ?? row.name, tokens: row.tokens })),
    free: of('free'),
    tokens,
    window,
    percent: window === 0 ? 0 : Math.round((tokens / window) * 100),
  }
  await update($, fill, () => measured)
}

// 空きの割合で S〜D を決める
export const gradeOf = (measured: Fill) => {
  const ratio = measured.window === 0 ? 0 : measured.free / measured.window
  return GRADES.find(grade => ratio >= grade.from) ?? GRADES[GRADES.length - 1]!
}

export const kilo = (tokens: number) => `${(tokens / 1000).toFixed(1)}k`
