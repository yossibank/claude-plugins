// 許可の確認を待った時間を、確かな合図だけで測る
// 始まりは classic.PermissionRequest の時刻。終わりは、許可された時は classic.PostToolUse の時刻から duration_ms（ツールが動いた時間）を引いた時刻、断られた時は tool.call が決着した時刻
// 許可された瞬間の合図は無いので、待っている最中の行は出さず、終わった待ちの長さだけを数える

// 確認に回った呼び出し 1 回。askedAt は確認が始まった時刻。allowedAt は動き始めた時刻で、PostToolUse が来ていなければ undefined、来たが duration_ms が無ければ null
type Ask = { tool: string; agentId: string | undefined; input: string; askedAt: number | null; allowedAt?: number | null }

// 覚えておく呼び出しの数。tool.call の決着が来なかったものが溜まらないようにする
const ASKS_KEPT = 64

const asks = new Map<string, Ask>()

const jsonOf = (input: unknown) => {
  try {
    return JSON.stringify(input) ?? ''
  } catch {
    return ''
  }
}

// tool.check が ask を返した呼び出しを覚える。PermissionRequest には tool_use_id が無いので、ここで id と結ぶ
export function noteAsk(id: string, tool: string, agentId: string | undefined, input: unknown) {
  asks.delete(id)
  asks.set(id, { tool, agentId, input: jsonOf(input), askedAt: null })
  for (const old of [...asks.keys()].slice(0, Math.max(0, asks.size - ASKS_KEPT))) asks.delete(old)
}

// PermissionRequest を、覚えた呼び出しに結んで、確認の始まりを書く
// ツールの名前とエージェントが同じものが 1 つならそれ、複数なら入力も同じものが 1 つの時だけ結ぶ。決まらなければ結ばない
export function openAsk(tool: string, agentId: string | undefined, input: unknown, now: number) {
  const waiting = [...asks.values()].filter(ask => ask.askedAt === null && ask.tool === tool && ask.agentId === agentId)
  const json = jsonOf(input)
  const found = waiting.length > 1 ? waiting.filter(ask => ask.input === json) : waiting
  if (found.length !== 1 || found[0] === undefined) return
  found[0].askedAt = now
}

// PostToolUse・PostToolUseFailure が来たら、ツールは動いた。動き始めた時刻は、今から duration_ms を引いた時刻
export function noteRan(id: string, durationMs: number | undefined, now: number) {
  const ask = asks.get(id)
  if (ask === undefined || ask.askedAt === null) return
  ask.allowedAt = typeof durationMs === 'number' && Number.isFinite(durationMs) ? now - durationMs : null
}

// tool.call が決着した時に、待った長さ（ms）を返して忘れる。測れなければ 0
// ツールが動かずに失敗で終わったものは、断られたとして今までを数える。動いたのに duration_ms が無いものは数えない
export function closeAsk(id: string, isRefused: boolean, now: number) {
  const ask = asks.get(id)
  asks.delete(id)
  if (ask === undefined || ask.askedAt === null) return 0
  if (typeof ask.allowedAt === 'number') return Math.max(0, ask.allowedAt - ask.askedAt)
  return ask.allowedAt === undefined && isRefused ? Math.max(0, now - ask.askedAt) : 0
}

export function forgetAsks() {
  asks.clear()
}
