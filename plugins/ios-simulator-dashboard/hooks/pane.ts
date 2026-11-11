import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { PANE } from './config'

const isPaneShown = atom({ plugin: 'ios-simulator-dashboard', key: 'isPaneShown' } as const, false)

// いま pane が出ているかを、エンジンに聞く
export async function isShownNow($: EngineInterface) {
  return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
}

// pane が出ているかを見直す。今の値と、前に見た時の値を返す
export async function watchPane($: EngineInterface) {
  const shown = await isShownNow($)
  const was = await read($, isPaneShown)
  if (shown !== was) await update($, isPaneShown, () => shown)
  return { shown, was }
}
