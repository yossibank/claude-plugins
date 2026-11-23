import type { Gallery, SnapshotCase } from '../types'

import { REMOVED, STATUS } from './config'
import { label, stamp } from './view'

const escape = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)

// 絶対パスを file の URL にする。パスの区切りは残し、ほかの記号と日本語は符号にする
const url = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`

// 画面ごとに分ける鍵。名前が無い時は、ファイル名の最後の「-描き方」を外したもの
const groupKey = (one: SnapshotCase, set: string) => one.title ?? label(one, set).replace(/-[^-]+$/, '')

const card = (one: SnapshotCase, byName: Map<string, SnapshotCase>, set: string) => {
  const status = STATUS[one.status]
  const same = one.sameAs === undefined ? undefined : byName.get(one.sameAs)
  const caption = one.variant !== undefined && one.variant !== '' ? one.variant : label(one, set)
  const sameText = same === undefined ? '' : `<p class="same">＝ ${escape(same.title ?? label(same, set))}${same.variant ? `（${escape(same.variant)}）` : ''} と同じ見た目</p>`
  const before = one.before === undefined ? '<div class="none">前の画像なし</div>' : `<img class="before" src="${url(one.before)}" alt="前">`
  return `<figure class="card ${one.status}${same === undefined ? '' : ' dup'}" data-status="${one.status}" data-dup="${same === undefined ? 0 : 1}" data-name="${escape(one.name)}">
<figcaption><span>${status.mark} ${escape(caption)}</span><span class="when">${stamp(one.afterMs)}</span></figcaption>
<div class="pair" data-width="${one.width}" data-height="${one.height}">
<div class="side"><b>前</b>${before}</div>
<div class="side"><b>後</b><img class="after" src="${url(one.after)}" alt="後"></div>
<div class="diff">${one.before === undefined ? `<img src="${url(one.after)}" alt="後">` : `<img src="${url(one.before)}" alt=""><img class="top" src="${url(one.after)}" alt="">`}</div>
</div>
${sameText}
</figure>`
}

// 前と後を画面ごとに並べた 1 枚の HTML。ブラウザーで拡大・差分・前後の切り替えができる
export const page = (state: Gallery) => {
  const byName = new Map(state.cases.map(one => [one.name, one]))
  const groups = new Map<string, SnapshotCase[]>()
  for (const one of state.cases) {
    const key = groupKey(one, state.set)
    groups.set(key, [...(groups.get(key) ?? []), one])
  }
  const count = (status: keyof typeof STATUS) => state.cases.filter(one => one.status === status).length
  const sections = [...groups.entries()]
    .map(([title, cases]) => {
      const worst = cases.some(one => one.status === 'changed') ? 'changed' : cases.some(one => one.status === 'added') ? 'added' : 'same'
      return `<section data-status="${worst}"><h2>${STATUS[worst].mark} ${escape(title)}</h2><div class="cards">${cases.map(one => card(one, byName, state.set)).join('\n')}</div></section>`
    })
    .join('\n')
  const removed = state.removed.length === 0 ? '' : `<p class="removed">${REMOVED.mark} 後に無い画像：${state.removed.map(escape).join('、')}</p>`
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>📸 ${escape(state.set)}</title>
<style>
:root { color-scheme: light dark; --line: #8884; --dim: #888; }
body { margin: 0; font: 14px -apple-system, "Hiragino Sans", sans-serif; }
header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; padding: 10px 20px; background: Canvas; border-bottom: 1px solid var(--line); }
header h1 { margin: 0; font-size: 18px; }
header label { cursor: pointer; }
main { padding: 0 20px 40px; }
section h2 { font-size: 15px; margin: 24px 0 8px; }
.cards { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.card { margin: 0; padding: 8px; border: 1px solid var(--line); border-radius: 10px; }
.card.changed { border-color: #e0a000; }
.card.added { border-color: #2a9d4b; }
figcaption { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.when, .side b, .same, .none { color: var(--dim); font-size: 12px; font-weight: normal; }
.pair { display: flex; gap: 8px; cursor: zoom-in; }
.side { display: flex; flex-direction: column; gap: 2px; }
.pair img { display: block; width: var(--w); height: auto; }
.none { width: var(--w); height: 120px; display: grid; place-items: center; border: 1px dashed var(--line); }
.diff { display: none; position: relative; background: #000; filter: brightness(4); }
.added .diff { filter: none; }
.diff img.top { position: absolute; inset: 0; mix-blend-mode: difference; }
body.mode-diff .side { display: none; }
body.mode-diff .diff { display: block; }
body.mode-after .side:first-child { display: none; }
body.changed-only [data-status="same"] { display: none; }
body.hide-dup .card.dup .pair { display: none; }
.removed { color: #d33; }
#zoom { position: fixed; inset: 0; z-index: 3; display: none; background: #000d; overflow: hidden; cursor: grab; }
#zoom.open { display: block; }
#zoom .stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; display: flex; gap: 16px; }
#zoom .stage img { display: block; }
#zoom .help { position: fixed; left: 0; right: 0; bottom: 0; padding: 8px 16px; color: #ccc; background: #000a; font-size: 12px; }
</style>
</head>
<body>
<header>
<h1>📸 ${escape(state.set)}</h1>
<span>${(['changed', 'same', 'added'] as const).map(status => `${STATUS[status].mark} ${STATUS[status].word} ${count(status)}`).join('　')}${state.removed.length > 0 ? `　${REMOVED.mark} ${REMOVED.word} ${state.removed.length}` : ''}</span>
<label><input type="checkbox" id="changed" ${state.isChangedOnly ? 'checked' : ''}> 変更だけ</label>
<label><input type="checkbox" id="dup" checked> 同じ見た目はたたむ</label>
<span>見せ方：<label><input type="radio" name="mode" value="pair" checked> 前と後</label> <label><input type="radio" name="mode" value="after"> 後だけ</label> <label><input type="radio" name="mode" value="diff"> 差分</label></span>
<label>大きさ <input type="range" id="size" min="120" max="600" value="220"></label>
</header>
<main>
${removed}
${sections}
</main>
<div id="zoom"><div class="stage"></div><div class="help">ホイールで拡大・縮小、つかんで動かす　1 原寸　0 収める　← → 前と次　スペース 前と後を切り替え　d 差分　Esc 閉じる</div></div>
<script>
const body = document.body
const sync = () => {
  body.classList.toggle('changed-only', document.getElementById('changed').checked)
  body.classList.toggle('hide-dup', document.getElementById('dup').checked)
  const mode = document.querySelector('input[name=mode]:checked').value
  body.classList.remove('mode-pair', 'mode-after', 'mode-diff')
  body.classList.add('mode-' + mode)
  body.style.setProperty('--w', document.getElementById('size').value + 'px')
}
document.querySelectorAll('header input').forEach(input => input.addEventListener('input', sync))
sync()

const zoom = document.getElementById('zoom')
const stage = zoom.querySelector('.stage')
let view = { scale: 1, x: 0, y: 0 }, at = -1, flip = false, diff = false
const visible = () => [...document.querySelectorAll('.pair')].filter(pair => pair.offsetParent !== null)
const apply = () => { stage.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')' }
const fit = () => {
  const width = stage.scrollWidth, height = stage.scrollHeight
  view.scale = Math.min(1, (innerWidth - 40) / width, (innerHeight - 60) / height)
  view.x = (innerWidth - width * view.scale) / 2
  view.y = 20
  apply()
}
const show = index => {
  const list = visible()
  if (list.length === 0) return
  at = (index + list.length) % list.length
  const pair = list[at]
  const before = pair.querySelector('img.before'), after = pair.querySelector('img.after')
  const width = Number(pair.dataset.width) / 2
  const one = (src, blend) => '<img src="' + src + '" style="width:' + width + 'px' + (blend ? ';position:absolute;left:0;top:0;mix-blend-mode:difference' : '') + '">'
  if (diff && before) stage.innerHTML = '<div style="position:relative;background:#000;filter:brightness(4)">' + one(before.src) + one(after.src, true) + '</div>'
  else if (flip && before) stage.innerHTML = one(before.src)
  else stage.innerHTML = (before && !body.classList.contains('mode-after') ? one(before.src) : '') + one(after.src)
  zoom.classList.add('open')
  requestAnimationFrame(fit)
}
document.querySelector('main').addEventListener('click', event => {
  const pair = event.target.closest('.pair')
  if (pair) { flip = false; diff = body.classList.contains('mode-diff'); show(visible().indexOf(pair)) }
})
zoom.addEventListener('wheel', event => {
  event.preventDefault()
  const next = Math.max(0.1, Math.min(16, view.scale * Math.exp(-event.deltaY / 300)))
  view.x = event.clientX - (event.clientX - view.x) * next / view.scale
  view.y = event.clientY - (event.clientY - view.y) * next / view.scale
  view.scale = next
  apply()
}, { passive: false })
let drag = null
zoom.addEventListener('mousedown', event => { drag = { x: event.clientX - view.x, y: event.clientY - view.y } })
addEventListener('mousemove', event => { if (drag) { view.x = event.clientX - drag.x; view.y = event.clientY - drag.y; apply() } })
addEventListener('mouseup', () => { drag = null })
addEventListener('keydown', event => {
  if (!zoom.classList.contains('open')) return
  if (event.key === 'Escape') zoom.classList.remove('open')
  else if (event.key === 'ArrowRight') show(at + 1)
  else if (event.key === 'ArrowLeft') show(at - 1)
  else if (event.key === ' ') { event.preventDefault(); flip = !flip; diff = false; show(at) }
  else if (event.key === 'd') { diff = !diff; flip = false; show(at) }
  else if (event.key === '0') fit()
  else if (event.key === '1') { view.scale = 1; apply() }
})
</script>
</body>
</html>
`
}
