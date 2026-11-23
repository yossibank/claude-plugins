import type { SnapshotCase } from '../types'

export const stamp = (ms: number | undefined) => {
  if (ms === undefined) return 'なし'
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const fileLabel = (one: SnapshotCase, set: string) => (one.name.startsWith(`${set}-`) ? one.name.slice(set.length + 1) : one.name)
const withVariant = (title: string, variant: string | undefined) => (variant === undefined || variant === '' ? title : `${title}（${variant}）`)

// 画面の名前があればそれを、無ければセットの名前を外したファイル名を出す
export const label = (one: SnapshotCase, set: string) => (one.title === undefined ? fileLabel(one, set) : withVariant(one.title, one.variant))
