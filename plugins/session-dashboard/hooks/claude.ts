import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Claude, Limit } from '../types'

import { markStart } from './stats'

const claude = atom({ plugin: 'session-dashboard', key: 'claude' } as const, null)

export const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }

// claude-opus-5-5 を Opus 5.5 にする
const modelName = (id: string) => {
  const found = /^(?:claude-)?([a-z]+)(?:-(\d+)-(\d+))?/.exec(id)
  if (found === null) return id
  const name = found[1]!.charAt(0).toUpperCase() + found[1]!.slice(1)
  return found[2] === undefined ? name : `${name} ${found[2]}.${found[3]}`
}

export const limitsOf = (limits: readonly Limit[]): Limit[] =>
  limits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }) }))

export let version: string | undefined

export async function currentClaude($: EngineInterface) {
  return read($, claude)
}

// 上限と費用だけを書き換える
export async function updateLimits($: EngineInterface, limits: Limit[], usd: number | null) {
  await update($, claude, now => (now === null ? now : { ...now, limits, usd: usd ?? now.usd }))
  await markStart($, usd)
}

// 応答のモデルが変わっていたら書き換える
export async function updateModel($: EngineInterface, id: string) {
  const model = modelName(id)
  await update($, claude, now => (now === null || now.model === model ? now : { ...now, model }))
}

export async function readClaude($: EngineInterface) {
  version ??= (await $.session.version().catch(() => undefined))?.version ?? ''
  const model = await $.session.model().catch(() => '')
  const usage = await $.session.usage().catch(() => undefined)
  const before = await read($, claude)
  const next: Claude = {
    model: modelName(model),
    version,
    usd: usage?.cost?.usd ?? before?.usd ?? null,
    limits: usage === undefined ? (before?.limits ?? []) : limitsOf(usage.rateLimits),
  }
  await update($, claude, () => next)
  await markStart($, next.usd)
}
