import type { Step } from '../types'

import type { Options } from './config'

// このターンの間に見たこと。check は最後に走らせたテストかビルド、edited はその後に書き換えたファイル
export type Turn = { check: { label: string; isFailed: boolean } | null; edited: string[] }

// リポジトリの今。hasPr は、PR があるかを確かめられなかった時と、確かめる要が無い時に null
export type Repo = { dirty: number; unpushed: number; isPushed: boolean; isDefault: boolean; hasPr: boolean | null }

export type Facts = { repo: Repo | null; percent: number | null }

// 引用の中の字（commit の文や echo の文）を、コマンドとして当てない
const unquoted = (command: string) => command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '')

// コマンドの区切りごとに当て、当たった字を返す。当たらなければ undefined
export const checkOf = (command: string, check: RegExp) => {
  for (const segment of unquoted(command).split(/&&|\|\||[;|\n]/)) {
    const hit = segment.match(check)
    if (hit !== null) return hit[0].trim() || segment.trim()
  }
  return undefined
}

// 優先の高い順に並べ、当てはまったものを maxSteps 個まで返す
export const choose = (turn: Turn, facts: Facts, options: Options): Step[] => {
  const steps: Step[] = []
  const { repo, percent } = facts
  // 失敗の後に書き換えていたら、直している途中とみなし、確かめ直す方だけを出す
  if (turn.check !== null && turn.check.isFailed && turn.edited.length === 0) {
    steps.push({ id: 'fix', label: '落ちた所を直して', reason: `${turn.check.label} が失敗した`, text: `${turn.check.label} の落ちた所を直して` })
  }
  if (turn.edited.length > 0) {
    const text = `${options.testCommand} を走らせて`
    steps.push({ id: 'check', label: text, reason: `${turn.edited.length} ファイルを書き換えた後、まだ確かめていない`, text })
  }
  if (repo !== null && repo.dirty > 0) steps.push({ id: 'commit', label: '変更を commit して', reason: `未 commit ${repo.dirty} 件`, text: '変更を commit して' })
  if (repo !== null && repo.unpushed > 0) steps.push({ id: 'push', label: 'push して', reason: `push していない commit ${repo.unpushed} つ`, text: 'push して' })
  if (repo !== null && !repo.isDefault && repo.isPushed && repo.hasPr === false) steps.push({ id: 'pr', label: 'PR を作って', reason: 'push 済みで、PR がまだ無い', text: 'PR を作って' })
  if (percent !== null && percent >= options.contextPercent) steps.push({ id: 'handoff', label: '/handoff で区切る', reason: `文脈 ${percent}%`, text: '/handoff' })
  return steps.slice(0, options.maxSteps)
}

// 全角の字を 2 桁と数える
const isWide = (code: number) =>
  code >= 0x1100 &&
  (code <= 0x115f ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f300)

export const widthOf = (text: string) => [...text].reduce((sum, letter) => sum + (isWide(letter.codePointAt(0) ?? 0) ? 2 : 1), 0)

// columns 桁に収まらない時は、後ろを切って「…」を付ける
export const cut = (text: string, columns: number) => {
  if (widthOf(text) <= columns) return text
  let kept = ''
  for (const letter of text) {
    if (widthOf(kept + letter) > columns - 1) break
    kept += letter
  }
  return `${kept}…`
}

export const pad = (text: string, columns: number) => text + ' '.repeat(Math.max(0, columns - widthOf(text)))
