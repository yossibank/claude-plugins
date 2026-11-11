import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Action } from '../types'

import { draw } from './cell'
import { configure, PANE, PLUGIN, TITLE, WATCH_MS } from './config'
import type { Config } from './config'
import { actionsOf, currentLog, followSession, markOpened, record } from './history'
import { isShownNow, watchPane } from './pane'
import { report } from './report'
import { currentSim, lastReadAt, refresh, setAppearance } from './simctl'
import { linesOf } from './view'

let watcher: Timer | undefined

// pane が出ている間だけ、開いた時と refreshSeconds ごとに取り直す。閉じている間は xcrun を走らせない
async function watch($: EngineInterface, config: Config) {
  const { shown, was } = await watchPane($)
  if (!shown) return
  if (!was || (await $.clock.now()) - lastReadAt() >= config.refreshMs) await refresh($, config)
}

// 頼まれて開く時はキーを受けられるよう focus を渡す。自動で開く時は入力を奪わない
async function open($: EngineInterface, config: Config, focus: boolean) {
  await $.ui.open(focus ? { id: PANE, title: TITLE, focus: true } : { id: PANE, title: TITLE })
  await watchPane($)
  await refresh($, config, true)
}

// 終わった操作を履歴に足す。pane が出ていれば、状態を取り直す
async function settle($: EngineInterface, config: Config, actions: Action[], startedAt: number, isFailed: boolean) {
  const at = await $.clock.now()
  await record($, actions, { at, ms: at - startedAt, isFailed })
  if (config.autoOpen && (await markOpened($))) {
    await $.ui.open({ id: PANE, title: TITLE })
    await watchPane($)
  }
  // 取り直しは待たない。ツールの結果を、xcrun の分だけ遅らせない
  void (async () => {
    if (await isShownNow($)) await refresh($, config, true)
  })().catch(error => report($, '操作の後の取り直し', error))
}

async function toggleAppearance($: EngineInterface, config: Config) {
  const sim = await currentSim($)
  const booted = sim.status === 'ok' ? sim.booted : []
  if (booted.length === 0) {
    $.ui.toast(`${PLUGIN}: 起動中のシミュレータがありません`)
    return
  }
  // 起動中のものを、1 台目の逆の外観に揃える
  const next = booted[0]?.appearance === 'dark' ? 'light' : 'dark'
  for (const device of booted) {
    const reason = await setAppearance($, device.udid, next)
    if (reason !== null) $.ui.toast(`${PLUGIN}: ${device.name} の外観を変えられませんでした（${reason}）`.slice(0, 160))
  }
  await refresh($, config, true)
}

async function showSimulator($: EngineInterface) {
  const opened = await $.process.run(['open', '-a', 'Simulator'])
  if (opened.exitCode !== 0) $.ui.toast(`${PLUGIN}: Simulator.app を前に出せませんでした（${opened.stderr.trim()}）`.slice(0, 160))
}

export const register: Register = (on, options) => {
  const config = configure(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await followSession($)
    await $.command.register({ name: 'simulator', description: 'iOS シミュレータの状態を右の pane に出す' })
    watcher?.cancel()
    watcher = $.clock.every(WATCH_MS, () => {
      watch($, config).catch(error => report($, 'pane の見張り', error))
    })
    return started
  })

  // /clear のあとは、履歴を初めからにする
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) await followSession($)
    return started
  })

  on('tool.call', async ($, e, next) => {
    const actions = actionsOf(e as unknown as Parameters<typeof actionsOf>[0])
    if (actions.length === 0) return next(e)
    const startedAt = await $.clock.now()
    // 断られた・エラーを返した・投げた呼び出しは、失敗として履歴に残す
    let isFailed = true
    try {
      const done = await next(e)
      isFailed = done.deny !== undefined || done.isError === true
      // ツールの結果は、そのまま返す
      return done
    } finally {
      await settle($, config, actions, startedAt, isFailed).catch(error => report($, '履歴の記録', error))
    }
  })

  on('command.run', { command: 'simulator' }, async $ => {
    await open($, config, true)
    return { text: 'iOS シミュレータの状態を右の pane に出しました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const inner = Math.max(1, e.props.bodyColumns - 2)
    const lines = linesOf(await currentSim($), await currentLog($), config.bundleId, await $.clock.now(), inner)
    const press = (where: string, work: () => Promise<void>) => () => void work().catch(error => report($, where, error))

    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {lines.map((line, index) => draw(Text, line, String(index)))}
        <Box flexDirection="row" flexWrap="wrap" gap={2} paddingTop={1}>
          <Button key="refresh" plain hotkey="r" label="更新" onPress={press('取り直し', () => refresh($, config, true))} />
          <Button key="simulator" plain hotkey="s" label="前に出す" onPress={press('Simulator.app を前に出すこと', () => showSimulator($))} />
          <Button key="appearance" plain hotkey="d" label="外観" onPress={press('外観の切り替え', () => toggleAppearance($, config))} />
          <Button
            key="close"
            plain
            hotkey="x"
            label="閉じる"
            dimColor
            onPress={press('閉じること', async () => {
              await $.ui.close({ id: PANE })
              await watchPane($)
            })}
          />
        </Box>
      </Box>
    )
  })
}
