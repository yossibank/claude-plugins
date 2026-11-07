import type { Register, Timer } from 'claude-code'

import type { Phase } from '../types'

import { act, currentActivity, currentSecond, forget, nextCallNumber, phaseLine, running, tickWhileRunning } from './activity'
import { statusLine, workingLine } from './band'
import { claudeCard, contextCard, filesCard, limitCard, nextCard, nowCard, repoCard, sessionCard, tasksCard, unmeasuredCard } from './cards'
import { draw } from './cell'
import type { Seg } from './cell'
import { currentClaude, limitsOf, readClaude, updateLimits, updateModel } from './claude'
import { configure, PANE, SLACK_COLUMNS, TITLE, WATCH_MS } from './config'
import { currentFiles, touchFile } from './files'
import { currentRepo, readRepo } from './git'
import { nextOf } from './handoff'
import { cacheLeft, currentSession, endTurn, restart, watchPane } from './session'
import { countCall, countTurn, currentStats } from './stats'
import { currentTasks, trackTasks } from './tasks'
import { currentFill, measure } from './tokens'
import { describe, EDIT_TOOLS, firstLine, GIT_TOOLS, QUIET_TOOLS, textOf, toolName } from './tool'
import type { Args } from './tool'

let watcher: Timer | undefined

export const register: Register = (on, options) => {
  const config = configure(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await restart($, config)
    await forget($)
    await readClaude($)
    await readRepo($, true)
    await $.command.register({ name: 'session-dashboard', description: 'セッションの計器盤を右の pane に出す' })
    void $.ui.open({ id: PANE, title: TITLE })
    watcher?.cancel()
    watcher = $.clock.every(WATCH_MS, () => void watchPane($))
    return started
  })

  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    // /clear は新しいセッションとして続き、state が初めに戻るのに session.start が来ないので、ここで読み直す
    if (e.source === 'clear') {
      await restart($, config)
      await forget($)
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

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) await act($, { isWorking: true, tool: null, phase: null, startedAt: null })
    return started
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const stream = next(e)
    let text = ''
    let said: string | null = null
    let isThinking = false
    let stepped: Awaited<typeof stream.result> | undefined
    try {
      while (true) {
        const piece = await stream.next()
        if (piece.done === true) {
          stepped = piece.value
          break
        }
        const chunk = piece.value
        // 届いた途中の chunk で、応答の終わりを待たずに今の作業を書き換える
        if (chunk.kind === 'thinking' && isMain && !isThinking && running.size === 0) {
          isThinking = true
          await act($, { phase: 'thinking' })
        } else if (chunk.kind === 'text' && isMain) {
          text += chunk.text
          const line = firstLine(text)
          if (line !== null && line !== said) {
            said = line
            await act($, { said, ...(running.size === 0 && isThinking ? { phase: 'done' as Phase } : {}) })
          }
        } else if (chunk.kind === 'tool' && !QUIET_TOOLS.has(chunk.name) && running.size === 0) {
          await act($, { tool: toolName(chunk.name, e.agentId), phase: 'preparing', startedAt: null })
        }
        yield chunk
      }
    } finally {
      // 途中でやめた時も、内側の stream を閉じる
      if (stepped === undefined) await stream.return(undefined as never)
    }
    if (isMain) {
      const said = firstLine(stepped.answer)
      if (said !== null) await act($, { said })
      await updateModel($, e.model)
    }
    return stepped
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Args
    const isShown = !QUIET_TOOLS.has(e.tool)
    const id = e.tool_use_id ?? `call-${nextCallNumber()}`
    const tool = describe(args)
    if (isShown) {
      await countCall($)
      running.set(id, { tool, startedAt: await $.clock.now() })
      tickWhileRunning($, true)
      await act($, { tool, phase: 'running', startedAt: running.get(id)!.startedAt })
    }
    const done = await next(e).finally(async () => {
      if (!isShown || !running.delete(id)) return
      // まだ動いている呼び出しがあれば、最後に始まったものを出す
      const last = [...running.values()].pop()
      if (last !== undefined) await act($, { tool: last.tool, phase: 'running', startedAt: last.startedAt })
      else {
        tickWhileRunning($, false)
        await act($, { tool, phase: 'done' })
      }
    })
    if ('result' in done) {
      await trackTasks($, args, done.result)
      const path = textOf(args, 'file_path') ?? textOf(args, 'notebook_path')
      if (EDIT_TOOLS.has(e.tool) && path !== undefined) await touchFile($, path)
      if (QUIET_TOOLS.has(e.tool)) await act($, {})
      if (GIT_TOOLS.has(e.tool)) await readRepo($)
    }
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
    const doing = await currentActivity($)
    await currentSecond($)
    const step = phaseLine(doing, now)
    const measured = await currentFill($)
    const cards: Seg[][] = []

    if (info !== null) cards.push(...claudeCard(info, inner))
    if (git !== null) cards.push(...repoCard(git, inner))
    if (info !== null && info.limits.length > 0) cards.push(...limitCard(info.limits, now, inner))

    if (measured === null || measured.window === 0) cards.push(...unmeasuredCard(inner))
    else cards.push(...contextCard(measured, await cacheLeft($, config), inner))

    const next = await nextOf($, config)
    if (next.length > 0) cards.push(...nextCard(next, inner))
    cards.push(...nowCard(doing, step, inner))

    const counted = await currentStats($)
    if (session.start !== null) {
      const spent = info?.usd == null ? null : info.usd - (counted.usdAtStart ?? 0)
      cards.push(...sessionCard(now - session.start, counted.turns, counted.calls, spent, inner))
    }

    const list = (await currentTasks($)).items.filter(item => item.subject !== '')
    if (list.length > 0) cards.push(...tasksCard(list, inner))

    const touched = await currentFiles($)
    if (touched.length > 0) cards.push(...filesCard(touched, inner))

    return (
      <Box flexDirection="column" paddingX={1}>
        {cards.map(line => draw(Text, line))}
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await endTurn($)
      await countTurn($)
      running.clear()
      tickWhileRunning($, false)
      await act($, { isWorking: false, tool: null, phase: null, startedAt: null })
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
    await currentSecond($)
    const now = await $.clock.now()
    const left = await cacheLeft($, config)
    const doing = await currentActivity($)
    const step = phaseLine(doing, now)
    const info = await currentClaude($)
    const git = await currentRepo($)
    const width = Math.max(1, e.props.bodyColumns - SLACK_COLUMNS)
    const working = workingLine(doing, step, width)

    return (
      <Box flexDirection="column">
        {working.length === 0 ? null : draw(Text, working)}
        {draw(Text, statusLine(info, git, measured, left, width))}
        {beneath}
      </Box>
    )
  })
}
