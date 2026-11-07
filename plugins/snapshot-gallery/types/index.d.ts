export type CaseStatus = 'changed' | 'added' | 'same'

export type SnapshotCase = {
  name: string
  after: string
  before?: string
  status: CaseStatus
  width: number
  height: number
  afterMs: number
  beforeMs?: number
}

export type Gallery = {
  set: string
  cases: SnapshotCase[]
  index: number
  isChangedOnly: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'snapshot-gallery': { gallery: Shaped<Gallery | null> }
  }
}
