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
  // ファイルの大きさ（バイト）
  bytes: number
  beforeBytes?: number
  // 前の画像の大きさ（px）。取れなかった時は無い
  beforeWidth?: number
  beforeHeight?: number
}

export type Gallery = {
  set: string
  cases: SnapshotCase[]
  // 前にはあって、後に無い画像の名前
  removed: string[]
  index: number
  isChangedOnly: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'snapshot-gallery': { gallery: Shaped<Gallery | null> }
  }
}
