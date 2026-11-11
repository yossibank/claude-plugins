import type { PluginOptions } from 'claude-code'

export const SLACK_COLUMNS = 2
export const PANE = 'session-dashboard'
export const TITLE = '📊 Session'
export const WATCH_MS = 2000

// plugin.json の userConfig の既定と同じにする。options に無い時だけ使う
const DEFAULTS = { cacheMinutes: '60' }

export type Config = {
  cacheMs: number
}

// 空や数でない値は、既定の分数に戻す
export const configure = (options: PluginOptions): Config => {
  const minutes = Number(options.cacheMinutes)
  return { cacheMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : Number(DEFAULTS.cacheMinutes)) * 60_000 }
}
