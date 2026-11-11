export type Phase = 'thinking' | 'preparing' | 'running' | 'done' | 'compacting'

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

// 終わったツールの呼び出し 1 回。ms はかかった時間
export type Done = { tool: string; ms: number; isError: boolean }

// ツールの呼び出しの数え。recent は終わった順の直近、byName はツールの名前ごとの回数
export type Tally = { calls: number; errors: number; recent: Done[]; byName: Record<string, number> }

// メインのターンの終わり方
export type TurnEnd = 'answer' | 'aborted' | 'error'

// アイコンの動き。動いている間は think・type・read・web・play・plain、止まっている間は idle・done・failed・plain
export type Action = 'plain' | 'think' | 'type' | 'read' | 'web' | 'play' | 'idle' | 'done' | 'failed'

export type WorkerStatus = 'running' | 'done' | 'failed'

// 1 ターンで使ったトークン。input はキャッシュから読んだ分と書いた分を含む
export type Spent = { input: number; output: number; model: string }

// メインの今のターン。endedAt は終わるまで null
export type MainTurn = Spent & { startedAt: number | null; endedAt: number | null; end?: TurnEnd }

// Agent で起こしたサブエージェント 1 本。active はその中で動いているツール、last は最後に始めたツール、hue はアイコンの色の番号
// said は今のステップの発言の最初の行、result は終わった時の報告の最初の行
export type Worker = Spent & Tally & {
  id: string
  type: string
  title: string
  startedAt: number
  endedAt: number | null
  status: WorkerStatus
  active: Running[]
  last: string | null
  said: string | null
  result: string | null
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
      tally: Tally
    }
  }
}
