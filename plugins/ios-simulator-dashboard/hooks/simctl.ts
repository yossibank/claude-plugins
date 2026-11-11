import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { App, Appearance, Device, Sim } from '../types'

import type { Config } from './config'
import { RUN_MS } from './config'
import { errorText } from './report'

// shape の番号は、保存する値の形の版。形を変えた時に上げると、前の版の値は読まれず初めの値に戻る
const sim = atom({ plugin: 'ios-simulator-dashboard', key: 'sim' } as const, { status: 'unread' }, { shape: 'sim-1' })

const RUNTIME_PREFIX = 'com.apple.CoreSimulator.SimRuntime.'

// runtime の id から OS の名前にする。com.apple.CoreSimulator.SimRuntime.iOS-18-2 → iOS 18.2
export const osOf = (runtime: string) => {
  const [name, ...version] = (runtime.startsWith(RUNTIME_PREFIX) ? runtime.slice(RUNTIME_PREFIX.length) : runtime).split('-')
  return version.length === 0 ? (name ?? runtime) : `${name} ${version.join('.')}`
}

type Listed = { booted: { name: string; os: string; udid: string }[]; available: number }

// simctl list devices --json を読む。形が違えば null
export const devicesOf = (stdout: string): Listed | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  const devices = (parsed as { devices?: unknown } | null)?.devices
  if (typeof devices !== 'object' || devices === null) return null
  const out: Listed = { booted: [], available: 0 }
  for (const [runtime, list] of Object.entries(devices)) {
    if (!Array.isArray(list)) continue
    for (const device of list as { name?: unknown; udid?: unknown; state?: unknown; isAvailable?: unknown }[]) {
      if (typeof device?.udid !== 'string') continue
      if (device.isAvailable !== false) out.available += 1
      if (device.state === 'Booted') out.booted.push({ name: typeof device.name === 'string' ? device.name : device.udid, os: osOf(runtime), udid: device.udid })
    }
  }
  return out
}

function simctl($: EngineInterface, args: string[]) {
  return $.process.run(['xcrun', 'simctl', ...args], { timeoutMs: RUN_MS })
}

async function appearanceOf($: EngineInterface, udid: string): Promise<Appearance> {
  const shown = await simctl($, ['ui', udid, 'appearance']).catch(() => null)
  const word = shown === null || shown.exitCode !== 0 ? '' : shown.stdout.trim()
  return word === 'light' || word === 'dark' ? word : 'unknown'
}

// 入っているかは get_app_container の終了コード、動いているかは launchctl list に bundleId の行があるかで見る
async function appOf($: EngineInterface, udid: string, bundleId: string): Promise<App> {
  const [container, services] = await Promise.all([
    simctl($, ['get_app_container', udid, bundleId]).catch(() => null),
    simctl($, ['spawn', udid, 'launchctl', 'list']).catch(() => null),
  ])
  return {
    isInstalled: container !== null && container.exitCode === 0,
    isRunning: services !== null && services.exitCode === 0 && services.stdout.split('\n').some(line => line.includes(bundleId)),
  }
}

async function load($: EngineInterface, config: Config, readAt: number): Promise<Sim> {
  const failed = (reason: string): Sim => ({ status: 'failed', reason, readAt })
  let listed
  try {
    listed = await simctl($, ['list', 'devices', '--json'])
  } catch (error) {
    return failed(errorText(error))
  }
  if (listed.exitCode !== 0) return failed(listed.stderr.trim().split('\n')[0] || `xcrun simctl list が終了コード ${listed.exitCode} で終わった`)
  const devices = devicesOf(listed.stdout)
  if (devices === null) return failed('xcrun simctl list の出力を読めない')
  const booted = await Promise.all(
    devices.booted.map(async (device): Promise<Device> => {
      const [appearance, app] = await Promise.all([appearanceOf($, device.udid), config.bundleId === '' ? undefined : appOf($, device.udid, config.bundleId)])
      return { ...device, appearance, ...(app === undefined ? {} : { app }) }
    }),
  )
  return { status: 'ok', booted, available: devices.available, readAt }
}

// 取っている途中の読み取り。重ねて走らせない
let reading: Promise<void> | undefined
// 最後に取り始めた時刻
let startedAt = 0

export const lastReadAt = () => startedAt

export async function currentSim($: EngineInterface) {
  return read($, sim)
}

// シミュレータの状態を取り直す。isFresh なら、途中の読み取りを待ってから新しく取る（操作の後の状態を出すため）
export async function refresh($: EngineInterface, config: Config, isFresh = false) {
  if (isFresh && reading !== undefined) await reading.catch(() => undefined)
  reading ??= (async () => {
    startedAt = await $.clock.now()
    const next = await load($, config, startedAt)
    await update($, sim, () => next)
  })().finally(() => {
    reading = undefined
  })
  return reading
}

// 外観を変える。失敗したら、理由を返す
export async function setAppearance($: EngineInterface, udid: string, appearance: 'light' | 'dark') {
  const done = await simctl($, ['ui', udid, 'appearance', appearance])
  return done.exitCode === 0 ? null : done.stderr.trim().split('\n')[0] || `終了コード ${done.exitCode}`
}
