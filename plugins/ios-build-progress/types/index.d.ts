export type BuildRun = {
  label: string
  // 前の回の数を覚える時の名前。xcodebuild は -scheme ごとに分ける
  key: string
  startedAt: number
  now: number
  // 済んだ手順の数
  steps: number
  // 今のターゲット・今の段・最後にコンパイルしたファイル。まだ無ければ空
  target: string
  stage: string
  file: string
  warnings: number
  errors: string[]
  // ログが最後に変わった時刻。動きが止まっている時間を出すのに使う
  changedAt: number
  total: number | null
  lastMs: number | null
  // 走り始めた後に、ログが書かれたか。書かれるまでは帯を出さない
  isWritten: boolean
  // XcodeBuildMCP のツールの見張りか。ログが無いので、名前と経った時間だけを出す
  isTool: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ios-build-progress': { runs: Shaped<Record<string, BuildRun>> }
  }
}
