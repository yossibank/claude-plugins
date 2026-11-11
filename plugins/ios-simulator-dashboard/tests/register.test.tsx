import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { actionsOf, bashActions } from '../hooks/history'
import { devicesOf, osOf } from '../hooks/simctl'
import { agoOf, tookOf, wrap } from '../hooks/view'

type On = Parameters<TestBody>[1]
type Self = Parameters<TestBody>[0]

const T0 = 1_000_000_000
const UDID = 'DBBC9FC0-591C-4EB6-8130-D78CF1DA80E3'
const APP = 'com.example.app'

const device = (name: string, udid: string, state: 'Booted' | 'Shutdown') => ({ name, udid, state, isAvailable: true, deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro' })

// 偽の simctl list devices --json。booted が true なら 1 台が起動中
const listOf = (booted: boolean) =>
  JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [],
      'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [device('iPhone 16 Pro', UDID, booted ? 'Booted' : 'Shutdown'), device('iPhone 16', 'F79833FE-668C-40F4-B738-91953CBE0E9E', 'Shutdown')],
    },
  })

type State = {
  // pane が出ているか。テストが途中で書き換える
  isShown: boolean
  isBooted?: boolean
  appearance?: string
  isInstalled?: boolean
  isRunning?: boolean
  // xcrun が無い時のように process.run を断る
  isXcrunMissing?: boolean
  // simctl list が失敗する
  isListBroken?: boolean
  // エラーを返すツールの名前
  failing?: string
  // 断るツールの名前
  denied?: string
  isPanesBroken?: boolean
}

const engine = (on: On, state: State) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = { runs: [] as string[], toasts: [] as string[], opened: [] as { id: string; focus?: boolean }[], closed: [] as string[], session: 's1' }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: seen.session }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('command.register', () => ({ value: { command: 'simulator' } }))
  on('ui.open', (_, e) => {
    seen.opened.push({ id: e.id, ...(e.focus === true ? { focus: true } : {}) })
    state.isShown = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    seen.closed.push(e.id)
    state.isShown = false
    return { value: undefined } as never
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.panes', () => (state.isPanesBroken === true ? { deny: 'panes failed' } : { value: [{ id: 'ios-simulator-dashboard', title: '📱 Simulator', isShown: state.isShown, isFocused: false, isPlaced: true }] }))
  on('process.run', (_, e) => {
    const args = e.argv.join(' ')
    seen.runs.push(args)
    if (state.isXcrunMissing === true && e.argv[0] === 'xcrun') return { deny: 'spawn xcrun ENOENT' }
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } as never })
    const ng = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr } as never })
    if (args.includes('list devices --json')) return state.isListBroken === true ? ng('xcrun: error: unable to find utility "simctl"\nmore') : ok(listOf(state.isBooted !== false))
    if (/ ui \S+ appearance (dark|light)$/.test(args)) {
      state.appearance = args.split(' ').pop() ?? ''
      return ok('')
    }
    if (args.includes(' appearance')) return ok(`${state.appearance ?? 'light'}\n`)
    if (args.includes('get_app_container')) return state.isInstalled === false ? ng('No such file or directory') : ok('/path/App.app\n')
    if (args.includes('launchctl list')) return ok(`PID\tStatus\tLabel\n-\t0\tcom.apple.x\n${state.isRunning === false ? '' : `123\t0\tUIKitApplication:${APP}[1a2b][rb-legacy]\n`}`)
    return ok('')
  })
  on('tool.call', (_, e) => {
    if (e.tool === state.denied) return { deny: 'no' } as never
    if (e.tool === state.failing) return { isError: true, result: undefined, text: 'failed' } as never
    return { result: { stdout: 'ok', stderr: '' }, text: 'ok' } as never
  })
  return { clock, seen }
}

const PANE = {
  plugin: 'ios-simulator-dashboard',
  component: 'Pane',
  requestId: 'ios-simulator-dashboard',
  surface: 'terminal',
  props: { title: '📱 Simulator', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const COMMAND = { command: 'simulator', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

const start = ($: Self) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const texts = async ($: Self) => {
  const ui = await $.ui.mount(PANE)
  const found = (await ui.findAll({ type: 'Text' })).map(element => element.text)
  await ui.unmount()
  return found
}

// 罫線の行から、鍵に当たる行を探す
const rowOf = (lines: string[], key: RegExp) => lines.find(line => /^[│╭╰]/u.test(line) && key.test(line))

const listRuns = (runs: string[]) => runs.filter(run => run.includes('list devices')).length

test('runtime の id を OS の名前にし、起動中と使える数を数える', () => {
  expect(osOf('com.apple.CoreSimulator.SimRuntime.iOS-18-2')).toBe('iOS 18.2')
  expect(osOf('com.apple.CoreSimulator.SimRuntime.watchOS-11-0')).toBe('watchOS 11.0')
  expect(devicesOf(listOf(true))).toEqual({ booted: [{ name: 'iPhone 16 Pro', os: 'iOS 18.2', udid: UDID }], available: 2 })
  expect(devicesOf(listOf(false))).toEqual({ booted: [], available: 2 })
  expect(devicesOf('not json')).toBeNull()
  expect(devicesOf('{}')).toBeNull()
})

test('時刻とかかった時間の書き方', () => {
  expect(agoOf(12_000)).toBe('12 秒前')
  expect(agoOf(3 * 60_000)).toBe('3 分前')
  expect(agoOf(2 * 3600_000)).toBe('2 時間前')
  expect(tookOf(450)).toBe('450ms')
  expect(tookOf(1234)).toBe('1.2s')
  expect(tookOf(65_000)).toBe('1m05s')
  expect(wrap('abcdefgh', 3, 3)).toEqual(['abc', 'def', 'gh'])
  expect(wrap('abcdefgh', 3, 2)).toEqual(['abc', 'def '])
})

test('Bash のコマンドから simctl の操作を拾い、読むだけのものは拾わない', () => {
  expect(bashActions(`xcrun simctl boot ${UDID} && xcrun simctl install booted ./build/App.app; xcrun simctl launch --console booted ${APP}`)).toEqual([
    { label: 'シミュレータを起動', target: 'DBBC9FC0', counts: ['boot'] },
    { label: 'インストール', target: 'App.app', counts: ['install'] },
    { label: 'アプリを起動', target: APP, counts: ['launch'] },
  ])
  expect(bashActions('xcrun simctl io booted screenshot --type=png /tmp/shot.png')).toEqual([{ label: 'スクリーンショット', target: 'shot.png', counts: ['screenshot'] }])
  expect(bashActions('/usr/bin/xcrun simctl openurl booted "myapp://home"').map(action => action.target)).toEqual(['myapp://home'])
  expect(bashActions('xcrun simctl shutdown all | cat').map(action => action.label)).toEqual(['シミュレータを止める'])
  expect(bashActions('xcrun simctl ui booted appearance dark').map(action => action.label)).toEqual(['外観を変える'])
  expect(bashActions('xcrun simctl list devices --json')).toEqual([])
  expect(bashActions('xcrun simctl ui booted appearance')).toEqual([])
  expect(bashActions('xcrun simctl get_app_container booted com.example.app')).toEqual([])
  expect(bashActions('echo simctl boot')).toEqual([])
})

test('XcodeBuildMCP のツールは決めた名前だけ拾う', () => {
  expect(actionsOf({ tool: 'mcp__XcodeBuildMCP__install_app_sim', appPath: '/build/App.app' })).toEqual([{ label: 'インストール', target: 'App.app', counts: ['install'] }])
  expect(actionsOf({ tool: 'mcp__XcodeBuildMCP__build_run_sim' })).toEqual([{ label: 'ビルドして実行', target: '', counts: ['install', 'launch'] }])
  expect(actionsOf({ tool: 'mcp__XcodeBuildMCP__list_sims' })).toEqual([])
  expect(actionsOf({ tool: 'mcp__other__boot_sim' })).toEqual([])
  expect(actionsOf({ tool: 'Read', file_path: 'xcrun simctl boot x' })).toEqual([])
})

test('/simulator で pane を focus 付きで開き、起動中のシミュレータとアプリを出す', async ($, on) => {
  const { seen } = engine(on, { isShown: false, appearance: 'dark' })
  await start($)

  await $.command.run(COMMAND)

  expect(seen.opened).toEqual([{ id: 'ios-simulator-dashboard', focus: true }])
  expect(seen.runs).toContain('xcrun simctl list devices --json')
  expect(seen.runs).toContain(`xcrun simctl ui ${UDID} appearance`)
  const lines = await texts($)
  expect(rowOf(lines, /iPhone 16 Pro/)).toMatch(/^╭─ ● iPhone 16 Pro /u)
  expect(rowOf(lines, /OS/)).toContain('iOS 18.2')
  expect(rowOf(lines, /UDID/)).toContain('DBBC9FC0 ')
  expect(rowOf(lines, /外観/)).toContain('☾ ダーク')
  // bundleId が空の間は、アプリを調べない
  expect(rowOf(lines, /アプリ /)).toBeUndefined()
  expect(seen.runs.some(run => run.includes('get_app_container') || run.includes('launchctl'))).toBe(false)
  expect(rowOf(lines, /まだ何もしていません/)).toBeDefined()
})

test('bundleId があれば、入っているかと動いているかを出す', { options: { bundleId: APP } }, async ($, on) => {
  const state: State = { isShown: false }
  const { seen } = engine(on, state)
  await start($)

  await $.command.run(COMMAND)
  expect(seen.runs).toContain(`xcrun simctl get_app_container ${UDID} ${APP}`)
  expect(seen.runs).toContain(`xcrun simctl spawn ${UDID} launchctl list`)
  expect(rowOf(await texts($), /アプリ /)).toContain('入っている · 動いている')
  expect(rowOf(await texts($), /com\.example\.app/)).toMatch(/^╰─+ com\.example\.app ─╯$/u)

  state.isRunning = false
  await $.command.run(COMMAND)
  expect(rowOf(await texts($), /アプリ /)).toContain('入っている · 止まっている')

  state.isInstalled = false
  await $.command.run(COMMAND)
  expect(rowOf(await texts($), /アプリ /)).toContain('入っていない')
})

test('起動中が無ければ、使えるシミュレータの数を出す', async ($, on) => {
  engine(on, { isShown: false, isBooted: false })
  await start($)

  await $.command.run(COMMAND)

  const lines = await texts($)
  expect(lines).toContain('○ 起動中のシミュレータはありません')
  expect(lines).toContain('  使えるシミュレータ 2 台')
})

test('xcrun が無い・失敗した時は、落ちずに理由を出す', async ($, on) => {
  const state: State = { isShown: false, isXcrunMissing: true }
  engine(on, state)
  await start($)

  await $.command.run(COMMAND)
  let lines = await texts($)
  expect(lines).toContain('✖ シミュレータの状態を取れません')
  expect(lines.filter(line => line.startsWith('  ')).map(line => line.trim()).join('')).toContain('spawn xcrun ENOENT')

  state.isXcrunMissing = false
  state.isListBroken = true
  await $.command.run(COMMAND)
  lines = await texts($)
  expect(lines).toContain('✖ シミュレータの状態を取れません')
  expect(lines).toContain('  xcrun: error: unable to find utility "simctl"')

  state.isListBroken = false
  await $.command.run(COMMAND)
  expect(await texts($)).not.toContain('✖ シミュレータの状態を取れません')
})

test('MCP のツールと Bash の simctl を履歴と回数に拾い、ツールの結果はそのまま返す', async ($, on) => {
  const { clock } = engine(on, { isShown: false })
  await start($)

  const done = await $.tool.call({ tool: 'mcp__XcodeBuildMCP__boot_sim', simulatorName: 'iPhone 16 Pro' } as never)
  expect(done).toMatchObject({ result: { stdout: 'ok', stderr: '' }, text: 'ok' })
  await $.tool.call({ tool: 'Bash', command: `xcrun simctl install booted build/App.app && xcrun simctl launch booted ${APP}` } as never)
  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__screenshot' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__list_sims' } as never)
  await clock.advance(3 * 60_000)

  const lines = await texts($)
  const history = lines.filter(line => /^│ \d+ 分前/u.test(line))
  expect(history).toHaveLength(4)
  expect(history[0]).toContain('✓ スクリーンショット')
  expect(history[1]).toContain(`✓ アプリを起動 0ms ${APP}`)
  expect(history[2]).toContain('✓ インストール 0ms App.app')
  expect(history[3]).toContain('✓ シミュレータを起動 0ms iPhone 16 Pro')
  expect(rowOf(lines, /│ 起動 /)).toContain('1 回')
  expect(rowOf(lines, /│ インストール /)).toContain('1 回')
  expect(rowOf(lines, /│ アプリ起動 /)).toContain('1 回')
  expect(rowOf(lines, /│ スクショ /)).toContain('1 枚 · 最後 3 分前')
  expect(rowOf(lines, /│ 失敗 /)).toContain('│ 0 ')
})

test('エラーを返した・断られた呼び出しは、失敗の印を付けて回数に数えない', async ($, on) => {
  const state: State = { isShown: false, failing: 'mcp__XcodeBuildMCP__launch_app_sim', denied: 'Bash' }
  engine(on, state)
  await start($)

  const failed = await $.tool.call({ tool: 'mcp__XcodeBuildMCP__launch_app_sim', bundleId: APP } as never)
  expect(failed.isError).toBe(true)
  const denied = await $.tool.call({ tool: 'Bash', command: 'xcrun simctl io booted screenshot /tmp/a.png' } as never)
  expect(denied.deny).toBe('no')

  const lines = await texts($)
  expect(lines.some(line => line.includes(`✖ アプリを起動 0ms ${APP}`))).toBe(true)
  expect(lines.some(line => line.includes('✖ スクリーンショット 0ms a.png'))).toBe(true)
  expect(rowOf(lines, /│ アプリ起動 /)).toContain('0 回')
  expect(rowOf(lines, /│ スクショ /)).toContain('│ 0 枚 ')
  expect(rowOf(lines, /│ 失敗 /)).toContain('│ 2 ')
})

test('pane を閉じている間は取り直さず、出ている間は refreshSeconds ごとに取り直す', async ($, on) => {
  const state: State = { isShown: false }
  const { clock, seen } = engine(on, state)
  await start($)

  await clock.advance(60_000)
  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__boot_sim' } as never)
  await clock.settle()
  expect(seen.runs).toEqual([])

  // 開いたのを見つけたら、すぐに取る
  state.isShown = true
  await clock.advance(2000)
  expect(listRuns(seen.runs)).toBe(1)
  await clock.advance(8000)
  expect(listRuns(seen.runs)).toBe(1)
  await clock.advance(2000)
  expect(listRuns(seen.runs)).toBe(2)

  // 出ている間は、ツールが終わった後にも取る
  await $.tool.call({ tool: 'Bash', command: 'xcrun simctl shutdown booted' } as never)
  await clock.settle()
  expect(listRuns(seen.runs)).toBe(3)

  state.isShown = false
  await clock.advance(60_000)
  expect(listRuns(seen.runs)).toBe(3)
})

test('refreshSeconds の設定で、取り直す間隔が変わる', { options: { refreshSeconds: 4 } }, async ($, on) => {
  const { clock, seen } = engine(on, { isShown: true })
  await start($)

  await clock.advance(2000)
  expect(listRuns(seen.runs)).toBe(1)
  await clock.advance(4000)
  expect(listRuns(seen.runs)).toBe(2)
})

test('autoOpen なら、初めて使った時に 1 回だけ、focus を取らずに pane を開く', { options: { autoOpen: true } }, async ($, on) => {
  const state: State = { isShown: false }
  const { clock, seen } = engine(on, state)
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(seen.opened).toEqual([])
  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__boot_sim' } as never)
  await clock.settle()
  expect(seen.opened).toEqual([{ id: 'ios-simulator-dashboard' }])
  expect(listRuns(seen.runs)).toBe(1)

  state.isShown = false
  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__screenshot' } as never)
  await clock.settle()
  expect(seen.opened).toHaveLength(1)
})

test('autoOpen が false なら、ツールを使っても pane を開かない', async ($, on) => {
  const { clock, seen } = engine(on, { isShown: false })
  await start($)

  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__boot_sim' } as never)
  await clock.settle()

  expect(seen.opened).toEqual([])
})

test('ボタンで、取り直す・前に出す・外観を切り替える・閉じる', async ($, on) => {
  const state: State = { isShown: false, appearance: 'light' }
  const { clock, seen } = engine(on, state)
  await start($)
  await $.command.run(COMMAND)
  const ui = await $.ui.mount(PANE)
  expect((await ui.findAll({ type: 'Button' })).map(button => button.props?.hotkey)).toEqual(['r', 's', 'd', 'x'])

  const before = listRuns(seen.runs)
  await ui.press({ key: 'refresh' })
  await clock.settle()
  expect(listRuns(seen.runs)).toBe(before + 1)

  await ui.press({ key: 'simulator' })
  await clock.settle()
  expect(seen.runs).toContain('open -a Simulator')

  await ui.press({ key: 'appearance' })
  await clock.settle()
  expect(seen.runs).toContain(`xcrun simctl ui ${UDID} appearance dark`)
  expect(rowOf((await ui.findAll({ type: 'Text' })).map(element => element.text), /外観/)).toContain('☾ ダーク')

  await ui.press({ key: 'close' })
  await clock.settle()
  expect(seen.closed).toEqual(['ios-simulator-dashboard'])
  await ui.unmount()

  // シミュレータを変える操作は、外観だけ
  expect(seen.runs.filter(run => /simctl (boot|shutdown|install|uninstall|launch|terminate|erase)\b/.test(run))).toEqual([])
})

test('起動中が無い時に外観を押したら、何も変えずに知らせる', async ($, on) => {
  const { clock, seen } = engine(on, { isShown: false, isBooted: false })
  await start($)
  await $.command.run(COMMAND)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'appearance' })
  await clock.settle()
  await ui.unmount()

  expect(seen.toasts).toEqual(['ios-simulator-dashboard: 起動中のシミュレータがありません'])
  expect(seen.runs.some(run => / appearance (dark|light)/.test(run))).toBe(false)
})

test('/clear で会話が替わったら、履歴と回数を初めに戻す', async ($, on) => {
  const { seen } = engine(on, { isShown: false })
  await start($)
  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__boot_sim' } as never)
  expect(rowOf(await texts($), /│ 起動 /)).toContain('1 回')

  seen.session = 's2'
  await $.turn.start({ turnId: 't1', prompt: 'x' } as never)

  const lines = await texts($)
  expect(rowOf(lines, /│ 起動 /)).toContain('0 回')
  expect(rowOf(lines, /まだ何もしていません/)).toBeDefined()
})

test('pane の見張りが失敗したら、同じ失敗は 1 回だけトーストで知らせる', async ($, on) => {
  const { clock, seen } = engine(on, { isShown: true, isPanesBroken: true })
  await start($)

  await clock.advance(6000)

  expect(seen.toasts.filter(text => /pane の見張り.*panes failed/.test(text))).toHaveLength(1)
})
