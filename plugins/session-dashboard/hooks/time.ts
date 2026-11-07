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

export const elapsedOf = (ms: number) => hoursMinutes(Math.max(0, Math.floor(ms / 60_000)))
