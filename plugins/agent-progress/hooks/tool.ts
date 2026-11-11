// 2 行目に出さない、作業の中身を表さないツール
export const QUIET_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite', 'ToolSearch'])
// サブエージェントを起こすツール。動きは agents に持つ
export const AGENT_TOOLS = new Set(['Agent', 'Task'])

// 表や見出しの記号を外した 1 行
const plain = (text: string) => text.replace(/^[\s#>*\-|]+/, '').replace(/[`*]/g, '').trim()

// 応答の最初の行と、その行が改行で閉じたか。閉じた後は、続きが届いても最初の行は変わらない
export const firstLineOf = (answer: string) => {
  const lines = answer.split('\n')
  const at = lines.findIndex(text => plain(text) !== '')
  return at < 0 ? { line: null, isClosed: false } : { line: plain(lines[at]!), isClosed: at < lines.length - 1 }
}

export const firstLine = (answer: string) => firstLineOf(answer).line

// 同じ名前のファイルを見分けられるよう、親のフォルダまで出す
const shortPath = (path: unknown) => (typeof path === 'string' ? path.split('/').filter(part => part !== '').slice(-2).join('/') : '')

// Read の読む範囲。offset が無ければ空
const rangeOf = (e: Args) => {
  if (typeof e.offset !== 'number') return ''
  return typeof e.limit === 'number' ? `:${e.offset}-${e.offset + e.limit - 1}` : `:${e.offset}-`
}

// 引数ではない、呼び出しの欄
const META_KEYS = new Set(['tool', 'tool_use_id', 'agentId', 'consent', 'requestMeta'])

// 名前を知らないツール（MCP など）は、最初の文字の引数を対象にする
const firstText = (e: Args) => Object.entries(e).find(([key, value]) => !META_KEYS.has(key) && typeof value === 'string' && value.trim() !== '')?.[1] as string | undefined

// 名前だけの 1 行。MCP のツールは最後の名前だけにする。準備中のツールにも使う
export const toolName = (tool: string) => (tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool)

export type Args = Record<string, unknown>

export const textOf = (e: Args, key: string) => (typeof e[key] === 'string' ? (e[key] as string) : undefined)

// ツールの呼び出しを「名前: 対象」の 1 行にする
export const describe = (e: Args) => {
  const tool = String(e.tool)
  const text = (key: string) => textOf(e, key) ?? ''
  const detail = (() => {
    switch (tool) {
      case 'Bash':
        return text('description') || text('command')
      case 'Read':
        return `${shortPath(e.file_path)}${rangeOf(e)}`
      case 'Edit':
      case 'Write':
        return shortPath(e.file_path)
      case 'NotebookEdit':
        return shortPath(e.notebook_path)
      case 'Grep': {
        const where = shortPath(e.path) || text('glob')
        return where === '' ? text('pattern') : `${text('pattern')} in ${where}`
      }
      case 'Glob':
        return text('pattern')
      case 'SendMessage':
        return text('to')
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
        return firstText(e)?.trim() ?? ''
    }
  })()
  const name = toolName(tool)
  return detail === '' ? name : `${name}: ${detail.split('\n')[0]}`
}
