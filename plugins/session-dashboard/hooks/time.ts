// 分数を 1h05m・12m の形にする
const hoursMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
}

export const untilReset = (resetsAt: string | undefined, now: number) => {
  if (resetsAt === undefined) return ''
  const minutes = Math.floor((Date.parse(resetsAt) - now) / 60_000)
  if (Number.isNaN(minutes)) return ''
  if (minutes <= 0) return 'soon'
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)}d${hours % 24}h`
  return hoursMinutes(minutes)
}

// 秒まで出す。1 分を超えたら 2m14s、1 時間を超えたら 1h05m
export const durationOf = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
  return hoursMinutes(Math.floor(seconds / 60))
}

// どれだけ前か。3m前・2h前・5d前
export const agoOf = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes}m前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h前` : `${Math.floor(hours / 24)}d前`
}

// 上限の窓の長さ（分）。窓の長さが決まっているものだけ
const WINDOW_MINUTES: Record<string, number> = { five_hour: 5 * 60, seven_day: 7 * 24 * 60 }
// 窓がこれだけ進むまでは、予測がぶれるので出さない
const MIN_ELAPSED = 0.05

// 今のペースのまま戻る時刻まで使った時の割合。出せなければ null
export const paceOf = (kind: string, percentUsed: number, resetsAt: string | undefined, now: number) => {
  const total = WINDOW_MINUTES[kind]
  if (total === undefined || resetsAt === undefined) return null
  const elapsed = 1 - (Date.parse(resetsAt) - now) / 60_000 / total
  return Number.isNaN(elapsed) || elapsed < MIN_ELAPSED || elapsed > 1 ? null : percentUsed / elapsed
}

export const elapsedOf = (ms: number) => hoursMinutes(Math.max(0, Math.floor(ms / 60_000)))
