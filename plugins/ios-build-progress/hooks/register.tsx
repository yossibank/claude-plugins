import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BuildRun } from '../types'
import { buildLog, count, problems, watched, type Watched } from './log'

const POLL_MS = 1000
const GIVE_UP_MS = 60 * 60 * 1000
const STALL_MS = 5 * 60 * 1000
const SHOWN_ERRORS = 3
const SIDE_COLUMNS = 42
// ログがこれだけ変わらなければ、帯に「動きなし」を出す
const QUIET_MS = 30 * 1000
// XcodeBuildMCP のビルドのツール（build_sim・build_run_sim など）。ログが無いので、結果の文だけを数える
const BUILD_TOOL = /^mcp__XcodeBuildMCP__build/
const SUMMARY = /\bbuild (?:failed|succeeded)\b/i

// 見張り（走っているビルド）ごとの表示。id を鍵にして、重なった見張りが互いの表示と終わりを書き換えないようにする
// shape の番号は、保存する値の形の版。形を変えた時に上げると、前の版の値は読まれず初めの値に戻る
const runs = atom({ plugin: 'ios-build-progress', key: 'runs' } as const, {}, { shape: 'runs-1' })

let serial = 0

const put = ($: EngineInterface, id: string, change: (old: BuildRun) => BuildRun) =>
  update($, runs, all => {
    const old = all[id]
    return old === undefined ? all : { ...all, [id]: change(old) }
  })

const drop = ($: EngineInterface, id: string) => update($, runs, all => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)))

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// 終わりのトーストの文。counted が無い時（結果の文を数えられなかった時）は、成功・失敗と時間だけにする
const told = (label: string, isSucceeded: boolean, counted: { warnings: number; errors: number } | null, took: number, lastMs: number | null) => {
  const parts = [isSucceeded ? `✔ ${label} 成功` : `✖ ${label} 失敗`]
  if (counted !== null && !isSucceeded) parts.push(`エラー ${counted.errors}`)
  if (counted !== null) parts.push(`警告 ${counted.warnings}`)
  parts.push(`${clock(took)}${lastMs === null ? '' : `（前回 ${clock(lastMs)}）`}`)
  return parts.join(' · ')
}

const begin = async ($: EngineInterface, label: string, key: string, isTool: boolean) => {
  const startedAt = await $.clock.now()
  const id = `${startedAt}-${(serial += 1)}`
  const total = isTool ? undefined : await $.store.get(`total:${key}`)
  const lastMs = await $.store.get(`durationMs:${key}`)
  await update($, runs, all => ({
    ...all,
    [id]: {
      label,
      key,
      startedAt,
      now: startedAt,
      steps: 0,
      target: '',
      stage: '',
      file: '',
      warnings: 0,
      errors: [],
      changedAt: startedAt,
      total: typeof total === 'number' ? total : null,
      lastMs: typeof lastMs === 'number' ? lastMs : null,
      isWritten: isTool,
      isTool,
    },
  }))
  return { id, startedAt }
}

// isSucceeded は成功とみなすか。isLearnt は、終わった行で成功と分かった回か。その時だけ次の回のために数を覚える
const finish = async ($: EngineInterface, id: string, isSucceeded: boolean, isLearnt: boolean) => {
  const last = (await read($, runs))[id]
  if (last === undefined) return
  const took = last.now - last.startedAt
  if (isLearnt && last.steps >= 1) {
    await $.store.set(`total:${last.key}`, last.steps)
    await $.store.set(`durationMs:${last.key}`, took)
  }
  await drop($, id)
  $.ui.toast(told(last.label, isSucceeded, { warnings: last.warnings, errors: last.errors.length }, took, last.lastMs))
}

type Pulse = { changedAt: number; mtimeMs: number }

// isFinal はコマンドが終わった後の読み。書き終わりが前の読みと同じ時刻に入っていても数え直す
const tick = async ($: EngineInterface, id: string, spec: Watched, log: string, startedAt: number, pulse: Pulse, isFinal = false) => {
  const now = await $.clock.now()
  const mtimeMs = (await $.fs.exists(log)) ? (await $.fs.stat(log)).mtimeMs : 0
  const isFresh = mtimeMs >= startedAt - 1000
  const isChanged = isFresh && mtimeMs !== pulse.mtimeMs
  if (isChanged) {
    pulse.mtimeMs = mtimeMs
    pulse.changedAt = now
  }
  const isStalled = pulse.mtimeMs !== 0 && now - pulse.changedAt > STALL_MS
  const idle = () => (isStalled ? 'stalled' : now - startedAt > GIVE_UP_MS ? 'given-up' : 'running')
  // ログが変わっていなければ、読み直さずに経った時間だけを進める
  if (!isFresh || (!isChanged && !isFinal)) {
    await put($, id, old => ({ ...old, now }))
    return idle()
  }
  const counted = count(await $.fs.read(log), spec)
  await put($, id, old => ({
    ...old,
    now,
    steps: counted.steps,
    target: counted.target,
    stage: counted.stage,
    file: counted.file,
    warnings: counted.warnings,
    errors: counted.errors,
    changedAt: pulse.changedAt,
    isWritten: true,
  }))
  if (counted.isFinished) return counted.isSucceeded ? 'succeeded' : 'failed'
  return idle()
}

const watch = async ($: EngineInterface, spec: Watched, log: string, label: string, key: string) => {
  const { id, startedAt } = await begin($, label, key, false)
  const pulse: Pulse = { changedAt: startedAt, mtimeMs: 0 }
  let isBusy = false
  let isDone = false
  const stop = async (result: string) => {
    if (isDone) return
    isDone = true
    timer.cancel()
    // ログが一度も書かれなかった回は、ログを書かないコマンドとみなし、何も知らせない
    if (result === 'given-up' || result === 'stalled' || result === 'unread') return drop($, id)
    // 終わった行が無いまま終わった時は、tee が終わりの値を隠すので、エラーの行が無いことも見る
    const isClean = ((await read($, runs))[id]?.errors.length ?? 0) === 0
    await finish($, id, result === 'succeeded' || (result === 'exited-ok' && isClean), result === 'succeeded')
  }
  const timer = $.clock.every(POLL_MS, () => {
    if (isBusy || isDone) return
    isBusy = true
    void tick($, id, spec, log, startedAt, pulse)
      .then(result => (result === 'running' ? undefined : stop(result)))
      .catch(async error => {
        $.ui.toast(`ios-build-progress: 見張りを止めました: ${message(error)}`.slice(0, 120))
        await stop('given-up').catch(() => undefined)
      })
      .finally(() => {
        isBusy = false
      })
  })
  return async (isPassed: boolean, isDenied = false) => {
    if (isDone) return
    if (isDenied) return stop('given-up')
    const result = await tick($, id, spec, log, startedAt, pulse, true)
    const exited = isPassed ? 'ok' : 'ng'
    await stop(result !== 'running' ? result : pulse.mtimeMs === 0 ? 'unread' : `exited-${exited}`)
  }
}

// XcodeBuildMCP のツールの見張り。帯の経った時間を進めるだけで、数えるのは終わった後の結果の文
const follow = async ($: EngineInterface, spec: Watched, label: string) => {
  const { id, startedAt } = await begin($, label, label, true)
  let isDone = false
  const timer = $.clock.every(POLL_MS, () => {
    if (isDone) return
    void (async () => {
      const now = await $.clock.now()
      if (now - startedAt <= GIVE_UP_MS) return put($, id, old => ({ ...old, now }))
      isDone = true
      timer.cancel()
      await drop($, id)
    })().catch(error => {
      isDone = true
      timer.cancel()
      $.ui.toast(`ios-build-progress: 見張りを止めました: ${message(error)}`.slice(0, 120))
    })
  })
  // ran が無いのは、実行を拒まれた時と、ツールが投げた時。トーストを出さずに帯だけを消す
  return async (ran?: { text?: string; isError?: boolean }) => {
    const wasDone = isDone
    isDone = true
    timer.cancel()
    const last = (await read($, runs))[id]
    await drop($, id)
    if (wasDone || ran === undefined || last === undefined) return
    const took = (await $.clock.now()) - startedAt
    const said = ran.text ?? ''
    // 「❌ … build failed for scheme …」のような結果のまとめの行は、エラーの 1 件として数えない
    const found = said.trim() === '' ? null : problems(said.split('\n').filter(line => !SUMMARY.test(line)).join('\n'), spec)
    // 結果の文に成功のまとめの行がある時は、エラーの形の行が混じっていても成功とみなす
    const isSucceeded = ran.isError !== true && (found === null || found.errors.length === 0 || /\bsucceeded\b/i.test(said))
    if (isSucceeded) await $.store.set(`durationMs:${label}`, took)
    $.ui.toast(told(label, isSucceeded, found === null ? null : { warnings: found.warnings, errors: found.errors.length }, took, last.lastMs))
  }
}

const bar = (done: number, total: number, columns: number) => {
  const filled = Math.min(columns, Math.round((done / Math.max(1, total)) * columns))
  return { filled: '█'.repeat(filled), empty: '░'.repeat(columns - filled) }
}

export const register: Register = (on, options) => {
  const { spec, broken } = watched(options)
  let isTold = false

  on('session.start', async ($, e, next) => {
    await update($, runs, () => ({}))
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isTold && broken.length > 0) {
      isTold = true
      $.ui.toast(`ios-build-progress: ${broken.join('・')} の正規表現が正しくないので、初めの値で見張ります`)
    }
    const found = buildLog(e.command, await $.session.cwd(), spec)
    if (found === undefined) return next(e)

    const end = await watch($, spec, found.log, found.label, found.key)
    const ran = await next(e)
    if (e.run_in_background !== true) await end(ran.deny === undefined && ran.isError !== true, ran.deny !== undefined)
    return ran
  })

  on('tool.call', { tool: BUILD_TOOL }, async ($, e, next) => {
    const end = await follow($, spec, e.tool.replace(/^mcp__XcodeBuildMCP__/, ''))
    try {
      const ran = await next(e)
      await end(ran.deny === undefined ? { text: ran.text, isError: ran.isError } : undefined)
      return ran
    } catch (error) {
      await end()
      throw error
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await $.clock.now()
    // 1 時間を超えた見張りは、見張り自身が止めて消す。描く時は書かずに出さないだけにする
    const current = Object.entries(await read($, runs)).filter(([, one]) => one.isWritten && now - one.startedAt <= GIVE_UP_MS)
    if (e.props.hasSurvey || current.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const beneath = await next(e)
    const columns = Math.max(10, (e.viewport?.columns ?? 80) - SIDE_COLUMNS)

    return (
      <Box flexDirection="column">
        {current.map(([id, one]) => {
          const elapsed = one.now - one.startedAt
          const left = one.lastMs === null ? null : one.lastMs - elapsed
          const timing = (
            <Text>
              <Text dimColor>⏱ {clock(elapsed)}{left !== null && left > 0 ? ` · 残り約 ${clock(left)}` : ''}</Text>
              {left !== null && left <= 0 && <Text color="warning"> · 前回より {clock(-left)} 長い</Text>}
              {one.lastMs !== null && <Text dimColor> · 前回 {clock(one.lastMs)}</Text>}
            </Text>
          )
          if (one.isTool) {
            return (
              <Text key={id} wrap="truncate-end">
                <Text bold>🔨 {one.label}  </Text>
                {timing}
              </Text>
            )
          }
          const total = one.total === null ? null : Math.max(one.total, one.steps)
          const quiet = one.now - one.changedAt
          const percent = total === null ? null : Math.floor((one.steps / Math.max(1, total)) * 100)
          const drawn = total === null ? null : bar(one.steps, total, columns)
          const doing = [one.target, one.stage].filter(part => part !== '').join(' · ')
          return (
            <Box key={id} flexDirection="column">
              <Text wrap="truncate-end">
                <Text bold>🔨 {one.label}  </Text>
                {drawn !== null && (
                  <Text>
                    <Text dimColor>▕</Text>
                    <Text color={one.errors.length > 0 ? 'error' : 'success'}>{drawn.filled}</Text>
                    <Text dimColor>{drawn.empty}▏ </Text>
                  </Text>
                )}
                <Text>{total === null ? `${one.steps} 手順` : `${one.steps} / ${total}`}</Text>
                {percent !== null && <Text dimColor> · {percent}%</Text>}
              </Text>
              <Text wrap="truncate-end">
                {'   '}
                {doing !== '' && <Text>⚙ {doing}  </Text>}
                <Text color={one.warnings > 0 ? 'warning' : undefined} dimColor={one.warnings === 0}>⚠ {one.warnings}</Text>
                <Text color={one.errors.length > 0 ? 'error' : undefined} dimColor={one.errors.length === 0}>  ✖ {one.errors.length}</Text>
                {'   '}
                {timing}
                {quiet >= QUIET_MS && <Text color="warning"> · ⏸ {clock(quiet)} 動きなし</Text>}
              </Text>
              {one.file !== '' && (
                <Text dimColor wrap="truncate-end">
                  {'   '}▸ {one.file}
                </Text>
              )}
              {one.errors.slice(0, SHOWN_ERRORS).map((error, index) => (
                <Text key={`${index}-${error}`} color="error" wrap="truncate-end">
                  {'   '}✖ {error}
                </Text>
              ))}
              {one.errors.length > SHOWN_ERRORS && <Text dimColor>   ほか {one.errors.length - SHOWN_ERRORS} 件</Text>}
            </Box>
          )
        })}
        {beneath}
      </Box>
    )
  })
}
