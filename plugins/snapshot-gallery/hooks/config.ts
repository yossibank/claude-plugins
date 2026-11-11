import type { PluginOptions } from 'claude-code'

export const PANE = 'snapshot-gallery'
export const TITLE = '📸 Snapshots'
export const MAX_IMAGE_ROWS = 255
export const MIN_IMAGE_ROWS = 6
export const CHROME_ROWS = 10
// 設定が空か壊れている時の値。plugin.json の userConfig の default と同じにしておく
export const DEFAULTS = {
  commandPattern: 'make\\s+(?:-C\\s+\\S+\\s+)?snapshot\\s+SNAPSHOT=([\\w.-]+)',
  snapshotsDir: '.build/snapshots',
  beforeDir: '.build/snapshots-before',
}
export const STATUS = {
  changed: { mark: '🟡', word: '変更', color: 'warning' },
  same: { mark: '⚪', word: '同じ', color: 'inactive' },
  added: { mark: '🟢', word: '新規', color: 'success' },
} as const

export type Folders = { after: string; before: string }

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback)

export const folders = (options: PluginOptions): Folders => ({
  after: text(options.snapshotsDir, DEFAULTS.snapshotsDir),
  before: text(options.beforeDir, DEFAULTS.beforeDir),
})

// 壊れた正規表現は初めの値に戻す。isBroken は、最初の Bash の時に toast で知らせる印
export const watcher = (options: PluginOptions) => {
  try {
    return { pattern: new RegExp(text(options.commandPattern, DEFAULTS.commandPattern)), isBroken: false }
  } catch {
    return { pattern: new RegExp(DEFAULTS.commandPattern), isBroken: true }
  }
}
