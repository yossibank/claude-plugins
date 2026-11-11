import type { EngineInterface, SessionMessage } from 'claude-code'

import type { Change, Facts, Fill } from '../types'

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
  const value = await $.session.messages().catch(() => [])
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

// `git diff --numstat` の「12\t3\tパス」を、パスごとの足した行と消した行にする。バイナリは「-」なので 0 とする
export const numstatOf = (numstat: string) =>
  new Map(
    numstat
      .split('\n')
      .map(line => line.split('\t'))
      .filter((cells): cells is [string, string, string] => cells.length === 3)
      .map(([added, removed, path]) => [path, { added: Number(added) || 0, removed: Number(removed) || 0 }] as const),
  )

// 触ったファイルごとの、まだ commit していない差分。未追跡のファイルは、行の数を足した行とする。リポジトリの外のファイルは、外の印を付けて 0 とする
async function changesOf($: EngineInterface, root: Root, files: string[]): Promise<Change[]> {
  const inside = files.filter(file => !file.startsWith('/'))
  const clean = (path: string): Change => ({ path, added: 0, removed: 0, isNew: false, isOutside: !root.isRepo || path.startsWith('/') })
  if (!root.isRepo || inside.length === 0) return files.map(clean)
  // [id] や * を含む名前を glob と読ませない。日本語の名前を \343 の形にさせない
  const [numstat, others] = await Promise.all([
    git($, root.base, ['-c', 'core.quotepath=false', '--literal-pathspecs', 'diff', '--numstat', '--no-renames', 'HEAD', '--', ...inside]),
    git($, root.base, ['-c', 'core.quotepath=false', '--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '--', ...inside]),
  ])
  const tracked = numstatOf(numstat)
  const untracked = others.split('\n').filter(file => file !== '')
  const lines = new Map(
    await Promise.all(
      untracked.map(file =>
        $.fs
          .read(`${root.base}/${file}`)
          .then(text => [file, text.trim() === '' ? 0 : lineCount(text)] as const)
          .catch(() => [file, 0] as const),
      ),
    ),
  )
  return files.map(path => {
    const added = lines.get(path)
    return added === undefined ? { ...clean(path), ...tracked.get(path) } : { path, added, removed: 0, isNew: true, isOutside: false }
  })
}

// まだ commit していないファイルの数。メモ自身は数えない
async function dirtyOf($: EngineInterface, root: Root, memo: string) {
  if (!root.isRepo) return null
  const status = await git($, root.base, ['-c', 'core.quotepath=false', 'status', '--porcelain'])
  return status.split('\n').filter(line => line.trim() !== '' && line.trim().replace(/^\S+\s+/, '') !== relative(root.base, memo)).length
}

export async function gather($: EngineInterface, root: Root, path: string, messages: Messages): Promise<Facts> {
  const files = filesOf(messages, root.base)
  // 互いに待たないので、まとめて取る
  const [usage, previous, branch, changes, dirty] = await Promise.all([
    $.session.usage().catch(() => undefined),
    $.fs.exists(path).then(isFound => (isFound ? $.fs.stat(path).catch(() => undefined) : undefined)),
    root.isRepo ? git($, root.base, ['branch', '--show-current']) : '',
    changesOf($, root, files),
    dirtyOf($, root, path),
  ])
  return {
    repo: root.base.split('/').pop() ?? root.base,
    branch,
    previousMs: previous?.mtimeMs ?? null,
    sessionStartedAt: usage?.startedAt ?? 0,
    messages: messages.length,
    turns: messages.filter(message => message.role === 'user' && message.text.trim() !== '').length,
    files,
    changes,
    added: changes.reduce((sum, change) => sum + change.added, 0),
    removed: changes.reduce((sum, change) => sum + change.removed, 0),
    dirty,
  }
}
