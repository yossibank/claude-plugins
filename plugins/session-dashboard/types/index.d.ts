export type Slice = { name: string; tokens: number }

export type Fill = {
  slices: Slice[]
  free: number
  tokens: number
  window: number
  percent: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Claude = { model: string; version: string; usd: number | null; limits: Limit[] }

export type Repo = { name: string; branch: string; added: number; deleted: number; untracked: number }

export type Stats = { turns: number; calls: number; usdAtStart: number | null }

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
      stats: Stats
    }
  }
}
