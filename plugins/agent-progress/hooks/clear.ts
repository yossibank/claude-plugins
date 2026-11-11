import type { EngineInterface } from 'claude-code'

// 見てきたセッションの id。/clear で変わる
let known: string | undefined

// 前に見た時からセッションが替わったか（/clear など）。初めて見た時は替わったと数えない
export async function hasSessionChanged($: EngineInterface) {
  const id = await $.session.id().catch(() => undefined)
  if (id === undefined) return false
  const changed = known !== undefined && id !== known
  known = id
  return changed
}
