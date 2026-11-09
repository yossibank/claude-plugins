import type { Activity, Worker } from '../types'

import type { Step } from './activity'
import { fitSegs } from './cell'
import type { Seg } from './cell'
import { MOON } from './palette'

// pane を閉じている間に、入力欄の上に出す作業中の 1 行。作業も実行も無ければ空
export const workingLine = (doing: Activity, step: Step | null, workers: readonly Worker[], width: number): Seg[] => {
  const summary = doing.task ?? doing.said
  const running = workers.filter(worker => worker.status === 'running').length
  const working: Seg[] = []
  if (doing.isWorking && (summary !== null || step !== null)) {
    // 作業の名前が無ければ、実行の印を行の頭の ● にする
    if (summary !== null) working.push({ text: '● ', color: MOON.yellow }, { text: summary, color: MOON.fg })
    if (summary !== null && step !== null) working.push({ text: ' │ ', color: MOON.comment })
    if (step !== null) working.push({ text: step.mark, color: step.mark === '● ' ? MOON.yellow : MOON.green }, { text: step.text, color: MOON.comment })
    if (running > 0) working.push({ text: ` │ サブエージェント ${running}`, color: MOON.comment })
  }
  return fitSegs(working, width)
}
