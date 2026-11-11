import type { PluginOptions } from 'claude-code'

export const PLUGIN = 'ios-simulator-dashboard'
export const PANE = 'ios-simulator-dashboard'
export const TITLE = '📱 Simulator'
// pane が出ているかを見る間隔
export const WATCH_MS = 2000
// xcrun を待つ長さ。固まったシミュレータで pane を止めない
export const RUN_MS = 10_000

// plugin.json の userConfig の既定と同じにする。options に無い時だけ使う
const DEFAULTS = { bundleId: '', refreshSeconds: 10, autoOpen: false }

export type Config = {
  bundleId: string
  refreshMs: number
  autoOpen: boolean
}

// 空や数でない値は、既定に戻す
export const configure = (options: PluginOptions): Config => {
  const seconds = Number(options.refreshSeconds)
  return {
    bundleId: typeof options.bundleId === 'string' ? options.bundleId.trim() : DEFAULTS.bundleId,
    refreshMs: (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULTS.refreshSeconds) * 1000,
    autoOpen: typeof options.autoOpen === 'boolean' ? options.autoOpen : options.autoOpen === 'true' ? true : DEFAULTS.autoOpen,
  }
}
