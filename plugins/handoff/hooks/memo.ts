// 引き継ぎメモの指示と、返ってきたメモの読み方
export const MAX_LINES = 20

const RULES = `この会話を区切る。続きのセッションが会話の履歴を読まずに再開できるよう、引き継ぎメモを書いて。

決まり:
- 見出しは「# 引き継ぎ」の 1 つだけ。その下に「- 目的：…」の形で項目を並べる。
- 項目は次の順。中身の無い項目は書かない。1 項目は 1 行。
  - 目的：何を終えれば完了か
  - 決めたこと：理由が要るものだけ。1 項目 1 行
  - 次：次にすることを、する順に。この項目だけ「1. 」「2. 」と番号を付ける
  - 触ったファイル：パスだけ
  - 未検証：確かめていないこと
- 全体で ${MAX_LINES} 行以内。
- 試して戻した変更の経緯と、コードの中身の写しは書かない。
- 日本語で書く。
- メモの本文だけを返す。前置き・後書き・コードブロックの囲みは付けない。`

export const promptOf = (files: string[]) =>
  files.length === 0 ? RULES : `${RULES}\n\nこの会話で書き換えたファイル（「触ったファイル」の材料）:\n${files.map(file => `- ${file}`).join('\n')}`

export const shortenOf = (text: string, lines: number) =>
  `次の引き継ぎメモは ${lines} 行ある。決まりはそのままに、${MAX_LINES} 行以内に削って。メモの本文だけを返す。\n\n${text}`

// 新しい会話の入力欄に入れる文
export const resumeOf = (text: string) => `引き継ぎメモのとおりに、続きを始めて。\n\n${text}`

// モデルが囲みや前置きを付けて返しても、メモの本文だけにする
export const cleanMemo = (raw: string) => {
  const fenced = raw.match(/```(?:markdown|md)?\n([\s\S]*?)\n```/)
  const body = (fenced?.[1] ?? raw).trim()
  const at = body.indexOf('# 引き継ぎ')
  return `${(at > 0 ? body.slice(at) : body).trim()}\n`
}

export const lineCount = (text: string) => text.trimEnd().split('\n').length

// 「- 名前：a」の行と、その下に見出しより深く字下げして続く行を、項目の並びにする。見出しの字下げは問わない。同じ名前の行が何度あってもよい
const fieldOf = (text: string, name: string) => {
  const head = new RegExp(`^(\\s*)[-*]\\s*${name}[：:]\\s*(.*)$`)
  const items: string[] = []
  let depth: number | null = null
  for (const line of text.split('\n')) {
    const match = line.match(head)
    if (match) {
      depth = match[1]?.length ?? 0
      const first = match[2]?.trim() ?? ''
      if (first !== '') items.push(first)
    } else if (depth !== null && line.trim() !== '' && line.length - line.trimStart().length > depth) {
      items.push(line.trim().replace(/^(?:[-*]|\d+[.．])\s+/, ''))
    } else {
      depth = null
    }
  }
  return items
}

// 「次：1. a 2. b」と、その下の「1. a」の行を [a, b] にする
export const nextOf = (text: string) =>
  fieldOf(text, '次')
    .flatMap(item => item.split(/(?:^|\s)\d+[.．]\s+/))
    .map(item => item.trim())
    .filter(item => item !== '')

export const unverifiedOf = (text: string) => fieldOf(text, '未検証')

export type Parts = { goal: string; decisions: string[]; next: string[]; files: string[]; unverified: string[] }

// メモを項目ごとに分ける。ペインで項目ごとに描くために使う
export const partsOf = (text: string): Parts => ({
  goal: fieldOf(text, '目的').join(' '),
  decisions: fieldOf(text, '決めたこと'),
  next: nextOf(text),
  files: fieldOf(text, '触ったファイル'),
  unverified: unverifiedOf(text),
})

export const isEmptyParts = (parts: Parts) => parts.goal === '' && parts.decisions.length + parts.next.length + parts.files.length + parts.unverified.length === 0
