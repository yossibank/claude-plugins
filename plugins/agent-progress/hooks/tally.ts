import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Done, Tally } from '../types'

// カードに残す、終わった呼び出しの数
const RECENT_KEPT = 3

export const NO_TALLY: Tally = { calls: 0, errors: 0, recent: [], byName: {} }

// 呼び出しが始まった時に、回数を数える
export const counted = <T extends Tally>(tally: T, name: string): T => ({
  ...tally,
  calls: tally.calls + 1,
  byName: { ...tally.byName, [name]: (tally.byName[name] ?? 0) + 1 },
})

// 呼び出しが終わった時に、直近の履歴へ足す
export const recorded = <T extends Tally>(tally: T, done: Done): T => ({
  ...tally,
  errors: tally.errors + (done.isError ? 1 : 0),
  recent: [...tally.recent, done].slice(-RECENT_KEPT),
})

// メインの今のターンの数え
const tally = atom({ plugin: 'agent-progress', key: 'tally' } as const, NO_TALLY)

export async function currentTally($: EngineInterface) {
  return read($, tally)
}

export async function countCall($: EngineInterface, name: string) {
  await update($, tally, now => counted(now, name))
}

export async function recordCall($: EngineInterface, done: Done) {
  await update($, tally, now => recorded(now, done))
}

export async function resetTally($: EngineInterface) {
  await update($, tally, () => NO_TALLY)
}
