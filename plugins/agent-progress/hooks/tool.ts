// 2 行目に出さない、作業の中身を表さないツール
export const QUIET_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite', 'ToolSearch'])
// サブエージェントを起こすツール。動きは agents に持つ
export const AGENT_TOOLS = new Set(['Agent', 'Task'])

// 応答の最初の行から、表や見出しの記号を外す
export const firstLine = (answer: string) =>
  answer
    .split('\n')
    .map(text => text.replace(/^[\s#>*\-|]+/, '').replace(/[`*]/g, '').trim())
    .find(text => text !== '') ?? null

const baseName = (path: unknown) => (typeof path === 'string' ? (path.split('/').pop() ?? path) : '')

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
  const name = toolName(tool)
  return detail === '' ? name : `${name}: ${detail.split('\n')[0]}`
}
