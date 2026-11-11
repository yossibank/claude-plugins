import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Done, Running, Spent, Worker } from '../types'

import { counted, NO_TALLY, recorded } from './tally'
import { addSpent } from './usage'

const workers = atom({ plugin: 'agent-progress', key: 'workers' } as const, [] as Worker[], { shape: 'workers-2' })

const FAILED = new Set(['failed', 'killed'])
const ENDED = new Set(['completed', 'failed', 'killed'])

const blank = (id: string, startedAt: number, hue: number): Worker => ({
  id,
  type: '',
  title: '',
  startedAt,
  endedAt: null,
  status: 'running',
  ...NO_TALLY,
  active: [],
  last: null,
  said: null,
  result: null,
  hue,
  input: 0,
  output: 0,
  model: '',
})

// 見つからなければ足し、あれば change を当てる。tool.call が agent.spawn の戻りより先に来ても追える
// 色は、一覧で前のものの次の色にする。消えた後も隣どうしが同じ色にならない
const upsert = (list: readonly Worker[], id: string, startedAt: number, change: (worker: Worker) => Worker) =>
  list.some(worker => worker.id === id)
    ? list.map(worker => (worker.id === id ? change(worker) : worker))
    : [...list, change(blank(id, startedAt, (list.at(-1)?.hue ?? -1) + 1))]

export async function currentWorkers($: EngineInterface) {
  return read($, workers)
}

export async function spawnWorker($: EngineInterface, id: string, type: string, title: string) {
  const now = await $.clock.now()
  await update($, workers, list => upsert(list, id, now, worker => ({ ...worker, type, title, startedAt: Math.min(worker.startedAt, now) })))
}

export async function startAgentCall($: EngineInterface, agentId: string, call: Running) {
  await update($, workers, list =>
    upsert(list, agentId, call.startedAt, worker => ({ ...counted(worker, call.name), status: 'running', endedAt: null, last: call.tool, active: [...worker.active.filter(found => found.id !== call.id), call] })),
  )
}

// 済みのサブエージェントが同じ agentId で動き直した時（SendMessage など）に、動いている状態へ戻す。消えていたら一覧から種類と題を取る
export async function restartWorker($: EngineInterface, agentId: string) {
  const now = await $.clock.now()
  const listed = (await $.agent.list().catch(() => [])).find(found => found.id === agentId)
  await update($, workers, list =>
    upsert(list, agentId, now, worker => ({
      ...worker,
      type: worker.type === '' ? (listed?.type ?? '') : worker.type,
      title: worker.title === '' ? (listed?.description ?? '') : worker.title,
      status: 'running',
      endedAt: null,
      result: null,
      startedAt: worker.status === 'running' ? worker.startedAt : now,
    })),
  )
}

// サブエージェントの 1 ステップで使ったトークンを足す
export async function addWorkerUsage($: EngineInterface, agentId: string, used: Spent) {
  const now = await $.clock.now()
  await update($, workers, list => upsert(list, agentId, now, worker => addSpent(worker, used)))
}

// 動いていた呼び出しを外し、直近の履歴へ足す
export async function endAgentCall($: EngineInterface, agentId: string, id: string, done: Done) {
  const now = await $.clock.now()
  await update($, workers, list => upsert(list, agentId, now, worker => ({ ...recorded(worker, done), active: worker.active.filter(found => found.id !== id) })))
}

// サブエージェントの今のステップの発言
export async function sayWorker($: EngineInterface, agentId: string, said: string) {
  const now = await $.clock.now()
  await update($, workers, list => upsert(list, agentId, now, worker => ({ ...worker, said })))
}

// $.agent.list() の status で、終わった・失敗した・止められたを決める
async function settle($: EngineInterface, ids: readonly string[], isForced: boolean, result: string | null = null) {
  if (ids.length === 0) return
  const now = await $.clock.now()
  const listed = await $.agent.list().catch(() => [])
  await update($, workers, list =>
    list.map((worker): Worker => {
      if (!ids.includes(worker.id) || worker.status !== 'running') return worker
      const status = listed.find(found => found.id === worker.id)?.status
      // 一覧に無いものは、止められて turn.complete が来なかったものとみなす
      if (!isForced && status !== undefined && !ENDED.has(status)) return worker
      return { ...worker, status: status !== undefined && FAILED.has(status) ? 'failed' : 'done', endedAt: now, active: [], result }
    }),
  )
}

// agentId 付きの turn.complete で終わりにする。result は報告の最初の行
export async function finishWorker($: EngineInterface, agentId: string, result: string | null) {
  await settle($, [agentId], true, result)
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
