import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Step } from '../types'

import { optionsOf } from './config'
import type { Options } from './config'
import { gather } from './facts'
import { askedOf, askingOf, checkOf, choose, cut, pad, saidOf, widthOf } from './steps'
import type { Turn } from './steps'

const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']
// ボタンの「1: 」が取る幅
const HOTKEY_COLUMNS = 3
// 候補と理由の間の空白
const GAP_COLUMNS = 2
// これより狭い時は、理由を出さない
const MIN_REASON_COLUMNS = 6

// 帯に出している候補。空の時は帯を出さない
// shape の番号は、保存する値の形の版。形を変えた時に上げると、前の版の値は読まれず初めの値に戻る
const shown = atom({ plugin: 'session-next-steps', key: 'steps' } as const, [], { shape: 'steps-1' })

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const report = ($: EngineInterface, what: string) => (error: unknown) => {
  $.ui.toast(`session-next-steps: ${what}に失敗しました: ${errorText(error)}`.slice(0, 120))
}

const fresh = (): Turn => ({ check: null, edited: [], said: [] })

// register の 1 回ごとの持ち物。$ を受け取る関数はファイルの一番上に置くので、ここにまとめて渡す
type Local = {
  isBroken: boolean
  isTold: boolean
  turn: Turn
  // 調べている間に帯を消した（次の指示・次のターン・隠す）時に、古い結果を出さないための番号
  generation: number
  // PR があると分かったブランチ
  knownPrs: Set<string>
  // この会話で最後に走らせたテストかビルド。書き換えた後に走らせるよう勧めるのは、testCommand よりこちら
  lastCheck: string | null
}

const tell = ($: EngineInterface, local: Local) => {
  if (local.isTold || !local.isBroken) return
  local.isTold = true
  $.ui.toast('session-next-steps: checkPattern の正規表現が正しくないので、初めの値で見ます')
}

const clear = async ($: EngineInterface, local: Local) => {
  local.generation += 1
  await update($, shown, () => [])
}

const fill = async ($: EngineInterface, step: Step) => {
  const filled = await $.prompt.fill({ text: step.text })
  if (!filled.isFilled) $.ui.toast(`session-next-steps: 入力欄に入れられませんでした。「${step.text}」と打ってください`.slice(0, 120))
}

// 会話の続きとしてモデルに尋ねる。尋ねられない時と答えを読めない時は、規則の候補を返す
const ask = async ($: EngineInterface, hints: Step[], options: Options) => {
  const reply = await $.model.fork({ prompt: askingOf(hints, options.maxSteps) })
  if (!reply.isAnswered) {
    if (reply.reason !== 'nothing-to-fork' && reply.reason !== 'aborted') $.ui.toast(`session-next-steps: モデルに尋ねられませんでした（${reply.reason}）。規則の候補を出します`)
    return hints
  }
  const asked = askedOf(reply.text, options.maxSteps)
  if (asked === null) $.ui.toast('session-next-steps: モデルの答えを読めませんでした。規則の候補を出します')
  return asked ?? hints
}

// git と gh を走らせて候補を選ぶ。待つ間に帯を消していたら、出さない
const look = async ($: EngineInterface, local: Local, options: Options, answer: string, isAsked: boolean) => {
  const mine = (local.generation += 1)
  const seen = { ...local.turn, said: saidOf(answer) }
  const hints = choose(seen, await gather($, local.knownPrs), { ...options, testCommand: local.lastCheck ?? options.testCommand })
  const steps = isAsked ? await ask($, hints, options) : hints
  if (mine === local.generation) await update($, shown, () => steps)
}

export const register: Register = (on, raw) => {
  const { options, isBroken } = optionsOf(raw)
  const local: Local = { isBroken, isTold: false, turn: fresh(), generation: 0, knownPrs: new Set(), lastCheck: null }

  on('session.start', async ($, e, next) => {
    await clear($, local)
    return next(e)
  })

  // /clear のあとは、前の会話の候補を残さない
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await clear($, local).catch(report($, '帯を消すこと'))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await clear($, local).catch(report($, '帯を消すこと'))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      tell($, local)
      local.turn = fresh()
      await clear($, local).catch(report($, '帯を消すこと'))
    }
    return next(e)
  })

  // メインの呼び出しだけを見る。ツールの結果はそのまま返す
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran
    if (e.tool === 'Bash') {
      tell($, local)
      const label = checkOf(e.command, options.check)
      // 断られたコマンドは、走っていないので数えない
      if (label !== undefined && ran.deny === undefined) {
        local.turn = { ...local.turn, check: { label, isFailed: ran.isError === true }, edited: [] }
        local.lastCheck = label
      }
    } else if (EDIT_TOOLS.includes(e.tool) && ran.deny === undefined && ran.isError !== true) {
      const input = e as { file_path?: unknown; notebook_path?: unknown }
      const path = input.file_path ?? input.notebook_path
      const name = typeof path === 'string' ? path : ''
      if (!local.turn.edited.includes(name)) local.turn = { ...local.turn, edited: [...local.turn.edited, name] }
    }
    return ran
  })

  // git と gh とモデルは、ターンの終わりを待たせずに走らせる。止めたターンでは、モデルに尋ねない
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const isAsked = options.askModel && e.reason === 'answer'
    void look($, local, options, e.answer, isAsked).catch(report($, '次の一手を調べること'))
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const steps = await read($, shown)
    if (e.props.hasSurvey || steps.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const beneath = await next(e)
    const columns = Math.max(HOTKEY_COLUMNS + 1, e.props.bodyColumns)
    const labels = Math.min(Math.max(...steps.map(step => widthOf(step.label))), columns - HOTKEY_COLUMNS)
    const room = columns - HOTKEY_COLUMNS - labels - GAP_COLUMNS

    return (
      <Box flexDirection="column">
        <Text bold>➡ 次の一手</Text>
        {steps.map((step, index) => (
          <Box key={step.id}>
            <Button key={`step-${step.id}`} hotkey={String(index + 1)} plain onPress={() => void fill($, step).catch(report($, '入力欄に入れること'))}>
              {room >= MIN_REASON_COLUMNS ? pad(cut(step.label, labels), labels + GAP_COLUMNS) : cut(step.label, labels)}
              {room >= MIN_REASON_COLUMNS ? <Text dimColor>{cut(step.reason, room)}</Text> : ''}
            </Button>
          </Box>
        ))}
        <Box key="hide">
          <Button key="hide" hotkey="0" plain role="dismiss" onPress={() => void clear($, local).catch(report($, '帯を隠すこと'))}>
            隠す
          </Button>
        </Box>
        {beneath}
      </Box>
    )
  })
}
