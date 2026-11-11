import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Phase } from '../types'

import { act, animate, clearCalls, currentActivity, currentFrame, currentRunning, currentSecond, endCall, forget, phaseLine, refreshTicker, startCall } from './activity'
import { addWorkerUsage, currentWorkers, dropFinished, endAgentCall, finishWorker, reconcileWorkers, restartWorker, spawnWorker, startAgentCall } from './agents'
import { workingLine } from './band'
import { draw } from './cell'
import type { Seg } from './cell'
import { hasSessionChanged } from './clear'
import { PANE, SLACK_COLUMNS, TITLE, WATCH_MS } from './config'
import { currentPaneShown, watchPane } from './pane'
import { TN } from './palette'
import { report } from './report'
import { SPRITE_COLUMNS, SPRITE_ROWS, spriteCells } from './sprite'
import { currentTasks, trackTasks } from './tasks'
import { describe, firstLine, firstLineOf, QUIET_TOOLS, toolName } from './tool'
import type { Args } from './tool'
import { addMainUsage, currentTurn, endTurn, spentOf, startTurn } from './usage'
import { mainCard, sectionLine, tasksLines, workerCard } from './view'
import type { Card } from './view'

let watcher: Timer | undefined

// アイコンと文字の間の空白
const GUTTER_COLUMNS = 1

// /clear は新しいセッションとして続き、state が初めに戻るのに session.start が来ない
// classic.SessionStart は先に動くプラグインに止められることがあるので、ターンの始めと見張りでも id の変わり目を見る
const followSession = async ($: EngineInterface) => {
  if (await hasSessionChanged($)) await forget($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await forget($)
    await hasSessionChanged($)
    await $.command.register({ name: 'agent-progress', description: 'メインとサブエージェントの作業を右の pane に出す' })
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
    if (e.agentId === undefined) {
      await followSession($)
      await dropFinished($)
      await startTurn($)
      await act($, { isWorking: true, tool: null, phase: null, startedAt: null })
    } else await restartWorker($, e.agentId)
    await refreshTicker($)
    return started
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId !== undefined) {
      await spawnWorker($, started.agentId, e.subagentType, e.description)
      await refreshTicker($)
    }
    return started
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const stream = next(e)
    let text = ''
    let said: string | null = null
    // 最初の行が閉じたら、届いた全文を読み直さない
    let isSaid = false
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
        if (chunk.kind === 'thinking' && isMain && !isThinking && (await currentRunning($)).length === 0) {
          isThinking = true
          await act($, { phase: 'thinking' })
        } else if (chunk.kind === 'text' && isMain && !isSaid) {
          text += chunk.text
          const { line, isClosed } = firstLineOf(text)
          isSaid = isClosed
          if (line !== null && line !== said) {
            said = line
            await act($, { said, ...((await currentRunning($)).length === 0 && isThinking ? { phase: 'done' as Phase } : {}) })
          }
        } else if (chunk.kind === 'tool' && isMain && !QUIET_TOOLS.has(chunk.name) && (await currentRunning($)).length === 0) {
          await act($, { tool: toolName(chunk.name), phase: 'preparing', startedAt: null })
        }
        yield chunk
      }
    } finally {
      // 途中でやめた時も、内側の stream を閉じる
      if (stepped === undefined) await stream.return(undefined as never)
    }
    const used = stepped.usage === null ? { input: 0, output: 0, model: e.model } : spentOf(stepped.usage)
    if (isMain) {
      const said = firstLine(stepped.answer)
      if (said !== null) await act($, { said })
      await addMainUsage($, used)
    } else if (e.agentId !== undefined) await addWorkerUsage($, e.agentId, used)
    return stepped
  })

  let calls = 0

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Args
    const isShown = !QUIET_TOOLS.has(e.tool)
    calls += 1
    const id = e.tool_use_id ?? `call-${calls}`
    const call = { id, name: toolName(e.tool), tool: describe(args), startedAt: await $.clock.now() }
    if (isShown) {
      if (e.agentId === undefined) {
        await startCall($, call)
        await act($, { tool: call.tool, phase: 'running', startedAt: call.startedAt })
      } else await startAgentCall($, e.agentId, call)
      await refreshTicker($)
    }
    // 表示の後始末が失敗しても、ツールの結果はそのまま返す
    const settle = async () => {
      if (!isShown) return
      if (e.agentId !== undefined) {
        await endAgentCall($, e.agentId, id)
        await refreshTicker($)
        return
      }
      const left = await endCall($, id)
      if (left === null) return
      // まだ動いている呼び出しがあれば、最後に始まったものを出す
      const last = left.at(-1)
      if (last !== undefined) await act($, { tool: last.tool, phase: 'running', startedAt: last.startedAt })
      else await act($, { tool: call.tool, phase: 'done' })
      await refreshTicker($)
    }
    const done = await next(e).finally(() => settle().catch(error => report($, 'ツールの後始末', error)))
    // 作業の一覧は、メインのものだけを追う
    if ('result' in done && e.agentId === undefined) {
      await trackTasks($, args, done.result)
      if (QUIET_TOOLS.has(e.tool)) await act($, {})
    }
    return done
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await clearCalls($)
      await reconcileWorkers($)
      await endTurn($)
      await act($, { isWorking: false, tool: null, phase: null, startedAt: null })
    } else await finishWorker($, e.agentId)
    await refreshTicker($)
    return done
  })

  on('command.run', { command: 'agent-progress' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await watchPane($)
    return { text: 'メインとサブエージェントの作業を右の pane に出しました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    // Raster は端末の面にだけある。無い面では文字だけを出す
    const Raster = 'Raster' in elements ? elements.Raster : undefined
    const inner = Math.max(1, e.props.bodyColumns - 2)
    const hasIcon = Raster !== undefined && inner > SPRITE_COLUMNS + GUTTER_COLUMNS + 8
    const width = hasIcon ? inner - SPRITE_COLUMNS - GUTTER_COLUMNS : inner
    const now = await $.clock.now()
    await currentSecond($)
    const doing = await currentActivity($)
    const workers = await currentWorkers($)
    const running = workers.filter(worker => worker.status === 'running')
    const ended = workers.filter(worker => worker.status !== 'running')
    const frame = currentFrame()

    const cardOf = (card: Card) => (
      <Box key={card.key} flexDirection="row" marginBottom={1}>
        {hasIcon ? <Raster key={card.key} columns={SPRITE_COLUMNS} rows={SPRITE_ROWS} cells={spriteCells(card.isAnimated ? frame : 0, card.color)} /> : null}
        <Box flexDirection="column" {...(hasIcon ? { marginLeft: GUTTER_COLUMNS } : {})}>
          {card.lines.map((line, index) => draw(Text, line, String(index)))}
        </Box>
      </Box>
    )

    const main = mainCard(doing, phaseLine(doing, now), await currentRunning($), await currentTurn($), now, width)
    const crew = [...running, ...ended].map(worker => workerCard(worker, now, width))
    animate(new Map([main, ...crew].filter(card => hasIcon && card.isAnimated).map(card => [card.key, card.color])))

    const list = (await currentTasks($)).items.filter(item => item.subject !== '')
    // 見出しの下に 1 行空けて、カードと分ける
    const section = (label: string, count: number, color: string) => (
      <Box key={label} marginBottom={1}>
        {draw(Text, sectionLine(label, count, color, inner), label)}
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {cardOf(main)}
        {running.length > 0 ? section('Running', running.length, TN.yellow) : null}
        {crew.slice(0, running.length).map(cardOf)}
        {ended.length > 0 ? section('Finished', ended.length, TN.green) : null}
        {crew.slice(running.length).map(cardOf)}
        {list.length > 0 ? tasksLines(list, inner).map((line: Seg[], index: number) => draw(Text, line, `task-${index}`)) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await currentPaneShown($))) return next(e)
    const doing = await currentActivity($)
    if (!doing.isWorking) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const beneath = await next(e)
    await currentSecond($)
    const now = await $.clock.now()
    const line = workingLine(doing, phaseLine(doing, now), await currentWorkers($), Math.max(1, e.props.bodyColumns - SLACK_COLUMNS))
    if (line.length === 0) return beneath
    return (
      <Box flexDirection="column">
        {draw(Text, line, 'working')}
        {beneath}
      </Box>
    )
  })
}
