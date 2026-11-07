import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Stats } from '../types'

const NO_STATS: Stats = { turns: 0, calls: 0, usdAtStart: null }
const stats = atom({ plugin: 'session-dashboard', key: 'stats' } as const, NO_STATS)

export async function currentStats($: EngineInterface) {
  return read($, stats)
}

export async function resetStats($: EngineInterface) {
  await update($, stats, () => NO_STATS)
}

// 数えた後の回数を返す
export async function countCall($: EngineInterface) {
  return (await update($, stats, now => ({ ...now, calls: now.calls + 1 }))).calls
}

export async function countTurn($: EngineInterface) {
  await update($, stats, now => ({ ...now, turns: now.turns + 1 }))
}

// 始めた時の費用を覚え、1 時間あたりの費用をこのセッションの分だけで出す
export async function markStart($: EngineInterface, usd: number | null) {
  await update($, stats, now => (now.usdAtStart === null && usd !== null ? { ...now, usdAtStart: usd } : now))
}
