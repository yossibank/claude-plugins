import type { Elements, RenderSurface } from 'claude-code'

import type { Change, Facts, Fill, Handoff, Step } from '../types'

import { isEmptyParts, MAX_LINES, partsOf } from './memo'

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
// 触ったファイルの一覧に出す件数。残りは「ほか N 件」にまとめる
const MAX_FILES = 6

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

// 長いパスは、後ろのファイル名を残して前を「…」にする。フォルダの区切りがあれば、そこで切る
export const tail = (path: string, columns: number) => {
  if ([...path].length <= columns) return path
  const kept = [...path].slice(1 - columns).join('')
  const slash = kept.indexOf('/')
  return `…${slash > 0 ? kept.slice(slash) : kept}`
}

// 差分の大きい順。同じなら元の並び
export const largest = (changes: Change[]) => [...changes].sort((a, b) => b.added + b.removed - (a.added + a.removed))

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

  // 数字のタイル：名前、大きな数字、棒、補足
  const tile = (label: string, value: string, sub: string, color: string, ratio?: number) => {
    const drawn = ratio === undefined ? undefined : bar(ratio, Math.max(6, half - 4), '▰', '▱')
    return (
      <Box key={label} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={half}>
        <Text dimColor>{label}</Text>
        <Text bold color={color}>
          {value}
        </Text>
        {drawn !== undefined && (
          <Text>
            <Text color={color}>{drawn[0]}</Text>
            <Text dimColor>{drawn[1]}</Text>
          </Text>
        )}
        {(sub !== '' || drawn === undefined) && (
          <Text dimColor wrap="truncate-end">
            {sub}
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
    if (now.phase === 'ready') return tile('メモ', `${now.lines} 行`, `上限 ${MAX_LINES} 行 · ${now.chars} 字`, 'success', Math.min(1, now.lines / MAX_LINES))
    if (now.phase === 'building' && writing !== undefined && writing.state === 'running') return tile('メモ', writing.detail, '書いています', 'warning', writing.ratio)
    if (now.phase === 'failed') return tile('メモ', '失敗', writing?.detail === '' ? '' : `${writing?.detail ?? ''}で止まった`, 'error')
    return tile('メモ', '—', 'まだ', 'inactive')
  }

  const tiles =
    now.phase === 'idle' ? null : (
      <Box flexDirection="column" marginTop={1}>
        <Box columnGap={1}>
          {fill === null ? tile('文脈', '—', '測れない', 'inactive') : tile('文脈', `${fill.percent}%`, `${kilo(fill.tokens)} / ${kilo(fill.window)}`, fill.percent >= 90 ? 'error' : 'warning', fill.percent / 100)}
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
        <Text>
          <Text dimColor>内訳</Text> 会話 <Text bold>{kilo(Math.max(0, now.fill.tokens - now.fill.fixed))}</Text>
          <Text dimColor> · 区切っても残る分 {kilo(now.fill.fixed)}</Text>
        </Text>
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

  // 完成した後は、工程は 1 行にまとめてメモを上に出す
  const pipeline =
    steps.length === 0 || now.phase === 'ready' ? null : (
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

  // 触ったファイルの一覧。差分の大きい順に、ファイルごとの +追加 −削除 を出す
  const files = (() => {
    if (facts === null || facts.changes.length === 0) return null
    const shown = largest(facts.changes).slice(0, MAX_FILES)
    const rest = facts.changes.length - shown.length
    return (
      <Box flexDirection="column">
        {section('触ったファイル', facts.dirty === null ? `${facts.changes.length} 件` : facts.dirty === 0 ? 'すべて commit 済み' : `未 commit ${facts.dirty} 件`)}
        {shown.map(change => (
          <Box key={`file-${change.path}`} justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text color={change.isNew ? 'success' : change.added + change.removed > 0 ? 'warning' : 'inactive'}>{change.isNew ? '+' : change.added + change.removed > 0 ? '●' : '○'}</Text>{' '}
              {tail(change.path, Math.max(8, width - 16))}
            </Text>
            {change.added + change.removed === 0 ? (
              <Text dimColor>変更なし</Text>
            ) : (
              <Text>
                {change.isNew && <Text dimColor>新規 </Text>}
                <Text color="success">+{change.added}</Text> <Text color="error">−{change.removed}</Text>
              </Text>
            )}
          </Box>
        ))}
        {rest > 0 && <Text dimColor>  ほか {rest} 件</Text>}
      </Box>
    )
  })()

  // メモの 1 項目：色の付いた名前の下に、中身を印付きで並べる
  const part = (title: string, color: string, items: string[], mark: (index: number) => string, right?: string) =>
    items.length === 0 ? null : (
      <Box key={title} flexDirection="column" marginTop={1}>
        <Box justifyContent="space-between">
          <Text bold color={color}>
            {title}
          </Text>
          {right !== undefined && <Text dimColor>{right}</Text>}
        </Box>
        {items.map((item, index) => (
          <Text key={`${title}-${index}`}>
            <Text color={color} bold>
              {' '}
              {mark(index)}{' '}
            </Text>
            {item}
          </Text>
        ))}
      </Box>
    )

  const details = (() => {
    if (now.phase !== 'ready') return null
    const parts = partsOf(now.text)
    return (
      <Box flexDirection="column">
        {section('引き継ぎメモ', now.path.split('/').slice(-2).join('/'))}
        {isEmptyParts(parts) ? (
          // 決まりの形で返ってこなかった時は、全文をそのまま出す
          <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
            <Markdown text={now.text} />
          </Box>
        ) : (
          <Box flexDirection="column" borderStyle="round" borderColor="success" paddingX={1} paddingBottom={1}>
            {part('目的', 'success', parts.goal === '' ? [] : [parts.goal], () => '◎')}
            {part('次にすること', 'suggestion', parts.next, index => String(index + 1), `${parts.next.length} 件`)}
            {part('決めたこと', 'success', parts.decisions, () => '✓', `${parts.decisions.length} 件`)}
            {part('未検証', 'warning', parts.unverified, () => '⚠', `${parts.unverified.length} 件`)}
            {part('メモに書いたファイル', 'inactive', parts.files, () => '·')}
          </Box>
        )}
        {files}
        <Box marginTop={1}>
          <Text dimColor>
            工程 {steps.filter(step => step.state === 'done').length} / {steps.length} · {now.seconds} 秒
            {now.cost !== null && ` · 入力 ${kilo(now.cost.input)}（キャッシュ ${Math.round((now.cost.cacheRead / Math.max(1, now.cost.input)) * 100)}%）· 出力 ${kilo(now.cost.output)}`}
          </Text>
        </Box>
      </Box>
    )
  })()

  return (
    <Box flexDirection="column" paddingX={1}>
      {header}
      {tiles}
      {advice}
      {failure}
      {pipeline}
      {buttons}
      {now.phase === 'ready' ? null : files}
      {details}
    </Box>
  )
}
