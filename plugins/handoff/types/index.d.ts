export type StepState = 'waiting' | 'running' | 'done' | 'failed'

// ratio は進みの棒の伸び。0 から 1
export type Step = { label: string; state: StepState; detail: string; ratio: number }

// fixed は会話を除いた文脈。/clear の後にも残る分
export type Fill = { tokens: number; window: number; percent: number; fixed: number }

// 触ったファイル 1 つの、まだ commit していない差分。isNew は未追跡
export type Change = { path: string; added: number; removed: number; isNew: boolean }

export type Facts = {
  repo: string
  branch: string
  previousMs: number | null
  sessionStartedAt: number
  messages: number
  turns: number
  files: string[]
  // 触ったファイルごとの差分。files と同じ並び
  changes: Change[]
  // 触ったファイルの、まだ commit していない差分の合計
  added: number
  removed: number
  // リポジトリの中の、まだ commit していないファイルの数。リポジトリの外では null
  dirty: number | null
}

export type Cost = { input: number; cacheRead: number; output: number }

export type Handoff =
  | { phase: 'idle' }
  | { phase: 'offered'; fill: Fill; facts: Facts }
  | { phase: 'building'; fill: Fill | null; facts: Facts | null; steps: Step[]; startedAt: number; now: number; expectedMs: number }
  | { phase: 'ready'; fill: Fill | null; facts: Facts; steps: Step[]; path: string; text: string; lines: number; chars: number; seconds: number; cost: Cost | null }
  | { phase: 'failed'; fill: Fill | null; facts: Facts | null; steps: Step[]; reason: string }

declare module 'claude-code' {
  interface PluginState {
    handoff: { handoff: Shaped<Handoff>; isLater: boolean }
  }
}
