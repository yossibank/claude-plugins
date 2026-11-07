import type { EngineInterface } from 'claude-code'

// 同じ失敗は続けて知らせない
let lastFailure = ''

// 握りつぶされる非同期の失敗を、トーストで知らせる
export function report($: EngineInterface, where: string, error: unknown) {
  const text = `session-dashboard: ${where}に失敗しました（${error instanceof Error ? error.message : String(error)}）`
  if (text === lastFailure) return
  lastFailure = text
  $.ui.toast(text)
}
