import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Running, Worker } from '../types'

const workers = atom({ plugin: 'session-dashboard', key: 'workers' } as const, [] as Worker[], { shape: 'workers-1' })

const FAILED = new Set(['failed', 'killed'])
const ENDED = new Set(['completed', 'failed', 'killed'])

const blank = (id: string, startedAt: number): Worker => ({ id, type: '', title: '', startedAt, endedAt: null, status: 'running', calls: 0, active: [], last: null })

// 見つからなければ足し、あれば change を当てる。tool.call が agent.spawn の戻りより先に来ても追える
const upsert = (list: readonly Worker[], id: string, startedAt: number, change: (worker: Worker) => Worker) =>
  list.some(worker => worker.id === id) ? list.map(worker => (worker.id === id ? change(worker) : worker)) : [...list, change(blank(id, startedAt))]

export async function currentWorkers($: EngineInterface) {
  return read($, workers)
}

export async function spawnWorker($: EngineInterface, id: string, type: string, title: string) {
  const now = await $.clock.now()
  await update($, workers, list => upsert(list, id, now, worker => ({ ...worker, type, title, startedAt: Math.min(worker.startedAt, now) })))
}

export async function startAgentCall($: EngineInterface, agentId: string, call: Running) {
  await update($, workers, list =>
    upsert(list, agentId, call.startedAt, worker => ({ ...worker, calls: worker.calls + 1, last: call.tool, active: [...worker.active.filter(found => found.id !== call.id), call] })),
  )
}

export async function endAgentCall($: EngineInterface, agentId: string, id: string) {
  const now = await $.clock.now()
  await update($, workers, list => upsert(list, agentId, now, worker => ({ ...worker, active: worker.active.filter(found => found.id !== id) })))
}

// $.agent.list() の status で、終わった・失敗した・止められたを決める
async function settle($: EngineInterface, ids: readonly string[], isForced: boolean) {
  if (ids.length === 0) return
  const now = await $.clock.now()
  const listed = await $.agent.list().catch(() => [])
  await update($, workers, list =>
    list.map((worker): Worker => {
      if (!ids.includes(worker.id) || worker.status !== 'running') return worker
      const status = listed.find(found => found.id === worker.id)?.status
      if (!isForced && (status === undefined || !ENDED.has(status))) return worker
      return { ...worker, status: status !== undefined && FAILED.has(status) ? 'failed' : 'done', endedAt: now, active: [] }
    }),
  )
}

// agentId 付きの turn.complete で終わりにする
export async function finishWorker($: EngineInterface, agentId: string) {
  await settle($, [agentId], true)
}

// メインのターンが終わった時、止められたり失敗したりして turn.complete が来なかったものを拾う
export async function reconcileWorkers($: EngineInterface) {
  await settle($, (await read($, workers)).filter(worker => worker.status === 'running').map(worker => worker.id), false)
}

// 終わったものは、次のメインの turn.start で消す
export async function dropFinished($: EngineInterface) {
  await update($, workers, list => list.filter(worker => worker.status === 'running'))
}

export async function clearWorkers($: EngineInterface) {
  await update($, workers, () => [])
}
