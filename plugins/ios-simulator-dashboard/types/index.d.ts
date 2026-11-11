export type Appearance = 'light' | 'dark' | 'unknown'

// 設定の bundleId のアプリ。isInstalled は入っているか、isRunning は動いているか
export type App = { isInstalled: boolean; isRunning: boolean }

// 起動中のシミュレータ 1 台。app は bundleId を設定した時だけ
export type Device = { name: string; os: string; udid: string; appearance: Appearance; app?: App }

// シミュレータの状態。available は使えるシミュレータの数、readAt は取った時刻
export type Sim =
  | { status: 'unread' }
  | { status: 'ok'; booted: Device[]; available: number; readAt: number }
  | { status: 'failed'; reason: string; readAt: number }

// 回数に数える操作の種類
export type Count = 'boot' | 'install' | 'launch' | 'screenshot'

// ツールやコマンドから読み取った操作 1 つ。target は相手（bundle ID やシミュレータの名前）
export type Action = { label: string; target: string; counts: Count[] }

// 履歴の 1 件。at は終わった時刻、ms はかかった時間
export type Entry = { at: number; label: string; target: string; isFailed: boolean; ms: number }

// この会話でシミュレータにしたこと。entries は新しい順。session は数えている会話の id
export type Log = {
  session: string | null
  entries: Entry[]
  boots: number
  installs: number
  launches: number
  screenshots: number
  failures: number
  lastScreenshotAt: number | null
  // autoOpen で、もう pane を開いたか
  isOpened: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ios-simulator-dashboard': {
      sim: Shaped<Sim>
      log: Shaped<Log>
      isPaneShown: boolean
    }
  }
}
