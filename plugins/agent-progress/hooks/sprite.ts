import { rgb } from './palette'

// Claude Code のロゴ（起動画面の ▐▛███▜▌）を 9 桁 × 3 行で描く。動いている間は 4 コマを回す
const STAND = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']
const CROUCH = [' ▗▄▄▄▄▄▖ ', '▗▟▙███▟▙▖', ' ▐▜▀▀▀▛▌ ']
const BLINK = [' ▐█████▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']

export const FRAMES = [STAND, CROUCH, BLINK, CROUCH]
export const SPRITE_COLUMNS = 9
export const SPRITE_ROWS = 3
// 1 コマの長さ
export const FRAME_MS = 250

// 端末の既定の色
const DEFAULT = 0x01000000

// Raster の cells（コードポイント・前景・背景の u32 を行の順に並べ、base64 にしたもの）
export const spriteCells = (frame: number, color: string) => {
  const rows = FRAMES[((frame % FRAMES.length) + FRAMES.length) % FRAMES.length]!
  const fg = rgb(color)
  const words = new Uint32Array(SPRITE_COLUMNS * SPRITE_ROWS * 3)
  rows.forEach((row, y) =>
    [...row].forEach((char, x) => {
      const at = (y * SPRITE_COLUMNS + x) * 3
      words[at] = char.codePointAt(0) ?? 0x20
      words[at + 1] = fg
      words[at + 2] = DEFAULT
    }),
  )
  return base64(new Uint8Array(words.buffer))
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Uint8Array.prototype.toBase64 は es2023 の型に無いので、自前で詰める
const base64 = (bytes: Uint8Array) => {
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[at], bytes[at + 1], bytes[at + 2]]
    const word = (a << 16) | (b << 8) | c
    out += ALPHABET[(word >> 18) & 63]! + ALPHABET[(word >> 12) & 63]!
    out += at + 1 < bytes.length ? ALPHABET[(word >> 6) & 63]! : '='
    out += at + 2 < bytes.length ? ALPHABET[word & 63]! : '='
  }
  return out
}
