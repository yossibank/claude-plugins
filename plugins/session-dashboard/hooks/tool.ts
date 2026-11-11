// 数えない、作業の中身を表さないツール
export const QUIET_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite', 'ToolSearch'])
// MCP のツールは最後の名前だけにする
export const toolName = (tool: string) => (tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool)
export const GIT_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit'])
