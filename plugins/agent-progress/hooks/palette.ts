// pane は Tokyo Night、帯は Tokyo Night Moon の色
export const TN = {
  fg: '#c0caf5',
  fgDark: '#a9b1d6',
  comment: '#565f89',
  line: '#3b4261',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  magenta: '#bb9af7',
  green: '#9ece6a',
  orange: '#ff9e64',
  red: '#f7768e',
  yellow: '#e0af68',
  teal: '#73daca',
}
export const MOON = {
  fg: '#c8d3f5',
  comment: '#636da6',
  yellow: '#ffc777',
  green: '#c3e88d',
}

// アイコンの色。メインは Claude Code のロゴの色、サブエージェントは起こした順に HUES を回す
export const CLAUDE = '#d77757'
export const HUES = [TN.blue, TN.green, TN.red, TN.magenta, TN.teal]
export const IDLE = TN.comment
export const FAILED = '#f7524a'

// ツールの色。読む・探す・動かす・書く・外を見る・任せるで分ける。無いものは teal
const TOOL_COLORS: Record<string, string> = {
  Read: TN.blue,
  Grep: TN.cyan,
  Glob: TN.cyan,
  Bash: TN.yellow,
  Edit: TN.green,
  Write: TN.green,
  NotebookEdit: TN.green,
  WebFetch: TN.magenta,
  WebSearch: TN.magenta,
  Agent: TN.orange,
  Task: TN.orange,
}

export const toolColor = (name: string) => TOOL_COLORS[name] ?? TN.teal

const rgbOf = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))

// from から to へ、t（0〜1）だけ寄せた色。Raster の 0x00RRGGBB で返す
export const toward = (from: string, to: string, t: number) => {
  const [a, b] = [rgbOf(from), rgbOf(to)]
  const [r = 0, g = 0, b2 = 0] = a.map((value, index) => Math.round(value + ((b[index] ?? value) - value) * Math.max(0, Math.min(1, t))))
  return (r << 16) | (g << 8) | b2
}

export const rgb = (hex: string) => {
  const [r = 0, g = 0, b = 0] = rgbOf(hex)
  return (r << 16) | (g << 8) | b
}

// stops の色の間を、t（0〜1）で混ぜる
export const blend = (stops: readonly string[], t: number) => {
  const at = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const from = Math.min(stops.length - 2, Math.floor(at))
  const [a, b] = [rgbOf(stops[Math.max(0, from)]!), rgbOf(stops[Math.max(0, from) + 1] ?? stops[Math.max(0, from)]!)]
  return `#${a.map((value, index) => Math.round(value + (b[index]! - value) * (at - from)).toString(16).padStart(2, '0')).join('')}`
}
