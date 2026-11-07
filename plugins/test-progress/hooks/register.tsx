import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TestRun } from '../types'

const LOG = '.build/test.log'
const ANSI = /\x1b\[[0-9;]*m/g
const PASSED = /^\s*✔\s/
const FAILED = /^\s*✖\s+(.+?)(?:\s+\(\d|,\s|$)/
const FINISHED = /\bTest (Succeeded|Failed)\b|\*\* TEST (SUCCEEDED|FAILED) \*\*|\bTesting failed\b/
const POLL_MS = 1000
const GIVE_UP_MS = 60 * 60 * 1000
const SHOWN_FAILURES = 3
const SIDE_COLUMNS = 34

const run = atom({ plugin: 'test-progress', key: 'run' } as const, null, { shape: 'run-1' })

const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

const testLog = (command: string, root: string) => {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/)
    const at = words.indexOf('make')
    if (at < 0) continue
    let dir = root
    const targets: string[] = []
    for (let i = at + 1; i < words.length; i += 1) {
      const word = words[i] ?? ''
      if (word === '-C') {
        const next = words[i + 1] ?? '.'
        dir = next.startsWith('/') ? next : join(root, next)
        i += 1
      } else if (!word.startsWith('-') && !word.includes('=') && !word.startsWith('>')) targets.push(word)
      else if (word.startsWith('>')) break
    }
    if (targets.includes('test')) return join(dir, LOG)
  }
  return undefined
}

const count = (text: string) => {
  let passed = 0
  const failed: string[] = []
  for (const line of text.replace(ANSI, '').split('\n')) {
    if (PASSED.test(line)) passed += 1
    const failure = line.match(FAILED)?.[1]
    if (failure !== undefined && !failed.includes(failure)) failed.push(failure)
  }
  return { passed, failed, isFinished: FINISHED.test(text.replace(ANSI, '')) }
}

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const finish = async ($: EngineInterface, isPassed: boolean) => {
  const last = await read($, run)
  if (last === null) return
  const took = last.now - last.startedAt
  await $.store.set('total', last.passed + last.failed.length)
  await $.store.set('durationMs', took)
  await update($, run, () => null)
  $.ui.toast(
    isPassed && last.failed.length === 0
      ? `✔ make test ${last.passed} 本通った · ${clock(took)}`
      : `✖ make test ${last.failed.length} 本落ちた · ${clock(took)}`,
  )
}

const tick = async ($: EngineInterface, log: string, startedAt: number) => {
  const now = await $.clock.now()
  const isFresh = (await $.fs.exists(log)) && (await $.fs.stat(log)).mtimeMs >= startedAt - 1000
  if (!isFresh) {
    await update($, run, old => (old === null ? old : { ...old, now }))
    return now - startedAt > GIVE_UP_MS ? 'given-up' : 'running'
  }
  const text = await $.fs.read(log)
  const counted = count(text)
  await update($, run, old => (old === null ? old : { ...old, now, passed: counted.passed, failed: counted.failed }))
  if (counted.isFinished) return /Test Succeeded|TEST SUCCEEDED/.test(text.replace(ANSI, '')) ? 'passed' : 'failed'
  return now - startedAt > GIVE_UP_MS ? 'given-up' : 'running'
}

const watch = async ($: EngineInterface, log: string) => {
  const startedAt = await $.clock.now()
  const total = await $.store.get('total')
  const lastMs = await $.store.get('durationMs')
  await update($, run, () => ({
    startedAt,
    now: startedAt,
    passed: 0,
    failed: [],
    total: typeof total === 'number' ? total : null,
    lastMs: typeof lastMs === 'number' ? lastMs : null,
  }))
  let isBusy = false
  let isDone = false
  const stop = async (result: string) => {
    if (isDone) return
    isDone = true
    timer.cancel()
    if (result === 'given-up') await update($, run, () => null)
    else await finish($, result === 'passed')
  }
  const timer = $.clock.every(POLL_MS, () => {
    if (isBusy || isDone) return
    isBusy = true
    void tick($, log, startedAt)
      .then(result => (result === 'running' ? undefined : stop(result)))
      .finally(() => {
        isBusy = false
      })
  })
  return async (isPassed: boolean) => {
    if (isDone) return
    const result = await tick($, log, startedAt)
    await stop(result === 'running' ? (isPassed ? 'passed' : 'failed') : result)
  }
}

const bar = (done: number, total: number, columns: number) => {
  const filled = Math.min(columns, Math.round((done / Math.max(1, total)) * columns))
  return { filled: '█'.repeat(filled), empty: '░'.repeat(columns - filled) }
}

export const register: Register = on => {
  let root = ''

  on('session.start', async ($, e, next) => {
    root = e.cwd
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const log = testLog(e.command, root)
    if (log === undefined) return next(e)

    const end = await watch($, log)
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
          <Text bold>🧪 make test  </Text>
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
