import type { PluginOptions } from 'claude-code'

export const SLACK_COLUMNS = 2
export const PANE = 'session-dashboard'
export const TITLE = '📊 Session'
export const WATCH_MS = 2000

export type Config = {
  cacheMs: number
  handoffPath: string
}

export const configure = (options: PluginOptions): Config => ({
  cacheMs: Number(options.cacheMinutes ?? '60') * 60_000,
  handoffPath: String(options.handoffPath ?? '.claude/handoff.md'),
})
