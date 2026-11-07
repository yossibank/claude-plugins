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
export const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
  return hoursMinutes(Math.floor(seconds / 60))
}

export const elapsedOf = (ms: number) => hoursMinutes(Math.max(0, Math.floor(ms / 60_000)))
