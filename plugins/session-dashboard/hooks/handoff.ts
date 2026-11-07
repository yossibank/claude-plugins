import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Upcoming } from '../types'

import type { Config } from './config'

const upcoming = atom({ plugin: 'session-dashboard', key: 'upcoming' } as const, null)

const NEXT_LINE = /^\s*[-*]\s*次[：:]\s*(.*)$/
const NEXT_ITEM = /(?:^|\s)\d+[.．]\s+/

let handoffFile: string | undefined

async function resolveHandoff($: EngineInterface, config: Config) {
  const cwd = await $.session.cwd()
  const top = await $.process
    .run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    .then(result => (result.exitCode === 0 ? result.stdout.trim() : ''))
    .catch(() => '')
  const base = top === '' ? cwd : top
  return config.handoffPath.startsWith('/') ? config.handoffPath : `${base.replace(/\/$/, '')}/${config.handoffPath}`
}

async function handoffOf($: EngineInterface, config: Config) {
  handoffFile ??= await resolveHandoff($, config)
  return handoffFile
}

const parseNext = (text: string): string[] => {
  const lines = text.split('\n')
  const at = lines.findIndex(line => NEXT_LINE.test(line))
  if (at < 0) return []
  const chunks = [NEXT_LINE.exec(lines[at] ?? '')?.[1] ?? '']
  for (const line of lines.slice(at + 1)) {
    if (!/^\s+\S/.test(line)) break
    chunks.push(line.trim())
  }
  return chunks
    .join(' ')
    .split(NEXT_ITEM)
    .map(item => item.trim())
    .filter(item => item !== '')
}

async function readUpcoming($: EngineInterface, config: Config): Promise<Upcoming | null> {
  const path = await handoffOf($, config)
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat === undefined) return null
  const text = await $.fs.read(path).catch(() => '')
  const items = parseNext(typeof text === 'string' ? text : '')
  return items.length === 0 ? null : { items, mtimeMs: stat.mtimeMs }
}

export async function nextOf($: EngineInterface, config: Config): Promise<string[]> {
  const ahead = await read($, upcoming)
  if (ahead === null) return []
  const stat = await $.fs.stat(await handoffOf($, config)).catch(() => undefined)
  return stat === undefined || stat.mtimeMs <= ahead.mtimeMs ? ahead.items : []
}

// handoff を探し直し、次の項目を読み直す
export async function loadUpcoming($: EngineInterface, config: Config) {
  handoffFile = undefined
  const found = await readUpcoming($, config)
  await update($, upcoming, () => found)
}
