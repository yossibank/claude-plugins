import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TestRun } from '../types'

const ANSI = /\x1b\[[0-9;]*m/g
// 設定が空か壊れている時の値。plugin.json の userConfig の default と同じにしておく
const DEFAULTS = {
  commandPattern: '\\bmake\\b(?:.*\\s)?test(?=\\s|$)',
  logPath: '.build/test.log',
  passedLine: '^\\s*✔\\s',
  failedLine: '^\\s*✖\\s+(.+?)(?:\\s+\\(\\d|,\\s|$)',
  finishedLine: '\\bTest (Succeeded|Failed)\\b|\\*\\* TEST (SUCCEEDED|FAILED) \\*\\*|\\bTesting failed\\b',
  succeededLine: 'Test Succeeded|TEST SUCCEEDED',
}
const POLL_MS = 1000
const GIVE_UP_MS = 60 * 60 * 1000
const STALL_MS = 5 * 60 * 1000
const SHOWN_FAILURES = 3
const SIDE_COLUMNS = 42
// ログがこれだけ変わらなければ、帯に「動きなし」を出す
const QUIET_MS = 30 * 1000
// 終わりの知らせに出す、時間のかかったテストの数と、出し始める秒
const SHOWN_SLOW = 3
const SLOW_SECONDS = 1
// 行の後ろの「(0.012 seconds)」
const SECONDS = /\((\d+(?:\.\d+)?)\s*(?:seconds?|s)\)/

type Pattern = 'commandPattern' | 'passedLine' | 'failedLine' | 'finishedLine' | 'succeededLine'

type Watched = {
  command: RegExp
  logPath: string
  passed: RegExp
  failed: RegExp
  finished: RegExp
  succeeded: RegExp
}

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback)

// 壊れた正規表現は初めの値に戻し、その設定の名前を broken に集める。知らせるのは最初の Bash の時
const watched = (options: Readonly<Record<string, unknown>>) => {
  const broken: Pattern[] = []
  const pattern = (name: Pattern) => {
    try {
      return new RegExp(text(options[name], DEFAULTS[name]))
    } catch {
      broken.push(name)
      return new RegExp(DEFAULTS[name])
    }
  }
  const spec: Watched = {
    command: pattern('commandPattern'),
    logPath: text(options.logPath, DEFAULTS.logPath),
    passed: pattern('passedLine'),
    failed: pattern('failedLine'),
    finished: pattern('finishedLine'),
    succeeded: pattern('succeededLine'),
  }
  return { spec, broken }
}

// 見張り（走っているテストのコマンド）ごとの表示。id を鍵にして、重なった見張りが互いの表示と終わりを書き換えないようにする
// shape の番号は、保存する値の形の版。形を変えた時に上げると、前の版の値は読まれず初めの値に戻る
const runs = atom({ plugin: 'ios-test-progress', key: 'runs' } as const, {}, { shape: 'runs-4' })

let serial = 0

const put = ($: EngineInterface, id: string, change: (old: TestRun) => TestRun) =>
  update($, runs, all => {
    const old = all[id]
    return old === undefined ? all : { ...all, [id]: change(old) }
  })

const drop = ($: EngineInterface, id: string) => update($, runs, all => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)))

const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

const place = (base: string, dir: string) => (dir.startsWith('/') ? dir : join(base, dir))

// コマンドの区切りごとに cd で基点を動かし、見張るコマンドに当たった区切りのログの置き場と、帯に出す名前を返す
const testLog = (command: string, cwd: string, spec: Watched) => {
  let base = cwd
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/)
    if (words[0] === 'cd') {
      const next = (words[1] ?? '').replace(/^['"]|['"]$/g, '')
      if (next !== '' && next !== '-' && !next.startsWith('~') && !next.startsWith('$')) base = place(base, next)
      continue
    }
    const checked = /(^|\/)run-check\.sh$/.test(words[0] ?? '') ? (words[1] ?? '').replace(/^['"]|['"]$/g, '') : ''
    const root = checked !== '' && !checked.startsWith('~') && !checked.startsWith('$') ? place(base, checked) : base
    const isMake = /\bmake\b/.test(segment)
    const hit = (isMake ? segment.replace(/\s-C\s*\S+/g, '') : segment).match(spec.command)
    if (hit === null) continue
    const into = isMake ? segment.match(/\s-C\s*(\S+)/)?.[1] : undefined
    const dir = into === undefined ? root : place(root, into.replace(/^['"]|['"]$/g, ''))
    return { log: place(dir, spec.logPath), label: hit[0].trim() || segment.trim() }
  }
  return undefined
}

const count = (raw: string, spec: Watched) => {
  const plain = raw.replace(ANSI, '')
  let passed = 0
  let latest = ''
  const failed: string[] = []
  const reasons: Record<string, string> = {}
  const timed = new Map<string, number>()
  const lines = plain.split('\n')
  const isResult = (line: string) => spec.passed.test(line) || spec.failed.test(line) || spec.finished.test(line)
  const time = (name: string, line: string) => {
    const seconds = Number(line.match(SECONDS)?.[1])
    if (name !== '' && Number.isFinite(seconds)) timed.set(name, Math.max(timed.get(name) ?? 0, seconds))
  }
  lines.forEach((line, at) => {
    if (spec.passed.test(line)) {
      passed += 1
      // 通った行から印を外し、後ろの「(0.012 seconds)」を落として名前にする
      const name = line.replace(spec.passed, '').replace(/\s+\(\d[^)]*\)\s*$/, '').trim()
      latest = name || latest
      time(name, line)
    }
    const hit = line.match(spec.failed)
    const failure = hit === null ? undefined : (hit[1] ?? line.trim())
    if (failure === undefined) return
    latest = failure
    time(failure, line)
    if (!failed.includes(failure)) failed.push(failure)
    if (reasons[failure] !== undefined) return
    // 理由は、同じ行の名前の後ろか、無ければ次の行から取る。次の行が別のテストの結果なら取らない
    const rest = line
      .slice(line.indexOf(failure) + failure.length)
      .replace(SECONDS, '')
      .replace(/^[\s,:：—-]+/, '')
      .trim()
    const next = lines.slice(at + 1).find(other => other.trim() !== '')
    const reason = rest !== '' ? rest : next !== undefined && !isResult(next) ? next.trim() : ''
    if (reason !== '') reasons[failure] = reason
  })
  const slow = [...timed.entries()]
    .filter(([, seconds]) => seconds >= SLOW_SECONDS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SHOWN_SLOW)
    .map(([name, seconds]) => ({ name, seconds }))
  return { passed, failed, reasons, slow, latest, isFinished: lines.some(line => spec.finished.test(line)), isSucceeded: lines.some(line => spec.succeeded.test(line)) }
}

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const finish = async ($: EngineInterface, id: string, isPassed: boolean, isLearnt: boolean) => {
  const last = (await read($, runs))[id]
  if (last === undefined) return
  const took = last.now - last.startedAt
  if (isLearnt && last.passed + last.failed.length >= 1) {
    await $.store.set(`total:${last.label}`, last.passed + last.failed.length)
    await $.store.set(`durationMs:${last.label}`, took)
  }
  // 落ちた名前は、次の回に「直った」「新しく落ちた」を出すために、落ちた回も覚える
  if (last.passed + last.failed.length >= 1) await $.store.set(`failed:${last.label}`, last.failed)
  await drop($, id)
  const before = last.lastMs === null ? '' : `（前回 ${clock(last.lastMs)}）`
  const fixed = (last.lastFailed ?? []).filter(name => !last.failed.includes(name)).length
  const fresh = last.lastFailed === null ? 0 : last.failed.filter(name => !last.lastFailed?.includes(name)).length
  const change = `${fixed > 0 ? ` · 直った ${fixed}` : ''}${fresh > 0 ? ` · 新しく落ちた ${fresh}` : ''}`
  const slow = last.slow.length === 0 ? '' : ` · 遅い: ${last.slow.map(one => `${one.name.slice(0, 24)} ${one.seconds.toFixed(1)}s`).join('、')}`
  $.ui.toast(
    isPassed && last.failed.length === 0
      ? `✔ ${last.label} ${last.passed} 本通った · ${clock(took)}${before}${change}${slow}`
      : `✖ ${last.label} ${last.failed.length} 本落ちた（${last.passed} 本通った）· ${clock(took)}${before}${change}${slow}`,
  )
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
  await put($, id, old => ({ ...old, now, passed: counted.passed, failed: counted.failed, reasons: counted.reasons, slow: counted.slow, latest: counted.latest, changedAt: pulse.changedAt, isWritten: true }))
  if (counted.isFinished) return counted.isSucceeded ? 'passed' : 'failed'
  return idle()
}

const watch = async ($: EngineInterface, spec: Watched, log: string, label: string) => {
  const startedAt = await $.clock.now()
  const id = `${startedAt}-${(serial += 1)}`
  const total = await $.store.get(`total:${label}`)
  const lastMs = await $.store.get(`durationMs:${label}`)
  const lastFailed = await $.store.get(`failed:${label}`)
  await update($, runs, all => ({
    ...all,
    [id]: {
      label,
      startedAt,
      now: startedAt,
      passed: 0,
      failed: [],
      reasons: {},
      slow: [],
      lastFailed: Array.isArray(lastFailed) ? lastFailed.filter((name): name is string => typeof name === 'string') : null,
      latest: '',
      changedAt: startedAt,
      total: typeof total === 'number' ? total : null,
      lastMs: typeof lastMs === 'number' ? lastMs : null,
      isWritten: false,
    },
  }))
  const pulse: Pulse = { changedAt: startedAt, mtimeMs: 0 }
  let isBusy = false
  let isDone = false
  const stop = async (result: string) => {
    if (isDone) return
    isDone = true
    timer.cancel()
    // ログが一度も書かれなかった回は、ログを書かないコマンドとみなし、何も知らせない
    if (result === 'given-up' || result === 'stalled' || result === 'unread') await drop($, id)
    else await finish($, id, result === 'passed' || result === 'exited-ok', result === 'passed')
  }
  const timer = $.clock.every(POLL_MS, () => {
    if (isBusy || isDone) return
    isBusy = true
    void tick($, id, spec, log, startedAt, pulse)
      .then(result => (result === 'running' ? undefined : stop(result)))
      .catch(async error => {
        $.ui.toast(`ios-test-progress: 見張りを止めました: ${error instanceof Error ? error.message : String(error)}`.slice(0, 120))
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
      $.ui.toast(`ios-test-progress: ${broken.join('・')} の正規表現が正しくないので、初めの値で見張ります`)
    }
    const found = testLog(e.command, await $.session.cwd(), spec)
    if (found === undefined) return next(e)

    const end = await watch($, spec, found.log, found.label)
    const ran = await next(e)
    if (e.run_in_background !== true) await end(ran.deny === undefined && ran.isError !== true, ran.deny !== undefined)
    return ran
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
          const done = one.passed + one.failed.length
          const total = one.total === null ? null : Math.max(one.total, done)
          const elapsed = one.now - one.startedAt
          const left = one.lastMs === null ? null : one.lastMs - elapsed
          const quiet = one.now - one.changedAt
          const percent = total === null ? null : Math.floor((done / Math.max(1, total)) * 100)
          // 1 分あたりの本数。走り始めてすぐは振れるので、5 秒たってから出す
          const pace = elapsed >= 5000 && done > 0 ? Math.round((done / elapsed) * 60_000) : null
          const drawn = total === null ? null : bar(done, total, columns)
          return (
            <Box key={id} flexDirection="column">
              <Text>
                <Text bold>🧪 {one.label}  </Text>
                {drawn !== null && (
                  <Text>
                    <Text dimColor>▕</Text>
                    <Text color={one.failed.length > 0 ? 'error' : 'success'}>{drawn.filled}</Text>
                    <Text dimColor>{drawn.empty}▏ </Text>
                  </Text>
                )}
                <Text>{total === null ? `${done} 本` : `${done} / ${total}`}</Text>
                {percent !== null && <Text dimColor> · {percent}%</Text>}
              </Text>
              <Text>
                <Text color="success">   ✔ {one.passed}</Text>
                <Text color={one.failed.length > 0 ? 'error' : undefined} dimColor={one.failed.length === 0}>  ✖ {one.failed.length}</Text>
                <Text dimColor>   ⏱ {clock(elapsed)}{left !== null && left > 0 ? ` · 残り約 ${clock(left)}` : ''}</Text>
                {left !== null && left <= 0 && <Text color="warning"> · 前回より {clock(-left)} 長い</Text>}
                {one.lastMs !== null && <Text dimColor> · 前回 {clock(one.lastMs)}</Text>}
                {pace !== null && <Text dimColor> · {pace} 本/分</Text>}
                {quiet >= QUIET_MS && <Text color="warning"> · ⏸ {clock(quiet)} 動きなし</Text>}
              </Text>
              {one.latest !== '' && (
                <Text dimColor wrap="truncate-end">
                  {'   '}▸ {one.latest}
                </Text>
              )}
              {one.failed.slice(0, SHOWN_FAILURES).map((name, index) => (
                <Text key={`${index}-${name}`} wrap="truncate-end">
                  <Text color="error">   ✖ {name}</Text>
                  {one.lastFailed !== null && !one.lastFailed.includes(name) && <Text color="warning"> 新</Text>}
                  {one.reasons[name] !== undefined && <Text dimColor> — {one.reasons[name]}</Text>}
                </Text>
              ))}
              {one.failed.length > SHOWN_FAILURES && <Text dimColor>   ほか {one.failed.length - SHOWN_FAILURES} 本</Text>}
            </Box>
          )
        })}
        {beneath}
      </Box>
    )
  })
}
