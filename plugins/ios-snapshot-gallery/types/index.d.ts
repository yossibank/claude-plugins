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
  // index.jsonl に書かれた、人が読む画面の名前と描き方。無い時は出さない
  title?: string
  variant?: string
  // 同じ回に描いた、見た目がまったく同じ画像のうち先の 1 枚の名前
  sameAs?: string
}

export type Gallery = {
  set: string
  cases: SnapshotCase[]
  // 前にはあって、後に無い画像の名前
  removed: string[]
  // ブラウザーで開く一覧のページ
  page: string
  // 変わった画像があれば、一覧を初めから変更と新規に絞る
  isChangedOnly: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ios-snapshot-gallery': { gallery: Shaped<Gallery | null> }
  }
}
