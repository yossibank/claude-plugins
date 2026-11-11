import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Config } from './config'
import { PANE } from './config'
import { resetStats } from './stats'
import { measure, resetTokens } from './tokens'

const lastTurnEnd = atom({ plugin: 'session-dashboard', key: 'lastTurnEnd' } as const, null)
const sessionStart = atom({ plugin: 'session-dashboard', key: 'sessionStart' } as const, null)
const tick = atom({ plugin: 'session-dashboard', key: 'tick' } as const, 0)
const isPaneShown = atom({ plugin: 'session-dashboard', key: 'isPaneShown' } as const, false)

async function begin($: EngineInterface) {
  const now = await $.clock.now()
  await update($, sessionStart, () => now)
  await update($, lastTurnEnd, () => null)
  await resetStats($)
  await resetTokens($)
}

export async function restart($: EngineInterface) {
  await begin($)
  await measure($)
}

export async function watchPane($: EngineInterface) {
  const shown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
  if (shown !== (await read($, isPaneShown))) await update($, isPaneShown, () => shown)
  const minute = Math.floor((await $.clock.now()) / 60_000)
  if (minute !== (await read($, tick))) await update($, tick, () => minute)
}

// 分が変わった時に描き直すために、tick を読む。pane が見えているかと始めた時刻も返す
export async function currentSession($: EngineInterface) {
  await read($, tick)
  return { isPaneShown: await read($, isPaneShown), start: await read($, sessionStart) }
}

export async function endTurn($: EngineInterface) {
  const now = await $.clock.now()
  await update($, lastTurnEnd, () => now)
}

// キャッシュが切れるまでの分数。切れていたら null
export async function cacheLeft($: EngineInterface, config: Config): Promise<number | null> {
  const now = await $.clock.now()
  const start = await read($, sessionStart)
  const lastTurn = await read($, lastTurnEnd)
  const since = now - (lastTurn ?? start ?? now)
  return since >= config.cacheMs ? null : Math.max(1, Math.ceil((config.cacheMs - since) / 60_000))
}
