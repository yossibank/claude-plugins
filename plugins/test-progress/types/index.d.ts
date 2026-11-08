export type TestRun = {
  label: string
  startedAt: number
  now: number
  passed: number
  failed: string[]
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
