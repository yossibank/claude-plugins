import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fill } from '../types'

const CREATE = new RegExp(['\\bgh', 'pr', 'create\\b'].join('\\s+'))
const PR_NUMBER = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g
const STEPS = ['⣀', '⣄', '⣤', '⣦', '⣶', '⣷', '⣿']
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
const YELLOW_AT = 50
const RED_AT = 80
const SLACK_COLUMNS = 2
const PANE = 'context-gauge'
const TITLE = '📊 Context'
const WATCH_MS = 2000

const fill = atom({ plugin: 'context-gauge', key: 'fill' } as const, null, { shape: 'fill-1' })
const pullRequest = atom({ plugin: 'context-gauge', key: 'pullRequest' } as const, null)
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
  const { context } = await $.session.usage({ breakdown: 'summary' })
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

const braille = (fraction: number, columns: number) => {
  const exact = Math.max(0, Math.min(1, fraction)) * columns
  const full = Math.floor(exact)
  const rest = exact - full
  const head = full < columns && rest > 0 ? (STEPS[Math.min(STEPS.length - 1, Math.floor(rest * STEPS.length))] ?? '') : ''
  return { filled: FULL.repeat(full) + head, empty: (STEPS[0] ?? '').repeat(columns - full - (head === '' ? 0 : 1)) }
}

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

const watchPane = async ($: EngineInterface) => {
  const shown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
  if (shown !== (await read($, isPaneShown))) await update($, isPaneShown, () => shown)
}

const tone = (measured: Fill, pr: number | null) => {
  const isLate = measured.percent >= RED_AT || pr !== null
  const color: keyof typeof GRADIENTS = isLate ? 'error' : measured.percent >= YELLOW_AT ? 'warning' : 'success'
  return { isLate, color }
}

const note = (measured: Fill, pr: number | null, isLate: boolean) =>
  pr !== null ? `🧹 PR #${pr} → /clear` : isLate ? '🧹 /clear' : `${thousands(measured.tokens)} / ${thousands(measured.window)}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, pullRequest, () => null)
    await measure($)
    await $.command.register({ name: 'context-gauge', description: '文脈の量を右の pane に出す' })
    void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(WATCH_MS, () => void watchPane($))
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

    const pr = await read($, pullRequest)
    const { isLate, color } = tone(measured, pr)
    const legend = [...measured.slices].sort((a, b) => b.tokens - a.tokens)
    const nameColumns = Math.max(...legend.map(slice => cellWidth(slice.name)), 4)
    const barColumns = Math.max(4, e.props.bodyColumns - 2 - nameColumns - 1 - 7)
    const [from, to] = GRADIENTS[color]
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
        <Box flexDirection="column">
          {legend.map(slice => {
            const bar = braille(slice.tokens / measured.window, barColumns)
            return (
              <Text>
                <Text dimColor>{pad(slice.name, nameColumns)} </Text>
                <Text color={slice.color}>{bar.filled}</Text>
                <Text dimColor>{bar.empty}</Text>
                <Text>{thousands(slice.tokens).padStart(7)}</Text>
              </Text>
            )
          })}
        </Box>
        <Text color={isLate ? 'error' : undefined} dimColor={!isLate} bold={isLate}>
          {pr !== null ? `🧹 PR #${pr} を作ったので /clear` : isLate ? '🧹 /clear の頃合い' : `🧹 ${RED_AT}% で /clear`}
        </Text>
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await measure($)
    return done
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !CREATE.test(e.command)) return ran
    const number = [...(ran.text ?? '').matchAll(PR_NUMBER)].at(-1)?.[1]
    if (number !== undefined) await update($, pullRequest, () => Number(number))
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const measured = await read($, fill)
    if (e.props.hasSurvey || measured === null || measured.window === 0 || (await read($, isPaneShown))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const beneath = await next(e)
    const pr = await read($, pullRequest)
    const { isLate, color } = tone(measured, pr)
    const percent = `${measured.percent}%`
    const right = note(measured, pr, isLate)
    const fixed = 2 + cellWidth(percent) + 2 + 2 + cellWidth(right) + SLACK_COLUMNS
    const columns = Math.max(8, e.props.bodyColumns - fixed)
    const cells = widths([...measured.slices.map(slice => slice.tokens), measured.free + measured.buffer], columns)
    const legend = [...measured.slices].sort((a, b) => b.tokens - a.tokens)

    return (
      <Box flexDirection="column">
        <Text>
          <Text color={color}>● </Text>
          <Text bold color={isLate ? 'error' : undefined}>{percent}</Text>
          <Text>  </Text>
          {measured.slices.map((slice, index) => (
            <Text color={slice.color}>{FULL.repeat(cells[index] ?? 0)}</Text>
          ))}
          <Text dimColor>{STEPS[0]?.repeat(cells[measured.slices.length] ?? 0)}</Text>
          <Text color={isLate ? 'error' : undefined} dimColor={!isLate} bold={isLate}>  {right}</Text>
        </Text>
        {!isLate && (
          <Text>
            {legend.map(slice => (
              <Text>
                <Text color={slice.color}>   ●</Text>
                <Text dimColor> {slice.name} {thousands(slice.tokens)}</Text>
              </Text>
            ))}
          </Text>
        )}
        {beneath}
      </Box>
    )
  })
}
