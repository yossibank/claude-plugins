import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Gallery } from '../types'

import { folders, watcher } from './config'
import { collect, discard, pngs, report, succeeded } from './files'
import { isSetName, join, moveBase } from './path'
import { page } from './page'

// shape の番号は、保存する値の形の版。形を変えた時に上げると、前の版の値は読まれず初めの値に戻る
const gallery = atom({ plugin: 'ios-snapshot-gallery', key: 'gallery' } as const, null, {
  shape: 'gallery-6',
})

// 一覧のページを書き直す。書けなかったら toast で知らせる
const writePage = ($: EngineInterface, state: Gallery) => $.fs.write(state.page, page(state)).then(() => true, (error: unknown) => {
  report($, '一覧のページの書き込み')(error)
  return false
})

// 一覧のページを書いて、ブラウザーで開く
const openPage = async ($: EngineInterface, state: Gallery) => (await writePage($, state)) && (await succeeded($, ['open', state.page], 'ブラウザーで開くこと'))

// 描き終えた時の toast の 1 行。数が 0 のものは出さない
export const summary = (state: Gallery, isOpened: boolean) => {
  const count = (status: string) => state.cases.filter(one => one.status === status).length
  const parts = [['変更', count('changed')], ['新規', count('added')], ['同じ', count('same')], ['消えた', state.removed.length]] as const
  const counts = parts.filter(([, n]) => n > 0).map(([word, n]) => `${word} ${n}`).join('・')
  return `📸 ${state.set}：${counts}。${isOpened ? '一覧をブラウザーで開きました' : '/snapshots で一覧を開けます'}`
}

export const register: Register = (on, options) => {
  const dirs = folders(options)
  const { pattern, isBroken } = watcher(options)
  let isTold = false
  // 人がターミナルで見ているセッションの時だけ、ブラウザーを開く
  let isWatched = false

  on('session.start', async ($, e, next) => {
    isWatched = e.isInteractive === true && e.surface === 'terminal'
    await $.command.register({ name: 'snapshots', description: 'スナップショットの一覧をブラウザーで開く。引数にセットの名前を渡せる' })
    return next(e)
  })

  on('command.run', { command: 'snapshots' }, async ($, e) => {
    const set = e.args.trim()
    if (set.length > 0) {
      if (!isSetName(set)) return { text: 'セットの名前が正しくありません' }
      const found = await collect($, await $.session.cwd(), set, dirs)
      if (found.cases.length === 0) return { text: `${set} の画像がありません` }
      await update($, gallery, () => found)
    }
    const state = await read($, gallery)
    if (state === null) return { text: 'まだ描いたスナップショットがありません。/snapshots <セット> で開けます。' }
    return { text: (await openPage($, state)) ? `${state.set} の一覧をブラウザーで開きました。` : `${state.set} の一覧を開けませんでした。` }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (isBroken && !isTold) {
      isTold = true
      $.ui.toast('ios-snapshot-gallery: commandPattern の正規表現が正しくないので、初めの値で見張ります')
    }
    const found = e.command.match(pattern)
    if (found === null) return next(e)

    const base = moveBase(await $.session.cwd(), e.command, found.index ?? 0)
    const set = found[1] ?? ''
    if (!isSetName(set)) return next(e)
    const afterDir = join(base, dirs.after, set)
    const beforeDir = join(base, dirs.before, set)
    const pending = `${beforeDir}.pending`
    const backup = `${beforeDir}.old`
    let isCopied = (await pngs($, afterDir)).length > 0
    if (isCopied) {
      const isReady =
        (await succeeded($, ['rm', '-rf', pending], '一時のフォルダの削除')) &&
        (await succeeded($, ['mkdir', '-p', pending], '一時のフォルダの作成')) &&
        (await succeeded($, ['rsync', '-a', '--delete', '--include', '*.png', '--exclude', '*', `${afterDir}/`, `${pending}/`], '前の画像の写し'))
      if (!isReady) {
        await discard($, pending)
        isCopied = false
      }
    }

    let ran
    try {
      ran = await next(e)
    } catch (error) {
      if (isCopied) await discard($, pending)
      throw error
    }
    if (ran.deny !== undefined || ran.isError === true) {
      if (isCopied) await discard($, pending)
      return ran
    }
    if (isCopied) {
      // before は退避してから入れ替え、失敗したら戻す
      let hasBefore = await $.fs.exists(beforeDir)
      // 前の回が退避のまま止まっていたら、消さずに戻してから進める
      const hadBackup = !hasBefore && (await $.fs.exists(backup))
      if (hadBackup) hasBefore = await succeeded($, ['mv', backup, beforeDir], '退避の復元')
      const isKept = hasBefore && (await succeeded($, ['rm', '-rf', backup], '古い退避の削除')) && (await succeeded($, ['mv', beforeDir, backup], '前の画像の退避'))
      const isSwapped = (isKept || (!hasBefore && !hadBackup)) && (await succeeded($, ['mv', pending, beforeDir], '前の画像の入れ替え'))
      if (isSwapped) {
        if (isKept) await succeeded($, ['rm', '-rf', backup], '退避の削除')
      } else {
        if (isKept) await succeeded($, ['mv', backup, beforeDir], '退避の復元')
        await discard($, pending)
      }
    }

    // 画像を集められなくても、コマンドの結果はそのまま返す
    const drawn = await collect($, base, set, dirs).catch(error => {
      report($, '画像の集め直し')(error)
      return null
    })
    if (drawn !== null && drawn.cases.length > 0) {
      await update($, gallery, () => drawn)
      // 人が見ていて、変わった画像か新しい画像がある時だけ、一覧をブラウザーで開く
      const isOpened = isWatched && drawn.cases.some(one => one.status !== 'same') ? await openPage($, drawn) : await writePage($, drawn).then(() => false)
      $.ui.toast(summary(drawn, isOpened))
    }
    return ran
  })
}
