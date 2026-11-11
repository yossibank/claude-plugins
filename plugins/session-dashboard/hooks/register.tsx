import type { EngineInterface, Register, Timer } from 'claude-code'

import { statusLine } from './band'
import { claudeCard, contextCard, limitCard, repoCard, sessionCard, tokensCard, unmeasuredCard } from './cards'
import { draw } from './cell'
import type { Seg } from './cell'
import { hasSessionChanged } from './clear'
import { currentClaude, limitsOf, readClaude, updateLimits, updateModel } from './claude'
import { configure, PANE, SLACK_COLUMNS, TITLE, WATCH_MS } from './config'
import { currentRepo, readRepo } from './git'
import { report } from './report'
import { cacheLeft, currentSession, endTurn, restart, watchPane } from './session'
import { countCall, countError, countTurn, currentStats } from './stats'
import { addSpent, currentFill, currentHistory, currentSpent, measure, recordFill } from './tokens'
import { GIT_TOOLS, QUIET_TOOLS, toolName } from './tool'

let watcher: Timer | undefined

// セッションの初めの値に戻し、Claude とリポジトリを読み直す
const renew = async ($: EngineInterface) => {
  await restart($)
  await readClaude($)
  await readRepo($, true)
}

// /clear は新しいセッションとして続き、state が初めに戻るのに session.start が来ない
// classic.SessionStart は先に動くプラグインに止められることがあるので、ターンの始めと見張りでも id の変わり目を見る
// リセットの途中に来た呼び出しも、それが終わるまで待ってから進む。待たないと、ターンの始めに書いた値をリセットが消す
let resetting: Promise<void> = Promise.resolve()

const followSession = async ($: EngineInterface) => {
  if (await hasSessionChanged($)) resetting = renew($).catch(error => report($, 'セッションの切り替え', error))
  await resetting
}

export const register: Register = (on, options) => {
  const config = configure(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await renew($)
    await hasSessionChanged($)
    await $.command.register({ name: 'session-dashboard', description: 'セッションの計器盤を右の pane に出す' })
    $.ui.open({ id: PANE, title: TITLE }).catch(error => report($, 'pane を開くこと', error))
    watcher?.cancel()
    watcher = $.clock.every(WATCH_MS, () => {
      followSession($)
        .then(() => watchPane($))
        .catch(error => report($, 'pane の見張り', error))
    })
    return started
  })

  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    await followSession($)
    return started
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) await followSession($)
    return started
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.changed.includes('rateLimits') || e.changed.includes('cost')) {
      const limits = limitsOf(e.rateLimits)
      const usd = e.cost?.usd ?? null
      await updateLimits($, limits, usd)
    }
    return measured
  })

  on('turn.step', async function* ($, e, next) {
    const stepped = yield* next(e)
    if (e.agentId === undefined) await updateModel($, e.model)
    // トークンは、サブエージェントの分もセッションの合計に足す
    if (stepped.usage !== null) await addSpent($, stepped.usage)
    return stepped
  })

  on('tool.call', async ($, e, next) => {
    const isCounted = !QUIET_TOOLS.has(e.tool)
    if (isCounted) await countCall($, toolName(e.tool))
    const done = await next(e)
    // 断られた・エラーを返した呼び出しを、失敗として数える
    if (isCounted && (done.deny !== undefined || done.isError === true)) await countError($)
    if ('result' in done && GIT_TOOLS.has(e.tool)) await readRepo($)
    return done
  })

  on('command.run', { command: 'session-dashboard' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await watchPane($)
    return { text: 'セッションの計器盤を右の pane に出しました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const inner = Math.max(1, e.props.bodyColumns - 2)
    const now = await $.clock.now()
    const session = await currentSession($)
    const info = await currentClaude($)
    const git = await currentRepo($)
    const measured = await currentFill($)
    const cards: Seg[][] = []

    if (info !== null) cards.push(...claudeCard(info, inner))
    if (git !== null) cards.push(...repoCard(git, now, inner))
    if (info !== null && info.limits.length > 0) cards.push(...limitCard(info.limits, now, inner))

    if (measured === null || measured.window === 0) cards.push(...unmeasuredCard(inner))
    else cards.push(...contextCard(measured, await cacheLeft($, config), await currentHistory($), inner))

    cards.push(...tokensCard(await currentSpent($), inner))

    const counted = await currentStats($)
    if (session.start !== null) {
      const spent = info?.usd == null ? null : info.usd - (counted.usdAtStart ?? 0)
      cards.push(...sessionCard(now - session.start, counted, spent, inner))
    }

    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {cards.map((line, index) => draw(Text, line, String(index)))}
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // サブエージェントのターンは、メインの文脈を変えないので測り直さない
    if (e.agentId === undefined) {
      await endTurn($)
      await countTurn($, e.durationMs)
      await readRepo($, true)
      await measure($)
      await recordFill($)
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const measured = await currentFill($)
    if (e.props.hasSurvey || measured === null || measured.window === 0 || (await currentSession($)).isPaneShown) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const beneath = await next(e)
    const left = await cacheLeft($, config)
    const info = await currentClaude($)
    const git = await currentRepo($)
    const width = Math.max(1, e.props.bodyColumns - SLACK_COLUMNS)

    return (
      <Box flexDirection="column">
        {draw(Text, statusLine(info, git, measured, left, width), 'status')}
        {beneath}
      </Box>
    )
  })
}
