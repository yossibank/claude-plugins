export type TestRun = {
  label: string
  startedAt: number
  now: number
  passed: number
  failed: string[]
  total: number | null
  lastMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'test-progress': { runs: Shaped<Record<string, TestRun>> }
  }
}
