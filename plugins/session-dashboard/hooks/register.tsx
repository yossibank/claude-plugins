import type { Register, Timer } from 'claude-code'

import { statusLine } from './band'
import { claudeCard, contextCard, limitCard, repoCard, sessionCard, unmeasuredCard } from './cards'
import { draw } from './cell'
import type { Seg } from './cell'
import { currentClaude, limitsOf, readClaude, updateLimits, updateModel } from './claude'
import { configure, PANE, SLACK_COLUMNS, TITLE, WATCH_MS } from './config'
import { currentRepo, readRepo } from './git'
import { report } from './report'
import { cacheLeft, currentSession, endTurn, restart, watchPane } from './session'
import { countCall, countTurn, currentStats } from './stats'
import { currentFill, measure } from './tokens'
import { GIT_TOOLS, QUIET_TOOLS } from './tool'

let watcher: Timer | undefined

export const register: Register = (on, options) => {
  const config = configure(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await restart($)
    await readClaude($)
    await readRepo($, true)
    await $.command.register({ name: 'session-dashboard', description: 'セッションの計器盤を右の pane に出す' })
    $.ui.open({ id: PANE, title: TITLE }).catch(error => report($, 'pane を開くこと', error))
    watcher?.cancel()
    watcher = $.clock.every(WATCH_MS, () => {
      watchPane($).catch(error => report($, 'pane の見張り', error))
    })
    return started
  })

  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    // /clear は新しいセッションとして続き、state が初めに戻るのに session.start が来ないので、ここで読み直す
    if (e.source === 'clear') {
      await restart($)
      await readClaude($)
      await readRepo($, true)
    }
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
    return stepped
  })

  on('tool.call', async ($, e, next) => {
    if (!QUIET_TOOLS.has(e.tool)) await countCall($)
    const done = await next(e)
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
    if (git !== null) cards.push(...repoCard(git, inner))
    if (info !== null && info.limits.length > 0) cards.push(...limitCard(info.limits, now, inner))

    if (measured === null || measured.window === 0) cards.push(...unmeasuredCard(inner))
    else cards.push(...contextCard(measured, await cacheLeft($, config), inner))

    const counted = await currentStats($)
    if (session.start !== null) {
      const spent = info?.usd == null ? null : info.usd - (counted.usdAtStart ?? 0)
      cards.push(...sessionCard(now - session.start, counted.turns, counted.calls, spent, inner))
    }

    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {cards.map((line, index) => draw(Text, line, String(index)))}
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await endTurn($)
      await countTurn($)
      await readRepo($, true)
    }
    await measure($)
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
