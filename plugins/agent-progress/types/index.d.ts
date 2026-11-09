export type Phase = 'thinking' | 'preparing' | 'running' | 'done'

export type Activity = {
  isWorking: boolean
  task: string | null
  said: string | null
  tool: string | null
  phase: Phase | null
  startedAt?: number | null
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type TaskItem = { id: string; subject: string; activeForm?: string; status: TaskStatus }

export type Tasks = { items: TaskItem[]; current: string | null }

// 動いているツールの呼び出し。name はツールの名前、tool は describe した 1 行
export type Running = { id: string; name: string; tool: string; startedAt: number }

export type WorkerStatus = 'running' | 'done' | 'failed'

// 1 ターンで使ったトークン。input はキャッシュから読んだ分と書いた分を含む
export type Spent = { input: number; output: number; model: string }

// メインの今のターン。endedAt は終わるまで null
export type MainTurn = Spent & { startedAt: number | null; endedAt: number | null }

// Agent で起こしたサブエージェント 1 本。active はその中で動いているツール、last は最後に始めたツール、hue はアイコンの色の番号
export type Worker = Spent & {
  id: string
  type: string
  title: string
  startedAt: number
  endedAt: number | null
  status: WorkerStatus
  calls: number
  active: Running[]
  last: string | null
  hue: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-progress': {
      activity: Activity
      second: number
      tasks: Tasks
      running: Shaped<Running[]>
      workers: Shaped<Worker[]>
      isPaneShown: boolean
      turn: MainTurn
    }
  }
}
