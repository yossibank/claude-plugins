import type { EngineInterface } from 'claude-code'

import { PLUGIN } from './config'

// 同じ失敗は続けて知らせない
let lastFailure = ''

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

// 握りつぶされる非同期の失敗を、トーストで知らせる
export function report($: EngineInterface, where: string, error: unknown) {
  const text = `${PLUGIN}: ${where}に失敗しました（${errorText(error)}）`.slice(0, 160)
  if (text === lastFailure) return
  lastFailure = text
  $.ui.toast(text)
}
