const ANSI = /\x1b\[[0-9;]*m/g
// 設定が空か壊れている時の値。plugin.json の userConfig の default と同じにしておく
export const DEFAULTS = {
  commandPattern: '\\bxcodebuild\\b(?!.*\\s(?:test|test-without-building|-list|-version|-showsdks|-showBuildSettings|-showdestinations|-exportArchive|-resolvePackageDependencies|-help)(?=\\s|$))|\\bmake\\b(?!.*\\stest(?=\\s|$))(?:.*\\s)?build(?=\\s|$)',
  logPath: '.build/build.log',
  targetLine: '^=== BUILD TARGET (.+?) OF PROJECT|^Build target (.+?)(?: of project| with configuration|$)|\\(in target \\W(.+?)\\W from project|^\\[([^\\]]+)\\] \\S',
  stepLine: '^(?:CompileSwift|SwiftCompile|CompileSwiftSources|SwiftDriver|SwiftEmitModule|CompileC|CompileAssetCatalog|CompileStoryboard|CompileXIB|LinkStoryboards|Ld|Libtool|CodeSign|CpResource|Copy|CopySwiftLibs|ProcessInfoPlistFile|PhaseScriptExecution|GenerateDSYMFile|Touch|Validate)\\s|^\\[[^\\]]+\\] [A-Z][a-z]+\\s',
  warningLine: '(?:^|\\s)warning: |^\\s*⚠',
  errorLine: '(?:^|\\s)error: |^\\s*❌',
  finishedLine: '\\*\\* (?:BUILD|ARCHIVE) (?:SUCCEEDED|FAILED) \\*\\*|\\b(?:Build|Archive) (?:Succeeded|Failed)\\b',
  succeededLine: 'BUILD SUCCEEDED|ARCHIVE SUCCEEDED|Build Succeeded|Archive Succeeded',
}

export type Pattern = 'commandPattern' | 'targetLine' | 'stepLine' | 'warningLine' | 'errorLine' | 'finishedLine' | 'succeededLine'

export type Watched = {
  command: RegExp
  logPath: string
  target: RegExp
  step: RegExp
  warning: RegExp
  error: RegExp
  finished: RegExp
  succeeded: RegExp
}

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback)

// 壊れた正規表現は初めの値に戻し、その設定の名前を broken に集める。知らせるのは最初の Bash の時
export const watched = (options: Readonly<Record<string, unknown>>) => {
  const broken: Pattern[] = []
  const pattern = (name: Pattern) => {
    try {
      return new RegExp(text(options[name], DEFAULTS[name]))
    } catch {
      broken.push(name)
      return new RegExp(DEFAULTS[name])
    }
  }
  const spec: Watched = {
    command: pattern('commandPattern'),
    logPath: text(options.logPath, DEFAULTS.logPath),
    target: pattern('targetLine'),
    step: pattern('stepLine'),
    warning: pattern('warningLine'),
    error: pattern('errorLine'),
    finished: pattern('finishedLine'),
    succeeded: pattern('succeededLine'),
  }
  return { spec, broken }
}

const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

const place = (base: string, dir: string) => (dir.startsWith('/') ? dir : join(base, dir))

const bare = (word: string) => word.replace(/^['"]|['"]$/g, '')

// コマンドの区切りごとに cd で基点を動かし、見張るコマンドに当たった区切りのログの置き場と、帯に出す名前を返す
export const buildLog = (command: string, cwd: string, spec: Watched) => {
  let base = cwd
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/)
    if (words[0] === 'cd') {
      const next = bare(words[1] ?? '')
      if (next !== '' && next !== '-' && !next.startsWith('~') && !next.startsWith('$')) base = place(base, next)
      continue
    }
    const checked = /(^|\/)run-check\.sh$/.test(words[0] ?? '') ? bare(words[1] ?? '') : ''
    const root = checked !== '' && !checked.startsWith('~') && !checked.startsWith('$') ? place(base, checked) : base
    const isMake = /\bmake\b/.test(segment)
    const hit = (isMake ? segment.replace(/\s-C\s*\S+/g, '') : segment).match(spec.command)
    if (hit === null) continue
    const into = isMake ? segment.match(/\s-C\s*(\S+)/)?.[1] : undefined
    const dir = into === undefined ? root : place(root, bare(into))
    const label = hit[0].trim() || segment.trim()
    // 手順の数は scheme で大きく変わるので、前の回の数は scheme ごとに分けて覚える
    const scheme = segment.match(/\s-scheme\s+(\S+)/)?.[1]
    return { log: place(dir, spec.logPath), label, key: scheme === undefined ? label : `${label} ${bare(scheme)}` }
  }
  return undefined
}

// 手順の行の最初の語から、今の段の名前を決める。上が xcodebuild の語、下が xcbeautify を通した語
const STAGES: [RegExp, string][] = [
  [/^(?:CompileSwift|SwiftCompile|CompileSwiftSources|SwiftDriver|SwiftEmitModule|CompileC|Compiling)$/, 'コンパイル'],
  [/^(?:Ld|Libtool|CreateUniversalBinary|Linking)$/, 'リンク'],
  [/^(?:CodeSign|Signing)$/, '署名'],
  [/^(?:PhaseScriptExecution|Running)$/, 'スクリプト'],
  [/^(?:CompileAssetCatalog|CompileStoryboard|CompileXIB|LinkStoryboards|CpResource|Copy|CopySwiftLibs|ProcessInfoPlistFile|Processing|Copying)$/, 'リソース'],
]

const stageOf = (line: string) => {
  const word = line.replace(/^\[[^\]]+\]\s*/, '').split(/\s/)[0] ?? ''
  return STAGES.find(([words]) => words.test(word))?.[1] ?? word
}

// 手順の行の中の、最後のソースのファイルの名前。後ろの「(in target …)」は落としてから探す
const sourceOf = (line: string) =>
  line
    .replace(/\s\(in target .*$/, '')
    .match(/[^/\s\\,]+\.(?:swift|mm?|cc?|cpp|cxx)(?=[\s,]|$)/g)
    ?.at(-1) ?? ''

// エラーの行を帯に出す形にする。「パス:行:列: error: 文」は「ファイル:行 文」に、ほかは error: の後ろの文にする
const describe = (line: string) => {
  const plain = line.trim().replace(/^❌\s*/, '')
  const at = plain.match(/^(.*?):(\d+)(?::\d+)?:\s*(?:fatal\s+)?(?:error:\s*)?(.+)$/)
  if (at !== null) return `${(at[1] ?? '').split('/').at(-1)}:${at[2]} ${at[3]}`
  return plain.replace(/^.*?\berror:\s*/, '').trim() || plain
}

// 警告とエラーだけを数える。XcodeBuildMCP の結果の文にも使う
export const problems = (raw: string, spec: Watched) => {
  const warned = new Set<string>()
  const errors: string[] = []
  for (const line of raw.replace(ANSI, '').split('\n')) {
    // xcodebuild は同じ警告を、アーキテクチャごとと最後のまとめで繰り返すので、同じ行は 1 回だけ数える
    if (spec.warning.test(line)) warned.add(line.trim())
    else if (spec.error.test(line)) {
      const error = describe(line)
      if (!errors.includes(error)) errors.push(error)
    }
  }
  return { warnings: warned.size, errors }
}

export const count = (raw: string, spec: Watched) => {
  const plain = raw.replace(ANSI, '')
  let steps = 0
  let target = ''
  let stage = ''
  let file = ''
  const lines = plain.split('\n')
  for (const line of lines) {
    const named = line.match(spec.target)?.slice(1).find(group => group !== undefined && group !== '')
    if (named !== undefined) target = named.trim()
    if (!spec.step.test(line)) continue
    steps += 1
    stage = stageOf(line)
    if (stage === 'コンパイル') file = sourceOf(line) || file
  }
  return { steps, target, stage, file, ...problems(plain, spec), isFinished: lines.some(line => spec.finished.test(line)), isSucceeded: lines.some(line => spec.succeeded.test(line)) }
}
