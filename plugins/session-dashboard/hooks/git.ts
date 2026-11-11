import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Commit, Repo } from '../types'

const repo = atom({ plugin: 'session-dashboard', key: 'repo' } as const, null)

const GIT_MS = 2000

// origin の URL から owner/repo を取る
const repoName = (remote: string | null, root: string) => {
  const found = remote === null ? null : /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote)
  return found?.[1] ?? root.replace(/\/$/, '').split('/').pop() ?? ''
}

// rev-list --left-right --count の「behind ahead」。upstream が無ければ undefined
const syncOf = (counts: string) => {
  const found = /^(\d+)\s+(\d+)$/.exec(counts.trim())
  return found === null ? undefined : { behind: Number(found[1]), ahead: Number(found[2]) }
}

// log の「秒の時刻 タブ 題」。commit が無ければ undefined
const commitOf = (line: string): Commit | undefined => {
  const [at, ...subject] = line.trim().split('\t')
  return subject.length === 0 || !/^\d+$/.test(at ?? '') ? undefined : { at: Number(at), subject: subject.join('\t') }
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
  const [branch, numstat, status, counts, log] = await Promise.all([
    git(['branch', '--show-current']),
    git(['diff', 'HEAD', '--numstat']),
    git(['status', '--porcelain']),
    git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
    git(['log', '-1', '--format=%ct%x09%s']),
  ])
  const sync = syncOf(counts)
  const last = commitOf(log)
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
    ...(sync === undefined ? {} : sync),
    ...(last === undefined ? {} : { last }),
  }
  await update($, repo, () => next)
}
