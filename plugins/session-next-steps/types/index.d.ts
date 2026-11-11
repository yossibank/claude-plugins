// said は返事の最後で勧めたコマンド、ask はモデルに尋ねた候補。番号で分ける
export type StepId = 'fix' | 'check' | 'commit' | 'push' | 'pr' | 'handoff' | `said-${number}` | `ask-${number}`

// 帯に出す候補 1 つ。label はボタンの字、reason は選んだ理由、text は入力欄に入れる文
export type Step = { id: StepId; label: string; reason: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'session-next-steps': { steps: Shaped<Step[]> }
  }
}
