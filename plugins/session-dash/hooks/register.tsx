import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Activity, Claude, Fill, Limit, Phase, Repo, Upcoming } from '../types'

const NEXT_LINE = /^\s*[-*]\s*次[：:]\s*(.*)$/
const NEXT_ITEM = /(?:^|\s)\d+[.．]\s+/
// pane は Tokyo Night、帯は Tokyo Night Moon の色
const TN = {
  fg: '#c0caf5',
  fgDark: '#a9b1d6',
  comment: '#565f89',
  line: '#3b4261',
  bgHighlight: '#292e42',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  magenta: '#bb9af7',
  green: '#9ece6a',
  orange: '#ff9e64',
  red: '#f7768e',
  yellow: '#e0af68',
  teal: '#73daca',
}
const MOON = {
  fg: '#c8d3f5',
  comment: '#636da6',
  blue: '#82aaff',
  cyan: '#86e1fc',
  magenta: '#c099ff',
  green: '#c3e88d',
  orange: '#ff966c',
  red: '#ff757f',
  yellow: '#ffc777',
  teal: '#4fd6be',
}
const HEAT = [TN.teal, TN.yellow, TN.orange, TN.red]
// Nerd Font のアイコン
const ICON = {
  model: '\u{F06A9}',
  repo: '\uf401',
  branch: '\ue725',
  limit: '\u{F029A}',
  context: '\u{F09D1}',
  cache: '\u{F01BC}',
  next: '\uf04e',
  now: '\u{F140B}',
}
const MIN_INNER = 20
const GRADES = [
  { name: 'S', from: 0.7, color: '#7ee0ff' },
  { name: 'A', from: 0.5, color: '#7fe0a0' },
  { name: 'B', from: 0.3, color: '#e8d27a' },
  { name: 'C', from: 0.15, color: '#f0a050' },
  { name: 'D', from: 0, color: '#f05a5a' },
] as const
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
const PANE = 'session-dash'
const TITLE = '📊 Session'
const WATCH_MS = 2000

const fill = atom({ plugin: 'session-dash', key: 'fill' } as const, null, { shape: 'fill-1' })
const lastTurnEnd = atom({ plugin: 'session-dash', key: 'lastTurnEnd' } as const, null)
const sessionStart = atom({ plugin: 'session-dash', key: 'sessionStart' } as const, null)
const upcoming = atom({ plugin: 'session-dash', key: 'upcoming' } as const, null)
const tick = atom({ plugin: 'session-dash', key: 'tick' } as const, 0)
const isPaneShown = atom({ plugin: 'session-dash', key: 'isPaneShown' } as const, false)
const claude = atom({ plugin: 'session-dash', key: 'claude' } as const, null)
const repo = atom({ plugin: 'session-dash', key: 'repo' } as const, null)
const IDLE: Activity = { isWorking: false, task: null, said: null, tool: null, phase: null, startedAt: null }
const activity = atom({ plugin: 'session-dash', key: 'activity' } as const, IDLE)
const second = atom({ plugin: 'session-dash', key: 'second' } as const, 0)

const GIT_MS = 2000
const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }
// 2 行目に出さない、作業の中身を表さないツール
const QUIET_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite', 'ToolSearch'])
const GIT_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit'])

const thousands = (tokens: number) => {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x26a1, 0x26a1],
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

// 幅に収まらなければ末尾を … にする
const fit = (text: string, width: number) => {
  if (cellWidth(text) <= width) return text
  let out = ''
  for (const char of text) {
    if (cellWidth(out + char) > width - 1) break
    out += char
  }
  return `${out}…`
}

// claude-opus-5-5 を Opus 5.5 にする
const modelName = (id: string) => {
  const found = /^(?:claude-)?([a-z]+)(?:-(\d+)-(\d+))?/.exec(id)
  if (found === null) return id
  const name = found[1]!.charAt(0).toUpperCase() + found[1]!.slice(1)
  return found[2] === undefined ? name : `${name} ${found[2]}.${found[3]}`
}

const untilReset = (resetsAt: string | undefined, now: number) => {
  if (resetsAt === undefined) return ''
  const minutes = Math.floor((Date.parse(resetsAt) - now) / 60_000)
  if (Number.isNaN(minutes)) return ''
  if (minutes <= 0) return 'soon'
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)}d${hours % 24}h`
  return hours > 0 ? `${hours}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
}

const limitsOf = (limits: readonly Limit[]): Limit[] =>
  limits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }) }))

let version: string | undefined

const readClaude = async ($: EngineInterface) => {
  version ??= (await $.session.version().catch(() => undefined))?.version ?? ''
  const model = await $.session.model().catch(() => '')
  const usage = await $.session.usage().catch(() => undefined)
  const before = await read($, claude)
  const next: Claude = {
    model: modelName(model),
    version,
    usd: usage?.cost?.usd ?? before?.usd ?? null,
    limits: usage === undefined ? (before?.limits ?? []) : limitsOf(usage.rateLimits),
  }
  await update($, claude, () => next)
}

// origin の URL から owner/repo を取る
const repoName = (remote: string | null, root: string) => {
  const found = remote === null ? null : /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote)
  return found?.[1] ?? root.replace(/\/$/, '').split('/').pop() ?? ''
}

let gitAt = 0

const readRepo = async ($: EngineInterface, isForced = false) => {
  const now = await $.clock.now()
  if (!isForced && now - gitAt < GIT_MS) return
  gitAt = now
  const found = await $.session.repo().catch(() => null)
  if (found === null) {
    await update($, repo, () => null)
    return
  }
  const cwd = await $.session.cwd()
  const git = (args: string[]) =>
    $.process
      .run(['git', ...args], { cwd })
      .then(result => (result.exitCode === 0 ? result.stdout : ''))
      .catch(() => '')
  const [branch, numstat, status] = await Promise.all([git(['branch', '--show-current']), git(['diff', 'HEAD', '--numstat']), git(['status', '--porcelain'])])
  const sum = (column: number) =>
    numstat
      .split('\n')
      .filter(line => line !== '')
      .map(line => Number(line.split('\t')[column]))
      .filter(count => Number.isFinite(count))
      .reduce((total, count) => total + count, 0)
  const next: Repo = {
    name: repoName(found.remote, found.root),
    branch: branch.trim(),
    added: sum(0),
    deleted: sum(1),
    untracked: status.split('\n').filter(line => line.startsWith('??')).length,
  }
  await update($, repo, () => next)
}

// 応答の最初の行から、表や見出しの記号を外す
const firstLine = (answer: string) =>
  answer
    .split('\n')
    .map(text => text.replace(/^[\s#>*\-|]+/, '').replace(/[`*]/g, '').trim())
    .find(text => text !== '') ?? null

const baseName = (path: unknown) => (typeof path === 'string' ? (path.split('/').pop() ?? path) : '')

type Args = Record<string, unknown>

const textOf = (e: Args, key: string) => (typeof e[key] === 'string' ? (e[key] as string) : undefined)

// ツールの呼び出しを「名前: 対象」の 1 行にする
const describe = (e: Args) => {
  const tool = String(e.tool)
  const text = (key: string) => textOf(e, key) ?? ''
  const detail = (() => {
    switch (tool) {
      case 'Bash':
        return text('description') || text('command')
      case 'Read':
      case 'Edit':
      case 'Write':
        return baseName(e.file_path)
      case 'NotebookEdit':
        return baseName(e.notebook_path)
      case 'Grep':
      case 'Glob':
        return text('pattern')
      case 'Agent':
      case 'Task':
        return text('description')
      case 'Skill':
        return text('skill')
      case 'WebFetch':
        return text('url')
      case 'WebSearch':
        return text('query')
      default:
        return ''
    }
  })()
  const name = tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool
  const line = detail === '' ? name : `${name}: ${detail.split('\n')[0]}`
  return e.agentId === undefined ? line : `↳ ${line}`
}

type Task = { subject: string; activeForm?: string }
const tasks = new Map<string, Task>()
let current: string | null = null

const taskLine = () => {
  const task = current === null ? undefined : tasks.get(current)
  return task === undefined ? null : task.activeForm || task.subject || null
}

const pick = (e: Args, key: 'subject' | 'activeForm') => {
  const value = textOf(e, key)
  return value === undefined ? {} : { [key]: value }
}

// TaskCreate・TaskUpdate・TodoWrite から作業中の項目を追う
const track = (e: Args, result: unknown) => {
  if (e.tool === 'TaskCreate') {
    const id = (result as { task?: { id?: string } } | undefined)?.task?.id
    const subject = textOf(e, 'subject')
    if (id !== undefined && subject !== undefined) tasks.set(id, { subject, ...pick(e, 'activeForm') })
  } else if (e.tool === 'TaskUpdate') {
    const id = textOf(e, 'taskId')
    if (id === undefined) return
    tasks.set(id, { subject: '', ...tasks.get(id), ...pick(e, 'subject'), ...pick(e, 'activeForm') })
    const status = textOf(e, 'status')
    if (status === 'in_progress') current = id
    else if ((status === 'completed' || status === 'deleted') && current === id) current = null
  } else if (e.tool === 'TodoWrite' && Array.isArray(e.todos)) {
    const doing = (e.todos as { content?: string; activeForm?: string; status?: string }[]).find(todo => todo.status === 'in_progress')
    if (doing !== undefined) tasks.set('todo', { subject: doing.content ?? '', ...(doing.activeForm === undefined ? {} : { activeForm: doing.activeForm }) })
    current = doing === undefined ? null : 'todo'
  }
}

const act = ($: EngineInterface, change: Partial<Activity>) => update($, activity, now => ({ ...now, ...change, task: taskLine() }))

// 名前だけの 1 行。準備中のツールに使う
const toolName = (tool: string, agentId: string | undefined) => {
  const name = tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool
  return agentId === undefined ? name : `↳ ${name}`
}

// 動いているツールの呼び出し。重なった呼び出しを、始まった順に持つ
const running = new Map<string, { tool: string; startedAt: number }>()
let callCount = 0
let ticker: Timer | undefined

// ツールが動いている間だけ、経った秒数のために 1 秒ごとに描き直す
const tickWhileRunning = ($: EngineInterface, isRunning: boolean) => {
  if (!isRunning) {
    ticker?.cancel()
    ticker = undefined
    return
  }
  ticker ??= $.clock.every(1000, () => void $.clock.now().then(now => update($, second, () => Math.floor(now / 1000))))
}

const phaseLine = (doing: Activity, now: number): { mark: string; text: string; color: string } | null => {
  const phase = doing.phase ?? null
  if (phase === 'thinking') return { mark: '', text: '考えています…', color: TN.comment }
  if (doing.tool === null) return null
  if (phase === 'preparing') return { mark: '', text: `${doing.tool} を準備しています…`, color: TN.comment }
  if (phase === 'running') {
    const seconds = doing.startedAt == null ? 0 : Math.max(0, Math.floor((now - doing.startedAt) / 1000))
    return { mark: '● ', text: `${doing.tool} · ${seconds}s`, color: TN.fg }
  }
  return { mark: '✓ ', text: doing.tool, color: TN.comment }
}

const forget = async ($: EngineInterface) => {
  tasks.clear()
  current = null
  running.clear()
  tickWhileRunning($, false)
  await update($, activity, () => IDLE)
}

type Seg = { text: string; color?: string; bold?: boolean }

const segWidth = (segs: readonly Seg[]) => segs.reduce((sum, seg) => sum + cellWidth(seg.text), 0)

// 幅に収まらなければ、はみ出す所から … にする
const fitSegs = (segs: readonly Seg[], width: number): Seg[] => {
  if (segWidth(segs) <= width) return [...segs]
  const out: Seg[] = []
  let used = 0
  for (const seg of segs) {
    const cells = cellWidth(seg.text)
    if (used + cells < width) {
      out.push(seg)
      used += cells
      continue
    }
    out.push({ ...seg, text: fit(seg.text, width - used) })
    break
  }
  return out
}

const padSegs = (segs: readonly Seg[], width: number): Seg[] => {
  const fitted = fitSegs(segs, width)
  return [...fitted, { text: ' '.repeat(Math.max(0, width - segWidth(fitted))) }]
}

type TextElement = ReturnType<EngineInterface['ui']['resolve']>['Text']

const draw = (Text: TextElement, segs: readonly Seg[]) => (
  <Text>
    {segs.map(seg => (
      <Text {...(seg.color === undefined ? {} : { color: seg.color })} {...(seg.bold === true ? { bold: true } : {})}>
        {seg.text}
      </Text>
    ))}
  </Text>
)

const rgbOf = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))

// stops の色の間を、t（0〜1）で混ぜる
const blend = (stops: readonly string[], t: number) => {
  const at = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const from = Math.min(stops.length - 2, Math.floor(at))
  const [a, b] = [rgbOf(stops[Math.max(0, from)]!), rgbOf(stops[Math.max(0, from) + 1] ?? stops[Math.max(0, from)]!)]
  return `#${a.map((value, index) => Math.round(value + (b[index]! - value) * (at - from)).toString(16).padStart(2, '0')).join('')}`
}

const heat = (t: number, palette: { teal: string; yellow: string; orange: string; red: string } = TN) => blend([palette.teal, palette.yellow, palette.orange, palette.red], t)

// 1 マスずつ色が移る棒
const gradient = (ratio: number, columns: number, stops: readonly string[], track: string, full = '━', empty = '━'): Seg[] => {
  const filled = Math.max(0, Math.min(columns, Math.round(ratio * columns)))
  const cells: Seg[] = Array.from({ length: filled }, (_, index) => ({ text: full, color: blend(stops, index / Math.max(1, columns - 1)) }))
  return filled === columns ? cells : [...cells, { text: empty.repeat(columns - filled), color: track }]
}

const valueWidth = (inner: number, keyWidth: number) => Math.max(1, inner - keyWidth - 7)

// 題を上の罫線に、note を下の罫線に埋めた 2 列の表
const card = (title: Seg[], rows: [Seg[], Seg[]][], inner: number, note?: Seg[]): Seg[][] => {
  const line = TN.line
  const keyWidth = Math.max(1, ...rows.map(([key]) => segWidth(key)))
  const value = valueWidth(inner, keyWidth)
  const head = fitSegs(title, Math.max(1, inner - 5))
  const out: Seg[][] = [[{ text: '╭─ ', color: line }, ...head, { text: ` ${'─'.repeat(Math.max(0, inner - 5 - segWidth(head)))}╮`, color: line }]]
  for (const [key, cell] of rows)
    out.push([{ text: '│ ', color: line }, ...padSegs(key, keyWidth), { text: ' │ ', color: line }, ...padSegs(cell, value), { text: ' │', color: line }])
  if (note === undefined) out.push([{ text: `╰${'─'.repeat(keyWidth + 2)}┴${'─'.repeat(value + 2)}╯`, color: line }])
  else {
    const tail = fitSegs(note, Math.max(1, inner - 5))
    out.push([{ text: `╰${'─'.repeat(Math.max(0, inner - 5 - segWidth(tail)))} `, color: line }, ...tail, { text: ' ─╯', color: line }])
  }
  return out
}

const changeSegs = (git: Repo, palette: { green: string; red: string; yellow: string; comment: string } = TN): Seg[] => {
  const parts: Seg[] = [
    ...(git.added > 0 ? [{ text: `+${git.added}`, color: palette.green }] : []),
    ...(git.deleted > 0 ? [{ text: `-${git.deleted}`, color: palette.red }] : []),
    ...(git.untracked > 0 ? [{ text: `?${git.untracked}`, color: palette.yellow }] : []),
  ]
  return parts.length === 0 ? [{ text: 'なし', color: palette.comment }] : parts.flatMap((part, index) => (index === 0 ? [part] : [{ text: ' ' }, part]))
}

const stepSegs = (step: { mark: string; text: string; color: string }): Seg[] => [
  ...(step.mark === '' ? [] : [{ text: step.mark, color: step.mark === '● ' ? TN.yellow : TN.green }]),
  { text: step.text, color: step.color },
]

export const register: Register = (on, options) => {
  const config = configure(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await restart($, config)
    await forget($)
    await readClaude($)
    await readRepo($, true)
    await $.command.register({ name: 'session-dash', description: 'セッションの計器盤を右の pane に出す' })
    void $.ui.open({ id: PANE, title: TITLE })
    watcher?.cancel()
    watcher = $.clock.every(WATCH_MS, () => void watchPane($))
    return started
  })

  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    if (e.source === 'clear') {
      await restart($, config)
      await forget($)
    }
    return started
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.changed.includes('rateLimits') || e.changed.includes('cost')) {
      const limits = limitsOf(e.rateLimits)
      const usd = e.cost?.usd ?? null
      await update($, claude, now => (now === null ? now : { ...now, limits, usd: usd ?? now.usd }))
    }
    return measured
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) await act($, { isWorking: true, tool: null, phase: null, startedAt: null })
    return started
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const stream = next(e)
    let text = ''
    let said: string | null = null
    let isThinking = false
    let stepped: Awaited<typeof stream.result> | undefined
    try {
      while (true) {
        const piece = await stream.next()
        if (piece.done === true) {
          stepped = piece.value
          break
        }
        const chunk = piece.value
        // 届いた途中の chunk で、応答の終わりを待たずに今の作業を書き換える
        if (chunk.kind === 'thinking' && isMain && !isThinking && running.size === 0) {
          isThinking = true
          await act($, { phase: 'thinking' })
        } else if (chunk.kind === 'text' && isMain) {
          text += chunk.text
          const line = firstLine(text)
          if (line !== null && line !== said) {
            said = line
            await act($, { said, ...(running.size === 0 && isThinking ? { phase: 'done' as Phase } : {}) })
          }
        } else if (chunk.kind === 'tool' && !QUIET_TOOLS.has(chunk.name) && running.size === 0) {
          await act($, { tool: toolName(chunk.name, e.agentId), phase: 'preparing', startedAt: null })
        }
        yield chunk
      }
    } finally {
      // 途中でやめた時も、内側の stream を閉じる
      if (stepped === undefined) await stream.return(undefined as never)
    }
    if (isMain) {
      const said = firstLine(stepped.answer)
      if (said !== null) await act($, { said })
      const model = modelName(e.model)
      await update($, claude, now => (now === null || now.model === model ? now : { ...now, model }))
    }
    return stepped
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Args
    const isShown = !QUIET_TOOLS.has(e.tool)
    callCount += 1
    const id = e.tool_use_id ?? `call-${callCount}`
    const tool = describe(args)
    if (isShown) {
      running.set(id, { tool, startedAt: await $.clock.now() })
      tickWhileRunning($, true)
      await act($, { tool, phase: 'running', startedAt: running.get(id)!.startedAt })
    }
    const done = await next(e).finally(async () => {
      if (!isShown || !running.delete(id)) return
      // まだ動いている呼び出しがあれば、最後に始まったものを出す
      const last = [...running.values()].pop()
      if (last !== undefined) await act($, { tool: last.tool, phase: 'running', startedAt: last.startedAt })
      else {
        tickWhileRunning($, false)
        await act($, { tool, phase: 'done' })
      }
    })
    if ('result' in done) {
      track(args, done.result)
      if (QUIET_TOOLS.has(e.tool)) await act($, {})
      if (GIT_TOOLS.has(e.tool)) await readRepo($)
    }
    return done
  })

  on('command.run', { command: 'session-dash' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await watchPane($)
    return { text: 'セッションの計器盤を右の pane に出しました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const inner = Math.max(MIN_INNER, e.props.bodyColumns - 2)
    const now = await $.clock.now()
    await read($, tick)
    const info = await read($, claude)
    const git = await read($, repo)
    const doing = await read($, activity)
    await read($, second)
    const step = phaseLine(doing, now)
    const measured = await read($, fill)
    const cards: Seg[][] = []

    if (info !== null)
      cards.push(
        ...card(
          [{ text: `${ICON.model} Claude`, color: TN.blue, bold: true }],
          [
            [[{ text: 'model', color: TN.comment }], [{ text: info.model, color: TN.fg }]],
            [[{ text: 'cost', color: TN.comment }], [{ text: info.usd === null ? '—' : `$${info.usd.toFixed(2)}`, color: TN.orange }]],
          ],
          inner,
          info.version === '' ? undefined : [{ text: `v${info.version}`, color: TN.comment }],
        ),
      )

    if (git !== null)
      cards.push(
        ...card(
          [{ text: `${ICON.repo} ${git.name}`, color: TN.cyan, bold: true }],
          [
            [[{ text: 'branch', color: TN.comment }], [{ text: git.branch === '' ? '—' : git.branch, color: TN.magenta }]],
            [[{ text: 'diff', color: TN.comment }], changeSegs(git)],
          ],
          inner,
        ),
      )

    const limits = info?.limits ?? []
    if (limits.length > 0) {
      const value = valueWidth(inner, 2)
      const resets = limits.map(limit => untilReset(limit.resetsAt, now))
      // 棒の長さをそろえるため、戻るまでの時間は一番長いものの幅で取る
      const resetWidth = Math.max(0, ...resets.map(until => cellWidth(until)))
      const isResetShown = resetWidth > 0 && value - 5 - resetWidth - 1 >= 4
      cards.push(
        ...card(
          [{ text: `${ICON.limit} Limit`, color: TN.yellow, bold: true }],
          limits.map((limit, index) => {
            const percent = `${Math.round(limit.percentUsed)}%`.padStart(4)
            // 棒が 4 も取れなければ、戻るまでの時間を落とす
            const reset = isResetShown ? ` ${' '.repeat(resetWidth - cellWidth(resets[index] ?? ''))}${resets[index] ?? ''}` : ''
            const columns = Math.max(1, value - 5 - (isResetShown ? resetWidth + 1 : 0))
            return [
              [{ text: LIMIT_NAMES[limit.kind] ?? limit.kind, color: TN.fg }],
              [...gradient(limit.percentUsed / 100, columns, HEAT, TN.line), { text: ` ${percent}`, color: heat(limit.percentUsed / 100), bold: true }, { text: reset, color: TN.comment }],
            ]
          }),
          inner,
        ),
      )
    }

    if (measured === null || measured.window === 0)
      cards.push(...card([{ text: `${ICON.context} Context`, color: TN.magenta, bold: true }], [[[], [{ text: 'まだ測っていません。', color: TN.comment }]]], inner))
    else {
      const left = await cacheLeft($, config)
      const grade = gradeOf(measured)
      const legend = [...measured.slices].sort((x, y) => y.tokens - x.tokens)
      const keyWidth = Math.max(4, ...legend.map(slice => cellWidth(slice.name)))
      const value = valueWidth(inner, keyWidth)
      const top = Math.max(...legend.map(slice => slice.tokens), 1)
      const total = `${thousands(measured.tokens)}/${thousands(measured.window)}`
      cards.push(
        ...card(
          [{ text: `${ICON.context} Context ${measured.percent}%`, color: TN.magenta, bold: true }],
          [
            [[{ text: 'used', color: TN.comment }], [...gradient(measured.percent / 100, Math.max(1, value - cellWidth(total) - 1), [TN.blue, TN.magenta], TN.line), { text: ` ${total}`, color: TN.fg }]],
            ...legend.map((slice): [Seg[], Seg[]] => [
              [{ text: slice.name, color: TN.fgDark }],
              [{ text: kilo(slice.tokens).padStart(6), color: TN.fg }, { text: ' ' }, ...gradient(slice.tokens / top, Math.max(1, value - 7), [TN.magenta, TN.magenta], TN.bgHighlight, '━', ' ')],
            ]),
          ],
          inner,
          [
            { text: 'grade ', color: TN.comment },
            { text: grade.name, color: grade.color, bold: true },
            { text: ` · ${ICON.cache} ${left === null ? 'cold' : `${left}m`}`, color: TN.comment },
          ],
        ),
      )
    }

    const next = await nextOf($, config)
    if (next.length > 0)
      cards.push(...card([{ text: `${ICON.next} Next`, color: TN.blue, bold: true }], next.map((item, index): [Seg[], Seg[]] => [[{ text: `${index + 1}`, color: TN.comment }], [{ text: item, color: TN.fg }]]), inner))

    const summary = doing.task ?? doing.said
    const nowRows: [Seg[], Seg[]][] = [[[{ text: '作業', color: TN.comment }], [{ text: summary ?? '待っています', color: doing.isWorking ? TN.fg : TN.comment }]]]
    if (doing.isWorking && step !== null) nowRows.push([[{ text: '実行', color: TN.comment }], stepSegs(step)])
    else if (!doing.isWorking && summary !== null) nowRows.push([[{ text: '状態', color: TN.comment }], [{ text: '待っています', color: TN.comment }]])
    cards.push(...card([{ text: `${ICON.now} Now`, color: TN.yellow, bold: true }], nowRows, inner))

    return (
      <Box flexDirection="column" paddingX={1}>
        {cards.map(line => draw(Text, line))}
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, lastTurnEnd, () => now)
      running.clear()
      tickWhileRunning($, false)
      await act($, { isWorking: false, tool: null, phase: null, startedAt: null })
      await readRepo($, true)
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
    await read($, second)
    const now = await $.clock.now()
    const left = await cacheLeft($, config)
    const doing = await read($, activity)
    const step = phaseLine(doing, now)
    const summary = doing.task ?? doing.said
    const info = await read($, claude)
    const git = await read($, repo)
    const width = Math.max(MIN_INNER, e.props.bodyColumns - SLACK_COLUMNS)

    const working: Seg[] = []
    if (doing.isWorking && (summary !== null || step !== null)) {
      working.push({ text: '● ', color: MOON.yellow })
      if (summary !== null) working.push({ text: summary, color: MOON.fg })
      if (summary !== null && step !== null) working.push({ text: ' │ ', color: MOON.comment })
      if (step !== null) working.push({ text: step.mark === '' ? '' : step.mark, color: step.mark === '● ' ? MOON.yellow : MOON.green }, { text: step.text, color: MOON.comment })
    }

    // 区切りの │ で並べるセル。枝は、幅に収まるように最後に縮める
    const cells: Seg[][] = []
    if (info !== null && info.model !== '') cells.push([{ text: info.model, color: MOON.blue }])
    const branchAt = cells.length
    if (git !== null && git.branch !== '') cells.push([{ text: `${ICON.branch} ${git.branch}`, color: MOON.magenta }])
    if (git !== null && git.added + git.deleted + git.untracked > 0) cells.push(changeSegs(git, MOON))
    cells.push([{ text: 'ctx ', color: MOON.fg }, { text: `${measured.percent}%`, color: MOON.cyan }])
    for (const limit of info?.limits ?? [])
      cells.push([{ text: `${LIMIT_NAMES[limit.kind] ?? limit.kind} `, color: MOON.fg }, { text: `${Math.round(limit.percentUsed)}%`, color: heat(limit.percentUsed / 100, MOON) }])
    cells.push([{ text: `${ICON.cache} ${left === null ? 'cold' : `${left}m`}`, color: MOON.comment }])
    const bar = { text: '│', color: MOON.magenta }
    const lineOf = (row: Seg[][]) => [bar, ...row.flatMap(cell => [{ text: ' ' }, ...cell, { text: ' ' }, bar])]
    const over = segWidth(lineOf(cells)) - width
    if (over > 0 && git !== null && git.branch !== '' && cells[branchAt] !== undefined) {
      const room = Math.max(4, segWidth(cells[branchAt]!) - over)
      cells[branchAt] = fitSegs(cells[branchAt]!, room)
    }

    return (
      <Box flexDirection="column">
        {working.length === 0 ? null : draw(Text, fitSegs(working, width))}
        {draw(Text, fitSegs(lineOf(cells), width))}
        {beneath}
      </Box>
    )
  })
}
