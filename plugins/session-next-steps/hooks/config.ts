// 設定が空か壊れている時の値。plugin.json の userConfig の default と同じにしておく
export const DEFAULTS = {
  maxSteps: 3,
  testCommand: 'make test',
  checkPattern: '\\b(?:make\\b(?:\\s+\\S+)*?\\s+(?:\\S*[-_.:])?(?:test|build|verify|check|lint|types)(?:[-_.:]\\S*)?|(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:test|build|lint|typecheck)(?:[-_.:]\\S*)?|swift\\s+(?:test|build)|xcodebuild|cargo\\s+(?:test|build|check|clippy)|go\\s+(?:test|build|vet)|pytest|tsc|jest|vitest|claude\\s+plugin\\s+(?:test|validate))(?=\\s|$)',
  contextPercent: 70,
}

export type Options = { maxSteps: number; testCommand: string; check: RegExp; contextPercent: number }

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback)

// 壊れた正規表現は初めの値に戻し、isBroken で伝える。知らせるのは最初のターンかツールの時
export const optionsOf = (raw: Readonly<Record<string, unknown>>) => {
  const maxSteps = Math.floor(Number(raw.maxSteps))
  const contextPercent = Number(raw.contextPercent)
  let isBroken = false
  let check: RegExp
  try {
    check = new RegExp(text(raw.checkPattern, DEFAULTS.checkPattern))
  } catch {
    isBroken = true
    check = new RegExp(DEFAULTS.checkPattern)
  }
  const options: Options = {
    maxSteps: Number.isFinite(maxSteps) && maxSteps >= 1 ? maxSteps : DEFAULTS.maxSteps,
    testCommand: text(raw.testCommand, DEFAULTS.testCommand),
    check,
    contextPercent: Number.isFinite(contextPercent) && contextPercent > 0 && contextPercent <= 100 ? contextPercent : DEFAULTS.contextPercent,
  }
  return { options, isBroken }
}
