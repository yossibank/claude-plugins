export type Slice = { name: string; tokens: number; color: string }

export type Fill = {
  slices: Slice[]
  free: number
  buffer: number
  tokens: number
  window: number
  percent: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-gauge': { fill: Shaped<Fill | null>; pullRequest: number | null; isPaneShown: boolean }
  }
}
