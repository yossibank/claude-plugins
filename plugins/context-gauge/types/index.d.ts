export type Slice = { name: string; tokens: number; color: string }

export type Fill = {
  slices: Slice[]
  free: number
  buffer: number
  tokens: number
  window: number
  percent: number
}

export type Breakpoint = { label: string; at: number }

export type Upcoming = { items: string[]; mtimeMs: number }

declare module 'claude-code' {
  interface PluginState {
    'context-gauge': {
      fill: Shaped<Fill | null>
      lastTurnEnd: number | null
      breakpoint: Breakpoint | null
      sessionStart: number | null
      upcoming: Upcoming | null
      tick: number
      isPaneShown: boolean
    }
  }
}
