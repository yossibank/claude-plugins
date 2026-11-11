import type { Action, Activity, Done, MainTurn, Running, Spent, TaskItem, Tally, Worker } from '../types'

import type { Step } from './activity'
import { fitSegs, gradient, segWidth, twoColumns, wrapSegs } from './cell'
import type { Seg } from './cell'
import { CLAUDE, FAILED, HUES, IDLE, TN, toolColor } from './palette'
import { duration } from './time'
import { AGENT_TOOLS } from './tool'
import { kilo, modelName } from './usage'

// アイコンと文字の行を並べたカード 1 枚。isAnimated の間はアイコンを動かす
export type Card = { key: string; color: string; isAnimated: boolean; action: Action; lines: Seg[][] }

const TOOL_ACTIONS: Record<string, Action> = {
  Bash: 'type',
  Edit: 'type',
  Write: 'type',
  NotebookEdit: 'type',
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'play',
  Task: 'play',
}

// 最後に始めた、動いているツールで動きを決める。動いているツールが無ければ、考えている
const actionOf = (calls: readonly Running[]): Action => {
  const name = calls.at(-1)?.name
  return name === undefined ? 'think' : (TOOL_ACTIONS[name] ?? 'plain')
}

const TASKS_SHOWN = 8
// 今のツールの上に並べる、終わった呼び出しの数。今のツールが無い時は 1 つ多く出す
const RECENT_SHOWN = 2
// 内訳に名前を出すツールの数。残りは「ほか」にまとめる
const NAMES_SHOWN = 3

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

// 終わった呼び出しの 1 行。失敗は ✗、1 秒を超えたらかかった時間を添える
const doneSegs = (done: Done): Seg[] => [
  done.isError ? { text: '✗ ', color: FAILED } : { text: '✓ ', color: TN.green },
  { text: done.ms >= 1000 ? `${done.tool} · ${duration(done.ms)}` : done.tool, color: TN.comment },
]

const recentLines = (tally: Tally, shown: number, width: number): Seg[][] => (shown <= 0 ? [] : tally.recent.slice(-shown).flatMap(done => wrapSegs(doneSegs(done), width)))

const SEPARATOR: Seg = { text: ' · ', color: TN.comment }

// · で繋いで並べる。幅に収まらない分は、区切りの所で次の行へ送る
const packed = (parts: readonly Seg[][], width: number): Seg[][] => {
  const lines: Seg[][] = []
  for (const part of parts.filter(found => found.length > 0)) {
    const line = lines.at(-1)
    if (line !== undefined && segWidth(line) + segWidth([SEPARATOR]) + segWidth(part) <= width) line.push(SEPARATOR, ...part)
    else lines.push([...part])
  }
  return lines.flatMap(line => wrapSegs(line, width))
}

const countSegs = (tally: Tally, hasTools: boolean): Seg[][] => [
  hasTools ? [{ text: `ツール ${tally.calls}`, color: TN.comment }] : [],
  tally.errors === 0 ? [] : [{ text: `失敗 ${tally.errors}`, color: FAILED }],
]

// ツールの内訳。多い順に名前と回数と色。NAMES_SHOWN より後ろは「ほか」にまとめる
const mixOf = (tally: Tally) => {
  const names = Object.entries(tally.byName).sort(([, a], [, b]) => b - a)
  const rest = names.slice(NAMES_SHOWN).reduce((sum, [, count]) => sum + count, 0)
  return [
    ...names.slice(0, NAMES_SHOWN).map(([name, count]) => ({ name, count, color: toolColor(name) })),
    ...(rest === 0 ? [] : [{ name: 'ほか', count: rest, color: TN.comment }]),
  ]
}

// 内訳を、ツールごとに色分けした割合の棒と、同じ色の名前で出す。2 回からだけ出す
const mixLines = (tally: Tally, width: number): Seg[][] => {
  if (tally.calls < 2) return []
  const mix = mixOf(tally)
  const total = mix.reduce((sum, part) => sum + part.count, 0)
  // どのツールも 1 マスは取る。端数は、いちばん多いツールで合わせる
  const cells = mix.map(part => Math.max(1, Math.floor((part.count / total) * width)))
  cells[0] = Math.max(1, (cells[0] ?? 1) + width - cells.reduce((sum, count) => sum + count, 0))
  const bar = fitSegs(mix.map((part, index) => ({ text: '━'.repeat(cells[index] ?? 1), color: part.color })), width)
  return [bar, ...packed(mix.map(part => [{ text: `${part.name} ${part.count}`, color: part.color }]), width)]
}

// トークン・ツールの回数・失敗の数と、その下に内訳
const statLines = (spent: Spent, tally: Tally, hasTools: boolean, width: number): Seg[][] => [...packed([spentSegs(spent), ...countSegs(tally, hasTools)], width), ...mixLines(tally, width)]

// メインとサブエージェントを足した合計。サブエージェントがいる間だけ出す
export const totalLines = (turn: MainTurn, tally: Tally, workers: readonly Worker[], width: number): Seg[][] => {
  if (workers.length === 0) return []
  const spent = workers.reduce<Spent>((sum, worker) => ({ ...sum, input: sum.input + worker.input, output: sum.output + worker.output }), turn)
  const all = workers.reduce((sum, worker) => ({ ...sum, calls: sum.calls + worker.calls, errors: sum.errors + worker.errors }), tally)
  return packed([[{ text: `Σ 合計 ${workers.length + 1} 体`, color: TN.magenta, bold: true }], spentSegs(spent), ...countSegs(all, true)], width)
}

// 止まっているメインの、名前の右に出す終わり方
const endSegs = (turn: MainTurn, elapsed: string): Seg[] => {
  if (turn.endedAt === null) return [{ text: '待っています', color: TN.comment }]
  if (turn.end === 'aborted') return [{ text: `■ 中断 ${elapsed}`, color: TN.yellow }]
  if (turn.end === 'error') return [{ text: `✗ エラー ${elapsed}`, color: FAILED }]
  return [{ text: '✓ ', color: TN.green }, { text: `完了 ${elapsed}`, color: TN.comment }]
}

// 名前の横に、モデルを薄く添える
const nameSegs = (name: Seg, model: string): Seg[] => [name, ...(model === '' ? [] : [{ text: `  ${modelName(model)}`, color: TN.comment }])]

export const mainCard = (doing: Activity, step: Step | null, calls: readonly Running[], turn: MainTurn, tally: Tally, now: number, width: number): Card => {
  const summary = doing.task ?? doing.said
  const own = calls.filter(call => !AGENT_TOOLS.has(call.name))
  // 終わったツールは履歴の行に出るので、今のツールの行には出さない
  const live = doing.phase === 'done' ? null : step
  const shown = doing.isWorking && own.length >= 2 ? groupStep(own, now) : live
  const elapsed = turn.startedAt === null ? '' : duration((turn.endedAt ?? now) - turn.startedAt)
  const state: Seg[] = doing.isWorking ? [{ text: elapsed, color: TN.comment }] : endSegs(turn, elapsed)
  return {
    key: 'main',
    color: doing.isWorking ? CLAUDE : IDLE,
    isAnimated: doing.isWorking,
    // 自分のツールがあればその動き、サブエージェントを待つだけならヘディング
    action: doing.isWorking ? actionOf(own.length > 0 ? own : calls) : turn.endedAt === null || turn.end === 'aborted' ? 'idle' : turn.end === 'error' ? 'failed' : 'done',
    lines: [
      twoColumns(nameSegs({ text: 'Claude', color: CLAUDE, bold: true }, turn.model), state, width),
      ...wrapSegs([{ text: summary ?? '—', color: doing.isWorking ? TN.fg : TN.comment }], width),
      ...(doing.isWorking ? recentLines(tally, shown === null ? RECENT_SHOWN + 1 : RECENT_SHOWN, width) : []),
      // 手の要約はターンの外でも動くので、作業中でなくても出す
      ...((doing.isWorking || doing.phase === 'compacting') && shown !== null ? wrapSegs(stepSegs(shown), width) : []),
      ...statLines(turn, tally, tally.calls > 0, width),
    ],
  }
}

const hueOf = (worker: Worker) => HUES[worker.hue % HUES.length] ?? TN.blue

// 終わったものは報告の最初の行（無ければ最後のツール）、動いているものは発言・直近の履歴・今のツール
const workerSteps = (worker: Worker, now: number, width: number): Seg[][] => {
  if (worker.status === 'done') return wrapSegs([{ text: '✓ ', color: TN.green }, { text: worker.result ?? worker.last ?? '終わりました', color: TN.comment }], width)
  if (worker.status === 'failed') return wrapSegs([{ text: '✗ ', color: FAILED }, { text: '失敗・停止しました', color: TN.comment }], width)
  const active = worker.active.at(-1)
  const step: Seg[] =
    active === undefined
      ? [{ text: '考えています…', color: TN.comment }]
      : [{ text: '● ', color: TN.yellow }, { text: `${active.tool}${worker.active.length > 1 ? ` ほか ${worker.active.length - 1}` : ''} · ${duration(now - active.startedAt)}`, color: TN.fg }]
  return [
    ...(worker.said === null ? [] : wrapSegs([{ text: '› ', color: TN.comment }, { text: worker.said, color: TN.fgDark }], width)),
    ...recentLines(worker, RECENT_SHOWN, width),
    ...wrapSegs(step, width),
  ]
}

export const workerCard = (worker: Worker, now: number, width: number): Card => {
  const isRunning = worker.status === 'running'
  const color = worker.status === 'failed' ? FAILED : hueOf(worker)
  return {
    key: `worker-${worker.id}`,
    color,
    isAnimated: isRunning,
    action: isRunning ? actionOf(worker.active) : worker.status === 'failed' ? 'failed' : 'done',
    lines: [
      twoColumns(nameSegs({ text: worker.type === '' ? 'agent' : worker.type, color: TN.cyan, bold: true }, worker.model), [{ text: duration((worker.endedAt ?? now) - worker.startedAt), color: TN.comment }], width),
      ...wrapSegs([{ text: worker.title === '' ? '—' : worker.title, color: isRunning ? TN.fg : TN.fgDark }], width),
      ...workerSteps(worker, now, width),
      ...statLines(worker, worker, true, width),
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
