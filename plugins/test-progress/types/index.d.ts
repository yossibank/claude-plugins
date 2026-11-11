export type TestRun = {
  label: string
  startedAt: number
  now: number
  passed: number
  failed: string[]
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
    'test-progress': { runs: Shaped<Record<string, TestRun>> }
  }
}
