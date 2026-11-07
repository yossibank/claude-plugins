export type Slice = { name: string; tokens: number; color: string }

export type Fill = {
  slices: Slice[]
  free: number
  buffer: number
  tokens: number
  window: number
  percent: number
}

export type Upcoming = { items: string[]; mtimeMs: number }

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Claude = { model: string; version: string; usd: number | null; limits: Limit[] }

export type Repo = { name: string; branch: string; added: number; deleted: number; untracked: number }

export type Phase = 'thinking' | 'preparing' | 'running' | 'done'

export type Activity = {
  isWorking: boolean
  task: string | null
  said: string | null
  tool: string | null
  phase?: Phase | null
  startedAt?: number | null
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type TaskItem = { id: string; subject: string; activeForm?: string; status: TaskStatus }

export type Tasks = { items: TaskItem[]; current: string | null }

export type Touched = { path: string; count: number }

export type Stats = { turns: number; calls: number; usdAtStart: number | null }

declare module 'claude-code' {
  interface PluginState {
    'session-dashboard': {
      fill: Shaped<Fill | null>
      lastTurnEnd: number | null
      sessionStart: number | null
      upcoming: Upcoming | null
      tick: number
      isPaneShown: boolean
      claude: Claude | null
      repo: Repo | null
      activity: Activity
      second: number
      tasks: Tasks
      files: Touched[]
      stats: Stats
    }
  }
}
