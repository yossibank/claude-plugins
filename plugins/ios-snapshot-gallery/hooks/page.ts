import type { Gallery, SnapshotCase } from '../types'

import { label, stamp } from './view'

const escape = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)

// 絶対パスを file の URL にする。パスの区切りは残し、ほかの記号と日本語は符号にする
const url = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`

// 画面ごとに分ける鍵。名前が無い時は、ファイル名の最後の「-描き方」を外したもの
const groupKey = (one: SnapshotCase, set: string) => one.title ?? label(one, set).replace(/-[^-]+$/, '')

// 描き方の名前。無い時はファイル名の最後の段
const variantOf = (one: SnapshotCase) => (one.variant !== undefined && one.variant !== '' ? one.variant : (one.name.split('-').at(-1) ?? one.name))

type Shot = { name: string; variant: string; status: SnapshotCase['status']; after: string; before?: string; width: number; height: number; afterMs: number; afterAt: string; beforeAt: string; sameAs?: string }
type Screen = { title: string; status: SnapshotCase['status']; shots: Shot[] }

const worst = (shots: Shot[]) => (shots.some(one => one.status === 'changed') ? 'changed' : shots.some(one => one.status === 'added') ? 'added' : 'same')

// 画像を画面の名前ごとにまとめる。画面の状態は、描き方のうちいちばん目立つもの
export const screens = (state: Gallery): Screen[] => {
  const byName = new Map(state.cases.map(one => [one.name, one]))
  const groups = new Map<string, Shot[]>()
  for (const one of state.cases) {
    const key = groupKey(one, state.set)
    const same = one.sameAs === undefined ? undefined : byName.get(one.sameAs)
    const shot: Shot = {
      name: one.name,
      variant: variantOf(one),
      status: one.status,
      after: url(one.after),
      before: one.before === undefined ? undefined : url(one.before),
      width: one.width,
      height: one.height,
      afterMs: one.afterMs,
      afterAt: stamp(one.afterMs),
      beforeAt: stamp(one.beforeMs),
      sameAs: same === undefined ? undefined : `${groupKey(same, state.set)}（${variantOf(same)}）`,
    }
    groups.set(key, [...(groups.get(key) ?? []), shot])
  }
  return [...groups.entries()].map(([title, shots]) => ({ title, status: worst(shots), shots }))
}

// JSON を script の中に置いても閉じタグにならないようにする
const embed = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

// 前と後を画面ごとに並べた 1 枚の HTML。画像は高さを揃え、クリックだけで絞り込み・比べ方の切り替え・拡大ができる
export const page = (state: Gallery) => {
  const data = { set: state.set, at: stamp(Math.max(0, ...state.cases.map(one => one.afterMs))), removed: state.removed, isChangedOnly: state.isChangedOnly, screens: screens(state) }
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>📸 ${escape(state.set)}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #eef0f4; --glow: radial-gradient(1200px 600px at 10% -10%, rgba(10,132,255,.10), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(191,90,242,.08), transparent 60%);
  --panel: rgba(255,255,255,.72); --card: rgba(255,255,255,.9); --well: rgba(0,0,0,.035); --line: rgba(0,0,0,.08); --ink: #1d1d1f; --dim: #6e6e73; --faint: #a1a1a6;
  --accent: #0a84ff; --accent2: #bf5af2; --changed: #ff9f0a; --added: #30d158; --same: #8e8e93; --removed: #ff453a;
  --shadow: 0 1px 1px rgba(0,0,0,.03), 0 10px 30px -8px rgba(30,40,80,.18); --ring: 0 0 0 1px var(--line);
  --h: 440px; --ease: cubic-bezier(.2,.8,.2,1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0c10; --glow: radial-gradient(1200px 600px at 10% -10%, rgba(10,132,255,.16), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(191,90,242,.13), transparent 60%);
    --panel: rgba(22,23,28,.7); --card: rgba(28,29,35,.82); --well: rgba(255,255,255,.04); --line: rgba(255,255,255,.08); --ink: #f5f5f7; --dim: #a1a1a6; --faint: #6e6e73;
    --shadow: 0 1px 1px rgba(0,0,0,.4), 0 16px 40px -12px rgba(0,0,0,.6);
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; color: var(--ink); background: var(--glow), var(--bg); background-attachment: fixed; -webkit-font-smoothing: antialiased; min-height: 100vh; }
button { font: inherit; color: inherit; }
::-webkit-scrollbar { width: 10px; height: 10px; } ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 10px; border: 2px solid transparent; background-clip: padding-box; }

header { position: sticky; top: 0; z-index: 20; background: var(--panel); backdrop-filter: saturate(180%) blur(24px); -webkit-backdrop-filter: saturate(180%) blur(24px); border-bottom: 1px solid var(--line); }
.bar { display: flex; align-items: center; gap: 14px 20px; padding: 14px 28px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.logo { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-size: 20px; background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 6px 16px -6px var(--accent); }
.brand h1 { margin: 0; font-size: 17px; letter-spacing: -.02em; white-space: nowrap; }
.brand p { margin: 0; font-size: 12px; color: var(--dim); white-space: nowrap; }
.tiles { display: flex; gap: 8px; flex-wrap: wrap; }
.tile { position: relative; display: flex; flex-direction: column; align-items: flex-start; min-width: 78px; padding: 7px 14px 8px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); cursor: pointer; transition: transform .2s var(--ease), box-shadow .2s, border-color .2s; overflow: hidden; }
.tile:hover { transform: translateY(-1px); box-shadow: var(--shadow); }
.tile .n { font-size: 20px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.tile .w { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--dim); white-space: nowrap; }
.tile::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--c, transparent); opacity: .9; }
.tile.on { border-color: var(--c, var(--ink)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c, var(--ink)) 22%, transparent); }
.tile.on .n { color: var(--c, var(--ink)); }
.tile.zero { opacity: .45; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; }
.dot.changed { background: var(--changed); } .dot.added { background: var(--added); } .dot.same { background: var(--same); } .dot.removed { background: var(--removed); }
.spacer { flex: 1; }
.tools-top { display: flex; align-items: center; gap: 14px; }
.progress { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--dim); white-space: nowrap; }
.progress b { color: var(--ink); font-size: 13px; }
.ring { width: 30px; height: 30px; border-radius: 50%; background: conic-gradient(var(--added) calc(var(--p) * 1%), var(--line) 0); display: grid; place-items: center; transition: background .4s; }
.ring::after { content: attr(data-t); width: 22px; height: 22px; border-radius: 50%; background: var(--card); display: grid; place-items: center; font-size: 9px; font-weight: 700; color: var(--ink); }
.search { width: 220px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--well); font: inherit; color: inherit; outline: none; transition: border-color .2s, box-shadow .2s, background .2s; }
.search:focus { border-color: var(--accent); background: var(--card); box-shadow: 0 0 0 4px rgba(10,132,255,.18); }
.ratio { display: flex; height: 3px; gap: 2px; }
.ratio i { display: block; border-radius: 2px; }

.layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); }
nav { position: sticky; top: var(--top, 70px); height: calc(100vh - var(--top, 70px)); overflow: auto; padding: 16px 12px 40px; border-right: 1px solid var(--line); }
nav details { margin-bottom: 6px; }
nav summary { list-style: none; display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 11px; font-weight: 700; color: var(--faint); letter-spacing: .06em; cursor: pointer; border-radius: 8px; user-select: none; }
nav summary::-webkit-details-marker { display: none; }
nav summary::before { content: "›"; font-size: 14px; transition: transform .2s var(--ease); }
nav details[open] summary::before { transform: rotate(90deg); }
nav summary:hover { color: var(--dim); }
nav summary span { margin-left: auto; font-weight: 500; }
nav a { position: relative; display: flex; align-items: center; gap: 9px; padding: 7px 10px; margin: 1px 0; border-radius: 9px; color: var(--dim); text-decoration: none; font-size: 13px; cursor: pointer; transition: background .15s, color .15s; }
nav a:hover { background: var(--well); color: var(--ink); }
nav a.on { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, var(--accent2))); color: #fff; box-shadow: 0 6px 14px -8px var(--accent); }
nav a.on .dot { box-shadow: 0 0 0 2px rgba(255,255,255,.9); }
nav a .check { margin-left: auto; width: 16px; height: 16px; border-radius: 50%; background: var(--added); color: #fff; font-size: 10px; display: grid; place-items: center; }

main { padding: 28px 32px 160px; display: flex; flex-direction: column; gap: 24px; min-width: 0; }
.screen { position: relative; background: var(--card); border-radius: 20px; box-shadow: var(--shadow), var(--ring); scroll-margin-top: calc(var(--top, 70px) + 16px); animation: rise .35s var(--ease) both; transition: opacity .3s, filter .3s; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
.screen.done { opacity: .5; filter: saturate(.4); }
.screen.done:hover { opacity: .85; filter: none; }
.head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 16px 20px 14px 22px; border-bottom: 1px solid var(--line); }
.head::before { content: ""; width: 4px; align-self: stretch; border-radius: 4px; background: var(--same); margin-left: -8px; }
.screen.changed .head::before { background: var(--changed); } .screen.added .head::before { background: var(--added); } .screen.removed .head::before { background: var(--removed); }
.head h2 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
.crumb { color: var(--faint); font-weight: 500; }
.badge { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); }
.badge.changed { --c: var(--changed); } .badge.added { --c: var(--added); } .badge.same { --c: var(--same); }
.actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.seg { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); }
.seg button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; padding: 5px 11px; border-radius: 7px; font-size: 12px; color: var(--dim); cursor: pointer; white-space: nowrap; transition: background .2s, color .2s, box-shadow .2s; }
.seg button:hover { color: var(--ink); }
.seg button.on { background: var(--card); color: var(--ink); box-shadow: 0 1px 4px rgba(0,0,0,.14), var(--ring); font-weight: 600; }
.seg button i { font-style: normal; font-size: 13px; opacity: .8; }
.done-button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--card); border-radius: 10px; padding: 5px 12px; font-size: 12px; cursor: pointer; transition: all .2s var(--ease); }
.done-button:hover { border-color: var(--added); color: var(--added); }
.done-button.on { background: var(--added); border-color: var(--added); color: #fff; }

.strip { display: flex; gap: 10px; padding: 14px 20px 0 22px; overflow-x: auto; }
.thumb { flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 6px 5px; border: 0; border-radius: 12px; background: transparent; cursor: pointer; transition: background .2s; }
.thumb:hover { background: var(--well); }
.thumb img { height: 64px; width: auto; display: block; border-radius: 7px; box-shadow: 0 0 0 1.5px var(--line); transition: box-shadow .2s, transform .2s var(--ease); }
.thumb.changed img { box-shadow: 0 0 0 2px var(--changed); } .thumb.added img { box-shadow: 0 0 0 2px var(--added); }
.thumb.on { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.thumb.on img { box-shadow: 0 0 0 2.5px var(--accent), 0 6px 14px -6px var(--accent); transform: translateY(-1px); }
.thumb span { max-width: 140px; font-size: 11px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thumb.on span { color: var(--accent); font-weight: 600; }

.stage { display: flex; gap: 28px; align-items: flex-start; padding: 18px 22px 22px; overflow-x: auto; }
.frame { flex: none; display: flex; flex-direction: column; gap: 8px; }
.frame .label { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--faint); }
.pill { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 6px; background: var(--well); color: var(--dim); box-shadow: var(--ring); }
.pill.after { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); box-shadow: none; }
.arrow { flex: none; align-self: center; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--well); color: var(--faint); box-shadow: var(--ring); }
.pic { height: var(--h); width: auto; display: block; border-radius: 14px; box-shadow: 0 0 0 1px var(--line), 0 12px 28px -14px rgba(0,0,0,.35); cursor: zoom-in; transition: transform .25s var(--ease), box-shadow .25s; background: #fff; }
.pic:hover { transform: translateY(-3px) scale(1.01); box-shadow: 0 0 0 1px var(--line), 0 20px 40px -16px rgba(0,0,0,.45); }
.box { position: relative; height: var(--h); border-radius: 14px; overflow: hidden; box-shadow: 0 0 0 1px var(--line), 0 12px 28px -14px rgba(0,0,0,.35); }
.box img { display: block; height: 100%; width: 100%; object-fit: contain; object-position: top center; }
.compare { cursor: ew-resize; user-select: none; touch-action: none; }
.compare img { pointer-events: none; }
.compare .top { position: absolute; inset: 0; clip-path: inset(0 0 0 var(--cut, 50%)); }
.compare .handle { position: absolute; top: 0; bottom: 0; left: var(--cut, 50%); width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.2), 0 0 12px rgba(0,0,0,.3); pointer-events: none; }
.compare .handle::after { content: "‹ ›"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: #fff; color: #1d1d1f; font-weight: 700; font-size: 14px; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
.compare .tag { position: absolute; top: 10px; padding: 2px 9px; border-radius: 7px; background: rgba(0,0,0,.6); backdrop-filter: blur(6px); color: #fff; font-size: 11px; font-weight: 600; pointer-events: none; }
.diff { background: #000; isolation: isolate; cursor: zoom-in; }
.diff .inner { height: 100%; filter: brightness(4) saturate(1.6); }
.diff .inner img + img { position: absolute; inset: 0; mix-blend-mode: difference; }
.empty { height: var(--h); display: grid; place-items: center; border: 2px dashed var(--line); border-radius: 14px; color: var(--faint); font-size: 12px; text-align: center; padding: 12px; }
.note { font-size: 12px; color: var(--dim); margin: 0; }
.foot { padding: 0 22px 18px; }

.same-wrap { display: flex; flex-wrap: wrap; gap: 18px; padding: 18px 22px 22px; }
.same-wrap figure { margin: 0; cursor: zoom-in; display: flex; flex-direction: column; gap: 6px; }
.same-wrap img { height: 180px; width: auto; border-radius: 10px; display: block; box-shadow: 0 0 0 1px var(--line); transition: transform .2s var(--ease), box-shadow .2s; }
.same-wrap figure:hover img { transform: translateY(-3px); box-shadow: 0 0 0 1px var(--line), var(--shadow); }
.same-wrap figcaption { max-width: 220px; font-size: 11px; color: var(--dim); line-height: 1.35; }
.hero { text-align: center; padding: 64px 20px; color: var(--dim); background: var(--card); border-radius: 20px; box-shadow: var(--shadow), var(--ring); }
.hero .big { font-size: 44px; }
.hero b { display: block; font-size: 20px; color: var(--ink); margin: 6px 0 4px; }
.removed-list { margin: 0; padding: 14px 22px 20px 40px; color: var(--dim); }

#viewer { position: fixed; inset: 0; z-index: 50; display: none; flex-direction: column; background: rgba(8,8,12,.92); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); color: #f5f5f7; }
#viewer.open { display: flex; animation: fade .2s var(--ease); }
@keyframes fade { from { opacity: 0; transform: scale(.99); } }
.vbar { display: flex; align-items: center; gap: 10px; padding: 12px 18px; }
.vbar .name { min-width: 0; }
.vbar .name b { display: block; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vbar .name small { color: #98989d; font-size: 11px; }
.glass { display: inline-flex; align-items: center; padding: 3px; border-radius: 11px; background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
.glass button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: #d1d1d6; padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; white-space: nowrap; transition: background .15s, color .15s; }
.glass button:hover { background: rgba(255,255,255,.1); color: #fff; }
.glass button.on { background: rgba(255,255,255,.2); color: #fff; font-weight: 600; }
.canvas { position: relative; flex: 1; min-height: 0; display: grid; place-items: center; cursor: zoom-out; }
.stagebox { display: flex; gap: 32px; align-items: center; cursor: default; }
.stagebox .arrow { background: rgba(255,255,255,.08); color: #98989d; box-shadow: none; }
.stagebox .pane { display: flex; flex-direction: column; gap: 8px; }
.stagebox .pane > span { font-size: 12px; color: #98989d; }
.stagebox img { display: block; }
.stagebox .shotimg { border-radius: 10px; box-shadow: 0 30px 60px -20px rgba(0,0,0,.8); }
.vstrip { display: flex; justify-content: center; gap: 10px; padding: 10px 18px 16px; overflow-x: auto; }
.vstrip .thumb span { color: #98989d; }
.vstrip .thumb:hover { background: rgba(255,255,255,.08); }
.vstrip .thumb.on { background: rgba(10,132,255,.22); }
.vstrip .thumb.on span { color: #fff; }
.vstrip .thumb img { height: 52px; box-shadow: 0 0 0 1.5px rgba(255,255,255,.15); }
.vstrip .thumb.on img { box-shadow: 0 0 0 2.5px var(--accent); }
.vhint { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); padding: 5px 12px; border-radius: 999px; background: rgba(255,255,255,.08); font-size: 11px; color: #98989d; pointer-events: none; }
</style>
</head>
<body>
<header id="header">
<div class="bar">
<div class="brand"><div class="logo">📸</div><div><h1>${escape(state.set)}</h1><p id="summary"></p></div></div>
<div class="tiles" id="tiles"></div>
<div class="spacer"></div>
<div class="tools-top">
<div class="progress" id="progress"></div>
<input class="search" id="search" type="search" placeholder="🔍 画面の名前で探す">
</div>
</div>
<div class="ratio" id="ratio"></div>
</header>
<div class="layout">
<nav id="nav"></nav>
<main id="main"></main>
</div>
<div id="viewer">
<div class="vbar">
<div class="glass"><button data-go="-1">‹ 前の画面</button><button data-go="1">次の画面 ›</button></div>
<div class="name" id="vname"></div>
<div class="spacer"></div>
<div class="glass" id="vmodes"></div>
<div class="glass"><button data-close>✕ 閉じる</button></div>
</div>
<div class="canvas" id="canvas"><div class="stagebox" id="stagebox"></div><div class="vhint">画像の外を押すと閉じる</div></div>
<div class="vstrip" id="vstrip"></div>
</div>
<script id="data" type="application/json">${embed(data)}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent)
  var WORD = { changed: '変更', added: '新規', same: '同じ' }
  var MODES = [['side', '◫', '並べる'], ['slider', '⇆', 'スライダー'], ['diff', '◐', '差分'], ['after', '▢', '後だけ']]
  var store = 'snapshot-gallery:' + data.set
  var saved = {}
  try { saved = JSON.parse(localStorage.getItem(store) || '{}') } catch (e) {}
  var done = saved.done || {}
  var state = { filter: data.isChangedOnly ? 'changes' : 'all', query: '', variant: {}, mode: {} }
  var screens = data.screens
  var count = { changed: 0, added: 0, same: 0 }
  screens.forEach(function (s) { count[s.status] += 1 })
  var shots = screens.reduce(function (n, s) { return n + s.shots.length }, 0)
  var el = function (id) { return document.getElementById(id) }
  var esc = function (t) { return String(t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';' }) }
  var key = function (s) { return s.title + '|' + s.shots.map(function (x) { return x.afterMs }).join(',') }
  var parts = function (t) { return t.split(' › ') }
  var save = function () { try { localStorage.setItem(store, JSON.stringify({ done: done })) } catch (e) {} }

  function top() { document.documentElement.style.setProperty('--top', el('header').offsetHeight + 'px') }
  // 比べ方に合わせて、横幅と高さに収まるいちばん大きな画像の高さを決める。並べる時は 2 枚と矢印で横幅いっぱいにする
  function fitHeight(shot, mode, width, height) {
    var r = shot.width / shot.height
    var isSide = mode === 'side'
    var room = width - (isSide ? 28 * 2 + 30 : 0)
    return Math.max(160, Math.floor(Math.min(room / ((isSide ? 2 : 1) * r), height, shot.height / 2 * 1.5)))
  }
  function cardHeight(i) {
    var width = el('main').clientWidth - 64 - 44
    var height = innerHeight - el('header').offsetHeight - (screens[i].shots.length > 1 ? 290 : 180)
    return fitHeight(shotOf(i), modeOf(i), width, height)
  }
  function resize() { top(); screens.forEach(function (s, i) { var c = el('s' + i); if (c) c.style.setProperty('--h', cardHeight(i) + 'px') }); if (viewer.classList.contains('open')) draw() }
  addEventListener('resize', resize)

  el('summary').textContent = data.at + ' に描いた · ' + screens.length + ' 画面 · ' + shots + ' 枚'
  if (screens.length > 0) el('ratio').innerHTML = ['changed', 'added', 'same'].filter(function (k) { return count[k] > 0 }).map(function (k) { return '<i style="flex:' + count[k] + ';background:var(--' + k + ')"></i>' }).join('')

  function tiles() {
    var list = [['changes', '要確認', count.changed + count.added, 'var(--accent)', ''], ['changed', '変更', count.changed, 'var(--changed)', 'changed'], ['added', '新規', count.added, 'var(--added)', 'added'], ['same', '同じ', count.same, 'var(--same)', 'same'], ['all', 'すべて', screens.length, 'var(--ink)', '']]
    if (data.removed.length > 0) list.push(['removed', '消えた', data.removed.length, 'var(--removed)', 'removed'])
    el('tiles').innerHTML = list.map(function (c) { return '<button class="tile' + (state.filter === c[0] ? ' on' : '') + (c[2] === 0 ? ' zero' : '') + '" style="--c:' + c[3] + '" data-filter="' + c[0] + '"><span class="n">' + c[2] + '</span><span class="w">' + (c[4] ? '<span class="dot ' + c[4] + '"></span>' : '') + c[1] + '</span></button>' }).join('')
  }
  function progress() {
    var targets = screens.filter(function (s) { return s.status !== 'same' })
    var n = targets.filter(function (s) { return done[key(s)] }).length
    var p = targets.length === 0 ? 100 : Math.round(n / targets.length * 100)
    el('progress').innerHTML = targets.length === 0 ? '' : '<span class="ring" style="--p:' + p + '" data-t="' + p + '%"></span><span><b>' + n + ' / ' + targets.length + '</b><br>確認した</span>'
  }
  function visible(s) {
    var f = state.filter
    var ok = f === 'all' || f === 'removed' || (f === 'changes' ? s.status !== 'same' : s.status === f)
    return ok && (state.query === '' || s.title.toLowerCase().indexOf(state.query) >= 0)
  }
  // 初めは、変わった描き方のうち最初のものを選ぶ
  function firstOf(s) { for (var k = 0; k < s.shots.length; k += 1) if (s.shots[k].status !== 'same') return k; return 0 }
  function indexOf(i) { var k = state.variant[i]; return Math.min(k === undefined ? firstOf(screens[i]) : k, screens[i].shots.length - 1) }
  function shotOf(i) { return screens[i].shots[indexOf(i)] }
  function modeOf(i) { var shot = shotOf(i); return shot.before ? (state.mode[i] || (shot.status === 'same' ? 'after' : 'side')) : 'after' }
  function ratio(shot) { return shot.width + ' / ' + shot.height }

  function nav() {
    var groups = {}, order = []
    if (state.filter !== 'removed') screens.forEach(function (s, i) {
      if (!visible(s)) return
      var g = parts(s.title)[0]
      if (!groups[g]) { groups[g] = []; order.push(g) }
      groups[g].push(i)
    })
    el('nav').innerHTML = order.map(function (g) {
      return '<details open><summary>' + esc(g) + '<span>' + groups[g].length + '</span></summary>' + groups[g].map(function (i) {
        var s = screens[i]
        var name = parts(s.title).length > 1 ? parts(s.title).slice(1).join(' › ') : s.title + '（全体）'
        return '<a data-jump="' + i + '"><span class="dot ' + s.status + '"></span>' + esc(name) + (done[key(s)] ? '<span class="check">✓</span>' : '') + '</a>'
      }).join('') + '</details>'
    }).join('') || '<p class="note" style="padding:0 12px">合う画面がありません</p>'
  }

  function strip(i, cls) {
    var s = screens[i], at = indexOf(i)
    if (s.shots.length < 2) return ''
    return '<div class="' + cls + '">' + s.shots.map(function (x, k) { return '<button class="thumb ' + x.status + (k === at ? ' on' : '') + '" data-variant="' + i + ':' + k + '"><img loading="lazy" src="' + x.after + '"><span>' + esc(x.variant) + '</span></button>' }).join('') + '</div>'
  }

  function body(i) {
    var shot = shotOf(i), mode = modeOf(i)
    var open = ' data-open="' + i + '"', ar = ' style="aspect-ratio:' + ratio(shot) + '"'
    var label = function (pill, at, cls) { return '<div class="label"><span class="pill ' + (cls || '') + '">' + pill + '</span>' + esc(at) + '</div>' }
    var arrow = '<span class="arrow">→</span>'
    if (mode === 'after') {
      return '<div class="frame">' + label(shot.before ? '後' : '新しい画像', shot.afterAt, 'after') + '<img class="pic" loading="lazy" src="' + shot.after + '"' + ar + open + '></div>'
    }
    if (mode === 'slider') {
      return '<div class="frame">' + label('前 ⇆ 後', 'つまみを左右に引いて比べる', 'after') + '<div class="box compare" data-slide' + ar + '><img src="' + shot.before + '"><img class="top" src="' + shot.after + '"><span class="tag" style="left:10px">前</span><span class="tag" style="right:10px">後</span><div class="handle"></div></div></div>'
    }
    if (mode === 'diff') {
      return '<div class="frame">' + label('差分', '違う所だけが明るく光る', 'after') + '<div class="box diff"' + ar + open + '><div class="inner"><img src="' + shot.before + '"><img src="' + shot.after + '"></div></div></div>'
    }
    return '<div class="frame">' + label('前', shot.beforeAt) + '<img class="pic" loading="lazy" src="' + shot.before + '"' + open + '></div>' + arrow + '<div class="frame">' + label('後', shot.afterAt, 'after') + '<img class="pic" loading="lazy" src="' + shot.after + '"' + ar + open + '></div>'
  }

  function card(i) {
    var s = screens[i], p = parts(s.title), shot = shotOf(i)
    var modes = shot.before ? '<span class="seg">' + MODES.map(function (m) { return '<button data-mode="' + i + ':' + m[0] + '" class="' + (modeOf(i) === m[0] ? 'on' : '') + '"><i>' + m[1] + '</i>' + m[2] + '</button>' }).join('') + '</span>' : ''
    var check = s.status === 'same' ? '' : '<button class="done-button' + (done[key(s)] ? ' on' : '') + '" data-done="' + i + '">' + (done[key(s)] ? '✓ 確認済み' : '○ 確認済みにする') + '</button>'
    var variant = s.shots.length < 2 ? '<span class="note">' + esc(shot.variant) + '</span>' : ''
    var same = shot.sameAs ? '<div class="foot"><p class="note">＝ ' + esc(shot.sameAs) + ' と同じ見た目</p></div>' : ''
    return '<section class="screen ' + s.status + (done[key(s)] ? ' done' : '') + '" id="s' + i + '" style="--h:' + cardHeight(i) + 'px"><div class="head"><h2>' + (p.length > 1 ? '<span class="crumb">' + esc(p.slice(0, -1).join(' › ')) + ' › </span>' : '') + esc(p[p.length - 1]) + '</h2><span class="badge ' + s.status + '">' + WORD[s.status] + '</span>' + variant + '<div class="actions">' + modes + check + '</div></div>' + strip(i, 'strip') + '<div class="stage">' + body(i) + '</div>' + same + '</section>'
  }

  function render() {
    tiles(); progress(); nav()
    var html = []
    if (state.filter === 'removed') {
      html.push('<section class="screen removed"><div class="head"><h2>消えた画像</h2><span class="note">前にはあって、今回は描かれなかった画像です</span></div><ul class="removed-list">' + data.removed.map(function (n) { return '<li>' + esc(n) + '</li>' }).join('') + '</ul></section>')
    } else {
      var list = [], sames = []
      screens.forEach(function (s, i) {
        if (!visible(s)) return
        if (s.status === 'same' && state.filter === 'all') sames.push(i)
        else list.push(i)
      })
      if (state.filter === 'changes' && list.length === 0 && state.query === '') html.push('<div class="hero"><div class="big">🎉</div><b>変わった画面はありません</b>' + count.same + ' 画面とも、前と同じ見た目でした。</div>')
      else if (list.length === 0 && sames.length === 0) html.push('<div class="hero"><div class="big">🔍</div><b>合う画面がありません</b>絞り込みか、探す言葉を変えてください。</div>')
      list.forEach(function (i) { html.push(card(i)) })
      if (sames.length > 0) html.push('<section class="screen"><div class="head"><h2>同じだった画面</h2><span class="badge same">' + sames.length + '</span><span class="note">押すと大きく開きます</span></div><div class="same-wrap">' + sames.map(function (i) { var s = screens[i]; return '<figure data-open="' + i + '"><img loading="lazy" src="' + s.shots[0].after + '"><figcaption>' + esc(s.title) + '</figcaption></figure>' }).join('') + '</div></section>')
    }
    el('main').innerHTML = html.join('')
    top(); spy()
  }

  function slide(box, x) {
    var r = box.getBoundingClientRect()
    box.style.setProperty('--cut', Math.max(0, Math.min(100, (x - r.left) / r.width * 100)) + '%')
  }
  var sliding = null
  document.addEventListener('pointerdown', function (e) {
    var box = e.target.closest('[data-slide]')
    if (!box) return
    sliding = box
    slide(box, e.clientX)
    e.preventDefault()
    e.stopPropagation()
  }, true)
  addEventListener('pointermove', function (e) { if (sliding) slide(sliding, e.clientX) })
  addEventListener('pointerup', function () { sliding = null })

  function replace(i) { var old = el('s' + i); if (old) { old.outerHTML = card(i); el('s' + i).style.animation = 'none' } }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-filter],[data-jump],[data-variant],[data-mode],[data-done],[data-open]')
    if (!t || viewer.contains(t)) return
    if (t.dataset.filter) { state.filter = t.dataset.filter; render(); scrollTo({ top: 0 }) }
    else if (t.dataset.jump) { var target = el('s' + t.dataset.jump); if (target) target.scrollIntoView({ behavior: 'smooth' }); else open(Number(t.dataset.jump)) }
    else if (t.dataset.variant) { var v = t.dataset.variant.split(':'); state.variant[v[0]] = Number(v[1]); replace(Number(v[0])) }
    else if (t.dataset.mode) { var m = t.dataset.mode.split(':'); state.mode[m[0]] = m[1]; replace(Number(m[0])) }
    else if (t.dataset.done) { var s = screens[t.dataset.done]; if (done[key(s)]) delete done[key(s)]; else done[key(s)] = 1; save(); replace(Number(t.dataset.done)); progress(); nav(); spy() }
    else if (t.dataset.open) open(Number(t.dataset.open))
  })
  el('search').addEventListener('input', function (e) { state.query = e.target.value.trim().toLowerCase(); render() })

  var observer = null
  function spy() {
    if (observer) observer.disconnect()
    var links = document.querySelectorAll('nav a')
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        links.forEach(function (a) { a.classList.toggle('on', 's' + a.dataset.jump === entry.target.id) })
      })
    }, { rootMargin: '-120px 0px -60% 0px' })
    document.querySelectorAll('main .screen[id]').forEach(function (s) { observer.observe(s) })
  }

  var viewer = el('viewer'), canvas = el('canvas'), box = el('stagebox')
  var view = { i: 0, mode: 'side' }
  function order() { var list = []; screens.forEach(function (s, i) { if (visible(s)) list.push(i) }); return list.length ? list : [view.i] }
  function open(i) { view.i = i; view.mode = modeOf(i); viewer.classList.add('open'); document.body.style.overflow = 'hidden'; draw() }
  function close() { viewer.classList.remove('open'); document.body.style.overflow = ''; replace(view.i) }
  function draw() {
    var s = screens[view.i], shot = shotOf(view.i)
    if (!shot.before) view.mode = 'after'
    el('vname').innerHTML = '<b>' + esc(s.title) + '</b><small>' + esc(shot.variant) + ' · ' + WORD[shot.status] + ' · ' + shot.width + '×' + shot.height + '</small>'
    el('vmodes').innerHTML = shot.before ? MODES.map(function (m) { return '<button data-vmode="' + m[0] + '" class="' + (view.mode === m[0] ? 'on' : '') + '">' + m[1] + ' ' + m[2] + '</button>' }).join('') : '<button class="on">▢ 新しい画像</button>'
    el('vstrip').innerHTML = strip(view.i, 'vstrip-in').replace('class="vstrip-in"', 'style="display:contents"')
    var r = canvas.getBoundingClientRect()
    var hh = fitHeight(shot, view.mode, r.width - 64, r.height - 64 - 26)
    var size = 'height:' + hh + 'px;aspect-ratio:' + ratio(shot)
    // 前の画像は高さだけ揃え、元の縦横の比で描く
    var img = function (src, isBefore) { return '<img class="shotimg" src="' + src + '" style="' + (isBefore ? 'height:' + hh + 'px' : size) + '">' }
    if (view.mode === 'side') box.innerHTML = '<div class="pane"><span>前 · ' + esc(shot.beforeAt) + '</span>' + img(shot.before, true) + '</div><span class="arrow">→</span><div class="pane"><span>後 · ' + esc(shot.afterAt) + '</span>' + img(shot.after) + '</div>'
    else if (view.mode === 'slider') box.innerHTML = '<div class="pane"><span>つまみを左右に引いて比べる</span><div class="box compare shotimg" data-slide style="' + size + '"><img src="' + shot.before + '"><img class="top" src="' + shot.after + '"><span class="tag" style="left:10px">前</span><span class="tag" style="right:10px">後</span><div class="handle"></div></div></div>'
    else if (view.mode === 'diff') box.innerHTML = '<div class="pane"><span>違う所だけが明るく光る</span><div class="box diff shotimg" style="' + size + '"><div class="inner"><img src="' + shot.before + '"><img src="' + shot.after + '"></div></div></div>'
    else box.innerHTML = '<div class="pane"><span>後 · ' + esc(shot.afterAt) + '</span>' + img(shot.after) + '</div>'
  }
  viewer.addEventListener('click', function (e) {
    var t = e.target.closest('button')
    if (!t) { if (e.target.closest('.canvas') && !e.target.closest('.shotimg')) close(); return }
    if (t.dataset.close !== undefined) close()
    else if (t.dataset.go) { replace(view.i); var list = order(); var at = list.indexOf(view.i); view.i = list[(at + Number(t.dataset.go) + list.length) % list.length]; view.mode = modeOf(view.i); draw() }
    else if (t.dataset.vmode) { view.mode = t.dataset.vmode; state.mode[view.i] = view.mode; draw() }
    else if (t.dataset.variant) { state.variant[view.i] = Number(t.dataset.variant.split(':')[1]); draw() }
  })
  addEventListener('keydown', function (e) {
    if (!viewer.classList.contains('open')) return
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowRight') viewer.querySelector('[data-go="1"]').click()
    else if (e.key === 'ArrowLeft') viewer.querySelector('[data-go="-1"]').click()
  })
  render()
})()
</script>
</body>
</html>
`
}
