// CI の結果の数。failedNames は落ちたものの名前
export type Checks = { passed: number; failed: number; pending: number; failedNames: string[] }

// 今のブランチの PR。review は GitHub の reviewDecision（無ければ空）。unresolved は未解決のスレッドの数で、取れなければ null
export type Pr = {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  review: string
  checks: Checks
  unresolved: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'git-pr-browser': { pr: Shaped<Pr | null> }
  }
}
