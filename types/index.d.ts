export type Segment = { name: string; color: string; tokens: number; kind: 'used' | 'free' | 'buffer' }
export type Limit = { kind: string; percentUsed: number; resetsAt?: number }
export type Snapshot = {
  segments: Segment[]
  total: number
  max: number
  percent: number
  startedAt: number
  limits: Limit[]
  // Tokens left before auto-compaction runs; absent when it is off.
  compactIn?: number
}

export type Row = { name: string; tokens: number; note?: string }
export type Details = {
  model: string
  max: number
  total: number
  categories: { name: string; color: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
  memoryFiles: Row[]
  mcpServers: Row[]
  agents: Row[]
  skills?: { total: number; included: number; tokens: number; top: Row[] }
  commands?: { total: number; included: number; tokens: number }
  api: { uncached: number; cacheRead: number; cacheWrite: number; output: number } | null
}

// The working zone: from `warnAt` % of the window the figure turns yellow, from `alertAt` red.
export type Thresholds = { warnAt: number; alertAt: number }

// A handoff document written in a session, offered to the next one in the same folder.
export type Handoff = { path: string; cwd: string; at: number; title: string }

// How the window grew over the last turns of the main loop: the tokens at the latest turn's end
// and what each counted turn added.
export type Pace = { lastTotal: number; deltas: number[] }

// The language the mod speaks: /context-bar lang picks it and the store keeps it.
export type Lang = 'en' | 'ru'

declare module 'claude-code' {
  interface PluginState {
    'context-bar-compact': { isOn: boolean; snapshot: Snapshot | null; now: number; details: Details | null; zone: Thresholds; handoff: Handoff | null; hasStarted: boolean; pace: Pace | null; repliedAt: number; lang: Lang }
  }
}
