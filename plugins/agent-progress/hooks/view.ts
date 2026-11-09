import type { Activity, MainTurn, Running, Spent, TaskItem, Worker } from '../types'

import type { Step } from './activity'
import { fitSegs, gradient, twoColumns, wrapSegs } from './cell'
import type { Seg } from './cell'
import { CLAUDE, FAILED, HUES, IDLE, TN } from './palette'
import { duration } from './time'
import { AGENT_TOOLS } from './tool'
import { kilo, modelName } from './usage'

// アイコンと 3 行の文字を並べたカード 1 枚。isAnimated の間はアイコンを動かす
export type Card = { key: string; color: string; isAnimated: boolean; lines: Seg[][] }

const TASKS_SHOWN = 8

const TASK_MARKS: Record<TaskItem['status'], Seg> = {
  completed: { text: '✓', color: TN.green },
  in_progress: { text: '●', color: TN.yellow },
  pending: { text: '·', color: TN.comment },
}

const TASK_COLORS: Record<TaskItem['status'], string> = { completed: TN.comment, in_progress: TN.fg, pending: TN.fgDark }

// 多すぎる時は、古い済みのものから落とす
const shownTasks = (items: readonly TaskItem[]) => {
  const dropped = new Set<TaskItem>()
  for (const item of items) {
    if (items.length - dropped.size <= TASKS_SHOWN) break
    if (item.status === 'completed') dropped.add(item)
  }
  return items.filter(item => !dropped.has(item)).slice(-TASKS_SHOWN)
}

const stepSegs = (step: Step): Seg[] => [
  ...(step.mark === '' ? [] : [{ text: step.mark, color: step.mark === '● ' ? TN.yellow : TN.green }]),
  { text: step.text, color: step.color },
]

// 重なって動くツールをまとめた 1 行。同じ名前なら Agent ×3
const groupStep = (calls: readonly Running[], now: number): Step => {
  const name = calls.every(call => call.name === calls[0]?.name) ? (calls[0]?.name ?? '') : '並行'
  const oldest = Math.min(...calls.map(call => call.startedAt))
  return { mark: '● ', text: `${name} ×${calls.length} · ${duration(now - oldest)}`, color: TN.fg }
}

// 入力・出力のトークン。まだ使っていなければ空
const spentSegs = (spent: Spent): Seg[] =>
  spent.input + spent.output === 0 ? [] : [{ text: `in ${kilo(spent.input)} · out ${kilo(spent.output)}`, color: TN.comment }]

// 名前の横に、モデルを薄く添える
const nameSegs = (name: Seg, model: string): Seg[] => [name, ...(model === '' ? [] : [{ text: `  ${modelName(model)}`, color: TN.comment }])]

export const mainCard = (doing: Activity, step: Step | null, calls: readonly Running[], turn: MainTurn, now: number, width: number): Card => {
  const summary = doing.task ?? doing.said
  const own = calls.filter(call => !AGENT_TOOLS.has(call.name))
  const shown = doing.isWorking && own.length >= 2 ? groupStep(own, now) : step
  const elapsed = turn.startedAt === null ? '' : duration((turn.endedAt ?? now) - turn.startedAt)
  const state: Seg[] = doing.isWorking ? [{ text: elapsed, color: TN.comment }] : [{ text: '待っています', color: TN.comment }]
  return {
    key: 'main',
    color: doing.isWorking ? CLAUDE : IDLE,
    isAnimated: doing.isWorking,
    lines: [
      twoColumns(nameSegs({ text: 'Claude', color: CLAUDE, bold: true }, turn.model), state, width),
      ...wrapSegs([{ text: summary ?? '—', color: doing.isWorking ? TN.fg : TN.comment }], width),
      ...(doing.isWorking && shown !== null ? wrapSegs(stepSegs(shown), width) : []),
      ...[spentSegs(turn)].filter(line => line.length > 0),
    ],
  }
}

const hueOf = (worker: Worker) => HUES[worker.hue % HUES.length] ?? TN.blue

const workerStep = (worker: Worker, now: number): Seg[] => {
  if (worker.status === 'done') return [{ text: '✓ ', color: TN.green }, { text: worker.last ?? '終わりました', color: TN.comment }]
  if (worker.status === 'failed') return [{ text: '✗ ', color: FAILED }, { text: '失敗・停止しました', color: TN.comment }]
  const active = worker.active.at(-1)
  if (active !== undefined) return [{ text: '● ', color: TN.yellow }, { text: `${active.tool} · ${duration(now - active.startedAt)}`, color: TN.fg }]
  if (worker.last !== null) return [{ text: '✓ ', color: TN.green }, { text: worker.last, color: TN.comment }]
  return [{ text: '考えています…', color: TN.comment }]
}

export const workerCard = (worker: Worker, now: number, width: number): Card => {
  const isRunning = worker.status === 'running'
  const color = worker.status === 'failed' ? FAILED : hueOf(worker)
  return {
    key: `worker-${worker.id}`,
    color,
    isAnimated: isRunning,
    lines: [
      twoColumns(nameSegs({ text: worker.type === '' ? 'agent' : worker.type, color: TN.cyan, bold: true }, worker.model), [{ text: duration((worker.endedAt ?? now) - worker.startedAt), color: TN.comment }], width),
      ...wrapSegs([{ text: worker.title === '' ? '—' : worker.title, color: isRunning ? TN.fg : TN.fgDark }], width),
      ...wrapSegs(workerStep(worker, now), width),
      fitSegs([...spentSegs(worker), { text: `${spentSegs(worker).length === 0 ? '' : ' · '}ツール ${worker.calls}`, color: TN.comment }], width),
    ],
  }
}

// 動いている・終わったの見出し
export const sectionLine = (label: string, count: number, color: string, width: number): Seg[] => fitSegs([{ text: '▌', color }, { text: `${label} · ${count}`, color, bold: true }], width)

// 進みの棒と、作業中の項目と、一覧
export const tasksLines = (list: readonly TaskItem[], width: number): Seg[][] => {
  const finished = list.filter(item => item.status === 'completed').length
  const percent = Math.round((finished / list.length) * 100)
  const head: Seg[] = [{ text: `Tasks ${finished}/${list.length} `, color: TN.green, bold: true }]
  const tail: Seg[] = [{ text: ` ${String(percent).padStart(3)}%`, color: TN.fg }]
  const bar = Math.max(1, width - head[0]!.text.length - tail[0]!.text.length)
  const lines: Seg[][] = [fitSegs([...head, ...gradient(finished / list.length, bar, [TN.blue, TN.magenta], TN.line), ...tail], width)]
  const current = list.find(item => item.status === 'in_progress')
  if (current !== undefined) lines.push(...wrapSegs([{ text: 'Now: ', color: TN.comment }, { text: current.activeForm || current.subject, color: TN.fg }], width))
  const shown = shownTasks(list)
  for (const item of shown) lines.push(...wrapSegs([TASK_MARKS[item.status], { text: ` ${item.subject}`, color: TASK_COLORS[item.status] }], width))
  if (shown.length < list.length) lines.push([{ text: `+${list.length - shown.length}`, color: TN.comment }])
  return lines
}
