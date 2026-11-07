import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Activity, Claude, Fill, Limit, Phase, Repo, Upcoming } from '../types'

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

const GREEN = '#7fe0a0'
const YELLOW = '#e8d27a'
const RED = '#f05a5a'
const LABEL = 7
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

const limitColor = (percent: number) => (percent >= 90 ? RED : percent >= 70 ? AMBER : GREEN)

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

let running = 0
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
  if (phase === 'thinking') return { mark: '', text: '考えています…', color: MUTED }
  if (doing.tool === null) return null
  if (phase === 'preparing') return { mark: '', text: `${doing.tool} を準備しています…`, color: MUTED }
  if (phase === 'running') {
    const seconds = doing.startedAt == null ? 0 : Math.max(0, Math.floor((now - doing.startedAt) / 1000))
    return { mark: '● ', text: `${doing.tool}  ${seconds}s`, color: INK }
  }
  return { mark: '✓ ', text: doing.tool, color: MUTED }
}

const forget = async ($: EngineInterface) => {
  tasks.clear()
  current = null
  running = 0
  tickWhileRunning($, false)
  await update($, activity, () => IDLE)
}

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
    let stepped: Awaited<typeof stream.result>
    while (true) {
      const piece = await stream.next()
      if (piece.done === true) {
        stepped = piece.value
        break
      }
      const chunk = piece.value
      // 届いた途中の chunk で、応答の終わりを待たずに今の作業を書き換える
      if (chunk.kind === 'thinking' && isMain && !isThinking && running === 0) {
        isThinking = true
        await act($, { phase: 'thinking' })
      } else if (chunk.kind === 'text' && isMain) {
        text += chunk.text
        const line = firstLine(text)
        if (line !== null && line !== said) {
          said = line
          await act($, { said, ...(running === 0 && isThinking ? { phase: 'done' as Phase } : {}) })
        }
      } else if (chunk.kind === 'tool' && !QUIET_TOOLS.has(chunk.name)) {
        await act($, { tool: toolName(chunk.name, e.agentId), phase: 'preparing', startedAt: null })
      }
      yield chunk
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
    if (isShown) {
      running += 1
      tickWhileRunning($, true)
      await act($, { tool: describe(args), phase: 'running', startedAt: await $.clock.now() })
    }
    const done = await next(e).finally(async () => {
      if (!isShown) return
      running = Math.max(0, running - 1)
      if (running === 0) {
        tickWhileRunning($, false)
        await act($, { phase: 'done' })
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
    const inner = Math.max(1, e.props.bodyColumns - 2)
    const body = inner - LABEL
    const label = (text: string) => <Text color={MUTED}>{text.padEnd(LABEL)}</Text>
    const rule = <Text color={LINE}>{'─'.repeat(inner)}</Text>
    const now = await $.clock.now()
    await read($, tick)
    const info = await read($, claude)
    const git = await read($, repo)
    const doing = await read($, activity)
    await read($, second)
    const step = phaseLine(doing, now)

    const claudeRow =
      info === null ? null : (
        <Text>
          {label('CLAUDE')}
          <Text color={INK}>{fit([info.model, info.version === '' ? '' : `v${info.version}`, info.usd === null ? '' : `$${info.usd.toFixed(2)}`].filter(part => part !== '').join(' · '), body)}</Text>
        </Text>
      )
    const changes = git === null ? '' : [git.added > 0 ? `+${git.added}` : '', git.deleted > 0 ? `-${git.deleted}` : '', git.untracked > 0 ? `?${git.untracked}` : ''].filter(part => part !== '').join(' ')
    const place = git === null ? '' : fit(`${git.name}${git.branch === '' ? '' : `  ⚡${git.branch}`}`, Math.max(4, body - (changes === '' ? 0 : cellWidth(changes) + 2)))
    const repoRow =
      git === null ? null : (
        <Text>
          {label('REPO')}
          <Text color={INK}>{place}</Text>
          {changes === '' ? null : <Text>  </Text>}
          {git.added > 0 ? <Text color={GREEN}>{`+${git.added}`}</Text> : null}
          {git.added > 0 && git.deleted + git.untracked > 0 ? <Text> </Text> : null}
          {git.deleted > 0 ? <Text color={RED}>{`-${git.deleted}`}</Text> : null}
          {git.deleted > 0 && git.untracked > 0 ? <Text> </Text> : null}
          {git.untracked > 0 ? <Text color={YELLOW}>{`?${git.untracked}`}</Text> : null}
        </Text>
      )
    const limitRows = (info?.limits ?? []).map((limit, index) => {
      const name = LIMIT_NAMES[limit.kind] ?? limit.kind
      const percent = `${Math.round(limit.percentUsed)}%`
      const fixed = cellWidth(name) + 1 + 1 + cellWidth(percent)
      const until = untilReset(limit.resetsAt, now)
      // 棒が 4 も取れなければ、戻るまでの時間を落とす
      const reset = until !== '' && body - fixed - cellWidth(until) - 1 >= 4 ? until : ''
      const bar = meter(limit.percentUsed / 100, Math.max(1, body - fixed - (reset === '' ? 0 : cellWidth(reset) + 1)))
      return (
        <Text>
          {label(index === 0 ? 'LIMIT' : '')}
          <Text color={INK}>{name} </Text>
          <Text color={limitColor(limit.percentUsed)}>{'▰'.repeat(bar.full)}</Text>
          <Text color={LINE}>{'▱'.repeat(bar.empty)}</Text>
          <Text bold color={INK}> {percent}</Text>
          {reset === '' ? null : <Text color={MUTED}> {reset}</Text>}
        </Text>
      )
    })
    const summary = doing.task ?? doing.said
    const nowRows = [
      <Text>
        {label('NOW')}
        <Text color={doing.isWorking ? INK : MUTED}>{fit(summary ?? '待っています', body)}</Text>
      </Text>,
      doing.isWorking && step !== null ? (
        <Text>
          {label('')}
          {step.mark === '' ? null : <Text color={step.mark === '● ' ? AMBER : GREEN}>{step.mark}</Text>}
          <Text color={step.color}>{fit(step.text, body - cellWidth(step.mark))}</Text>
        </Text>
      ) : null,
      !doing.isWorking && summary !== null ? (
        <Text>
          {label('')}
          <Text color={MUTED}>待っています</Text>
        </Text>
      ) : null,
    ]
    const head = [claudeRow, repoRow, ...limitRows, info === null && git === null ? null : rule, ...nowRows, rule]

    const measured = await read($, fill)
    if (measured === null || measured.window === 0)
      return (
        <Box flexDirection="column" paddingX={1}>
          {head}
          <Text dimColor>まだ測っていません。</Text>
        </Box>
      )

    const left = await cacheLeft($, config)
    const next = await nextOf($, config)
    const grade = gradeOf(measured)
    const legend = [...measured.slices].sort((a, b) => b.tokens - a.tokens)
    const nameColumns = Math.max(NAME_COLUMNS, ...legend.map(slice => cellWidth(slice.name)))
    const percent = `${measured.percent}%`
    const clock = left === null ? 'cold' : `${left}m`
    const top = Math.max(...legend.map(slice => slice.tokens), 1)
    const usedBar = meter(measured.percent / 100, Math.max(4, inner - cellWidth(percent) - 2))
    const legendBar = Math.max(4, inner - (2 + nameColumns + 7 + 6 + 2))
    const cacheBar = meter(left === null ? 0 : (left * 60_000) / config.cacheMs, Math.max(4, inner - 7 - cellWidth(clock) - 2))
    const pad = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

    return (
      <Box flexDirection="column" paddingX={1}>
        {head}
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
      running = 0
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
    const left = await cacheLeft($, config)
    const grade = gradeOf(measured)
    const percent = `${measured.percent}%`
    const used = `${thousands(measured.tokens)} / ${thousands(measured.window)}`
    const clock = `⏱ ${left === null ? 'cold' : `${left}m`}`
    const fixed = 2 + 1 + 2 + cellWidth(percent) + 2 + 2 + cellWidth(used) + 2 + 1 + 2 + cellWidth(clock) + SLACK_COLUMNS
    const bar = meter(measured.percent / 100, Math.max(4, Math.min(PROMPT_BAR_MAX, e.props.bodyColumns - fixed)))

    const doing = await read($, activity)
    await read($, second)
    const step = phaseLine(doing, await $.clock.now())
    const summary = doing.task ?? doing.said
    const width = Math.max(4, e.props.bodyColumns - SLACK_COLUMNS - 2)
    const info = await read($, claude)
    const git = await read($, repo)
    const dot = <Text color={MUTED}> · </Text>
    const limits = (info?.limits ?? []).map(limit => ({ name: LIMIT_NAMES[limit.kind] ?? limit.kind, percent: Math.round(limit.percentUsed), color: limitColor(limit.percentUsed) }))
    const changes = git === null ? [] : [{ text: git.added > 0 ? `+${git.added}` : '', color: GREEN }, { text: git.deleted > 0 ? `-${git.deleted}` : '', color: RED }, { text: git.untracked > 0 ? `?${git.untracked}` : '', color: YELLOW }].filter(part => part.text !== '')
    const model = info?.model ?? ''
    const limitText = limits.map(limit => ` · ${limit.name} ${limit.percent}%`).join('')
    const changeText = changes.map(part => ` ${part.text}`).join('')
    const room = e.props.bodyColumns - SLACK_COLUMNS - cellWidth(model) - cellWidth(limitText) - cellWidth(changeText) - (model === '' ? 0 : 3) - cellWidth('⚡')
    const branch = git === null || git.branch === '' ? '' : fit(git.branch, Math.max(4, room))

    return (
      <Box flexDirection="column">
        {doing.isWorking && summary !== null ? (
          <Text>
            <Text color={AMBER}>▸ </Text>
            <Text color={INK}>{fit(summary, width)}</Text>
          </Text>
        ) : null}
        {doing.isWorking && step !== null ? (
          <Text>
            <Text>  </Text>
            {step.mark === '' ? null : <Text color={step.mark === '● ' ? AMBER : GREEN}>{step.mark}</Text>}
            <Text color={step.color}>{fit(step.text, width - cellWidth(step.mark))}</Text>
          </Text>
        ) : null}
        <Text>
          <Text bold color={grade.color}>◆ {grade.name}</Text>
          <Text>  </Text>
          <Text bold color={INK}>{percent}</Text>
          <Text>  </Text>
          <Text color={AMBER}>{'▰'.repeat(bar.full)}</Text>
          <Text color={LINE}>{'▱'.repeat(bar.empty)}</Text>
          <Text color={MUTED}>  {used}  ·  {clock}</Text>
        </Text>
        {model === '' && branch === '' && limits.length === 0 ? null : (
          <Text>
            {model === '' ? null : <Text color={INK}>{model}</Text>}
            {model !== '' && branch !== '' ? dot : null}
            {branch === '' ? null : <Text color={MUTED}>{`⚡${branch}`}</Text>}
            {changes.map(part => (
              <Text color={part.color}>{` ${part.text}`}</Text>
            ))}
            {limits.map((limit, index) => (
              <Text>
                {index === 0 && model === '' && branch === '' ? null : dot}
                <Text color={MUTED}>{`${limit.name} `}</Text>
                <Text color={limit.color}>{`${limit.percent}%`}</Text>
              </Text>
            ))}
          </Text>
        )}
        {beneath}
      </Box>
    )
  })
}
