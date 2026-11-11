import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Phase, TurnEnd } from '../types'

import { act, animate, clearCalls, currentActivity, currentFrame, currentRunning, currentSecond, endCall, forget, phaseLine, refreshTicker, startCall } from './activity'
import { addWorkerAsked, addWorkerUsage, currentWorkers, dropFinished, endAgentCall, finishWorker, reconcileWorkers, restartWorker, sayWorker, spawnWorker, startAgentCall } from './agents'
import { closeAsk, noteAsk, noteRan, openAsk } from './asks'
import { workingLine } from './band'
import { draw } from './cell'
import type { Seg } from './cell'
import { hasSessionChanged } from './clear'
import { PANE, SLACK_COLUMNS, TITLE, WATCH_MS } from './config'
import { currentPaneShown, watchPane } from './pane'
import { TN } from './palette'
import { report } from './report'
import { SPRITE_COLUMNS, SPRITE_ROWS, spriteCells, stillCells } from './sprite'
import { countCall, currentTally, recordCall, resetTally } from './tally'
import { currentTasks, trackTasks } from './tasks'
import { describe, firstLine, firstLineOf, QUIET_TOOLS, toolName } from './tool'
import type { Args } from './tool'
import { addMainAsked, addMainUsage, currentTurn, endTurn, spentOf, startTurn } from './usage'
import { mainCard, sectionLine, tasksLines, totalLines, workerCard } from './view'
import type { Card } from './view'

let watcher: Timer | undefined

// アイコンと文字の間の空白
const GUTTER_COLUMNS = 1
// カードの枠と、その内側の空白が取る幅
const FRAME_COLUMNS = 4
// これより狭い pane では、枠を付けずに文字の幅を残す
const FRAMED_FROM_COLUMNS = 40

// /clear は新しいセッションとして続き、state が初めに戻るのに session.start が来ない
// classic.SessionStart は先に動くプラグインに止められることがあるので、ターンの始めと見張りでも id の変わり目を見る
// リセットの途中に来た呼び出しも、それが終わるまで待ってから進む。待たないと、ターンの始めに書いた値をリセットが消す
let resetting: Promise<void> = Promise.resolve()

const followSession = async ($: EngineInterface) => {
  if (await hasSessionChanged($)) resetting = forget($).catch(error => report($, 'セッションの切り替え', error))
  await resetting
}

// ツールが終わった時刻は、下の hook が動く前に読む。duration_ms は、許可の確認と hook の時間を除いた、ツールが動いた時間
const ran = async ($: EngineInterface, e: { tool_use_id: string; duration_ms?: number }) => {
  try {
    noteRan(e.tool_use_id, e.duration_ms, await $.clock.now())
  } catch (error) {
    report($, 'ツールが動いた時間を読むこと', error)
  }
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
      await resetTally($)
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
        } else if (chunk.kind === 'text' && !isSaid) {
          text += chunk.text
          const { line, isClosed } = firstLineOf(text)
          isSaid = isClosed
          if (line !== null && line !== said) {
            said = line
            if (isMain) await act($, { said, ...((await currentRunning($)).length === 0 && isThinking ? { phase: 'done' as Phase } : {}) })
            else if (e.agentId !== undefined) await sayWorker($, e.agentId, said)
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
    const closed = firstLine(stepped.answer)
    if (isMain) {
      if (closed !== null) await act($, { said: closed })
      await addMainUsage($, used)
    } else if (e.agentId !== undefined) {
      if (closed !== null && closed !== said) await sayWorker($, e.agentId, closed)
      await addWorkerUsage($, e.agentId, used)
    }
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
        await countCall($, call.name)
        await act($, { tool: call.tool, phase: 'running', startedAt: call.startedAt })
      } else await startAgentCall($, e.agentId, call)
      await refreshTicker($)
    }
    // 断られた・エラーを返した・投げた呼び出しは、失敗として履歴に残す
    let isError = true
    // 表示の後始末が失敗しても、ツールの結果はそのまま返す
    const settle = async () => {
      if (!isShown) return
      const ended = { tool: call.tool, ms: (await $.clock.now()) - call.startedAt, isError }
      if (e.agentId !== undefined) {
        await endAgentCall($, e.agentId, id, ended)
        await refreshTicker($)
        return
      }
      const left = await endCall($, id)
      if (left === null) return
      await recordCall($, ended)
      // まだ動いている呼び出しがあれば、最後に始まったものを出す
      const last = left.at(-1)
      if (last !== undefined) await act($, { tool: last.tool, phase: 'running', startedAt: last.startedAt })
      else await act($, { tool: call.tool, phase: 'done' })
      await refreshTicker($)
    }
    // 許可の確認を待った時間を、メインのターンかサブエージェントに足す
    const settleAsk = async () => {
      if (e.tool_use_id === undefined) return
      const asked = closeAsk(e.tool_use_id, isError, await $.clock.now())
      if (asked <= 0) return
      if (e.agentId === undefined) await addMainAsked($, asked)
      else await addWorkerAsked($, e.agentId, asked)
    }
    const done = await next(e)
      .then(answered => {
        isError = answered.deny !== undefined || answered.isError === true
        return answered
      })
      .finally(() =>
        settleAsk()
          .catch(error => report($, '許可待ちの集計', error))
          .then(settle)
          .catch(error => report($, 'ツールの後始末', error)),
      )
    // 作業の一覧は、メインのものだけを追う
    if ('result' in done && e.agentId === undefined) {
      await trackTasks($, args, done.result)
      if (QUIET_TOOLS.has(e.tool)) await act($, {})
    }
    return done
  })

  // 許可の確認は見るだけにする。答えは next(e) のものをそのまま返し、見るのに失敗しても確認を止めない
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    try {
      if (verdict.decision === 'ask' && e.tool_use_id !== undefined) noteAsk(e.tool_use_id, e.tool, e.agentId, e.input)
    } catch (error) {
      report($, '許可の確認を覚えること', error)
    }
    return verdict
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    const answered = await next(e)
    try {
      openAsk(e.tool_name, e.agent_id, e.tool_input, await $.clock.now())
    } catch (error) {
      report($, '許可の確認の始まりを書くこと', error)
    }
    return answered
  })

  on('classic.PostToolUse', async ($, e, next) => {
    await ran($, e)
    return next(e)
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await ran($, e)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await clearCalls($)
      await reconcileWorkers($)
      const end: TurnEnd = e.isAborted || e.reason === 'aborted' ? 'aborted' : e.reason === 'error' || e.reason === 'refusal' ? 'error' : 'answer'
      await endTurn($, end)
      await act($, { isWorking: false, tool: null, phase: null, startedAt: null })
    } else await finishWorker($, e.agentId, firstLine(e.answer))
    await refreshTicker($)
    return done
  })

  // メインの会話を要約している間は、今の作業の行にそう出す。先回りの要約（precompute）は裏で動くので出さない
  on('session.compact', async ($, e, next) => {
    const isShown = e.agentId === undefined && (e.trigger === 'manual' || e.trigger === 'auto')
    if (isShown) await act($, { phase: 'compacting' })
    try {
      return await next(e)
    } finally {
      if (isShown) await act($, { phase: null }).catch(error => report($, '要約の後始末', error))
    }
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
    const hasFrame = inner >= FRAMED_FROM_COLUMNS
    const room = hasFrame ? inner - FRAME_COLUMNS : inner
    const hasIcon = Raster !== undefined && room > SPRITE_COLUMNS + GUTTER_COLUMNS + 8
    const width = hasIcon ? room - SPRITE_COLUMNS - GUTTER_COLUMNS : room
    const now = await $.clock.now()
    await currentSecond($)
    const doing = await currentActivity($)
    const workers = await currentWorkers($)
    const running = workers.filter(worker => worker.status === 'running')
    const ended = workers.filter(worker => worker.status !== 'running')
    const frame = currentFrame()

    const cardOf = (card: Card) => (
      <Box key={card.key} flexDirection="row" {...(hasFrame ? { borderStyle: 'round', borderColor: card.color, borderDimColor: !card.isAnimated, paddingX: 1 } : { marginBottom: 1 })}>
        {hasIcon ? <Raster key={card.key} columns={SPRITE_COLUMNS} rows={SPRITE_ROWS} cells={card.isAnimated ? spriteCells(frame, card.color, card.action) : stillCells(card.color, card.action)} /> : null}
        <Box flexDirection="column" {...(hasIcon ? { marginLeft: GUTTER_COLUMNS } : {})}>
          {card.lines.map((line, index) => draw(Text, line, String(index)))}
        </Box>
      </Box>
    )

    const turn = await currentTurn($)
    const tally = await currentTally($)
    const main = mainCard(doing, phaseLine(doing, now), await currentRunning($), turn, tally, now, width)
    const crew = [...running, ...ended].map(worker => workerCard(worker, now, width))
    animate(new Map([main, ...crew].filter(card => hasIcon && card.isAnimated).map(card => [card.key, { color: card.color, action: card.action }])))

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
        {workers.length > 0 ? (
          <Box key="total" flexDirection="column" marginBottom={1}>
            {totalLines(turn, tally, workers, inner).map((line: Seg[], index: number) => draw(Text, line, `total-${index}`))}
          </Box>
        ) : null}
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
    const tasks = (await currentTasks($)).items.filter(item => item.subject !== '')
    const line = workingLine(doing, phaseLine(doing, now), await currentWorkers($), tasks, Math.max(1, e.props.bodyColumns - SLACK_COLUMNS))
    if (line.length === 0) return beneath
    return (
      <Box flexDirection="column">
        {draw(Text, line, 'working')}
        {beneath}
      </Box>
    )
  })
}
