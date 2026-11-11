import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cost, Handoff, Step } from '../types'

import { gather, measure, messagesOf, pathOf, relative, rootOf } from './facts'
import { cleanMemo, lineCount, MAX_LINES, promptOf, resumeOf, shortenOf } from './memo'
import { drawPane } from './pane'

// 設定が空か壊れている時の値。plugin.json の userConfig の default と同じにしておく
const DEFAULTS = { threshold: 75, handoffPath: '.claude/handoff.md' }
const PANE = 'handoff'
const TITLE = '🤝 Handoff'
const LABELS = ['会話を読む', '触ったファイル', 'メモを書く', '保存して確かめる']
// メモを書く段の棒は、前の回にかかった時間を目安に伸ばす。終わるまでは 9 割で止める
const GUESS_MS = 30_000
const TICK_MS = 500
const WRITE_MS_KEY = 'writeMs'

// shape の番号は、保存する値の形の版。形を変えた時に上げると、前の版の値は読まれず初めの値に戻る
const handoff = atom({ plugin: 'handoff', key: 'handoff' } as const, { phase: 'idle' }, { shape: 'handoff-3' })
// 「あとで」を押したら、その会話では勧めない
const isLater = atom({ plugin: 'handoff', key: 'isLater' } as const, false)

type Options = { threshold: number; handoffPath: string }

const optionsOf = (options: Readonly<Record<string, unknown>>): Options => {
  const threshold = Number(options.threshold)
  const handoffPath = typeof options.handoffPath === 'string' && options.handoffPath.trim() !== '' ? options.handoffPath.trim() : DEFAULTS.handoffPath
  return { threshold: Number.isFinite(threshold) && threshold > 0 && threshold <= 100 ? threshold : DEFAULTS.threshold, handoffPath }
}

const fresh = (): Step[] => LABELS.map(label => ({ label, state: 'waiting', detail: '', ratio: 0 }))

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const seconds = (ms: number) => (ms < 10_000 ? `${(Math.round(ms / 100) / 10).toFixed(1)} 秒` : `${Math.round(ms / 1000)} 秒`)

const building = ($: EngineInterface, change: (old: Extract<Handoff, { phase: 'building' }>) => Handoff) =>
  update($, handoff, (old): Handoff => (old.phase === 'building' ? change(old) : old))

const setStep = ($: EngineInterface, index: number, change: Partial<Step>) =>
  building($, old => ({ ...old, steps: old.steps.map((step, at) => (at === index ? { ...step, ...change } : step)) }))

const failWith = async ($: EngineInterface, reason: string) => {
  await update($, handoff, (old): Handoff => {
    if (old.phase !== 'building') return { phase: 'failed', fill: null, facts: null, steps: fresh(), reason }
    const steps = old.steps.map(step => (step.state === 'running' ? { ...step, state: 'failed' as const } : step))
    return { phase: 'failed', fill: old.fill, facts: old.facts, steps, reason }
  })
  $.ui.toast(`handoff: 引き継ぎを作れませんでした: ${reason}`.slice(0, 120))
}

// 同じ失敗は続けて知らせない。経過の tick のように繰り返す処理でも、toast を重ねない
let lastFailure = ''

const report = ($: EngineInterface, what: string) => (error: unknown) => {
  const text = `handoff: ${what}に失敗しました: ${errorText(error)}`.slice(0, 120)
  if (text === lastFailure) return
  lastFailure = text
  $.ui.toast(text)
}

// 段を 1 つ進め、かかった時間を段の補足にする
async function timed<T>($: EngineInterface, index: number, work: () => Promise<T>, detail: (value: T) => string) {
  const startedAt = await $.clock.now()
  await setStep($, index, { state: 'running', ratio: 0.5 })
  const value = await work()
  await setStep($, index, { state: 'done', ratio: 1, detail: detail(value) || seconds((await $.clock.now()) - startedAt) })
  return value
}

async function write($: EngineInterface, options: Options) {
  const root = await rootOf($)
  const path = pathOf(root, options.handoffPath)

  const messages = await timed($, 0, () => messagesOf($), () => '')
  const facts = await timed($, 1, () => gather($, root, path, messages), () => '')
  await building($, old => ({ ...old, facts }))

  const startedAt = await $.clock.now()
  await setStep($, 2, { state: 'running', detail: '0 秒' })
  const state = await read($, handoff)
  const expectedMs = state.phase === 'building' ? state.expectedMs : GUESS_MS
  const timer = $.clock.every(TICK_MS, () => {
    void $.clock
      .now()
      .then(now =>
        building($, old => ({
          ...old,
          now,
          // 止めた後に届いた tick で、済んだ段を戻さない
          steps: old.steps.map((step, at) => (at === 2 && step.state === 'running' ? { ...step, detail: seconds(now - startedAt), ratio: Math.min(0.9, (now - startedAt) / expectedMs) } : step)),
        })),
      )
      .catch(report($, '経過の更新'))
  })
  let text: string
  let cost: Cost | null = null
  try {
    const reply = await $.model.fork({ prompt: promptOf(facts.files) })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork') return failWith($, 'まだモデルに何も頼んでいない（/clear の直後など）。1 つ頼んでからやり直す')
    if (!reply.isAnswered) return failWith($, `モデルが答えなかった（${reply.reason}）`)
    cost = { input: reply.usage.input_tokens + reply.usage.cache_read_input_tokens + reply.usage.cache_creation_input_tokens, cacheRead: reply.usage.cache_read_input_tokens, output: reply.usage.output_tokens }
    text = cleanMemo(reply.text)
    if (lineCount(text) > MAX_LINES) {
      const shorter = await $.model.fork({ prompt: shortenOf(text, lineCount(text)), effort: 'low' })
      if (shorter.isAnswered) text = cleanMemo(shorter.text)
    }
  } finally {
    timer.cancel()
  }
  const took = (await $.clock.now()) - startedAt
  if (took > 0) await $.store.set(WRITE_MS_KEY, took)
  await setStep($, 2, { state: 'done', detail: seconds(took), ratio: 1 })

  const lines = await timed(
    $,
    3,
    async () => {
      await $.fs.write(path, text)
      if (root.isRepo && path.startsWith(`${root.base}/`)) await ignore($, root.base, relative(root.base, path))
      return lineCount(text)
    },
    () => '',
  )

  await building($, old => ({
    phase: 'ready',
    fill: old.fill,
    facts,
    steps: old.steps,
    path,
    text,
    lines,
    chars: [...text.trim()].length,
    seconds: Math.round(took / 1000),
    cost,
  }))
}

// リポジトリの .gitignore に、メモのパスが無ければ足す
async function ignore($: EngineInterface, base: string, entry: string) {
  const file = `${base}/.gitignore`
  const old = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
  const listed = old.split('\n').some(line => line.trim() === entry || line.trim() === `/${entry}`)
  if (listed) return
  await $.fs.write(file, `${old}${old === '' || old.endsWith('\n') ? '' : '\n'}${entry}\n`)
}

const start = async ($: EngineInterface, options: Options) => {
  const old = await read($, handoff)
  if (old.phase === 'building') return false
  const now = await $.clock.now()
  const last = await $.store.get(WRITE_MS_KEY)
  const fill = old.phase === 'offered' ? old.fill : await measure($)
  // 待つ間に別の start が先に書き始めていたら、こちらは書かない。update はぶつかると関数を呼び直すので、印は毎回付け直す
  let isFirst = false
  await update($, handoff, (current): Handoff => {
    isFirst = current.phase !== 'building'
    if (!isFirst) return current
    return {
      phase: 'building',
      fill,
      facts: null,
      steps: fresh(),
      startedAt: now,
      now,
      expectedMs: typeof last === 'number' && last > 0 ? last : GUESS_MS,
    }
  })
  if (!isFirst) return false
  void write($, options).catch(error => failWith($, errorText(error)))
  return true
}

const reset = ($: EngineInterface) => update($, handoff, (): Handoff => ({ phase: 'idle' }))

// 「あとで」にする。その会話では、もう勧めない
async function postpone($: EngineInterface) {
  await update($, isLater, () => true)
  await reset($)
}

// 頼まれて開く時はキーを受けられるよう focus を渡す。勧める時は入力を奪わない
const open = ($: EngineInterface, focus: boolean) => $.ui.open(focus ? { id: PANE, title: TITLE, focus: true } : { id: PANE, title: TITLE })

const hide = ($: EngineInterface) => $.ui.close({ id: PANE })

export const register: Register = (on, raw) => {
  const options = optionsOf(raw)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoff', description: '引き継ぎメモを書いて、新しい会話へ渡す用意をする' })
    return next(e)
  })

  // /clear のあとは、勧めるところからやり直す
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await reset($)
      await update($, isLater, () => false)
    }
    return next(e)
  })

  // 書いている間と完成した後は、もう一度 /handoff でペインを開き直す
  on('command.run', { command: 'handoff' }, async $ => {
    const old = await read($, handoff)
    if (old.phase === 'building' || old.phase === 'ready') {
      await open($, true)
      return { text: old.phase === 'building' ? 'いま引き継ぎメモを書いています' : '引き継ぎメモはできています。書き直す時は「書き直す」を押す' }
    }
    await start($, options)
    await open($, true)
    return { text: '引き継ぎメモを書いています。右のペインに進み具合を出します' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    void (async () => {
      if ((await read($, handoff)).phase !== 'idle' || (await read($, isLater))) return
      const fill = await measure($)
      if (fill === null || fill.percent < options.threshold) return
      const root = await rootOf($)
      const facts = await gather($, root, pathOf(root, options.handoffPath), await messagesOf($))
      await update($, handoff, (old): Handoff => (old.phase === 'idle' ? { phase: 'offered', fill, facts } : old))
      await open($, false)
    })().catch(report($, '文脈を測ること'))
    return result
  })

  // 勧めている間にペインを閉じたら、「あとで」と同じにする
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person' && (await read($, handoff)).phase === 'offered') await postpone($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const now = await read($, handoff)
    const at = await $.clock.now()
    const ui = $.ui.resolve(e) as unknown as Parameters<typeof drawPane>[0]['ui']
    return drawPane({
      ui,
      now,
      at,
      columns: e.props.bodyColumns,
      actions: {
        start: () => void start($, options).catch(error => failWith($, errorText(error))),
        later: () =>
          void (async () => {
            await postpone($)
            await hide($)
          })().catch(report($, '閉じること')),
        begin: () =>
          void (async () => {
            if (now.phase !== 'ready') return
            await hide($)
            await $.command.run({ command: 'clear' })
            await reset($)
            const filled = await $.prompt.fill({ text: resumeOf(now.text) })
            if (!filled.isFilled) $.ui.toast('handoff: 入力欄に入れられませんでした。/handoff で開き直して「コピー」を使ってください')
          })().catch(report($, '新しい会話を始めること')),
        copy: surface =>
          void (async () => {
            if (now.phase !== 'ready') return
            const copied = await $.ui.copy(surface === undefined ? { text: resumeOf(now.text) } : { text: resumeOf(now.text), surface })
            $.ui.toast(copied.isCopied ? 'handoff: 引き継ぎのプロンプトをコピーしました' : `handoff: コピーできませんでした: ${copied.reason}`)
          })().catch(report($, 'コピー')),
        open: () =>
          void (async () => {
            if (now.phase !== 'ready') return
            const opened = await $.process.run(['open', now.path])
            if (opened.exitCode !== 0) $.ui.toast(`handoff: 開けませんでした: ${opened.stderr.trim()}`.slice(0, 120))
          })().catch(report($, 'ファイルを開くこと')),
        // 閉じたら、その会話では勧めない
        close: () =>
          void (async () => {
            if (now.phase !== 'building') await postpone($)
            await hide($)
          })().catch(report($, '閉じること')),
      },
    })
  })
}
