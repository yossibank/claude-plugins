import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { PANE } from './config'

const isPaneShown = atom({ plugin: 'agent-progress', key: 'isPaneShown' } as const, false)

export async function watchPane($: EngineInterface) {
  const shown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
  if (shown !== (await read($, isPaneShown))) await update($, isPaneShown, () => shown)
}

export async function currentPaneShown($: EngineInterface) {
  return read($, isPaneShown)
}
