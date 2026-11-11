import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Stats } from '../types'

const NO_STATS: Stats = { turns: 0, calls: 0, usdAtStart: null, turnMs: 0, lastTurnMs: 0, byName: {}, errors: 0 }
const stats = atom({ plugin: 'session-dashboard', key: 'stats' } as const, NO_STATS, { shape: 'stats-2' })

export async function currentStats($: EngineInterface) {
  return read($, stats)
}

export async function resetStats($: EngineInterface) {
  await update($, stats, () => NO_STATS)
}

// 数えた後の回数を返す。name はツールの名前
export async function countCall($: EngineInterface, name: string) {
  return (await update($, stats, now => ({ ...now, calls: now.calls + 1, byName: { ...now.byName, [name]: (now.byName[name] ?? 0) + 1 } }))).calls
}

export async function countError($: EngineInterface) {
  await update($, stats, now => ({ ...now, errors: now.errors + 1 }))
}

// ms はそのターンにかかった時間
export async function countTurn($: EngineInterface, ms: number) {
  await update($, stats, now => ({ ...now, turns: now.turns + 1, turnMs: now.turnMs + ms, lastTurnMs: ms }))
}

// 始めた時の費用を覚え、1 時間あたりの費用をこのセッションの分だけで出す
export async function markStart($: EngineInterface, usd: number | null) {
  await update($, stats, now => (now.usdAtStart === null && usd !== null ? { ...now, usdAtStart: usd } : now))
}
