import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Fill, Upcoming } from '../types'

const NEXT_LINE = /^\s*[-*]\s*次[：:]\s*(.*)$/
const NEXT_ITEM = /(?:^|\s)\d+[.．]\s+/
const NEXT_HEAD = '📌 次  '
const EMPTY = '⣀'
const FULL = '⣿'
const DIGITS: Record<string, [string, string, string]> = {
  '0': ['┏━┓', '┃ ┃', '┗━┛'],
  '1': ['╺┓ ', ' ┃ ', '╺┻╸'],
  '2': ['┏━┓', '┏━┛', '┗━╸'],
  '3': ['┏━┓', ' ━┫', '┗━┛'],
  '4': ['╻ ╻', '┗━┫', '  ╹'],
  '5': ['┏━╸', '┗━┓', '┗━┛'],
  '6': ['┏━╸', '┣━┓', '┗━┛'],
  '7': ['┏━┓', '  ┃', '  ╹'],
  '8': ['┏━┓', '┣━┫', '┗━┛'],
  '9': ['┏━┓', '┗━┫', '┗━┛'],
  '%': ['█ ▞', ' ▞ ', '▞ █'],
}
const GRADIENTS = {
  success: ['#6edc8c', '#50c8e6'],
  warning: ['#f0c850', '#f08c46'],
  error: ['#fa9650', '#f05050'],
} as const
const NAMES: Record<string, string> = {
  'System prompt': 'システム',
  'System tools': 'ツール',
  'MCP tools': 'MCP',
  'Custom agents': 'エージェント',
  'Memory files': 'メモリ',
  Skills: 'スキル',
  Messages: '会話',
}
const SLACK_COLUMNS = 2
const PANE = 'context-gauge'
const TITLE = '📊 Context'
const WATCH_MS = 2000

const fill = atom({ plugin: 'context-gauge', key: 'fill' } as const, null, { shape: 'fill-1' })
const lastTurnEnd = atom({ plugin: 'context-gauge', key: 'lastTurnEnd' } as const, null)
const sessionStart = atom({ plugin: 'context-gauge', key: 'sessionStart' } as const, null)
const upcoming = atom({ plugin: 'context-gauge', key: 'upcoming' } as const, null)
const tick = atom({ plugin: 'context-gauge', key: 'tick' } as const, 0)
const isPaneShown = atom({ plugin: 'context-gauge', key: 'isPaneShown' } as const, false)

const thousands = (tokens: number) => {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
]

const cellWidth = (text: string) =>
  [...text].reduce((sum, char) => {
    const code = char.codePointAt(0) ?? 0
    return sum + (WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1)
  }, 0)

const measure = async ($: EngineInterface) => {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  if (usage === undefined) return
  const { context } = usage
  const rows = context.breakdown?.categories ?? []
  const of = (kind: string) => rows.filter(row => row.kind === kind).reduce((sum, row) => sum + row.tokens, 0)
  const measured: Fill = {
    slices: rows
      .filter(row => row.kind === 'used' && row.tokens > 0)
      .map(row => ({ name: NAMES[row.name] ?? row.name, tokens: row.tokens, color: row.color })),
    free: of('free'),
    buffer: of('buffer'),
    tokens: context.tokens ?? context.breakdown?.totalTokens ?? 0,
    window: context.window,
    percent: context.percent ?? context.breakdown?.percentage ?? 0,
  }
  await update($, fill, () => measured)
}

const digits = (text: string) => [0, 1, 2].map(row => [...text].map(char => DIGITS[char]?.[row] ?? '   ').join(' '))

const mix = (from: string, to: string, t: number) =>
  `#${[1, 3, 5]
    .map(at => Math.round(parseInt(from.slice(at, at + 2), 16) * (1 - t) + parseInt(to.slice(at, at + 2), 16) * t))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')}`

const widths = (parts: number[], columns: number) => {
  const total = parts.reduce((sum, part) => sum + part, 0)
  if (total === 0) return parts.map(() => 0)
  const exact = parts.map(part => (part / total) * columns)
  const cells = exact.map(Math.floor)
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest)
  for (let left = columns - cells.reduce((sum, cell) => sum + cell, 0), i = 0; left > 0; left -= 1, i += 1) {
    const at = order[i % order.length]?.index ?? 0
    cells[at] = (cells[at] ?? 0) + 1
  }
  return cells
}

const tone = (measured: Fill, config: Config): keyof typeof GRADIENTS =>
  measured.percent >= config.redAt ? 'error' : measured.percent >= config.yellowAt ? 'warning' : 'success'

type Config = {
  cacheMs: number
  yellowAt: number
  redAt: number
  handoffPath: string
}

const DEFAULT_YELLOW = 50
const DEFAULT_RED = 80

const configure = (options: PluginOptions): Config => {
  const yellow = Number(options.yellowAt ?? DEFAULT_YELLOW)
  const red = Number(options.redAt ?? DEFAULT_RED)
  const isValid = Number.isFinite(yellow) && Number.isFinite(red) && red >= yellow
  return {
    cacheMs: Number(options.cacheMinutes ?? '60') * 60_000,
    yellowAt: isValid ? yellow : DEFAULT_YELLOW,
    redAt: isValid ? red : DEFAULT_RED,
    handoffPath: String(options.handoffPath ?? '.claude/handoff.md'),
  }
}

let watcher: Timer | undefined
let handoffFile: string | undefined

const resolveHandoff = async ($: EngineInterface, config: Config) => {
  const cwd = await $.session.cwd()
  const top = await $.process
    .run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    .then(result => (result.exitCode === 0 ? result.stdout.trim() : ''))
    .catch(() => '')
  const base = top === '' ? cwd : top
  return config.handoffPath.startsWith('/') ? config.handoffPath : `${base.replace(/\/$/, '')}/${config.handoffPath}`
}

const handoffOf = async ($: EngineInterface, config: Config) => {
  handoffFile ??= await resolveHandoff($, config)
  return handoffFile
}

const parseNext = (text: string): string[] => {
  const lines = text.split('\n')
  const at = lines.findIndex(line => NEXT_LINE.test(line))
  if (at < 0) return []
  const chunks = [NEXT_LINE.exec(lines[at] ?? '')?.[1] ?? '']
  for (const line of lines.slice(at + 1)) {
    if (!/^\s+\S/.test(line)) break
    chunks.push(line.trim())
  }
  return chunks
    .join(' ')
    .split(NEXT_ITEM)
    .map(item => item.trim())
    .filter(item => item !== '')
}

const readUpcoming = async ($: EngineInterface, config: Config): Promise<Upcoming | null> => {
  const path = await handoffOf($, config)
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat === undefined) return null
  const text = await $.fs.read(path).catch(() => '')
  const items = parseNext(typeof text === 'string' ? text : '')
  return items.length === 0 ? null : { items, mtimeMs: stat.mtimeMs }
}

const begin = async ($: EngineInterface, config: Config) => {
  handoffFile = undefined
  const now = await $.clock.now()
  const found = await readUpcoming($, config)
  await update($, sessionStart, () => now)
  await update($, lastTurnEnd, () => null)
  await update($, upcoming, () => found)
}

const restart = async ($: EngineInterface, config: Config) => {
  await begin($, config)
  await measure($)
}

const watchPane = async ($: EngineInterface) => {
  const shown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
  if (shown !== (await read($, isPaneShown))) await update($, isPaneShown, () => shown)
  const minute = Math.floor((await $.clock.now()) / 60_000)
  if (minute !== (await read($, tick))) await update($, tick, () => minute)
}

// キャッシュが切れるまでの分数。切れていたら null
const cacheLeft = async ($: EngineInterface, config: Config): Promise<number | null> => {
  const now = await $.clock.now()
  const start = await read($, sessionStart)
  const lastTurn = await read($, lastTurnEnd)
  const since = now - (lastTurn ?? start ?? now)
  return since >= config.cacheMs ? null : Math.max(1, Math.ceil((config.cacheMs - since) / 60_000))
}

const nextOf = async ($: EngineInterface, config: Config): Promise<string[]> => {
  const ahead = await read($, upcoming)
  if (ahead === null) return []
  const stat = await $.fs.stat(await handoffOf($, config)).catch(() => undefined)
  return stat === undefined || stat.mtimeMs <= ahead.mtimeMs ? ahead.items.map((item, index) => `${index + 1}. ${item}`) : []
}

const nextRows = (next: string[]) => next.map((item, index) => (index === 0 ? `${NEXT_HEAD}${item}` : `${' '.repeat(cellWidth(NEXT_HEAD))}${item}`))

export const register: Register = (on, options) => {
  const config = configure(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await restart($, config)
    await $.command.register({ name: 'context-gauge', description: '文脈の量を右の pane に出す' })
    void $.ui.open({ id: PANE, title: TITLE })
    watcher?.cancel()
    watcher = $.clock.every(WATCH_MS, () => void watchPane($))
    return started
  })

  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    if (e.source === 'clear') await restart($, config)
    return started
  })

  on('command.run', { command: 'context-gauge' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await watchPane($)
    return { text: '文脈の量を右の pane に出しました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const measured = await read($, fill)
    if (measured === null || measured.window === 0) return <Text dimColor>まだ測っていません。</Text>

    await read($, tick)
    const left = await cacheLeft($, config)
    const next = await nextOf($, config)
    const legend = [...measured.slices].sort((a, b) => b.tokens - a.tokens)
    const nameColumns = Math.max(...legend.map(slice => cellWidth(slice.name)))
    const tokenColumns = Math.max(...legend.map(slice => thousands(slice.tokens).length))
    const columns = Math.max(8, e.props.bodyColumns - 2)
    const cells = widths([...measured.slices.map(slice => slice.tokens), measured.free + measured.buffer], columns)
    const [from, to] = GRADIENTS[tone(measured, config)]
    const pad = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
        <Box flexDirection="column">
          {digits(`${measured.percent}%`).map(row => (
            <Text bold>
              {[...row].map((char, index) => (
                <Text color={mix(from, to, index / Math.max(1, row.length - 1))}>{char}</Text>
              ))}
            </Text>
          ))}
          <Text dimColor>
            {thousands(measured.tokens)} / {thousands(measured.window)} · 空き {thousands(measured.free)}
          </Text>
        </Box>
        <Text>
          {measured.slices.map((slice, index) => (
            <Text color={slice.color}>{FULL.repeat(cells[index] ?? 0)}</Text>
          ))}
          <Text dimColor>{EMPTY.repeat(cells[measured.slices.length] ?? 0)}</Text>
        </Text>
        <Box flexDirection="column">
          {legend.map(slice => (
            <Text>
              <Text color={slice.color}>●</Text>
              <Text> {pad(slice.name, nameColumns)} </Text>
              <Text>{thousands(slice.tokens).padStart(tokenColumns)}</Text>
              <Text dimColor>{`${Math.round((slice.tokens / measured.window) * 100)}%`.padStart(5)}</Text>
            </Text>
          ))}
        </Box>
        <Text>{left === null ? '⏱ キャッシュは切れています' : `⏱ キャッシュ切れまで ${left} 分`}</Text>
        {next.length > 0 && (
          <Box flexDirection="column">
            {nextRows(next).map(row => (
              <Text>{row}</Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, lastTurnEnd, () => now)
    }
    await measure($)
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const measured = await read($, fill)
    if (e.props.hasSurvey || measured === null || measured.window === 0 || (await read($, isPaneShown))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const beneath = await next(e)
    await read($, tick)
    const left = await cacheLeft($, config)
    const percent = `${measured.percent}%`
    const color = tone(measured, config)
    const right = `${thousands(measured.tokens)} / ${thousands(measured.window)} · ${left === null ? 'キャッシュ切れ' : `キャッシュ ${left} 分`}`
    const fixed = 2 + cellWidth(percent) + 2 + 2 + cellWidth(right) + SLACK_COLUMNS
    const columns = Math.max(8, e.props.bodyColumns - fixed)
    const cells = widths([...measured.slices.map(slice => slice.tokens), measured.free + measured.buffer], columns)

    return (
      <Box flexDirection="column">
        <Text>
          <Text color={color}>● </Text>
          <Text bold color={color}>{percent}</Text>
          <Text>  </Text>
          {measured.slices.map((slice, index) => (
            <Text color={slice.color}>{FULL.repeat(cells[index] ?? 0)}</Text>
          ))}
          <Text dimColor>{EMPTY.repeat(cells[measured.slices.length] ?? 0)}</Text>
          <Text dimColor>  {right}</Text>
        </Text>
        {beneath}
      </Box>
    )
  })
}
