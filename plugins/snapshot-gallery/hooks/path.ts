export const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

const unquote = (text: string) => text.replace(/^(['"])(.*)\1$/, '$2')

const go = (base: string, dir: string) => {
  const target = unquote(dir)
  const parts: string[] = []
  for (const part of (target.startsWith('/') ? target : join(base, target)).split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

// コマンドの区切り（&& ; ||）ごとに、match の位置の区切りまで cd と make -C を順に当てて基点を動かす
export const moveBase = (start: string, command: string, at: number) => {
  let base = start
  let from = 0
  for (const cut of [...command.matchAll(/&&|;|\|\||\n/g), { index: command.length, 0: '' }]) {
    const end = cut.index ?? command.length
    const part = command.slice(from, end)
    const cd = part.match(/^\s*cd\s+(\S+)/)
    if (cd?.[1] !== undefined) base = go(base, cd[1])
    if (at >= from && at < end) {
      const make = part.match(/\bmake\b[^|]*?\s-C\s*(\S+)/)
      return make?.[1] === undefined ? base : go(base, make[1])
    }
    from = end + cut[0].length
  }
  return base
}

export const isSetName = (set: string) => /^[\w-][\w.-]*$/.test(set) && !set.includes('..')
