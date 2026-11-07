import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Fill, Upcoming } from '../types'

const NEXT_LINE = /^\s*[-*]\s*次[：:]\s*(.*)$/
const NEXT_ITEM = /(?:^|\s)\d+[.．]\s+/
const INK = '#e8e8e8'
const MUTED = '#8b8f98'
const LINE = '#3a3d44'
const AMBER = '#f5a524'
const GRADES = [
  { name: 'S', from: 0.7, color: '#7ee0ff' },
  { name: 'A', from: 0.5, color: '#7fe0a0' },
  { name: 'B', from: 0.3, color: '#e8d27a' },
  { name: 'C', from: 0.15, color: '#f0a050' },
  { name: 'D', from: 0, color: '#f05a5a' },
] as const
const NAME_COLUMNS = 10
const PROMPT_BAR_MAX = 24
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

const meter = (ratio: number, columns: number) => {
  const full = Math.max(0, Math.min(columns, Math.round(ratio * columns)))
  return { full, empty: columns - full }
}

// 空きの割合で S〜D を決める
const gradeOf = (measured: Fill) => {
  const ratio = measured.window === 0 ? 0 : measured.free / measured.window
  return GRADES.find(grade => ratio >= grade.from) ?? GRADES[GRADES.length - 1]!
}

const kilo = (tokens: number) => `${(tokens / 1000).toFixed(1)}k`

type Config = {
  cacheMs: number
  handoffPath: string
}

const configure = (options: PluginOptions): Config => ({
  cacheMs: Number(options.cacheMinutes ?? '60') * 60_000,
  handoffPath: String(options.handoffPath ?? '.claude/handoff.md'),
})

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
  return stat === undefined || stat.mtimeMs <= ahead.mtimeMs ? ahead.items : []
}

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
    const grade = gradeOf(measured)
    const legend = [...measured.slices].sort((a, b) => b.tokens - a.tokens)
    const inner = Math.max(1, e.props.bodyColumns - 2)
    const nameColumns = Math.max(NAME_COLUMNS, ...legend.map(slice => cellWidth(slice.name)))
    const percent = `${measured.percent}%`
    const clock = left === null ? 'cold' : `${left}m`
    const top = Math.max(...legend.map(slice => slice.tokens), 1)
    const usedBar = meter(measured.percent / 100, Math.max(4, inner - cellWidth(percent) - 2))
    const legendBar = Math.max(4, inner - (2 + nameColumns + 7 + 6 + 2))
    const cacheBar = meter(left === null ? 0 : (left * 60_000) / config.cacheMs, Math.max(4, inner - 7 - cellWidth(clock) - 2))
    const pad = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))
    const rule = <Text color={LINE}>{'─'.repeat(inner)}</Text>

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text>
          <Text color={MUTED}>CONTEXT</Text>
          <Text>{' '.repeat(Math.max(1, inner - 7 - 7))}</Text>
          <Text color={MUTED}>GRADE </Text>
          <Text bold color={grade.color}>{grade.name}</Text>
        </Text>
        <Text>
          <Text bold color={INK}>{percent}</Text>
          <Text>  </Text>
          <Text color={AMBER}>{'▰'.repeat(usedBar.full)}</Text>
          <Text color={LINE}>{'▱'.repeat(usedBar.empty)}</Text>
        </Text>
        <Text color={MUTED}>
          {kilo(measured.tokens)} used · {kilo(measured.free)} free · {thousands(measured.window)}
        </Text>
        {rule}
        {legend.map(slice => {
          const bar = meter(slice.tokens / top, legendBar)
          return (
            <Text>
              <Text color={slice.color}>●</Text>
              <Text color={INK}> {pad(slice.name, nameColumns)}{kilo(slice.tokens).padStart(7)}</Text>
              <Text color={MUTED}>{`${((slice.tokens / measured.window) * 100).toFixed(1)}%`.padStart(6)}</Text>
              <Text>  </Text>
              <Text color={slice.color}>{'━'.repeat(bar.full)}</Text>
              <Text color={LINE}>{'─'.repeat(bar.empty)}</Text>
            </Text>
          )
        })}
        {rule}
        <Text>
          <Text color={MUTED}>CACHE  </Text>
          <Text bold color={INK}>{clock}</Text>
          <Text>  </Text>
          <Text color={AMBER}>{'━'.repeat(cacheBar.full)}</Text>
          <Text color={LINE}>{'─'.repeat(cacheBar.empty)}</Text>
        </Text>
        {next.map((item, index) => (
          <Text>
            <Text color={MUTED}>{index === 0 ? 'NEXT   ' : '       '}</Text>
            <Text color={INK}>{item}</Text>
          </Text>
        ))}
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
    const grade = gradeOf(measured)
    const percent = `${measured.percent}%`
    const used = `${thousands(measured.tokens)} / ${thousands(measured.window)}`
    const clock = `⏱ ${left === null ? 'cold' : `${left}m`}`
    const fixed = 2 + 1 + 2 + cellWidth(percent) + 2 + 2 + cellWidth(used) + 2 + 1 + 2 + cellWidth(clock) + SLACK_COLUMNS
    const bar = meter(measured.percent / 100, Math.max(4, Math.min(PROMPT_BAR_MAX, e.props.bodyColumns - fixed)))

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold color={grade.color}>◆ {grade.name}</Text>
          <Text>  </Text>
          <Text bold color={INK}>{percent}</Text>
          <Text>  </Text>
          <Text color={AMBER}>{'▰'.repeat(bar.full)}</Text>
          <Text color={LINE}>{'▱'.repeat(bar.empty)}</Text>
          <Text color={MUTED}>  {used}  ·  {clock}</Text>
        </Text>
        {beneath}
      </Box>
    )
  })
}
