import type { Activity, Claude, Fill, Limit, Repo, Running, TaskItem, Touched, Worker } from '../types'

import type { Step } from './activity'
import { card, changeSegs, keyWidthOf, valueWidth } from './card'
import { cellWidth, gradient, twoColumns } from './cell'
import type { Seg } from './cell'
import { LIMIT_NAMES } from './claude'
import { heat, HEAT, ICON, TN } from './palette'
import { duration, elapsedOf, untilReset } from './time'
import { gradeOf, kilo, thousands } from './tokens'
import { AGENT_TOOLS } from './tool'

// 割合の列（空白 + 100%）の幅
const PERCENT_COLUMNS = 5
// 戻るまでの時間を出すのに要る棒の最小の幅
const MIN_BAR_COLUMNS = 4
// 使った量の列（6 桁にそろえた量 + 空白）の幅
const AMOUNT_COLUMNS = 7
const FILES_SHOWN = 5
const TASKS_SHOWN = 8
// 1 時間あたりの費用を出すまでの分数
const RATE_MINUTES = 5

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

export const claudeCard = (info: Claude, inner: number) =>
  card(
    [{ text: `${ICON.model} Claude`, color: TN.blue, bold: true }],
    [
      [[{ text: 'model', color: TN.comment }], [{ text: info.model, color: TN.fg }]],
      [[{ text: 'cost', color: TN.comment }], [{ text: info.usd === null ? '—' : `$${info.usd.toFixed(2)}`, color: TN.orange }]],
    ],
    inner,
    info.version === '' ? undefined : [{ text: `v${info.version}`, color: TN.comment }],
  )

export const repoCard = (git: Repo, inner: number) =>
  card(
    [{ text: `${ICON.repo} ${git.name}`, color: TN.cyan, bold: true }],
    [
      [[{ text: 'branch', color: TN.comment }], [{ text: git.branch === '' ? '—' : git.branch, color: TN.magenta }]],
      [[{ text: 'diff', color: TN.comment }], changeSegs(git)],
    ],
    inner,
  )

export const limitCard = (limits: readonly Limit[], now: number, inner: number) => {
  const keys = limits.map((limit): Seg[] => [{ text: LIMIT_NAMES[limit.kind] ?? limit.kind, color: TN.fg }])
  const value = valueWidth(inner, keyWidthOf(keys.map((key): [Seg[], Seg[]] => [key, []])))
  const resets = limits.map(limit => untilReset(limit.resetsAt, now))
  // 棒の長さをそろえるため、戻るまでの時間は一番長いものの幅で取る
  const resetWidth = Math.max(0, ...resets.map(until => cellWidth(until)))
  const isResetShown = resetWidth > 0 && value - PERCENT_COLUMNS - resetWidth - 1 >= MIN_BAR_COLUMNS
  return card(
    [{ text: `${ICON.limit} Limit`, color: TN.yellow, bold: true }],
    limits.map((limit, index): [Seg[], Seg[]] => {
      const percent = `${Math.round(limit.percentUsed)}%`.padStart(4)
      // 棒が 4 も取れなければ、戻るまでの時間を落とす
      const reset = isResetShown ? ` ${' '.repeat(resetWidth - cellWidth(resets[index] ?? ''))}${resets[index] ?? ''}` : ''
      const columns = Math.max(1, value - PERCENT_COLUMNS - (isResetShown ? resetWidth + 1 : 0))
      return [
        keys[index] ?? [],
        [...gradient(limit.percentUsed / 100, columns, HEAT, TN.line), { text: ` ${percent}`, color: heat(limit.percentUsed / 100), bold: true }, { text: reset, color: TN.comment }],
      ]
    }),
    inner,
  )
}

export const unmeasuredCard = (inner: number) =>
  card([{ text: `${ICON.context} Context`, color: TN.magenta, bold: true }], [[[], [{ text: 'まだ測っていません。', color: TN.comment }]]], inner)

export const contextCard = (measured: Fill, left: number | null, inner: number) => {
  const grade = gradeOf(measured)
  const legend = [...measured.slices].sort((x, y) => y.tokens - x.tokens)
  const keyWidth = Math.max(4, ...legend.map(slice => cellWidth(slice.name)))
  const value = valueWidth(inner, keyWidth)
  const top = Math.max(...legend.map(slice => slice.tokens), 1)
  const total = `${thousands(measured.tokens)}/${thousands(measured.window)}`
  return card(
    [{ text: `${ICON.context} Context ${measured.percent}%`, color: TN.magenta, bold: true }],
    [
      [[{ text: 'used', color: TN.comment }], [...gradient(measured.percent / 100, Math.max(1, value - cellWidth(total) - 1), [TN.blue, TN.magenta], TN.line), { text: ` ${total}`, color: TN.fg }]],
      ...legend.map((slice): [Seg[], Seg[]] => [
        [{ text: slice.name, color: TN.fgDark }],
        [{ text: kilo(slice.tokens).padStart(6), color: TN.fg }, { text: ' ' }, ...gradient(slice.tokens / top, Math.max(1, value - AMOUNT_COLUMNS), [TN.magenta, TN.magenta], TN.bgHighlight, '━', ' ')],
      ]),
    ],
    inner,
    [
      { text: 'grade ', color: TN.comment },
      { text: grade.name, color: grade.color, bold: true },
      { text: ` · ${ICON.cache} ${left === null ? 'cold' : `${left}m`}`, color: TN.comment },
    ],
  )
}

export const nextCard = (next: readonly string[], inner: number) =>
  card(
    [{ text: `${ICON.next} Next`, color: TN.blue, bold: true }],
    next.map((item, index): [Seg[], Seg[]] => [[{ text: `${index + 1}`, color: TN.comment }], [{ text: item, color: TN.fg }]]),
    inner,
  )

// サブエージェントの本数がこれを超えたら、残りは「ほか N 本」にまとめる
const WORKERS_SHOWN = 5

// 多すぎる時は、動いているものを先に、次に最近終わったものを残す
const shownWorkers = (workers: readonly Worker[]) => {
  if (workers.length <= WORKERS_SHOWN) return [...workers]
  const running = workers.filter(worker => worker.status === 'running')
  const ended = workers.filter(worker => worker.status !== 'running').sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))
  return [...running, ...ended].slice(0, WORKERS_SHOWN).sort((x, y) => x.startedAt - y.startedAt)
}

const WORKER_MARKS: Record<Worker['status'], Seg> = {
  running: { text: '', color: TN.comment },
  done: { text: '✓ ', color: TN.green },
  failed: { text: '✗ ', color: TN.red },
}

// 木の 1 本分。2 行目は動いているツールと、ツールの回数
const workerRows = (worker: Worker, now: number, isLast: boolean, width: number): [Seg[], Seg[]][] => {
  const branch = isLast ? '└ ' : '├ '
  const mark = WORKER_MARKS[worker.status]
  const left: Seg[] = [{ text: branch, color: TN.line }, { text: worker.type === '' ? 'agent' : worker.type, color: TN.cyan }, { text: `  ${worker.title}`, color: TN.fg }]
  const right: Seg[] = [...(mark.text === '' ? [] : [mark]), { text: duration((worker.endedAt ?? now) - worker.startedAt), color: TN.comment }]
  const rows: [Seg[], Seg[]][] = [[[], twoColumns(left, right, width)]]
  if (worker.status !== 'running' || worker.last === null) return rows
  const active = worker.active.at(-1)
  const step: Seg[] =
    active === undefined
      ? [{ text: '✓ ', color: TN.green }, { text: worker.last, color: TN.comment }]
      : [{ text: '● ', color: TN.yellow }, { text: `${active.tool} · ${Math.max(0, Math.floor((now - active.startedAt) / 1000))}s`, color: TN.fg }]
  rows.push([[], twoColumns([{ text: isLast ? '    ' : '│   ', color: TN.line }, ...step], [{ text: `ツール ${worker.calls}`, color: TN.comment }], width)])
  return rows
}

// メインで重なって動いているツール。サブエージェントを起こすものは、サブエージェントの側に出す
const callRow = (call: Running, now: number, isLast: boolean, width: number): [Seg[], Seg[]] => [
  [],
  twoColumns([{ text: isLast ? '└ ' : '├ ', color: TN.line }, { text: '● ', color: TN.yellow }, { text: call.tool, color: TN.fg }], [{ text: duration(now - call.startedAt), color: TN.comment }], width),
]

// 重なって動くツールをまとめた 1 行。同じ名前なら Agent ×3
const groupStep = (calls: readonly Running[], now: number): Step => {
  const name = calls.every(call => call.name === calls[0]?.name) ? (calls[0]?.name ?? '') : '並行'
  const oldest = Math.min(...calls.map(call => call.startedAt))
  return { mark: '● ', text: `${name} ×${calls.length} · ${duration(now - oldest)}`, color: TN.fg }
}

export const nowCard = (doing: Activity, step: Step | null, calls: readonly Running[], workers: readonly Worker[], now: number, inner: number) => {
  const summary = doing.task ?? doing.said
  const rows: [Seg[], Seg[]][] = [[[{ text: '作業', color: TN.comment }], [{ text: summary ?? '待っています', color: doing.isWorking ? TN.fg : TN.comment }]]]
  const shownStep = doing.isWorking && calls.length >= 2 ? groupStep(calls, now) : step
  if (doing.isWorking && shownStep !== null) rows.push([[{ text: '実行', color: TN.comment }], stepSegs(shownStep)])
  else if (!doing.isWorking && (summary !== null || workers.length > 0)) rows.push([[{ text: '状態', color: TN.comment }], [{ text: '待っています', color: TN.comment }]])

  const width = valueWidth(inner, keyWidthOf(rows))
  const crew = shownWorkers(workers)
  const hidden = workers.length - crew.length
  const others = doing.isWorking && calls.length >= 2 ? calls.filter(call => !AGENT_TOOLS.has(call.name)) : []
  const count = crew.length + others.length + (hidden > 0 ? 1 : 0)
  let at = 0
  const isLast = () => (at += 1) === count
  for (const worker of crew) rows.push(...workerRows(worker, now, isLast(), width))
  for (const call of others) rows.push(callRow(call, now, isLast(), width))
  if (hidden > 0) rows.push([[], twoColumns([{ text: '└ ', color: TN.line }, { text: `ほか ${hidden} 本`, color: TN.comment }], [], width)])
  return card([{ text: `${ICON.now} Now`, color: TN.yellow, bold: true }], rows, inner)
}

export const sessionCard = (ms: number, turns: number, calls: number, spent: number | null, inner: number) => {
  const rate = spent === null || ms < RATE_MINUTES * 60_000 ? '—' : `$${(spent / (ms / 3_600_000)).toFixed(2)}/h`
  return card(
    [{ text: `${ICON.session} Session`, color: TN.teal, bold: true }],
    [
      [[{ text: 'time', color: TN.comment }], [{ text: elapsedOf(ms), color: TN.fg }, { text: ` · ${turns} turns`, color: TN.fgDark }]],
      [[{ text: 'calls', color: TN.comment }], [{ text: String(calls), color: TN.fg }, { text: ` · ${rate}`, color: TN.orange }]],
    ],
    inner,
  )
}

export const tasksCard = (list: readonly TaskItem[], inner: number) => {
  const finished = list.filter(item => item.status === 'completed').length
  const shown = shownTasks(list)
  return card(
    [{ text: `${ICON.tasks} Tasks ${finished}/${list.length}`, color: TN.green, bold: true }],
    shown.map((item): [Seg[], Seg[]] => [[TASK_MARKS[item.status]], [{ text: item.subject, color: TASK_COLORS[item.status] }]]),
    inner,
    shown.length < list.length ? [{ text: `+${list.length - shown.length}`, color: TN.comment }] : undefined,
  )
}

export const filesCard = (touched: readonly Touched[], inner: number) =>
  card(
    [{ text: `${ICON.files} Files`, color: TN.orange, bold: true }],
    touched.slice(0, FILES_SHOWN).map((item): [Seg[], Seg[]] => {
      const parts = item.path.split('/')
      const folder = parts.at(-2)
      return [
        [{ text: `×${item.count}`, color: TN.comment }],
        [{ text: parts.at(-1) ?? item.path, color: TN.fg }, ...(folder === undefined || folder === '' ? [] : [{ text: ` ${folder}`, color: TN.comment }])],
      ]
    }),
    inner,
  )
