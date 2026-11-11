export type TestRun = {
  label: string
  startedAt: number
  now: number
  passed: number
  failed: string[]
  // 落ちたテストの名前ごとの理由。取れなかったものは入れない
  reasons: Record<string, string>
  // 時間のかかったテスト。長い順に 3 本まで
  slow: { name: string; seconds: number }[]
  // 前の回に落ちたテストの名前。前の回が無ければ null
  lastFailed: string[] | null
  // 最後に結果が出たテストの名前。まだ無ければ空
  latest: string
  // ログが最後に変わった時刻。動きが止まっている時間を出すのに使う
  changedAt: number
  total: number | null
  lastMs: number | null
  // 走り始めた後に、ログが書かれたか。書かれるまでは帯を出さない
  isWritten: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ios-test-progress': { runs: Shaped<Record<string, TestRun>> }
  }
}
