import type { PluginOptions } from 'claude-code'

export const SLACK_COLUMNS = 2
export const PANE = 'session-dashboard'
export const TITLE = '📊 Session'
export const WATCH_MS = 2000

// plugin.json の userConfig の既定と同じにする。options に無い時だけ使う
const DEFAULTS = { cacheMinutes: '60', handoffPath: '.claude/handoff.md' }

export type Config = {
  cacheMs: number
  handoffPath: string
}

export const configure = (options: PluginOptions): Config => ({
  cacheMs: Number(options.cacheMinutes ?? DEFAULTS.cacheMinutes) * 60_000,
  handoffPath: String(options.handoffPath ?? DEFAULTS.handoffPath),
})
