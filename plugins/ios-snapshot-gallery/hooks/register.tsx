import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { CHROME_ROWS, DOT, folders, MIN_IMAGE_ROWS, PANE, REMOVED, STATUS, TITLE, watcher } from './config'
import { collect, discard, pngs, report, succeeded } from './files'
import { isSetName, join, moveBase } from './path'
import { cellWidth, detail, fit, label, shown, stamp } from './view'

// shape の番号は、保存する値の形の版。形を変えた時に上げると、前の版の値は読まれず初めの値に戻る
const gallery = atom({ plugin: 'ios-snapshot-gallery', key: 'gallery' } as const, null, {
  shape: 'gallery-4',
})

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE })

export const register: Register = (on, options) => {
  const dirs = folders(options)
  const { pattern, isBroken } = watcher(options)
  let isTold = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'snapshots', description: 'スナップショットの画廊を開く。引数にセットの名前を渡せる' })
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
    await open($)
    return { text: `${state.set} のスナップショットを開きました。` }
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
      void open($).catch(report($, '画廊の表示'))
    }
    return ran
  })

  on('ui.focus', { requestId: PANE }, ($, e, next) => (e.origin.kind === 'person' && e.element !== undefined ? {} : next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Image = 'Image' in elements ? elements.Image : undefined
    const state = await read($, gallery)

    if (state === null) return <Text dimColor>まだ描いたスナップショットがありません。</Text>

    const list = shown(state)
    const current = list[Math.min(state.index, list.length - 1)]
    const count = (status: keyof typeof STATUS) => state.cases.filter(one => one.status === status).length
    const select = (to: number) => update($, gallery, old => (old === null ? old : { ...old, index: Math.max(0, Math.min(to, shown(old).length - 1)) }))
    const position = current === undefined ? 0 : list.indexOf(current)
    const previous = list[position - 1]
    const following = list[position + 1]

    const half = Math.floor((e.props.bodyColumns - 1) / 2)
    const size = current === undefined ? { columns: half - 2, rows: MIN_IMAGE_ROWS } : fit(current, Math.max(8, half - 2), e.props.scroll.bodyRows - CHROME_ROWS - (state.removed.length > 0 ? 1 : 0))
    const line = (rows: number) => Array.from({ length: rows }, () => '│').join('\n')

    const picture = (path: string | undefined, ms: number | undefined, key: string, title: string, titleWidth: number, isAfter: boolean) => (
      <Box flexDirection="column">
        <Text>
          <Text dimColor>╭─ </Text>
          <Text bold={isAfter} dimColor={!isAfter}>{key}</Text>
          {isAfter && current !== undefined && <Text color={STATUS[current.status].color}>{title}</Text>}
          <Text dimColor> {'─'.repeat(Math.max(0, size.columns - 3 - titleWidth))}╮</Text>
        </Text>
        <Box flexDirection="row">
          <Text dimColor>{line(size.rows)}</Text>
          {path === undefined ? (
            <Box width={size.columns} height={size.rows} justifyContent="center" alignItems="center">
              <Text dimColor>前の画像なし</Text>
            </Box>
          ) : Image === undefined ? (
            <Box width={size.columns} height={size.rows}>
              <Text dimColor>{path}</Text>
            </Box>
          ) : (
            <Image key={key} source={{ file: path, format: 'png', generation: ms === undefined ? undefined : Math.round(ms) }} columns={size.columns} rows={size.rows} alt={key} />
          )}
          <Text dimColor>{line(size.rows)}</Text>
        </Box>
        <Text dimColor>{`╰─ ${stamp(ms)} ${'─'.repeat(Math.max(0, size.columns - 3 - cellWidth(stamp(ms))))}╯`}</Text>
      </Box>
    )
    const about = current === undefined ? undefined : detail(current)
    // 1 枚を 1 文字にした並び。pane に収まらない枚数の時は出さない
    const dots = list.length <= e.props.bodyColumns - 6 ? list : []
    const afterTitle = current === undefined ? '' : ` · ${STATUS[current.status].mark} ${STATUS[current.status].word}`

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              📸 <Text bold>{state.set}</Text>
            </Text>
            <Text dimColor>{list.length === 0 ? '0 / 0' : `${position + 1} / ${list.length}`}</Text>
          </Box>
          <Text>
            {(['changed', 'same', 'added'] as const).map(status => (
              <Text key={status}>
                {STATUS[status].mark} <Text dimColor>{STATUS[status].word}</Text> {count(status)}{'   '}
              </Text>
            ))}
            {state.removed.length > 0 && (
              <Text>
                {REMOVED.mark} <Text dimColor>{REMOVED.word}</Text> {state.removed.length}
              </Text>
            )}
          </Text>
          <Text>
            {dots.map((one, at) => (
              <Text key={one.name} color={STATUS[one.status].color} inverse={at === position} bold={at === position}>
                {DOT[one.status]}
              </Text>
            ))}
            {dots.length === 0 && <Text dimColor>{list.length} 枚</Text>}
          </Text>
        </Box>
        {state.removed.length > 0 && (
          <Text wrap="truncate-end">
            {'  '}
            {REMOVED.mark} <Text dimColor>後に無い画像：</Text>
            {state.removed.map(name => (name.startsWith(`${state.set}-`) ? name.slice(state.set.length + 1) : name)).join('、')}
          </Text>
        )}
        <Text>
          {'  '}
          {previous !== undefined && <Text dimColor>‹ {label(previous, state.set)}  </Text>}
          {current !== undefined && (
            <Text bold inverse>
              {' '}{label(current, state.set)}{' '}
            </Text>
          )}
          {following !== undefined && <Text dimColor>  {label(following, state.set)} ›</Text>}
          {list.length === 0 && <Text dimColor>変わったものはありません</Text>}
        </Text>
        <Text> </Text>
        <Box flexDirection="row" gap={1}>
          {current !== undefined && picture(current.before, current.beforeMs, '前', '', 2, false)}
          {current !== undefined && picture(current.after, current.afterMs, '後', afterTitle, 2 + cellWidth(afterTitle), true)}
        </Box>
        {about !== undefined && (
          <Text>
            {'  '}
            <Text dimColor>大きさ</Text> {about.size}
            {about.resized !== '' && <Text color="warning">（{about.resized}）</Text>}
            <Text dimColor> · ファイル</Text> {about.bytes}
            {about.gap !== '' && <Text color="warning">（{about.gap}）</Text>}
          </Text>
        )}
        <Text> </Text>
        <Box flexDirection="row" gap={2}>
          <Button key="previous" plain hotkey="j" onPress={() => void select(position - 1).catch(report($, '前へ移ること'))}>‹ 前</Button>
          <Button key="next" plain hotkey="k" onPress={() => void select(position + 1).catch(report($, '次へ移ること'))}>次 ›</Button>
          <Button key="changed-only" plain hotkey="c" onPress={() => void update($, gallery, old => (old === null ? old : { ...old, isChangedOnly: !old.isChangedOnly, index: 0 })).catch(report($, '絞り込みの切り替え'))}>
            {state.isChangedOnly ? 'すべて' : '変更だけ'}
          </Button>
          {current !== undefined && (
            <Button key="finder" plain hotkey="o" onPress={() => void succeeded($, ['open', '-R', current.after], 'Finder で開くこと')}>Finder</Button>
          )}
          <Text dimColor>↑↓ スクロール</Text>
        </Box>
      </Box>
    )
  })
}
