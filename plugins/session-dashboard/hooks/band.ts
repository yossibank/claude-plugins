import type { Activity, Claude, Fill, Repo } from '../types'

import type { Step } from './activity'
import { changeSegs } from './card'
import { fitSegs, segWidth } from './cell'
import type { Seg } from './cell'
import { LIMIT_NAMES } from './claude'
import { heat, ICON, MOON } from './palette'

// 作業中の 1 行。作業も実行も無ければ空
export const workingLine = (doing: Activity, step: Step | null, width: number): Seg[] => {
  const summary = doing.task ?? doing.said
  const working: Seg[] = []
  if (doing.isWorking && (summary !== null || step !== null)) {
    working.push({ text: '● ', color: MOON.yellow })
    if (summary !== null) working.push({ text: summary, color: MOON.fg })
    if (summary !== null && step !== null) working.push({ text: ' │ ', color: MOON.comment })
    if (step !== null) working.push({ text: step.mark, color: step.mark === '● ' ? MOON.yellow : MOON.green }, { text: step.text, color: MOON.comment })
  }
  return fitSegs(working, width)
}

// │ で区切ったセルを並べた 1 行。枝は、幅に収まるように最後に縮める
export const statusLine = (info: Claude | null, git: Repo | null, measured: Fill, left: number | null, width: number): Seg[] => {
  const cells: Seg[][] = []
  if (info !== null && info.model !== '') cells.push([{ text: info.model, color: MOON.blue }])
  const branchAt = cells.length
  if (git !== null && git.branch !== '') cells.push([{ text: `${ICON.branch} ${git.branch}`, color: MOON.magenta }])
  if (git !== null && git.added + git.deleted + git.untracked > 0) cells.push(changeSegs(git, MOON))
  cells.push([{ text: 'ctx ', color: MOON.fg }, { text: `${measured.percent}%`, color: MOON.cyan }])
  for (const limit of info?.limits ?? [])
    cells.push([{ text: `${LIMIT_NAMES[limit.kind] ?? limit.kind} `, color: MOON.fg }, { text: `${Math.round(limit.percentUsed)}%`, color: heat(limit.percentUsed / 100, MOON) }])
  cells.push([{ text: `${ICON.cache} ${left === null ? 'cold' : `${left}m`}`, color: MOON.comment }])
  const bar = { text: '│', color: MOON.magenta }
  const lineOf = (row: Seg[][]) => [bar, ...row.flatMap(cell => [{ text: ' ' }, ...cell, { text: ' ' }, bar])]
  const over = segWidth(lineOf(cells)) - width
  if (over > 0 && git !== null && git.branch !== '' && cells[branchAt] !== undefined) {
    const room = Math.max(4, segWidth(cells[branchAt]!) - over)
    cells[branchAt] = fitSegs(cells[branchAt]!, room)
  }
  return fitSegs(lineOf(cells), width)
}
