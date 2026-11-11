import type { Step } from '../types'

import type { Options } from './config'

// このターンの間に見たこと。check は最後に走らせたテストかビルド、edited はその後に書き換えたファイル
// said は、ターンの終わりの返事の最後で勧めたコマンド
export type Turn = { check: { label: string; isFailed: boolean } | null; edited: string[]; said: string[] }

// リポジトリの今。hasPr は、PR があるかを確かめられなかった時と、確かめる要が無い時に null
export type Repo = { dirty: number; unpushed: number; isPushed: boolean; isDefault: boolean; hasRemote: boolean; hasPr: boolean | null }

export type Facts = { repo: Repo | null; percent: number | null }

// 引用の中の字（commit の文や echo の文）を、コマンドとして当てない
const unquoted = (command: string) => command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '')

// コマンドの区切りごとに当て、当たった字と、その区切りの字を返す。当たらなければ undefined
// 区切りは、もう一度走らせるよう勧める時に使う。引用の中の字は外れる
export const matchOf = (command: string, check: RegExp) => {
  for (const segment of unquoted(command).split(/&&|\|\||[;|\n]/)) {
    const hit = segment.match(check)
    if (hit !== null) return { label: hit[0].trim() || segment.trim(), segment: segment.trim().replace(/\s+/g, ' ') }
  }
  return undefined
}

export const checkOf = (command: string, check: RegExp) => matchOf(command, check)?.label

// スラッシュコマンド（/Users/… のようなパスは除く）か、! で始まるシェルのコマンド
const isCommand = (text: string) => /^\/[a-z][\w:-]*(?:\s|$)/i.test(text) || /^!\s*\S/.test(text)

// 返事の最後の段落にある、人に勧めたコマンドを返す。最後の段落がコードの塊なら、その行から取る
export const saidOf = (answer: string) => {
  const blocks = answer
    .trim()
    .split(/\n\s*\n/)
    .filter(block => block.trim() !== '')
  const last = blocks.at(-1)?.trim() ?? ''
  const found = last.startsWith('```')
    ? last.split('\n').slice(1, last.endsWith('```') ? -1 : undefined)
    : [...last.matchAll(/`([^`\n]+)`/g)].map(hit => hit[1] ?? '')
  return [...new Set(found.map(line => line.trim()).filter(isCommand))]
}

// 優先の高い順に並べ、当てはまったものを maxSteps 個まで返す
export const choose = (turn: Turn, facts: Facts, options: Options): Step[] => {
  const steps: Step[] = []
  const { repo, percent } = facts
  // 返事が人に勧めたコマンドを、いちばん上に出す
  turn.said.forEach((command, index) => {
    steps.push({ id: `said-${index}`, label: command, reason: '返事の最後で勧めた', text: command })
  })
  // 失敗の後に書き換えていたら、直している途中とみなし、確かめ直す方だけを出す
  if (turn.check !== null && turn.check.isFailed && turn.edited.length === 0) {
    steps.push({ id: 'fix', label: '落ちた所を直して', reason: `${turn.check.label} が失敗した`, text: `${turn.check.label} の落ちた所を直して` })
  }
  if (turn.edited.length > 0) {
    const text = `${options.testCommand} を走らせて`
    steps.push({ id: 'check', label: text, reason: `${turn.edited.length} ファイルを書き換えた後、まだ確かめていない`, text })
  }
  // 既定のブランチへは直に commit・push せず、ブランチに切り出して PR にする
  const isGuarded = repo !== null && repo.isDefault && repo.hasRemote && options.prOnDefault
  if (repo !== null && isGuarded && (repo.dirty > 0 || repo.unpushed > 0)) {
    const reason = [repo.dirty > 0 ? `未 commit ${repo.dirty} 件` : '', repo.unpushed > 0 ? `push していない commit ${repo.unpushed} つ` : ''].filter(part => part !== '').join('、')
    steps.push({ id: 'pr', label: 'PR にして', reason: `既定のブランチに${reason}`, text: 'PR にして' })
  }
  if (repo !== null && !isGuarded && repo.dirty > 0) steps.push({ id: 'commit', label: '変更を commit して', reason: `未 commit ${repo.dirty} 件`, text: '変更を commit して' })
  if (repo !== null && !isGuarded && repo.unpushed > 0) steps.push({ id: 'push', label: 'push して', reason: `push していない commit ${repo.unpushed} つ`, text: 'push して' })
  if (repo !== null && !repo.isDefault && repo.isPushed && repo.hasPr === false) steps.push({ id: 'pr', label: 'PR を作って', reason: 'push 済みで、PR がまだ無い', text: 'PR を作って' })
  if (percent !== null && percent >= options.contextPercent) steps.push({ id: 'handoff', label: '/handoff で区切る', reason: `文脈 ${percent}%`, text: '/handoff' })
  // 返事が勧めたものと同じ文は、2 度出さない
  const unique = steps.filter((step, index) => steps.findIndex(other => other.text === step.text) === index)
  return unique.slice(0, options.maxSteps)
}

// モデルに尋ねる文。ツールは使えないので、考え込まずにすぐ答えるよう頼む（effort を変えるとキャッシュが効かない）
export const askingOf = (hints: Step[], maxSteps: number) =>
  [
    'ここで作業を止め、ツールを使わずに、考え込まずにすぐ答えてください。',
    `この会話で、人が次にあなたへ送りそうな指示を、役に立つ順に ${maxSteps} 個まで選んでください。`,
    'CLAUDE.md・skill・会話で決めた手順に沿うものを選び、もう済んだことや人が断ったことは選ばないでください。',
    '答えは JSON の配列だけにし、前後に文を付けないでください。勧めることが無ければ [] を返してください。',
    '要素は {"label": "ボタンの字（20 字以内）", "reason": "選んだ理由（30 字以内）", "text": "入力欄に入れる、人からあなたへの指示の文"} です。',
    '字は会話で使っている言語で書いてください。',
    hints.length === 0 ? '' : `参考に、git の状態と使ったツールから規則で選んだ候補: ${hints.map(step => `${step.text}（${step.reason}）`).join(' / ')}`,
  ]
    .filter(line => line !== '')
    .join('\n')

const field = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

// モデルの答えから候補を取り出す。読めない時は null
export const askedOf = (reply: string, maxSteps: number): Step[] | null => {
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  if (start < 0 || end < start) return null
  let value: unknown
  try {
    value = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(value)) return null
  return value
    .map(item => (typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}))
    .map(item => ({ label: field(item.label), reason: field(item.reason), text: field(item.text) }))
    .filter(item => item.text !== '')
    .slice(0, maxSteps)
    .map((item, index) => ({ id: `ask-${index}` as const, label: item.label === '' ? item.text : item.label, reason: item.reason, text: item.text }))
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
