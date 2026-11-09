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

const rgbOf = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))

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
