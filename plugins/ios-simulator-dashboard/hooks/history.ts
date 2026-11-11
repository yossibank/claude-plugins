import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Action, Count, Entry, Log } from '../types'

// 履歴に残す件数
const MAX_ENTRIES = 20
const MCP_PREFIX = 'mcp__XcodeBuildMCP__'

const fresh = (session: string | null): Log => ({ session, entries: [], boots: 0, installs: 0, launches: 0, screenshots: 0, failures: 0, lastScreenshotAt: null, isOpened: false })

const log = atom({ plugin: 'ios-simulator-dashboard', key: 'log' } as const, fresh(null), { shape: 'log-1' })

type Args = { tool: string; [argument: string]: unknown }

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path
// UDID は頭の 8 文字にする
const short = (word: string) => (/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-/.test(word) ? word.slice(0, 8) : word)

// XcodeBuildMCP のツール。build_run_sim は、インストールとアプリの起動の両方に数える
const MCP_TOOLS: Record<string, { label: string; counts: Count[] }> = {
  boot_sim: { label: 'シミュレータを起動', counts: ['boot'] },
  open_sim: { label: 'Simulator.app を開く', counts: [] },
  install_app_sim: { label: 'インストール', counts: ['install'] },
  launch_app_sim: { label: 'アプリを起動', counts: ['launch'] },
  stop_app_sim: { label: 'アプリを止める', counts: [] },
  build_run_sim: { label: 'ビルドして実行', counts: ['install', 'launch'] },
  screenshot: { label: 'スクリーンショット', counts: ['screenshot'] },
  snapshot_ui: { label: 'UI を読む', counts: [] },
  record_sim_video: { label: '動画を撮る', counts: [] },
}

const mcpAction = (e: Args): Action[] => {
  const found = MCP_TOOLS[e.tool.slice(MCP_PREFIX.length)]
  if (found === undefined) return []
  const target = text(e.bundleId) || baseName(text(e.appPath)) || text(e.simulatorName) || short(text(e.simulatorId))
  return [{ ...found, target }]
}

// xcrun simctl のサブコマンド。args は、オプションを除いた引数。状態を読むだけのもの（list など）は拾わない
const SIMCTL: Record<string, (args: string[]) => Action | null> = {
  boot: args => ({ label: 'シミュレータを起動', target: short(args[0] ?? ''), counts: ['boot'] }),
  shutdown: args => ({ label: 'シミュレータを止める', target: short(args[0] ?? ''), counts: [] }),
  erase: args => ({ label: 'シミュレータを初期化', target: short(args[0] ?? ''), counts: [] }),
  install: args => ({ label: 'インストール', target: baseName(args[1] ?? ''), counts: ['install'] }),
  uninstall: args => ({ label: 'アンインストール', target: args[1] ?? '', counts: [] }),
  launch: args => ({ label: 'アプリを起動', target: args[1] ?? '', counts: ['launch'] }),
  terminate: args => ({ label: 'アプリを止める', target: args[1] ?? '', counts: [] }),
  openurl: args => ({ label: 'URL を開く', target: args[1] ?? '', counts: [] }),
  io: args =>
    args[1] === 'screenshot'
      ? { label: 'スクリーンショット', target: baseName(args[2] ?? ''), counts: ['screenshot'] }
      : args[1] === 'recordVideo'
        ? { label: '動画を撮る', target: baseName(args[2] ?? ''), counts: [] }
        : null,
  // 値の無い ui appearance は、読むだけ
  ui: args => (args[1] === 'appearance' && args[2] !== undefined ? { label: '外観を変える', target: args[2], counts: [] } : null),
  push: args => ({ label: '通知を送る', target: args[1] ?? '', counts: [] }),
  privacy: args => ({ label: '権限を変える', target: args.slice(1, 3).join(' '), counts: [] }),
  status_bar: args => ({ label: 'ステータスバーを変える', target: args[1] ?? '', counts: [] }),
  addmedia: args => ({ label: 'メディアを足す', target: baseName(args[1] ?? ''), counts: [] }),
  location: args => ({ label: '位置を変える', target: args[1] ?? '', counts: [] }),
}

// コマンドの中の xcrun simctl を、区切り（; & | 改行）まで取る
const SIMCTL_COMMAND = /(?:^|[\s;&|(`])(?:\S*\/)?xcrun\s+simctl\s+([^;&|\n`)]*)/g

export const bashActions = (command: string): Action[] => {
  const out: Action[] = []
  for (const found of command.matchAll(SIMCTL_COMMAND)) {
    const words = (found[1] ?? '')
      .trim()
      .split(/\s+/)
      .map(word => word.replace(/^["']|["']$/g, ''))
    // simctl 自身のオプション（--set <path>）を飛ばす
    while (words[0]?.startsWith('-') === true) words.splice(0, words[0] === '--set' ? 2 : 1)
    const [sub, ...rest] = words
    const action = SIMCTL[sub ?? '']?.(rest.filter(word => !word.startsWith('-') && word !== '')) ?? null
    if (action !== null) out.push(action)
  }
  return out
}

// ツールの呼び出しから、シミュレータにする操作を読み取る。関係が無ければ空
export const actionsOf = (e: Args): Action[] => {
  if (e.tool.startsWith(MCP_PREFIX)) return mcpAction(e)
  if (e.tool === 'Bash') return bashActions(text(e.command))
  return []
}

export async function currentLog($: EngineInterface) {
  return read($, log)
}

// 会話が替わっていたら（/clear など）、履歴を初めに戻す
export async function followSession($: EngineInterface) {
  const id = await $.session.id().catch(() => null)
  if (id === null || (await read($, log)).session === id) return
  await update($, log, old => (old.session === id ? old : fresh(id)))
}

// 終わった操作を履歴に足す。回数は成功した分だけ数え、失敗は呼び出し 1 回につき 1 と数える
export async function record($: EngineInterface, actions: Action[], done: { at: number; ms: number; isFailed: boolean }) {
  await followSession($)
  // 1 つのコマンドに並んだ操作は、後ろのものを上にする
  const entries: Entry[] = actions.map(action => ({ at: done.at, label: action.label, target: action.target, isFailed: done.isFailed, ms: done.ms })).reverse()
  const count = (kind: Count) => (done.isFailed ? 0 : actions.filter(action => action.counts.includes(kind)).length)
  await update($, log, old => ({
    ...old,
    entries: [...entries, ...old.entries].slice(0, MAX_ENTRIES),
    boots: old.boots + count('boot'),
    installs: old.installs + count('install'),
    launches: old.launches + count('launch'),
    screenshots: old.screenshots + count('screenshot'),
    failures: old.failures + (done.isFailed ? 1 : 0),
    lastScreenshotAt: count('screenshot') > 0 ? done.at : old.lastScreenshotAt,
  }))
}

// autoOpen で pane を開くのは、会話で 1 回だけ。初めてなら true を返して印を付ける
export async function markOpened($: EngineInterface) {
  let isFirst = false
  await update($, log, old => {
    isFirst = !old.isOpened
    return isFirst ? { ...old, isOpened: true } : old
  })
  return isFirst
}
