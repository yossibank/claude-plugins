import { expect, mock, test, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const IN_APP = "(in target 'MyApp' from project 'MyApp')"
const COMPILE = `CompileSwift normal arm64 /src/App/SummaryModel.swift ${IN_APP}\n    cd /src\n`
const WARNING = "/src/App/SummaryModel.swift:10:9: warning: variable 'x' was never mutated; consider changing to 'let' constant\n"
const LINK = `Ld /out/MyApp.app/MyApp normal ${IN_APP}\n`
const SIGN = `CodeSign /out/MyApp.app ${IN_APP}\n`
const SUCCEEDED_LOG = `${COMPILE}${WARNING}${WARNING}${LINK}${SIGN}\x1b[1m** BUILD SUCCEEDED **\x1b[0m\n`
const ERROR = "/src/App/SummaryView.swift:42:9: error: cannot find 'total' in scope\n"
const FAILED_LOG = `${COMPILE}${WARNING}${ERROR}${ERROR}error: no such module 'Charts'\n** BUILD FAILED **\n`

type Seen = { toasts: string[]; reads: string[]; store: Map<string, unknown> }
// wait は、ツールが答えるまで待たせるもの。走っている間の帯を見るのに使う
type Ran = { text?: string; isError?: true; deny?: string; wait?: (tool: string) => Promise<void> }

const engine = (on: On, log: string | Error | (() => string), seen: Seen, cwd = '/repo', mtimeMs: number | (() => number) = 1_000_000, isClockOwn = false, isLogMissing = false, ran: Ran = {}) => {
  on('session.cwd', () => ({ value: cwd }))
  on('tool.call', async (_, e) => {
    await ran.wait?.(e.tool)
    return ran.deny !== undefined ? { deny: ran.deny } : ran.isError ? { isError: true, result: ran.text, text: ran.text } : { result: { stdout: '', stderr: '' }, text: ran.text ?? '' }
  })
  if (!isClockOwn) on('clock.now', () => ({ value: 1_000_000 }))
  on('fs.exists', () => ({ value: !isLogMissing }))
  on('fs.stat', () => ({ value: { mtimeMs: typeof mtimeMs === 'function' ? mtimeMs() : mtimeMs } as never }))
  on('fs.read', (_, e) => {
    seen.reads.push(e.path)
    if (log instanceof Error) throw log
    return { value: typeof log === 'function' ? log() : log }
  })
  on('store.get', (_, e) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_, e) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const fresh = (): Seen => ({ toasts: [], reads: [], store: new Map<string, unknown>() })

const PROPS = { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }

const mountBand = ($: Parameters<TestBody>[0]) => $.ui.mount({ plugin: 'ios-build-progress', surface: 'terminal', component: 'AbovePrompt', props: PROPS, viewport: { columns: 80, rows: 40 } })

const XCODEBUILD = 'xcodebuild -scheme MyApp -destination "generic/platform=iOS Simulator" build 2>&1 | tee .build/build.log'

test('成功したら警告の数をトーストで知らせ、次の回のために手順の数を覚える', async ($, on) => {
  const seen = fresh()
  engine(on, SUCCEEDED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: XCODEBUILD })

  expect(seen.reads).toContain('/repo/.build/build.log')
  expect(seen.toasts).toEqual(['✔ xcodebuild 成功 · 警告 1 · 0:00'])
  expect(seen.store.get('total:xcodebuild MyApp')).toBe(3)
  expect(seen.store.get('durationMs:xcodebuild MyApp')).toBe(0)
})

test('失敗したらエラーと警告の数を知らせ、手順の数は覚えない', async ($, on) => {
  const seen = fresh()
  seen.store.set('total:make build', 10)
  engine(on, FAILED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'make -C /work build CONFIG=Debug' })

  expect(seen.reads).toContain('/work/.build/build.log')
  expect(seen.toasts).toEqual(['✖ make build 失敗 · エラー 2 · 警告 1 · 0:00'])
  expect(seen.store.get('total:make build')).toBe(10)
  expect(seen.store.has('durationMs:make build')).toBe(false)
})

test('裏で走らせた間は、前の回の数で棒と割合を出し、今のターゲットと段とファイルを出す', async ($, on) => {
  const seen = fresh()
  seen.store.set('total:xcodebuild MyApp', 4)
  seen.store.set('durationMs:xcodebuild MyApp', 110_000)
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, `${COMPILE}${WARNING}${LINK.replace('Ld', 'CompileC /out/a.o /src/Legacy/Bridge.m normal arm64 objective-c x')}`, seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: XCODEBUILD, run_in_background: true })
  await clock.advance(42_000)

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🔨 xcodebuild.*2 \/ 4 · 50%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⚙ MyApp · コンパイル {2}⚠ 1 {2}✖ 0 {3}⏱ 0:42 · 残り約 1:08 · 前回 1:50 · ⏸ 0:41 動きなし/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ Bridge\.m$/ })).toBeDefined()
  expect(seen.toasts).toEqual([])
  await ui.unmount()
})

test('前の回の数が無い時は、手順の数だけを出す', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, `${COMPILE}${LINK}`, seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await clock.advance(1000)

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🔨 make build {2}2 手順$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⚙ MyApp · リンク/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ SummaryModel\.swift$/ })).toBeDefined()
  await ui.unmount()
})

test('古い形のターゲットの行と、xcbeautify を通した行も拾う', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  let log = '=== BUILD TARGET Core OF PROJECT MyApp WITH CONFIGURATION Debug ===\nCompileC /out/a.o /src/a.m normal arm64 objective-c x\n'
  let mtime = 1_000_000
  engine(on, () => log, seen, '/repo', () => mtime, true)

  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await clock.advance(1000)
  const old = await mountBand($)
  expect(await old.find({ type: 'Text', text: /⚙ Core · コンパイル/ })).toBeDefined()
  await old.unmount()

  log = '[MyKit] Compiling Summary.swift\n[MyApp] Compiling SummaryView.swift\n[MyApp] Linking MyApp\n⚠️  /src/A.swift:3:5: unused\n❌  /src/App/SummaryView.swift:42:9: cannot find \'total\' in scope\n'
  mtime += 1000
  await clock.advance(1000)
  const pretty = await mountBand($)
  expect(await pretty.find({ type: 'Text', text: /3 手順$/ })).toBeDefined()
  expect(await pretty.find({ type: 'Text', text: /⚙ MyApp · リンク {2}⚠ 1 {2}✖ 1/ })).toBeDefined()
  expect(await pretty.find({ type: 'Text', text: /▸ SummaryView\.swift$/ })).toBeDefined()
  expect(await pretty.find({ type: 'Text', text: /✖ SummaryView\.swift:42 cannot find 'total' in scope$/ })).toBeDefined()
  await pretty.unmount()
})

test('エラーは 3 件までファイルと行を添えて出し、残りは「ほか N 件」にまとめる。同じ行は 1 回だけ数える', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  const errors = ['/src/One.swift:1:1: error: one', '/src/One.swift:1:1: error: one', '/src/Two.swift:2:2: error: two', 'ld: error: three', 'xcodebuild: error: four', '/src/Five.m:5: fatal error: five']
  engine(on, `${errors.join('\n')}\n`, seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await clock.advance(1000)

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /⚠ 0 {2}✖ 5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✖ One\.swift:1 one$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✖ Two\.swift:2 two$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✖ three$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✖ four$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /ほか 2 件/ })).toBeDefined()
  await ui.unmount()
})

test('test を含むコマンドと、ビルドをしない xcodebuild には当てない', async ($, on) => {
  const seen = fresh()
  engine(on, SUCCEEDED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'xcodebuild -scheme MyApp test 2>&1 | tee .build/build.log' })
  await $.tool.call({ tool: 'Bash', command: 'xcodebuild test-without-building -scheme MyApp' })
  await $.tool.call({ tool: 'Bash', command: 'xcodebuild -scheme MyApp build test' })
  await $.tool.call({ tool: 'Bash', command: 'xcodebuild -list && xcodebuild -showBuildSettings -scheme MyApp' })
  await $.tool.call({ tool: 'Bash', command: 'make test && make build test && make build-ios && make -C build verify' })

  expect(seen.reads).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('xcodebuild の archive と、動作を書かない形にも当てる', async ($, on) => {
  const seen = fresh()
  engine(on, `${COMPILE}** ARCHIVE SUCCEEDED **\n`, seen)

  await $.tool.call({ tool: 'Bash', command: 'xcodebuild archive -scheme MyApp' })
  await $.tool.call({ tool: 'Bash', command: 'make lint && xcodebuild -workspace A.xcworkspace -scheme "Other"' })

  expect(seen.toasts).toEqual(['✔ xcodebuild 成功 · 警告 0 · 0:00', '✔ xcodebuild 成功 · 警告 0 · 0:00'])
  expect(seen.store.get('total:xcodebuild MyApp')).toBe(1)
  expect(seen.store.get('total:xcodebuild Other')).toBe(1)
})

const OTHER = {
  commandPattern: '\\bswift build\\b',
  logPath: 'out/build.log',
  targetLine: '^target: (.+)$',
  stepLine: '^step ',
  warningLine: '^W: ',
  errorLine: '^E: ',
  finishedLine: '^DONE$',
  succeededLine: '^GOOD$',
}
const OTHER_LOG = 'target: Core\nstep a\nstep b\nW: x\nW: y\nDONE\nGOOD\n'

test('options で見張るコマンド・ログの置き場・行の形を変えられる', { options: OTHER }, async ($, on) => {
  const seen = fresh()
  engine(on, OTHER_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'make build' })
  expect(seen.reads).toEqual([])

  await $.tool.call({ tool: 'Bash', command: 'swift build -c release 2>&1 | tee out/build.log' })
  expect(seen.reads).toContain('/repo/out/build.log')
  expect(seen.toasts).toEqual(['✔ swift build 成功 · 警告 2 · 0:00'])
  expect(seen.store.get('total:swift build')).toBe(2)
})

test('終わった行があるのに成功の行が無ければ、失敗とする', { options: OTHER }, async ($, on) => {
  const seen = fresh()
  engine(on, OTHER_LOG.replace('GOOD\n', 'E: boom\n'), seen)

  await $.tool.call({ tool: 'Bash', command: 'swift build' })

  expect(seen.toasts).toEqual(['✖ swift build 失敗 · エラー 1 · 警告 2 · 0:00'])
  expect(seen.store.has('total:swift build')).toBe(false)
})

test('終わった行が無いまま終わった時は、エラーの行があれば失敗とし、手順の数は覚えない', async ($, on) => {
  const seen = fresh()
  engine(on, `${COMPILE}${ERROR}`, seen)

  await $.tool.call({ tool: 'Bash', command: 'make build' })
  expect(seen.toasts).toEqual(['✖ make build 失敗 · エラー 1 · 警告 0 · 0:00'])
  expect(seen.store.has('total:make build')).toBe(false)
})

test('壊れた正規表現は初めの値に戻る', { options: { stepLine: '(', commandPattern: '(' } }, async ($, on) => {
  const seen = fresh()
  engine(on, SUCCEEDED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'make build' })
  await $.tool.call({ tool: 'Bash', command: 'make build' })

  expect(seen.toasts).toEqual(['ios-build-progress: commandPattern・stepLine の正規表現が正しくないので、初めの値で見張ります', '✔ make build 成功 · 警告 1 · 0:00', '✔ make build 成功 · 警告 1 · 0:00（前回 0:00）'])
})

test('cd・make -C・run-check.sh のあとは、動かした先を基点にする', async ($, on) => {
  const seen = fresh()
  engine(on, SUCCEEDED_LOG, seen)

  await $.tool.call({ tool: 'Bash', command: 'cd app && xcodebuild -scheme MyApp build' })
  await $.tool.call({ tool: 'Bash', command: 'cd /abs; cd sub && make -C x build' })
  await $.tool.call({ tool: 'Bash', command: '/s/run-check.sh /wt/a "make build" make build' })

  expect(seen.reads).toEqual(['/repo/app/.build/build.log', '/abs/sub/x/.build/build.log', '/wt/a/.build/build.log'])
})

test('ログが 5 分変わらないと、帯を消して止める', async ($, on) => {
  const seen = fresh()
  seen.store.set('total:make build', 10)
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, COMPILE, seen, '/repo', 1_000_000, true)
  const shown = async () => {
    const ui = await mountBand($)
    const found = (await ui.find({ type: 'Text', text: /🔨 make build/ })) !== undefined
    await ui.unmount()
    return found
  }

  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await clock.advance(60_000)
  expect(await shown()).toBe(true)
  expect(seen.reads).toHaveLength(1)

  await clock.advance(5 * 60_000)
  expect(await shown()).toBe(false)
  expect(seen.toasts).toEqual([])
  expect(seen.store.get('total:make build')).toBe(10)
})

test('ログが変わり続けても、1 時間たったら帯を消して止める', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  let mtime = 1_000_000
  engine(on, COMPILE, seen, '/repo', () => (mtime += 1000), true)

  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await clock.advance(30 * 60_000)
  const during = await mountBand($)
  expect(await during.find({ type: 'Text', text: /🔨 make build/ })).toBeDefined()
  await during.unmount()

  await clock.advance(31 * 60_000)
  const after = await mountBand($)
  expect(await after.find({ type: 'Text', text: /🔨 make build/ })).toBeUndefined()
  await after.unmount()
  expect(seen.toasts).toEqual([])
})

test('ログが一度も書かれないまま終わったら、ログを書かないコマンドとみなして何も知らせない', async ($, on) => {
  const seen = fresh()
  engine(on, SUCCEEDED_LOG, seen, '/repo', 1_000_000, false, true)

  await $.tool.call({ tool: 'Bash', command: 'make build' })

  expect(seen.reads).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(seen.store.get('total:make build')).toBeUndefined()
})

test('ログが古いまま終わった時も、成功とは言わずに何も知らせない', async ($, on) => {
  const seen = fresh()
  engine(on, SUCCEEDED_LOG, seen, '/repo', 0)

  await $.tool.call({ tool: 'Bash', command: 'make build' })

  expect(seen.toasts).toEqual([])
})

test('ログが書かれるまでは、帯を出さない', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, SUCCEEDED_LOG, seen, '/repo', 1_000_000, true, true)

  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await clock.advance(3000)

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🔨 make build/ })).toBeUndefined()
  await ui.unmount()
})

test('実行を拒まれた時は、トーストを出さずに帯だけを消す', async ($, on) => {
  const seen = fresh()
  engine(on, SUCCEEDED_LOG, seen, '/repo', 1_000_000, false, false, { deny: 'no' })

  await $.tool.call({ tool: 'Bash', command: 'make build' })
  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__build_sim' })

  expect(seen.toasts).toEqual([])
  expect(seen.store.size).toBe(0)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🔨/ })).toBeUndefined()
  await ui.unmount()
})

test('見張りが重なっても、後の開始は前の表示と終わりを書き換えない', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, `${COMPILE}${LINK}`, seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await clock.advance(1000)
  await $.tool.call({ tool: 'Bash', command: 'make build' })

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🔨 make build/ })).toBeDefined()
  await ui.unmount()
  expect(seen.toasts).toEqual(['✔ make build 成功 · 警告 0 · 0:00'])
})

test('ログを読むのに失敗したら、トーストで知らせて見張りを止める', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, new Error('読めない'), seen, '/repo', 1_000_000, true)

  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await clock.advance(3000)

  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toMatch(/^ios-build-progress: 見張りを止めました: /)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🔨 make build/ })).toBeUndefined()
  await ui.unmount()
})

test('session.start で、残っていた見張りの行を消す', async ($, on) => {
  const seen = fresh()
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, COMPILE, seen, '/repo', 1_000_000, true)
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await clock.advance(1000)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🔨 make build/ })).toBeUndefined()
  await ui.unmount()
})

test('XcodeBuildMCP のビルドのツールは、結果の文から警告とエラーを数えて知らせる', async ($, on) => {
  const seen = fresh()
  engine(on, '', seen, '/repo', 1_000_000, false, false, { text: `⚠️ Warning: ${WARNING}⚠️ Warning: ${WARNING}✅ iOS Simulator Build build succeeded for scheme MyApp.` })

  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__build_sim' })
  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__build_sim' })

  expect(seen.reads).toEqual([])
  expect(seen.toasts).toEqual(['✔ build_sim 成功 · 警告 1 · 0:00', '✔ build_sim 成功 · 警告 1 · 0:00（前回 0:00）'])
})

test('XcodeBuildMCP のビルドが失敗したら、エラーの数を知らせ、かかった時間は覚えない', async ($, on) => {
  const seen = fresh()
  engine(on, '', seen, '/repo', 1_000_000, false, false, { isError: true, text: `❌ Error: ${ERROR}❌ Error: error: no such module 'Charts'\n❌ iOS Simulator Build build failed for scheme MyApp.` })

  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__build_run_sim' })

  expect(seen.toasts).toEqual(['✖ build_run_sim 失敗 · エラー 2 · 警告 0 · 0:00'])
  expect(seen.store.size).toBe(0)
})

test('XcodeBuildMCP の結果の文が空なら、成功・失敗と時間だけを知らせる', async ($, on) => {
  const seen = fresh()
  engine(on, '', seen)

  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__build_sim' })

  expect(seen.toasts).toEqual(['✔ build_sim 成功 · 0:00'])
})

test('XcodeBuildMCP のビルドの間は、帯に名前と経った時間だけを出す。ほかのツールは見張らない', async ($, on) => {
  const seen = fresh()
  seen.store.set('durationMs:build_sim', 110_000)
  const clock = mock.clock(on, { now: 1_000_000 })
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  engine(on, '', seen, '/repo', 1_000_000, true, false, { wait: async tool => (tool === 'mcp__XcodeBuildMCP__build_sim' ? held : undefined) })

  await $.tool.call({ tool: 'mcp__XcodeBuildMCP__test_sim' })
  expect(seen.toasts).toEqual([])

  const calling = $.tool.call({ tool: 'mcp__XcodeBuildMCP__build_sim' })
  await clock.advance(42_000)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /🔨 build_sim {2}⏱ 0:42 · 残り約 1:08 · 前回 1:50$/ })).toBeDefined()
  await ui.unmount()

  release()
  await calling
  expect(seen.toasts).toEqual(['✔ build_sim 成功 · 0:42（前回 1:50）'])
})
