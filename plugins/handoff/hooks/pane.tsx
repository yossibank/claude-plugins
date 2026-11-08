import type { Elements, RenderSurface } from 'claude-code'

import type { Facts, Fill, Handoff, Step } from '../types'

import { MAX_LINES, nextOf, unverifiedOf } from './memo'

type Ui = Elements['terminal']

export type Actions = {
  start: () => void
  later: () => void
  begin: () => void
  copy: (surface: RenderSurface | undefined) => void
  open: () => void
  close: () => void
}

const MARK = { waiting: '○', running: '◐', done: '✓', failed: '✖' } as const
const COLOR = { waiting: 'inactive', running: 'warning', done: 'success', failed: 'error' } as const
// 引き継いだ後の会話に、メモのほかに入る分の目安
const MEMO_TOKENS = 1000

export const bar = (ratio: number, columns: number, full = '━', empty = '─') => {
  const filled = Math.max(0, Math.min(columns, Math.round(ratio * columns)))
  return [full.repeat(filled), empty.repeat(columns - filled)] as const
}

export const kilo = (tokens: number) => (tokens >= 1_000_000 ? `${Number((tokens / 1_000_000).toFixed(1))}M` : tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens))

export const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export const ago = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'いま'
  if (minutes < 60) return `${minutes} 分前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} 時間前` : `${Math.floor(hours / 24)} 日前`
}

type Draw = { ui: Ui; now: Handoff; at: number; columns: number; actions: Actions }

export function drawPane({ ui, now, at, columns, actions }: Draw) {
  const { Box, Text, Button, Markdown } = ui
  const width = Math.max(24, columns - 2)
  const half = Math.floor((width - 1) / 2)
  const accent = now.phase === 'failed' ? 'error' : now.phase === 'ready' ? 'success' : 'warning'
  const fill: Fill | null = now.phase === 'idle' ? null : now.fill
  const facts: Facts | null = now.phase === 'idle' ? null : now.facts
  const steps: Step[] = now.phase === 'building' || now.phase === 'ready' || now.phase === 'failed' ? now.steps : []
  const isQuiet = now.phase === 'idle' || now.phase === 'offered'

  const section = (title: string, right?: string) => (
    <Box justifyContent="space-between" marginTop={1}>
      <Text bold dimColor>
        {title}
      </Text>
      {right !== undefined && <Text dimColor>{right}</Text>}
    </Box>
  )

  // 数字のタイル：名前、大きな数字、下に補足か棒
  const tile = (label: string, value: string, sub: string, color: string, ratio?: number) => {
    const drawn = ratio === undefined ? undefined : bar(ratio, Math.max(6, half - 4), '▰', '▱')
    return (
      <Box key={label} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={half}>
        <Text dimColor>{label}</Text>
        <Text bold color={color}>
          {value}
        </Text>
        {drawn === undefined ? (
          <Text dimColor wrap="truncate-end">
            {sub}
          </Text>
        ) : (
          <Text>
            <Text color={color}>{drawn[0]}</Text>
            <Text dimColor>{drawn[1]}</Text>
          </Text>
        )}
      </Box>
    )
  }

  // キーキャップのボタン：枠で囲む。押すキーは plain の Button が左に「r:」と描く。主のボタンは色の枠で横いっぱい
  const button = (key: string, hotkey: string, icon: string, label: string, kind: 'primary' | 'secondary' | 'quiet', onPress: (surface: RenderSurface | undefined) => void, color = 'success') => (
    <Box key={key} borderStyle="round" borderColor={kind === 'primary' ? color : 'inactive'} paddingX={1} flexGrow={kind === 'primary' ? 1 : 0}>
      <Button key={key} plain hotkey={hotkey} label={`${icon} ${label}`} dimColor={kind === 'quiet'} onPress={press => onPress(press.surface)} />
    </Box>
  )

  const headline =
    now.phase === 'idle'
      ? { mark: '○', text: '引き継ぎはまだありません', right: '' }
      : now.phase === 'offered'
        ? { mark: '●', text: '引き継ぎどき', right: `要約まで あと ${kilo(Math.max(0, now.fill.window - now.fill.tokens))}` }
        : now.phase === 'building'
          ? { mark: '◐', text: '引き継ぎを作成中', right: `${clock(now.now - now.startedAt)} · 目安 ${clock(now.expectedMs)}` }
          : now.phase === 'ready'
            ? { mark: '✓', text: '引き継ぎ完成', right: `${now.lines} 行 · ${now.chars} 字` }
            : { mark: '✖', text: '作れませんでした', right: '' }

  const header = (
    <Box flexDirection="column">
      {facts !== null && (
        <Box justifyContent="space-between">
          <Text dimColor wrap="truncate-end">
            {facts.repo}
            {facts.branch !== '' && <Text color="suggestion"> ⎇ {facts.branch}</Text>}
          </Text>
          <Text dimColor>{facts.previousMs === null ? '前回なし' : `前回 ${ago(at - facts.previousMs)}`}</Text>
        </Box>
      )}
      <Box justifyContent="space-between" marginTop={facts === null ? 0 : 1}>
        <Text bold color={accent}>
          {headline.mark} {headline.text}
        </Text>
        <Text dimColor>{headline.right}</Text>
      </Box>
      <Text color={accent}>{'━'.repeat(width)}</Text>
    </Box>
  )

  const memoTile = () => {
    const writing = steps[2]
    if (now.phase === 'ready') return tile('メモ', `${now.lines} 行`, '', 'success', Math.min(1, now.lines / MAX_LINES))
    if (now.phase === 'building' && writing !== undefined && writing.state === 'running') return tile('メモ', writing.detail, '書いています', 'warning', writing.ratio)
    if (now.phase === 'failed') return tile('メモ', '失敗', writing?.detail === '' ? '' : `${writing?.detail ?? ''}で止まった`, 'error')
    return tile('メモ', '—', 'まだ', 'inactive')
  }

  const tiles =
    now.phase === 'idle' ? null : (
      <Box flexDirection="column" marginTop={1}>
        <Box columnGap={1}>
          {fill === null ? tile('文脈', '—', '測れない', 'inactive') : tile('文脈', `${fill.percent}%`, '', 'warning', fill.percent / 100)}
          {facts === null
            ? tile('会話', '—', '読んでいます', 'inactive')
            : tile('会話', `${facts.messages} 件`, `${facts.turns} ターン · ${clock(at - facts.sessionStartedAt)}`, isQuiet ? 'inactive' : 'success')}
        </Box>
        <Box columnGap={1}>
          {facts === null
            ? tile('ファイル', '—', '集めています', 'inactive')
            : tile('ファイル', `${facts.files.length} 件`, `+${facts.added} −${facts.removed}`, isQuiet ? 'inactive' : 'success')}
          {memoTile()}
        </Box>
      </Box>
    )

  const advice = (() => {
    if (now.phase !== 'offered') return null
    const next = now.fill.fixed + MEMO_TOKENS
    const times = Math.round(now.fill.tokens / Math.max(1, next))
    return (
      <Box flexDirection="column">
        {section('いま区切ると')}
        <Text>
          <Text color="success">↓</Text> 次の会話の文脈{' '}
          <Text bold>
            {kilo(now.fill.tokens)} → 約 {kilo(next)}
          </Text>
        </Text>
        {times >= 2 && (
          <Text>
            <Text color="success">↓</Text> 1 回の要求の入力 <Text bold>約 {times} 分の 1</Text>
          </Text>
        )}
        <Text dimColor>要約に入ると、細かい決めごとが落ちやすい</Text>
      </Box>
    )
  })()

  const failure =
    now.phase === 'failed' ? (
      <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1} marginTop={1}>
        <Text color="error" bold>
          引き継ぎを作れませんでした
        </Text>
        <Text dimColor>{now.reason}</Text>
      </Box>
    ) : null

  const pipeline =
    steps.length === 0 ? null : (
      <Box flexDirection="column">
        {section('工程', `${steps.filter(step => step.state === 'done').length} / ${steps.length}`)}
        {steps.map(step => {
          const drawn = bar(step.ratio, Math.max(6, width - 28))
          return (
            <Box key={step.label} justifyContent="space-between">
              <Box width={20}>
                <Text color={COLOR[step.state]}>
                  {MARK[step.state]} <Text color={step.state === 'waiting' ? 'inactive' : undefined}>{step.label}</Text>
                </Text>
              </Box>
              <Text>
                <Text color={COLOR[step.state]}>{drawn[0]}</Text>
                <Text dimColor>{drawn[1]}</Text>
              </Text>
              <Box width={7} justifyContent="flex-end">
                <Text dimColor>{step.detail}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

  const buttons =
    now.phase === 'ready' ? (
      <Box flexDirection="column" marginTop={1}>
        <Box>{button('begin', 'n', '▶', '新しい会話で始める', 'primary', actions.begin)}</Box>
        <Box columnGap={1} flexWrap="wrap">
          {button('copy', 'c', '⧉', 'コピー', 'secondary', actions.copy)}
          {button('open', 'e', '↗', '開く', 'secondary', actions.open)}
          {button('redo', 'r', '↻', '書き直す', 'quiet', actions.start)}
        </Box>
      </Box>
    ) : now.phase === 'offered' || now.phase === 'idle' ? (
      <Box flexDirection="column" marginTop={1}>
        <Box>{button('start', 'h', '⇢', '引き継ぐ', 'primary', actions.start, 'warning')}</Box>
        <Box columnGap={1}>{button('later', 'l', '⏾', now.phase === 'idle' ? '閉じる' : 'あとで', 'quiet', now.phase === 'idle' ? actions.close : actions.later)}</Box>
      </Box>
    ) : now.phase === 'failed' ? (
      <Box columnGap={1} marginTop={1}>
        {button('retry', 'r', '↻', 'やり直す', 'primary', actions.start, 'error')}
        {button('close', 'x', '✕', '閉じる', 'quiet', actions.close)}
      </Box>
    ) : (
      <Box marginTop={1}>{button('hide', 'x', '✕', '隠す', 'quiet', actions.close)}</Box>
    )

  const details =
    now.phase === 'ready' ? (
      <Box flexDirection="column">
        {nextOf(now.text).length > 0 && section('次にすること', `${nextOf(now.text).length} 件`)}
        {nextOf(now.text).map((item, index) => (
          <Text key={`next-${index}`} wrap="truncate-end">
            <Text color="suggestion" bold>
              {' '}
              {index + 1}{' '}
            </Text>
            {item}
          </Text>
        ))}
        {unverifiedOf(now.text).map((item, index) => (
          <Text key={`unverified-${index}`} wrap="truncate-end">
            <Text color="warning"> ⚠ </Text>
            <Text dimColor>未検証：</Text>
            {item}
          </Text>
        ))}
        {section('メモ', now.path.split('/').slice(-2).join('/'))}
        <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
          <Markdown text={now.text} />
        </Box>
        {now.cost !== null && (
          <Text dimColor>
            作るのにかかった量 入力 {kilo(now.cost.input)}（キャッシュ {Math.round((now.cost.cacheRead / Math.max(1, now.cost.input)) * 100)}%）· 出力 {kilo(now.cost.output)} · {now.seconds} 秒
          </Text>
        )}
      </Box>
    ) : null

  return (
    <Box flexDirection="column" paddingX={1}>
      {header}
      {tiles}
      {advice}
      {failure}
      {pipeline}
      {buttons}
      {details}
    </Box>
  )
}
