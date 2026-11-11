import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Counted, Day, Days } from '../types'

import { currentClaude } from './claude'
import { currentStats } from './stats'
import { currentSpent } from './tokens'

// store に残す日数
const DAYS_KEPT = 14
// store の鍵。ローカルの日付
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
// 費用を丸める桁。足し算の誤差を store に残さない
const USD_SCALE = 1_000_000
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export const NO_DAY: Day = { usd: 0, input: 0, output: 0 }

// store から読んだ日ごとの値の写し。描く時はこれを読み、store は読まない
const days = atom({ plugin: 'session-dashboard', key: 'days' } as const, {} as Days, { shape: 'days-1' })
// 前に store へ足した時点の、このセッションの合計
const counted = atom({ plugin: 'session-dashboard', key: 'counted' } as const, null, { shape: 'counted-1' })

const keyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// ローカルの日付。YYYY-MM-DD
export const dayOf = (ms: number) => keyOf(new Date(ms))

// now の日を最後にした count 日分の、日付と曜日の字。古い順
export const lastDays = (now: number, count: number) => {
  const today = new Date(now)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - index))
    return { key: keyOf(date), weekday: WEEKDAYS[date.getDay()] ?? '' }
  })
}

const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

// store の値は形が分からないので、数だけを拾う
const dayFrom = (value: unknown): Day => {
  if (typeof value !== 'object' || value === null) return NO_DAY
  const { usd, input, output } = value as Record<string, unknown>
  return { usd: amount(usd), input: amount(input), output: amount(output) }
}

const isEmpty = (day: Day) => day.usd + day.input + day.output === 0

export async function currentDays($: EngineInterface) {
  return read($, days)
}

// /clear などでセッションの合計が初めに戻る時に、覚えている値も忘れる
export async function forgetCounted($: EngineInterface) {
  await update($, counted, () => null)
}

async function add($: EngineInterface) {
  const now = await $.clock.now()
  const usd = (await currentClaude($))?.usd ?? null
  const spent = await currentSpent($)
  const before = await read($, counted)
  // 初めて足す時は、始めた時の費用から数える。再開したセッションの、前の分を足さない
  const usdBefore = before?.usd ?? (await currentStats($)).usdAtStart ?? usd
  const total: Counted = { usd: usd ?? before?.usd ?? null, input: spent.input + spent.cacheRead + spent.cacheWrite, output: spent.output }
  // 合計が /clear で 0 に戻ると増えた分が負になる。0 として扱い、覚えている値は今の合計に取り直す
  const delta: Day = {
    usd: usd === null || usdBefore === null ? 0 : Math.max(0, usd - usdBefore),
    input: Math.max(0, total.input - (before?.input ?? 0)),
    output: Math.max(0, total.output - (before?.output ?? 0)),
  }

  const kept = lastDays(now, DAYS_KEPT).map(day => day.key)
  const today = kept[kept.length - 1] ?? dayOf(now)
  const oldest = kept[0] ?? today
  const next: Days = {}
  for (const key of (await $.store.keys()).filter(key => DAY_KEY.test(key)).sort()) {
    if (key < oldest) await $.store.delete(key)
    else if (key !== today) next[key] = dayFrom(await $.store.get(key))
  }
  // ほかのセッションが足した分を消さないよう、書く直前に今日の値を読み直してから足す
  const stored = dayFrom(await $.store.get(today))
  const sum: Day = { usd: Math.round((stored.usd + delta.usd) * USD_SCALE) / USD_SCALE, input: stored.input + delta.input, output: stored.output + delta.output }
  if (!isEmpty(delta)) await $.store.set(today, sum)
  if (!isEmpty(sum)) next[today] = sum

  // store に書けた後で覚える。書けなかった分は、次に足す
  if (JSON.stringify(before) !== JSON.stringify(total)) await update($, counted, () => total)
  if (JSON.stringify(await read($, days)) !== JSON.stringify(next)) await update($, days, () => next)
}

// 続けて呼ばれても、同じ増えた分を 2 度足さないよう、1 つずつ順に進める
let adding: Promise<void> = Promise.resolve()

// このセッションの合計が前に足した時から増えた分を、store の今日の値に足し、写しを読み直す
export function addToday($: EngineInterface) {
  adding = adding.catch(() => undefined).then(() => add($))
  return adding
}
