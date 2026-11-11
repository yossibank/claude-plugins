export type Slice = { name: string; tokens: number }

export type Fill = {
  slices: Slice[]
  free: number
  tokens: number
  window: number
  percent: number
  // 自動の要約が始まるトークン数。切ってあるか、分からなければ無い
  compactAt?: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Claude = { model: string; version: string; usd: number | null; limits: Limit[] }

// 最後の commit。at は秒の時刻
export type Commit = { at: number; subject: string }

// ahead・behind は upstream との差。upstream が無ければ無い
export type Repo = { name: string; branch: string; added: number; deleted: number; untracked: number; ahead?: number; behind?: number; last?: Commit }

// turnMs はメインのターンにかかった時間の合計、lastTurnMs は直近の 1 回。byName はツールの名前ごとの回数、errors は失敗した呼び出しの数
export type Stats = { turns: number; calls: number; usdAtStart: number | null; turnMs: number; lastTurnMs: number; byName: Record<string, number>; errors: number }

// セッションで使ったトークンの合計。メインとサブエージェントを足す
export type Spent = { input: number; output: number; cacheRead: number; cacheWrite: number }

// 1 日に使った費用（USD）とトークン。このマシンの全セッションの合算。input はキャッシュの読み書きも足す
export type Day = { usd: number; input: number; output: number }

// 鍵はローカルの日付（YYYY-MM-DD）
export type Days = Record<string, Day>

// 前に store へ足した時点の、このセッションの合計。usd は費用が分かるまで null
export type Counted = { usd: number | null; input: number; output: number }

declare module 'claude-code' {
  interface PluginState {
    'session-dashboard': {
      fill: Shaped<Fill | null>
      lastTurnEnd: number | null
      sessionStart: number | null
      tick: number
      isPaneShown: boolean
      claude: Claude | null
      repo: Repo | null
      stats: Shaped<Stats>
      spent: Spent
      history: number[]
      days: Shaped<Days>
      counted: Shaped<Counted | null>
    }
  }
}
