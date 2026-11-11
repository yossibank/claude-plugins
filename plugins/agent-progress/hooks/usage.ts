import { atom, read, update } from 'claude-code'
import type { EngineInterface, TurnUsage } from 'claude-code'

import type { MainTurn, Spent, TurnEnd } from '../types'

const NO_TURN: MainTurn = { startedAt: null, endedAt: null, input: 0, output: 0, model: '' }
const turn = atom({ plugin: 'agent-progress', key: 'turn' } as const, NO_TURN)

// usage を、キャッシュの分も含めた入力と出力にまとめる
export const spentOf = (usage: TurnUsage): Spent => ({
  input: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
  output: usage.output_tokens,
  model: usage.model,
})

export const addSpent = <T extends Spent>(total: T, used: Spent): T => ({
  ...total,
  input: total.input + used.input,
  output: total.output + used.output,
  model: used.model === '' ? total.model : used.model,
})

export async function currentTurn($: EngineInterface) {
  return read($, turn)
}

export async function startTurn($: EngineInterface) {
  const now = await $.clock.now()
  await update($, turn, before => ({ ...NO_TURN, model: before.model, startedAt: now }))
}

export async function addMainUsage($: EngineInterface, used: Spent) {
  await update($, turn, now => addSpent(now, used))
}

export async function endTurn($: EngineInterface, end: TurnEnd) {
  const now = await $.clock.now()
  await update($, turn, before => ({ ...before, endedAt: now, end }))
}

export async function resetTurn($: EngineInterface) {
  await update($, turn, () => NO_TURN)
}

// 1.2k・48.2k・1.3M の形
export const kilo = (tokens: number) => {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 100_000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

// claude-opus-5-5 を Opus 5.5 にする。形が違えばそのまま
export const modelName = (model: string) => {
  const found = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model)
  if (found === null) return model
  const [, family = '', major = '', minor = ''] = found
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`
}
