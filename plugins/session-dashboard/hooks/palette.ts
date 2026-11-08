// pane は Tokyo Night、帯は Tokyo Night Moon の色
export const TN = {
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
export const MOON = {
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
export const HEAT = [TN.teal, TN.yellow, TN.orange, TN.red]

// Nerd Font のアイコン
export const ICON = {
  model: '\u{F06A9}',
  repo: '\uf401',
  branch: '\ue725',
  limit: '\u{F029A}',
  context: '\u{F09D1}',
  cache: '\u{F01BC}',
  session: '\uf017',
}

const rgbOf = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))

// stops の色の間を、t（0〜1）で混ぜる
export const blend = (stops: readonly string[], t: number) => {
  const at = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const from = Math.min(stops.length - 2, Math.floor(at))
  const [a, b] = [rgbOf(stops[Math.max(0, from)]!), rgbOf(stops[Math.max(0, from) + 1] ?? stops[Math.max(0, from)]!)]
  return `#${a.map((value, index) => Math.round(value + (b[index]! - value) * (at - from)).toString(16).padStart(2, '0')).join('')}`
}

export const heat = (t: number, palette: { teal: string; yellow: string; orange: string; red: string } = TN) => blend([palette.teal, palette.yellow, palette.orange, palette.red], t)
