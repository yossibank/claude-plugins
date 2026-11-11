import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Pr } from '../types'

import { FIELDS, newsOf, parsePr, repoOf, REVIEW, THREADS, unresolvedOf } from './pr'

// 設定が空か壊れている時の値。plugin.json の userConfig の default と同じにしておく
const DEFAULTS = { pollSeconds: 60 }
const CREATE = new RegExp(['\\bgh', 'pr', 'create\\b'].join('\\s+'))
// PR の状態が変わりうるコマンド。終わったら取り直す
const TOUCHES = /\bgit\s+(push|switch|checkout)\b|\bgh\s+pr\s+(merge|ready|close|reopen|edit|review|checkout)\b/
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g
const NARROW_COLUMNS = 128
const GH_TIMEOUT_MS = 10_000
const SHOWN_FAILED = 3

// shape の番号は、保存する値の形の版。形を変えた時に上げると、前の版の値は読まれず初めの値に戻る
const pr = atom({ plugin: 'git-pr-browser', key: 'pr' } as const, null, { shape: 'pr-1' })

let columns: number | undefined
let poller: Timer | undefined
// 走っている取り直しと、その間に来た頼み。頼みは捨てずに、終わった後にもう一度走らせる
let running: Promise<void> | undefined
let queued: { target?: string } | undefined

const pollMs = (options: Readonly<Record<string, unknown>>) => {
  const seconds = Number(options.pollSeconds)
  return (Number.isFinite(seconds) && seconds >= 10 ? seconds : DEFAULTS.pollSeconds) * 1000
}

// gh を走らせて、成功した時だけ出力を返す。gh が無い・時間切れ・失敗は null
const gh = ($: EngineInterface, cwd: string, args: string[]) =>
  $.process
    .run(['gh', ...args], { cwd, timeoutMs: GH_TIMEOUT_MS })
    .then(ran => (ran.exitCode === 0 ? ran.stdout : null))
    .catch(() => null)

// 取り直す。走っている間に来た頼みは、終わった後に走らせ、その終わりを待つ。target のある頼みを残す
function refresh($: EngineInterface, wait: number, target?: string): Promise<void> {
  if (running !== undefined) {
    queued = { target: target ?? queued?.target }
    return running.then(() => running)
  }
  running = fetchPr($, wait, target).finally(() => {
    running = undefined
    const again = queued
    queued = undefined
    if (again !== undefined) later($, wait, again.target)
  })
  return running
}

// PR の状態を取り直す。target が無ければ、今のブランチの PR を探す。見つからなければ帯を消し、取り直しも止める
async function fetchPr($: EngineInterface, wait: number, target?: string) {
  const cwd = await $.session.cwd()
  const viewed = await gh($, cwd, ['pr', 'view', ...(target === undefined ? [] : [target]), '--json', FIELDS])
  const found = viewed === null ? null : parsePr(viewed)
  const old = await read($, pr)
  if (found === null) {
    // 作った直後の URL を見失った時は、前の値を残す
    if (target === undefined) {
      await update($, pr, () => null)
      poller?.cancel()
      poller = undefined
    }
    return
  }
  const repo = repoOf(found.url)
  const threads = repo === null ? null : await gh($, cwd, ['api', 'graphql', '-f', `query=${THREADS}`, '-F', `owner=${repo.owner}`, '-F', `repo=${repo.repo}`, '-F', `number=${found.number}`])
  const now: Pr = { ...found, unresolved: threads === null ? null : unresolvedOf(threads) }
  await update($, pr, () => now)
  for (const line of newsOf(old, now)) $.ui.toast(line.slice(0, 120))
  // CI が終わるまでは、決めた間隔で取り直す
  const isWaiting = now.state === 'OPEN' && now.checks.pending > 0
  if (isWaiting && poller === undefined) poller = $.clock.every(wait, () => later($, wait))
  if (!isWaiting) {
    poller?.cancel()
    poller = undefined
  }
}

const report = ($: EngineInterface) => (error: unknown) => {
  $.ui.toast(`git-pr-browser: PR の状態を取れませんでした: ${error instanceof Error ? error.message : String(error)}`.slice(0, 120))
}

// $ を受け取る関数は、ファイルの一番上に置く。待たずに取り直し、失敗はトーストで知らせる
const later = ($: EngineInterface, wait: number, target?: string) => void refresh($, wait, target).catch(report($))

const open = ($: EngineInterface, url: string) => {
  const split = columns !== undefined && columns < NARROW_COLUMNS ? 'down' : 'right'
  void $.process
    .run(['terminal-browser', 'open', url, '--split', split])
    .then(({ exitCode, stderr }) => {
      if (exitCode !== 0) $.ui.toast(`git-pr-browser: 開けませんでした: ${stderr.trim().slice(0, 80)}`)
    })
    .catch(() => $.ui.toast('git-pr-browser: terminal-browser が見つかりません'))
}

export const register: Register = (on, options) => {
  const wait = pollMs(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'pr', description: '今のブランチの PR の状態を取り直し、ページを開く' })
    poller?.cancel()
    poller = undefined
    later($, wait)
    return started
  })

  on('command.run', { command: 'pr' }, async $ => {
    await refresh($, wait)
    const now = await read($, pr)
    if (now === null) return { text: '今のブランチの PR は見つかりませんでした。' }
    open($, now.url)
    return { text: `PR #${now.number} を開きました。` }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    if (CREATE.test(e.command)) {
      const url = ran.text?.match(PR_URL)?.at(-1)
      if (url !== undefined) {
        open($, url)
        later($, wait, url)
      }
    } else if (TOUCHES.test(e.command)) later($, wait)

    return ran
  })

  // PR を追っている間は、メインのターンの終わりにも取り直す
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && (await read($, pr)) !== null) later($, wait)
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' && e.viewport !== undefined) columns = e.viewport.columns
    const now = await read($, pr)
    if (now === null || now.state !== 'OPEN' || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const beneath = await next(e)
    const { checks } = now
    const total = checks.passed + checks.failed + checks.pending
    const review = REVIEW[now.review]

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold>🔀 #{now.number}</Text>
          {now.isDraft && <Text dimColor> 下書き</Text>}
          <Text dimColor> · CI </Text>
          {total === 0 ? (
            <Text dimColor>なし</Text>
          ) : (
            <Text>
              <Text color="success">✔ {checks.passed}</Text>
              <Text color={checks.failed > 0 ? 'error' : undefined} dimColor={checks.failed === 0}> ✖ {checks.failed}</Text>
              {checks.pending > 0 && <Text color="warning"> ◌ {checks.pending}</Text>}
            </Text>
          )}
          {review !== undefined && (
            <Text>
              <Text dimColor> · </Text>
              <Text color={review.color}>{review.word}</Text>
            </Text>
          )}
          {now.unresolved !== null && now.unresolved > 0 && <Text color="warning"> · 未解決 {now.unresolved}</Text>}
          <Text dimColor> · {now.title}</Text>
        </Text>
        {checks.failedNames.length > 0 && (
          <Text color="error" wrap="truncate-end">
            {'   '}✖ {checks.failedNames.slice(0, SHOWN_FAILED).join('、')}
            {checks.failedNames.length > SHOWN_FAILED && <Text dimColor> ほか {checks.failedNames.length - SHOWN_FAILED} 件</Text>}
          </Text>
        )}
        {beneath}
      </Box>
    )
  })
}
