import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TestRun } from '../types'

const ANSI = /\x1b\[[0-9;]*m/g
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
const SIDE_COLUMNS = 34

type Watched = {
  command: RegExp
  logPath: string
  passed: RegExp
  failed: RegExp
  finished: RegExp
  succeeded: RegExp
}

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback)

const pattern = (value: unknown, fallback: string) => {
  try {
    return new RegExp(text(value, fallback))
  } catch {
    return new RegExp(fallback)
  }
}

const watched = (options: Readonly<Record<string, unknown>>): Watched => ({
  command: pattern(options.commandPattern, DEFAULTS.commandPattern),
  logPath: text(options.logPath, DEFAULTS.logPath),
  passed: pattern(options.passedLine, DEFAULTS.passedLine),
  failed: pattern(options.failedLine, DEFAULTS.failedLine),
  finished: pattern(options.finishedLine, DEFAULTS.finishedLine),
  succeeded: pattern(options.succeededLine, DEFAULTS.succeededLine),
})

const run = atom({ plugin: 'test-progress', key: 'run' } as const, null, { shape: 'run-2' })

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
    const isMake = /\bmake\b/.test(segment)
    const hit = (isMake ? segment.replace(/\s-C\s*\S+/g, '') : segment).match(spec.command)
    if (hit === null) continue
    const into = isMake ? segment.match(/\s-C\s*(\S+)/)?.[1] : undefined
    const dir = into === undefined ? base : place(base, into.replace(/^['"]|['"]$/g, ''))
    return { log: place(dir, spec.logPath), label: hit[0].trim() || segment.trim() }
  }
  return undefined
}

const count = (raw: string, spec: Watched) => {
  const plain = raw.replace(ANSI, '')
  let passed = 0
  const failed: string[] = []
  const lines = plain.split('\n')
  for (const line of lines) {
    if (spec.passed.test(line)) passed += 1
    const hit = line.match(spec.failed)
    const failure = hit === null ? undefined : (hit[1] ?? line.trim())
    if (failure !== undefined && !failed.includes(failure)) failed.push(failure)
  }
  return { passed, failed, isFinished: lines.some(line => spec.finished.test(line)), isSucceeded: lines.some(line => spec.succeeded.test(line)) }
}

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const finish = async ($: EngineInterface, isPassed: boolean, isLearnt: boolean, isUnread: boolean) => {
  const last = await read($, run)
  if (last === null) return
  const took = last.now - last.startedAt
  if (isLearnt && last.passed + last.failed.length >= 1) {
    await $.store.set(`total:${last.label}`, last.passed + last.failed.length)
    await $.store.set(`durationMs:${last.label}`, took)
  }
  await update($, run, () => null)
  if (isUnread) {
    $.ui.toast(`⚠ ${last.label} は終わったが、ログが見つからなかった（終了コードは${isPassed ? '成功' : '失敗'}） · ${clock(took)}`)
    return
  }
  $.ui.toast(
    isPassed && last.failed.length === 0
      ? `✔ ${last.label} ${last.passed} 本通った · ${clock(took)}`
      : `✖ ${last.label} ${last.failed.length} 本落ちた · ${clock(took)}`,
  )
}

type Pulse = { changedAt: number; mtimeMs: number }

const tick = async ($: EngineInterface, spec: Watched, log: string, startedAt: number, pulse: Pulse) => {
  const now = await $.clock.now()
  const mtimeMs = (await $.fs.exists(log)) ? (await $.fs.stat(log)).mtimeMs : 0
  const isFresh = mtimeMs >= startedAt - 1000
  if (isFresh && mtimeMs !== pulse.mtimeMs) {
    pulse.mtimeMs = mtimeMs
    pulse.changedAt = now
  }
  const idle = () => (now - pulse.changedAt > STALL_MS ? 'stalled' : now - startedAt > GIVE_UP_MS ? 'given-up' : 'running')
  if (!isFresh) {
    await update($, run, old => (old === null ? old : { ...old, now }))
    return idle()
  }
  const counted = count(await $.fs.read(log), spec)
  await update($, run, old => (old === null ? old : { ...old, now, passed: counted.passed, failed: counted.failed }))
  if (counted.isFinished) return counted.isSucceeded ? 'passed' : 'failed'
  return idle()
}

const watch = async ($: EngineInterface, spec: Watched, log: string, label: string) => {
  const startedAt = await $.clock.now()
  const total = await $.store.get(`total:${label}`)
  const lastMs = await $.store.get(`durationMs:${label}`)
  await update($, run, () => ({
    label,
    startedAt,
    now: startedAt,
    passed: 0,
    failed: [],
    total: typeof total === 'number' ? total : null,
    lastMs: typeof lastMs === 'number' ? lastMs : null,
  }))
  const pulse: Pulse = { changedAt: startedAt, mtimeMs: 0 }
  let isBusy = false
  let isDone = false
  const stop = async (result: string) => {
    if (isDone) return
    isDone = true
    timer.cancel()
    if (result === 'given-up' || result === 'stalled') await update($, run, () => null)
    else await finish($, result === 'passed' || result === 'exited-ok' || result === 'unread-ok', result === 'passed', result.startsWith('unread-'))
  }
  const timer = $.clock.every(POLL_MS, () => {
    if (isBusy || isDone) return
    isBusy = true
    void tick($, spec, log, startedAt, pulse)
      .then(result => (result === 'running' ? undefined : stop(result)))
      .finally(() => {
        isBusy = false
      })
  })
  return async (isPassed: boolean) => {
    if (isDone) return
    const result = await tick($, spec, log, startedAt, pulse)
    const exited = isPassed ? 'ok' : 'ng'
    await stop(result !== 'running' ? result : pulse.mtimeMs === 0 ? `unread-${exited}` : `exited-${exited}`)
  }
}

const bar = (done: number, total: number, columns: number) => {
  const filled = Math.min(columns, Math.round((done / Math.max(1, total)) * columns))
  return { filled: '█'.repeat(filled), empty: '░'.repeat(columns - filled) }
}

export const register: Register = (on, options) => {
  const spec = watched(options)

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const found = testLog(e.command, await $.session.cwd(), spec)
    if (found === undefined) return next(e)

    const end = await watch($, spec, found.log, found.label)
    const ran = await next(e)
    if (e.run_in_background !== true) await end(ran.deny === undefined && ran.isError !== true)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, run)
    if (e.props.hasSurvey || current === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const beneath = await next(e)
    const done = current.passed + current.failed.length
    const total = current.total === null ? null : Math.max(current.total, done)
    const elapsed = current.now - current.startedAt
    const left = current.lastMs === null ? null : current.lastMs - elapsed
    const columns = Math.max(10, (e.viewport?.columns ?? 80) - SIDE_COLUMNS)
    const drawn = total === null ? null : bar(done, total, columns)

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>🧪 {current.label}  </Text>
          {drawn !== null && (
            <Text>
              <Text dimColor>▕</Text>
              <Text color={current.failed.length > 0 ? 'error' : 'success'}>{drawn.filled}</Text>
              <Text dimColor>{drawn.empty}▏ </Text>
            </Text>
          )}
          <Text>{total === null ? `${done} 本` : `${done} / ${total}`}</Text>
        </Text>
        <Text>
          <Text color="success">   ✔ {current.passed}</Text>
          <Text color={current.failed.length > 0 ? 'error' : undefined} dimColor={current.failed.length === 0}>  ✖ {current.failed.length}</Text>
          <Text dimColor>   ⏱ {clock(elapsed)}{left !== null && left > 0 ? ` · 残り約 ${clock(left)}` : ''}</Text>
        </Text>
        {current.failed.slice(0, SHOWN_FAILURES).map(name => (
          <Text color="error">   ✖ {name}</Text>
        ))}
        {current.failed.length > SHOWN_FAILURES && <Text dimColor>   ほか {current.failed.length - SHOWN_FAILURES} 本</Text>}
        {beneath}
      </Box>
    )
  })
}
