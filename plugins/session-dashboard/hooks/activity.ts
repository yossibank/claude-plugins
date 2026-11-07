import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { Activity } from '../types'

import { TN } from './palette'
import { currentTasks, resetTasks, taskLineOf } from './tasks'

const IDLE: Activity = { isWorking: false, task: null, said: null, tool: null, phase: null, startedAt: null }
const activity = atom({ plugin: 'session-dashboard', key: 'activity' } as const, IDLE)
const second = atom({ plugin: 'session-dashboard', key: 'second' } as const, 0)

export async function currentActivity($: EngineInterface) {
  return read($, activity)
}

// 経った秒数を描き直すために、1 秒ごとの更新を読む
export async function currentSecond($: EngineInterface) {
  return read($, second)
}

export async function act($: EngineInterface, change: Partial<Activity>) {
  const task = taskLineOf(await currentTasks($))
  await update($, activity, now => ({ ...now, ...change, task }))
}

// 動いているツールの呼び出し。重なった呼び出しを、始まった順に持つ
export const running = new Map<string, { tool: string; startedAt: number }>()
let callCount = 0

// 呼び出しの id が無い時に使う、通し番号
export const nextCallNumber = () => {
  callCount += 1
  return callCount
}
let ticker: Timer | undefined

// ツールが動いている間だけ、経った秒数のために 1 秒ごとに描き直す
export function tickWhileRunning($: EngineInterface, isRunning: boolean) {
  if (!isRunning) {
    ticker?.cancel()
    ticker = undefined
    return
  }
  ticker ??= $.clock.every(1000, () => void $.clock.now().then(now => update($, second, () => Math.floor(now / 1000))))
}

export type Step = { mark: string; text: string; color: string }

export const phaseLine = (doing: Activity, now: number): Step | null => {
  const phase = doing.phase ?? null
  if (phase === 'thinking') return { mark: '', text: '考えています…', color: TN.comment }
  if (doing.tool === null) return null
  if (phase === 'preparing') return { mark: '', text: `${doing.tool} を準備しています…`, color: TN.comment }
  if (phase === 'running') {
    const seconds = doing.startedAt == null ? 0 : Math.max(0, Math.floor((now - doing.startedAt) / 1000))
    return { mark: '● ', text: `${doing.tool} · ${seconds}s`, color: TN.fg }
  }
  return { mark: '✓ ', text: doing.tool, color: TN.comment }
}

export async function forget($: EngineInterface) {
  await resetTasks($)
  running.clear()
  tickWhileRunning($, false)
  await update($, activity, () => IDLE)
}
