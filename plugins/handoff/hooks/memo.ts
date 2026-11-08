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

const itemsOf = (text: string, name: string) =>
  text
    .split('\n')
    .map(line => line.match(new RegExp(`^\\s*[-*]\\s*${name}[：:]\\s*(.*)$`))?.[1]?.trim())
    .filter((item): item is string => item !== undefined && item !== '')

// 「次：1. a 2. b」を [a, b] にする。字下げして続く行も読む。session-dashboard の parseNext と同じ読み方
export const nextOf = (text: string) => {
  const lines = text.split('\n')
  const at = lines.findIndex(line => /^\s*[-*]\s*次[：:]/.test(line))
  if (at < 0) return []
  const chunks = [lines[at]?.match(/^\s*[-*]\s*次[：:]\s*(.*)$/)?.[1] ?? '']
  for (const line of lines.slice(at + 1)) {
    if (!/^\s+\S/.test(line)) break
    chunks.push(line.trim())
  }
  return chunks
    .join(' ')
    .split(/(?:^|\s)\d+[.．]\s+/)
    .map(item => item.trim())
    .filter(item => item !== '')
}

export const unverifiedOf = (text: string) => itemsOf(text, '未検証')
