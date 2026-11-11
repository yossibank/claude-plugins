import { atom, read, update } from 'claude-code'
import type { EngineInterface, TurnUsage } from 'claude-code'

import type { Fill, Spent } from '../types'

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
    ...(context.breakdown?.isAutoCompactEnabled === true && context.breakdown.autoCompactThreshold !== undefined ? { compactAt: context.breakdown.autoCompactThreshold } : {}),
  }
  await update($, fill, () => measured)
}

// メインのターンの終わりごとの、文脈のトークン数。古い順に、直近 HISTORY_KEPT 回分
const HISTORY_KEPT = 16
const history = atom({ plugin: 'session-dashboard', key: 'history' } as const, [] as number[])

export async function currentHistory($: EngineInterface) {
  return read($, history)
}

// 測った後の文脈の量を、推移に足す
export async function recordFill($: EngineInterface) {
  const measured = await read($, fill)
  if (measured === null || measured.window === 0) return
  await update($, history, now => [...now, measured.tokens].slice(-HISTORY_KEPT))
}

// 1 ターンで増える量の平均。直近 GROWTH_TURNS 回の、増えた分だけで出す。出せなければ null
const GROWTH_TURNS = 5
export const growthOf = (samples: readonly number[]) => {
  const steps = samples.slice(1).map((tokens, index) => tokens - (samples[index] ?? tokens)).filter(step => step > 0).slice(-GROWTH_TURNS)
  return steps.length === 0 ? null : steps.reduce((sum, step) => sum + step, 0) / steps.length
}

const NO_SPENT: Spent = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const spent = atom({ plugin: 'session-dashboard', key: 'spent' } as const, NO_SPENT)

export async function currentSpent($: EngineInterface) {
  return read($, spent)
}

// 1 回の応答で使ったトークンを、セッションの合計に足す
export async function addSpent($: EngineInterface, usage: TurnUsage) {
  await update($, spent, now => ({
    input: now.input + usage.input_tokens,
    output: now.output + usage.output_tokens,
    cacheRead: now.cacheRead + usage.cache_read_input_tokens,
    cacheWrite: now.cacheWrite + usage.cache_creation_input_tokens,
  }))
}

export async function resetTokens($: EngineInterface) {
  await update($, history, () => [])
  await update($, spent, () => NO_SPENT)
}

// 空きの割合で S〜D を決める
export const gradeOf = (measured: Fill) => {
  const ratio = measured.window === 0 ? 0 : measured.free / measured.window
  return GRADES.find(grade => ratio >= grade.from) ?? GRADES[GRADES.length - 1]!
}

export const kilo = (tokens: number) => `${(tokens / 1000).toFixed(1)}k`
