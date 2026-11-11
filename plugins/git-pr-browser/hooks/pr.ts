import type { Checks, Pr } from '../types'

// gh pr view の --json に渡す欄
export const FIELDS = 'number,title,url,state,isDraft,reviewDecision,statusCheckRollup'

// 未解決のレビューのスレッドを数える GraphQL
export const THREADS = 'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}'

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const PENDING = new Set(['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'])

type Row = Record<string, unknown>

const text = (row: Row, key: string) => (typeof row[key] === 'string' ? (row[key] as string) : '')

// CI の 1 件ごとの結果を、通った・落ちた・まだ、に分ける。CheckRun は status と conclusion、StatusContext は state を持つ
export const checksOf = (rollup: unknown): Checks => {
  const checks: Checks = { passed: 0, failed: 0, pending: 0, failedNames: [] }
  for (const row of Array.isArray(rollup) ? (rollup as Row[]) : []) {
    const name = text(row, 'name') || text(row, 'context')
    const status = text(row, 'status')
    const result = text(row, 'conclusion') || text(row, 'state')
    if ((status !== '' && status !== 'COMPLETED') || PENDING.has(result) || result === '') checks.pending += 1
    else if (PASSED.has(result)) checks.passed += 1
    else {
      checks.failed += 1
      if (name !== '' && !checks.failedNames.includes(name)) checks.failedNames.push(name)
    }
  }
  return checks
}

// gh pr view の JSON を読む。読めなければ null
export const parsePr = (json: string): Omit<Pr, 'unresolved'> | null => {
  try {
    const row = JSON.parse(json) as Row
    if (typeof row.number !== 'number' || text(row, 'url') === '') return null
    return {
      number: row.number,
      title: text(row, 'title'),
      url: text(row, 'url'),
      state: text(row, 'state') || 'OPEN',
      isDraft: row.isDraft === true,
      review: text(row, 'reviewDecision'),
      checks: checksOf(row.statusCheckRollup),
    }
  } catch {
    return null
  }
}

// GraphQL の答えから、未解決のスレッドの数を取る。読めなければ null
export const unresolvedOf = (json: string) => {
  try {
    const nodes = (JSON.parse(json) as { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: { isResolved?: boolean }[] } } } } }).data?.repository?.pullRequest?.reviewThreads?.nodes
    return Array.isArray(nodes) ? nodes.filter(node => node.isResolved === false).length : null
  } catch {
    return null
  }
}

// PR の URL から、持ち主とリポジトリの名前を取る
export const repoOf = (url: string) => {
  const hit = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/\d+/)
  return hit === null ? null : { owner: hit[1] ?? '', repo: hit[2] ?? '' }
}

export const REVIEW: Record<string, { word: string; color: string }> = {
  APPROVED: { word: '承認済み', color: 'success' },
  CHANGES_REQUESTED: { word: '変更の依頼', color: 'error' },
  REVIEW_REQUIRED: { word: 'レビュー待ち', color: 'warning' },
}

// 前の状態から変わった所を、知らせる文にする。初めて取った時は何も知らせない
export const newsOf = (old: Pr | null, now: Pr) => {
  if (old === null || old.number !== now.number) return []
  const news: string[] = []
  if (old.state === 'OPEN' && now.state === 'MERGED') news.push(`✔ PR #${now.number} がマージされました`)
  if (old.state === 'OPEN' && now.state === 'CLOSED') news.push(`PR #${now.number} が閉じられました`)
  if (now.state !== 'OPEN') return news
  if (old.checks.failed === 0 && now.checks.failed > 0) news.push(`✖ PR #${now.number} の CI が落ちました: ${now.checks.failedNames.slice(0, 3).join('、')}`)
  const wasDone = old.checks.pending === 0 && old.checks.failed === 0
  if (!wasDone && now.checks.pending === 0 && now.checks.failed === 0 && now.checks.passed > 0) news.push(`✔ PR #${now.number} の CI が通りました（${now.checks.passed} 件）`)
  if (old.review !== now.review && (now.review === 'APPROVED' || now.review === 'CHANGES_REQUESTED')) news.push(`PR #${now.number} のレビュー: ${REVIEW[now.review]?.word ?? now.review}`)
  if (old.unresolved !== null && now.unresolved !== null && now.unresolved > old.unresolved) news.push(`PR #${now.number} に未解決のコメントが増えました（${now.unresolved} 件）`)
  return news
}
