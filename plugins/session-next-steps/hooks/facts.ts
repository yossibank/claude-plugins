import type { EngineInterface } from 'claude-code'

import type { Facts, Repo } from './steps'

// gh は網を使うので、遅い時は待たずに PR の候補を飛ばす
const GH_TIMEOUT_MS = 5000
const DEFAULT_BRANCHES = ['main', 'master']

// $ を受け取る関数は、ほかのファイルから呼ばれるので function で書く
// 走らせるのは読むだけのコマンドに限る。成功した時の出力を返し、失敗した時は null
function git($: EngineInterface, cwd: string, args: string[]) {
  return $.process
    .run(['git', ...args], { cwd })
    .then(result => (result.exitCode === 0 ? result.stdout.trim() : null))
    .catch(() => null)
}

// 今のブランチに PR があるか。gh が無い・遅い・ほかの理由で失敗した時は null
function prOf($: EngineInterface, cwd: string) {
  return $.process
    .run(['gh', 'pr', 'view', '--json', 'number'], { cwd, timeoutMs: GH_TIMEOUT_MS })
    .then(result => (result.exitCode === 0 ? true : /no pull requests found/i.test(result.stderr) ? false : null))
    .catch(() => null)
}

// 要約に入る手前までの窓に対する割合。session-handoff と session-dashboard の文脈の表示と同じ分母
export async function measure($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  if (usage === undefined) return null
  const { context } = usage
  const window = context.window === 0 ? 0 : (context.breakdown?.rawMaxTokens ?? context.window)
  const tokens = context.tokens ?? context.breakdown?.totalTokens ?? 0
  return window === 0 ? null : Math.round((tokens / window) * 100)
}

// knownPrs は、PR があると分かったブランチ。一度あれば、次からは gh を呼ばない
async function repoOf($: EngineInterface, cwd: string, knownPrs: Set<string>): Promise<Repo | null> {
  if ((await git($, cwd, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return null
  // 互いに待たないので、まとめて取る
  const [status, ahead, alone, remotes, branch, head] = await Promise.all([
    git($, cwd, ['status', '--porcelain']),
    git($, cwd, ['rev-list', '--count', '@{upstream}..HEAD']),
    git($, cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes']),
    git($, cwd, ['remote']),
    git($, cwd, ['branch', '--show-current']),
    git($, cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
  ])
  const hasUpstream = ahead !== null
  const hasRemote = remotes !== null && remotes !== ''
  // upstream が無いブランチは、どのリモートにも無い commit を数える。リモートが無ければ push を勧めない
  const unpushed = hasUpstream ? Number(ahead) || 0 : hasRemote ? Number(alone) || 0 : 0
  const isPushed = hasUpstream && unpushed === 0
  const name = branch ?? ''
  const isDefault = name === '' || (head === null || head === '' ? DEFAULT_BRANCHES.includes(name) : head.replace(/^[^/]+\//, '') === name)
  let hasPr: boolean | null = null
  if (!isDefault && isPushed) {
    hasPr = knownPrs.has(name) ? true : await prOf($, cwd)
    if (hasPr === true) knownPrs.add(name)
  }
  return {
    dirty: (status ?? '').split('\n').filter(line => line.trim() !== '').length,
    unpushed,
    isPushed,
    isDefault,
    hasRemote,
    hasPr,
  }
}

export async function gather($: EngineInterface, knownPrs: Set<string>): Promise<Facts> {
  const cwd = await $.session.cwd()
  const [repo, percent] = await Promise.all([repoOf($, cwd, knownPrs), measure($)])
  return { repo, percent }
}
