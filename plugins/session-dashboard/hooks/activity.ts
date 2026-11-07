import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { Activity, Running } from '../types'

import { TN } from './palette'
import { clearWorkers, currentWorkers } from './agents'
import { report } from './report'
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
const running = atom({ plugin: 'session-dashboard', key: 'running' } as const, [] as Running[], { shape: 'running-2' })

export async function currentRunning($: EngineInterface) {
  return read($, running)
}

export async function startCall($: EngineInterface, call: Running) {
  await update($, running, now => [...now.filter(found => found.id !== call.id), call])
}

// 動いていた呼び出しを外し、残りを返す。動いていなければ null
export async function endCall($: EngineInterface, id: string) {
  let wasRunning = false
  const left = await update($, running, now => {
    wasRunning = now.some(call => call.id === id)
    return now.filter(call => call.id !== id)
  })
  return wasRunning ? left : null
}

export async function clearCalls($: EngineInterface) {
  await update($, running, () => [])
}

let ticker: Timer | undefined

// ツールが動いている間だけ、経った秒数のために 1 秒ごとに描き直す
export function tickWhileRunning($: EngineInterface, isRunning: boolean) {
  if (!isRunning) {
    ticker?.cancel()
    ticker = undefined
    return
  }
  ticker ??= $.clock.every(1000, () => {
    $.clock
      .now()
      .then(now => update($, second, () => Math.floor(now / 1000)))
      .catch(error => report($, '経過秒の更新', error))
  })
}

export type Step = { mark: string; text: string; color: string }

export const phaseLine = (doing: Activity, now: number): Step | null => {
  const { phase } = doing
  if (phase === 'thinking') return { mark: '', text: '考えています…', color: TN.comment }
  if (doing.tool === null) return null
  if (phase === 'preparing') return { mark: '', text: `${doing.tool} を準備しています…`, color: TN.comment }
  if (phase === 'running') {
    const seconds = doing.startedAt == null ? 0 : Math.max(0, Math.floor((now - doing.startedAt) / 1000))
    return { mark: '● ', text: `${doing.tool} · ${seconds}s`, color: TN.fg }
  }
  return { mark: '✓ ', text: doing.tool, color: TN.comment }
}

// 動いているツールかサブエージェントがある間だけ、1 秒ごとに描き直す
export async function refreshTicker($: EngineInterface) {
  const isRunning = (await currentRunning($)).length > 0 || (await currentWorkers($)).some(worker => worker.status === 'running')
  tickWhileRunning($, isRunning)
}

export async function forget($: EngineInterface) {
  await resetTasks($)
  await clearCalls($)
  await clearWorkers($)
  tickWhileRunning($, false)
  await update($, activity, () => IDLE)
}
