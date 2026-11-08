import type { EngineInterface, SessionMessage } from 'claude-code'

import type { Facts, Fill } from '../types'

import { lineCount } from './memo'

const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']

export type Root = { base: string; isRepo: boolean }

// $ を受け取る関数は、ほかのファイルから呼ばれるので function で書く
function git($: EngineInterface, cwd: string, args: string[]) {
  return $.process
    .run(['git', ...args], { cwd })
    .then(result => (result.exitCode === 0 ? result.stdout.trim() : ''))
    .catch(() => '')
}

export async function rootOf($: EngineInterface): Promise<Root> {
  const cwd = await $.session.cwd()
  const top = await git($, cwd, ['rev-parse', '--show-toplevel'])
  return { base: (top === '' ? cwd : top).replace(/\/$/, ''), isRepo: top !== '' }
}

export const relative = (base: string, path: string) => (path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path)

export const pathOf = (root: Root, handoffPath: string) => (handoffPath.startsWith('/') ? handoffPath : `${root.base}/${handoffPath}`)

// 要約に入る手前までの窓で測る。session-dashboard の文脈の表示と同じ分母
export async function measure($: EngineInterface): Promise<Fill | null> {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  if (usage === undefined) return null
  const { context } = usage
  const window = context.window === 0 ? 0 : (context.breakdown?.rawMaxTokens ?? context.window)
  const tokens = context.tokens ?? context.breakdown?.totalTokens ?? 0
  if (window === 0) return null
  const fixed = (context.breakdown?.categories ?? []).filter(row => row.kind === 'used' && row.name !== 'Messages').reduce((sum, row) => sum + row.tokens, 0)
  return { tokens, window, percent: Math.round((tokens / window) * 100), fixed }
}

type Messages = readonly SessionMessage[]

// 会話の記録を読む。読めない時は空にする
export async function messagesOf($: EngineInterface): Promise<Messages> {
  const value = await $.session.messages()
  return Array.isArray(value) ? (value as Messages) : []
}

export const filesOf = (messages: Messages, base: string) => [
  ...new Set(
    messages.flatMap(message =>
      message.toolUses
        .filter(use => EDIT_TOOLS.includes(use.tool))
        .map(use => use.input.file_path ?? use.input.notebook_path)
        .filter((path): path is string => typeof path === 'string')
        .map(path => relative(base, path)),
    ),
  ),
]

// 「3 files changed, 10 insertions(+), 2 deletions(-)」から足した行と消した行を取る
export const diffOf = (shortstat: string) => ({
  added: Number(shortstat.match(/(\d+) insertion/)?.[1] ?? 0),
  removed: Number(shortstat.match(/(\d+) deletion/)?.[1] ?? 0),
})

// 触ったファイルのうち、リポジトリの中にあるものの、まだ commit していない差分。未追跡のファイルは、行の数を足した行とする
async function touchedDiffOf($: EngineInterface, root: Root, files: string[]) {
  const inside = files.filter(file => !file.startsWith('/'))
  if (!root.isRepo || inside.length === 0) return { added: 0, removed: 0 }
  const tracked = diffOf(await git($, root.base, ['diff', '--shortstat', 'HEAD', '--', ...inside]))
  const untracked = (await git($, root.base, ['ls-files', '--others', '--exclude-standard', '--', ...inside])).split('\n').filter(file => file !== '')
  const lines = await Promise.all(
    untracked.map(file =>
      $.fs
        .read(`${root.base}/${file}`)
        .then(text => (text.trim() === '' ? 0 : lineCount(text)))
        .catch(() => 0),
    ),
  )
  return { added: tracked.added + lines.reduce((sum, count) => sum + count, 0), removed: tracked.removed }
}

export async function gather($: EngineInterface, root: Root, path: string, messages: Messages): Promise<Facts> {
  const usage = await $.session.usage().catch(() => undefined)
  const previous = (await $.fs.exists(path)) ? await $.fs.stat(path).catch(() => undefined) : undefined
  const branch = root.isRepo ? await git($, root.base, ['branch', '--show-current']) : ''
  const files = filesOf(messages, root.base)
  const diff = await touchedDiffOf($, root, files)
  return {
    repo: root.base.split('/').pop() ?? root.base,
    branch,
    previousMs: previous?.mtimeMs ?? null,
    sessionStartedAt: usage?.startedAt ?? 0,
    messages: messages.length,
    turns: messages.filter(message => message.role === 'user' && message.text.trim() !== '').length,
    files,
    ...diff,
  }
}
