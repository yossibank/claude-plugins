import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { Activity, Running } from '../types'

import { clearWorkers, currentWorkers } from './agents'
import { PANE } from './config'
import { TN } from './palette'
import { report } from './report'
import { FRAME_MS, FRAMES, spriteCells } from './sprite'
import { resetTurn } from './usage'
import { currentTasks, resetTasks, taskLineOf } from './tasks'
import { duration } from './time'

const IDLE: Activity = { isWorking: false, task: null, said: null, tool: null, phase: null, startedAt: null }
const activity = atom({ plugin: 'agent-progress', key: 'activity' } as const, IDLE)
const second = atom({ plugin: 'agent-progress', key: 'second' } as const, 0)

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
const running = atom({ plugin: 'agent-progress', key: 'running' } as const, [] as Running[], { shape: 'running-2' })

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
let frame = 0
// 今の描画で動かすアイコン。Raster の key と色
let animated = new Map<string, string>()

export const currentFrame = () => frame

// 描くたびに、動かすアイコンを覚え直す
export function animate(sprites: ReadonlyMap<string, string>) {
  animated = new Map(sprites)
}

// アイコンだけを次のコマに差し替える。描き直しはしない
function blitFrame($: EngineInterface) {
  for (const [key, color] of animated)
    $.ui.blit({ requestId: PANE, key, cells: spriteCells(frame, color) }).catch(error => report($, 'アイコンの差し替え', error))
}

// 動いている間だけ、1 コマごとにアイコンを進め、1 秒ごとに経った秒数を描き直す
export function tickWhileRunning($: EngineInterface, isRunning: boolean) {
  if (!isRunning) {
    ticker?.cancel()
    ticker = undefined
    return
  }
  ticker ??= $.clock.every(FRAME_MS, () => {
    frame += 1
    blitFrame($)
    if (frame % FRAMES.length !== 0) return
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
    return { mark: '● ', text: `${doing.tool} · ${duration(doing.startedAt == null ? 0 : now - doing.startedAt)}`, color: TN.fg }
  }
  return { mark: '✓ ', text: doing.tool, color: TN.comment }
}

// メインが作業中か、サブエージェントが動いている間だけ時計を回す
export async function refreshTicker($: EngineInterface) {
  const isRunning = (await read($, activity)).isWorking || (await currentRunning($)).length > 0 || (await currentWorkers($)).some(worker => worker.status === 'running')
  tickWhileRunning($, isRunning)
}

export async function forget($: EngineInterface) {
  await resetTasks($)
  await clearCalls($)
  await clearWorkers($)
  await resetTurn($)
  tickWhileRunning($, false)
  await update($, activity, () => IDLE)
}
