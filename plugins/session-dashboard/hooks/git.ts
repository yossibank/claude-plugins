import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Repo } from '../types'

const repo = atom({ plugin: 'session-dashboard', key: 'repo' } as const, null)

const GIT_MS = 2000

// origin の URL から owner/repo を取る
const repoName = (remote: string | null, root: string) => {
  const found = remote === null ? null : /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote)
  return found?.[1] ?? root.replace(/\/$/, '').split('/').pop() ?? ''
}

let gitAt = 0

export async function currentRepo($: EngineInterface) {
  return read($, repo)
}

export async function readRepo($: EngineInterface, isForced = false) {
  const now = await $.clock.now()
  if (!isForced && now - gitAt < GIT_MS) return
  gitAt = now
  const found = await $.session.repo().catch(() => null)
  if (found === null) {
    await update($, repo, () => null)
    return
  }
  const cwd = await $.session.cwd()
  const git = (args: string[]) =>
    $.process
      .run(['git', ...args], { cwd })
      .then(result => (result.exitCode === 0 ? result.stdout : ''))
      .catch(() => '')
  const [branch, numstat, status] = await Promise.all([git(['branch', '--show-current']), git(['diff', 'HEAD', '--numstat']), git(['status', '--porcelain'])])
  const sum = (column: number) =>
    numstat
      .split('\n')
      .filter(line => line !== '')
      .map(line => Number(line.split('\t')[column]))
      .filter(count => Number.isFinite(count))
      .reduce((total, count) => total + count, 0)
  const next: Repo = {
    name: repoName(found.remote, found.root),
    branch: branch.trim(),
    added: sum(0),
    deleted: sum(1),
    untracked: status.split('\n').filter(line => line.startsWith('??')).length,
  }
  await update($, repo, () => next)
}
