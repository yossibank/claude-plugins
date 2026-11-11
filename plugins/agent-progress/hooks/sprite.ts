import type { Action } from '../types'

import { FAILED, rgb, TN, toward } from './palette'

// Claude Code のロゴ（起動画面の ▐▛███▜▌）を 9 桁 × 3 行で描き、その頭の上の 1 行に、作業に合わせた小道具を描く
const HEAD = { open: ' ▐▛███▜▌ ', shut: ' ▐█████▌ ' }
// 腕。両方上げる・右を下ろす・左を下ろす
const ARMS = { up: '▝▜█████▛▘', right: '▝▜█████▛▖', left: '▗▜█████▛▘' }
const FEET = '  ▘▘ ▝▝  '

const STAND = [HEAD.open, ARMS.up, FEET]
const CROUCH = [' ▗▄▄▄▄▄▖ ', '▗▟▙███▟▙▖', ' ▐▜▀▀▀▛▌ ']
const BLINK = [HEAD.shut, ARMS.up, FEET]

export const FRAMES = [STAND, CROUCH, BLINK]
export const SPRITE_COLUMNS = 9
const BODY_ROWS = 3
// 体の 3 行と、頭の上の 1 行
export const SPRITE_ROWS = BODY_ROWS + 1
// 1 コマの長さ。1 秒がちょうど TICKS_PER_SECOND コマになる
export const FRAME_MS = 100
export const TICKS_PER_SECOND = 1000 / FRAME_MS

// 立つ（S）とかがむ（C）を 0.8 秒で繰り返し、1 周に 1 度まばたき（B）をする
const TIMELINE = 'SSSSSCCCSSSSSCCCSSBSSCCCSSSSSCCC'
const POSES: Record<string, string[]> = { S: STAND, C: CROUCH, B: BLINK }
// 1 周のコマの数。光の帯と、立つ・かがむの並びが、この長さで元に戻る
export const LOOP_TICKS = TIMELINE.length

const loopOf = (tick: number) => ((tick % LOOP_TICKS) + LOOP_TICKS) % LOOP_TICKS
// step コマごとに 1 つ進み、count で元に戻る番号
const beat = (tick: number, step: number, count: number) => Math.floor(Math.max(0, tick) / step) % count
const bob = (tick: number) => POSES[TIMELINE[loopOf(tick)] ?? 'S'] ?? STAND
// 1 周に 1 度だけ目を閉じる頭
const headAt = (tick: number) => (loopOf(tick) === 18 ? HEAD.shut : HEAD.open)

// 小道具の色。inks の 1 字が 1 マスの色を指す。空白は体と同じ色
const INKS: Record<string, string> = { d: TN.fgDark, c: TN.comment, w: '#ffffff', g: TN.green, y: TN.yellow, b: TN.blue, r: FAILED }

// 1 コマ。air は頭の上の 1 行、inks はその色。isJumping の間は体を 1 行上げ、足元に影を置く
export type Scene = { air: string; inks: string; body: string[]; isJumping?: boolean }

const EMPTY = ' '.repeat(SPRITE_COLUMNS)
// 跳んでいる間の、足元の影
const SHADOW = '   ▔▔▔   '

// 幅いっぱいに、右を空白で埋める
const pad = (text: string) => text.padEnd(SPRITE_COLUMNS)
// row の at 桁目を char に替える
const put = (row: string, at: number, char: string) => [...row].map((found, index) => (index === at ? char : found)).join('')

// パソコンを打つ。腕を交互に下ろし、頭の上の行に打った字が伸びていく
const TYPED = ['>_', '>=_', '>==_', '>=-=_', '>=-==_', '>=-==-_', '>=-==-=_', '>=-==-==']
const typing = (tick: number): Scene => ({
  air: pad(TYPED[beat(tick, 2, TYPED.length)] ?? ''),
  inks: 'g'.repeat(SPRITE_COLUMNS),
  body: [headAt(tick), beat(tick, 2, 2) === 0 ? ARMS.right : ARMS.left, FEET],
})

// 書類を目で追う。頭の上の行の、読んでいる所が左から右へ動く
const PAGE = '=-==-=-=='
const reading = (tick: number): Scene => ({
  air: PAGE,
  inks: put('c'.repeat(SPRITE_COLUMNS), beat(tick, 2, SPRITE_COLUMNS), 'y'),
  body: [headAt(tick), ARMS.up, FEET],
})

// 頭の上で地球儀が回り、両脇に波が出る
const GLOBES = ['◐', '◓', '◑', '◒']
const browsing = (tick: number): Scene => {
  const globe = `(${GLOBES[beat(tick, 2, GLOBES.length)]})`
  return { air: beat(tick, 4, 2) === 0 ? `  ~${globe}~  ` : `   ${globe}   `, inks: '  cdbdc  ', body: bob(tick) }
}

// サッカーのヘディング。落ちてきたボールを、かがんで待ち、跳んで頭で打ち上げる
const BALL = '    o    '
const BALL_INKS = '    w    '
const HEADER: Scene[] = [
  { air: BALL, inks: BALL_INKS, body: STAND },
  { air: BALL, inks: BALL_INKS, body: CROUCH },
  { air: EMPTY, inks: EMPTY, body: STAND, isJumping: true },
  { air: EMPTY, inks: EMPTY, body: STAND, isJumping: true },
  { air: EMPTY, inks: EMPTY, body: STAND },
  { air: EMPTY, inks: EMPTY, body: STAND },
  { air: EMPTY, inks: EMPTY, body: STAND },
  { air: BALL, inks: BALL_INKS, body: STAND },
]
const playing = (tick: number): Scene => HEADER[beat(tick, 2, HEADER.length)] ?? { air: EMPTY, inks: EMPTY, body: STAND }

// 考えている。頭の上に泡が浮かんで大きくなり、? から ! に替わる
const BUBBLES: [string, string][] = [
  [EMPTY, EMPTY],
  ['    .    ', '    d    '],
  ['    o    ', '    d    '],
  ['    O    ', '    d    '],
  ['   (?)   ', '   dyd   '],
  ['   (?)   ', '   dyd   '],
  ['   (!)   ', '   dyd   '],
  ['   (!)   ', '   dyd   '],
]
const thinking = (tick: number): Scene => {
  const [air, inks] = BUBBLES[beat(tick, 4, BUBBLES.length)] ?? [EMPTY, EMPTY]
  return { air, inks, body: bob(tick) }
}

// 決まった動きの無い作業。立つ・かがむを繰り返し、頭の上を、きらめきが場所を替えながら光る
const SPARK_COLUMNS = [1, 6, 3, 7]
// 1 か所にいるコマの数。始めの SPARK_REST コマは何も出さず、残りで小さく・大きく・小さくと光る
const SPARK_TICKS = LOOP_TICKS / SPARK_COLUMNS.length
const SPARK_GLYPHS = ['.', '+', '*', '+', '.']
const SPARK_REST = SPARK_TICKS - SPARK_GLYPHS.length
const sparkling = (tick: number): Scene => {
  const at = loopOf(tick)
  const glyph = SPARK_GLYPHS[(at % SPARK_TICKS) - SPARK_REST]
  const column = SPARK_COLUMNS[Math.floor(at / SPARK_TICKS)] ?? 0
  return glyph === undefined ? { air: EMPTY, inks: EMPTY, body: bob(tick) } : { air: put(EMPTY, column, glyph), inks: put(EMPTY, column, 'w'), body: bob(tick) }
}

// 止まっている時の、頭の上の印。待ち・完了・失敗
const STILL: Partial<Record<Action, [string, string]>> = {
  idle: ['     zZ  ', '     cc  '],
  done: ['    ✓    ', '    g    '],
  failed: ['    ✗    ', '    r    '],
}

// 作業ごとの 1 コマ
export const sceneOf = (action: Action, tick: number): Scene => {
  if (action === 'type') return typing(tick)
  if (action === 'read') return reading(tick)
  if (action === 'web') return browsing(tick)
  if (action === 'play') return playing(tick)
  if (action === 'think') return thinking(tick)
  return sparkling(tick)
}

// 端末の既定の色
const DEFAULT = 0x01000000
const WHITE = '#ffffff'
const BLACK = '#000000'

// 光の帯。体の上を、左上から右下へ斜めに横切る。SLANT は 1 行下がるごとの遅れ、REACH は帯の太さ、TRAVEL は帯の中心が動く範囲
const SLANT = 1.2
const REACH = 4.5
const TRAVEL = { from: -5, to: 21 }
const GLOW = 0.55

// 体のマスの色。上の行を明るく、下の行を暗くして厚みを出し、光の帯が通る所を白へ寄せる。y は体の中の行
const shade = (color: string, x: number, y: number, tick: number) => {
  const depth = y === 0 ? toward(color, WHITE, 0.1) : y === BODY_ROWS - 1 ? toward(color, BLACK, 0.18) : rgb(color)
  const center = TRAVEL.from + (loopOf(tick) / LOOP_TICKS) * (TRAVEL.to - TRAVEL.from)
  const distance = x + y * SLANT - center
  const glow = Math.exp(-(distance * distance) / REACH)
  return toward(`#${depth.toString(16).padStart(6, '0')}`, WHITE, GLOW * glow)
}

const charAt = (row: string | undefined, x: number) => [...(row ?? '')][x] ?? ' '

// Raster の cells（コードポイント・前景・背景の u32 を行の順に並べ、base64 にしたもの）
// 体は頭の上の 1 行の下に置く。跳んでいる間は 1 行上げて、空いた足元に影を置く
const encode = (scene: Scene, color: string, bodyColor: (x: number, y: number) => number) => {
  const top = scene.isJumping === true ? 0 : 1
  const words = new Uint32Array(SPRITE_COLUMNS * SPRITE_ROWS * 3)
  for (let y = 0; y < SPRITE_ROWS; y += 1) {
    for (let x = 0; x < SPRITE_COLUMNS; x += 1) {
      const at = (y * SPRITE_COLUMNS + x) * 3
      const row = y - top
      const [char, fg] =
        row >= 0 && row < BODY_ROWS
          ? [charAt(scene.body[row], x), bodyColor(x, row)]
          : scene.isJumping === true
            ? [charAt(SHADOW, x), rgb(TN.comment)]
            : [charAt(scene.air, x), rgb(INKS[charAt(scene.inks, x)] ?? color)]
      words[at] = char.codePointAt(0) ?? 0x20
      words[at + 1] = fg
      words[at + 2] = DEFAULT
    }
  }
  return base64(new Uint8Array(words.buffer))
}

// 動いているアイコンの、tick コマ目。作業に合わせて体と頭の上の小道具を動かし、体に光の帯を流す
export const spriteCells = (tick: number, color: string, action: Action = 'plain') => encode(sceneOf(action, tick), color, (x, y) => shade(color, x, y, tick))

// 止まっているアイコン。立った姿勢を 1 色で描き、頭の上に待ち・完了・失敗の印を添える
export const stillCells = (color: string, action: Action = 'plain') => {
  const [air, inks] = STILL[action] ?? [EMPTY, EMPTY]
  return encode({ air, inks, body: STAND }, color, () => rgb(color))
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
