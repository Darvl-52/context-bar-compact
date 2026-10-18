import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Details, Limit, Row, Segment, Snapshot, Thresholds } from '../types'

// On at the start of every session; /context-bar hides it for that session only.
const isOn = atom({ plugin: 'context-bar-compact', key: 'isOn' } as const, true)
const snapshot = atom({ plugin: 'context-bar-compact', key: 'snapshot' } as const, null)
// The time the band last read, bumped each minute so the reset countdowns move.
const now = atom({ plugin: 'context-bar-compact', key: 'now' } as const, 0)
const details = atom({ plugin: 'context-bar-compact', key: 'details' } as const, null)
const isDetailsOpen = atom({ plugin: 'context-bar-compact', key: 'isDetailsOpen' } as const, false)
// The working zone in force: what /context-bar zone saved, else the defaults.
const zoneAtom = atom({ plugin: 'context-bar-compact', key: 'zone' } as const, { warnAt: 50, alertAt: 60 })

const PANE = 'context-details'
const ZONE_PANE = 'context-zone'
const ZONE_KEY = 'zone'
const ZONE_STEP = 5
export const PRESETS: readonly Thresholds[] = [
  { warnAt: 40, alertAt: 50 },
  { warnAt: 50, alertAt: 60 },
  { warnAt: 60, alertAt: 70 },
  { warnAt: 70, alertAt: 80 },
]
const GLYPH = { used: '█', buffer: '▒', free: '░' } as const
const BAR_CELLS = 20
const REFRESH_MS = 3000
const TICK_MS = 60_000
const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
// The working zone of the window: from `warnAt` the figure turns yellow, from `alertAt` red,
// with a toast once and a row offering a handoff or /compact. Set with /context-bar zone and kept
// in the plugin's store between sessions; these are the defaults.
export const DEFAULT_THRESHOLDS: Thresholds = { warnAt: 50, alertAt: 60 }

// A value that is no number, or out of 1–100, falls back to its default; a pair given the wrong
// way round is swapped rather than refused, the intent being plain.
export const thresholdsOf = (warn: unknown, alert: unknown): Thresholds => {
  const pick = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 100 ? Math.round(value) : fallback
  const warnAt = pick(warn, DEFAULT_THRESHOLDS.warnAt)
  const alertAt = pick(alert, DEFAULT_THRESHOLDS.alertAt)
  return alertAt >= warnAt ? { warnAt, alertAt } : { warnAt: alertAt, alertAt: warnAt }
}

// One step of a −/+ button: the other threshold moves along where it would be crossed, so the
// pair stays in order without a press being refused.
export const nudge = (t: Thresholds, which: keyof Thresholds, delta: number): Thresholds => {
  const value = Math.min(100, Math.max(1, t[which] + delta))
  if (which === 'warnAt') return { warnAt: value, alertAt: Math.max(t.alertAt, value) }
  return { warnAt: Math.min(t.warnAt, value), alertAt: value }
}

// `/context-bar zone`, `zone 40 70`, `zone reset`: what the arguments after `zone` ask for.
export const parseZone = (args: string): 'open' | 'reset' | Thresholds | undefined => {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'open'
  if (words.length === 1 && /^(reset|default)$/i.test(words[0]!)) return 'reset'
  const nums = words.map(w => Number(w.replace(/%$/, '')))
  if (nums.length === 2 && nums.every(n => Number.isFinite(n) && n >= 1 && n <= 100)) return thresholdsOf(nums[0], nums[1])
  return undefined
}

export type Zone = 'ok' | 'warn' | 'over'
export const zoneOf = (percent: number, t: Thresholds = DEFAULT_THRESHOLDS): Zone =>
  percent >= t.alertAt ? 'over' : percent >= t.warnAt ? 'warn' : 'ok'
const ZONE_COLOR: Record<Zone, string | undefined> = { ok: undefined, warn: 'warning', over: 'error' }

// Matt Pocock's handoff skill, when its plugin is installed: the command's name as typed.
export const findHandoff = (commands: readonly { name: string; plugin?: string }[]) =>
  commands.find(c => c.plugin === 'mattpocock-skills' && /(^|:)handoff$/.test(c.name))?.name ??
  commands.find(c => /(^|:)handoff$/.test(c.name))?.name

export const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

// The band's figures: whole thousands from 10k up, so the line stays short.
export const tiny = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : short(n)

export const span = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  const hours = Math.floor(m / 60)
  if (hours < 24) return `${hours}h${m % 60}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

// After the bar: rate limits with their reset countdown, then room before compaction.
export const infoLine = (snap: Snapshot, at: number) => {
  const parts = snap.limits.map(l => {
    const label = LIMIT_LABEL[l.kind] ?? l.kind
    const reset = l.resetsAt !== undefined && l.resetsAt > at ? ` ↻${span(l.resetsAt - at)}` : ''
    return `${label} ${l.percentUsed}%${reset}`
  })
  if (snap.compactIn !== undefined) parts.push(`${tiny(snap.compactIn)} to compact`)
  return parts.join(' · ')
}

// Split `width` cells across segments by largest remainder, giving every
// non-empty used segment at least one cell so small categories stay visible.
export const allocate = (segments: Segment[], max: number, width: number): number[] => {
  if (max <= 0 || width <= 0) return segments.map(() => 0)
  const exact = segments.map(s => (s.tokens / max) * width)
  const cells = exact.map((x, i) => (segments[i]!.kind === 'used' && segments[i]!.tokens > 0 ? Math.max(1, Math.floor(x)) : Math.floor(x)))
  let spare = width - cells.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; spare > 0 && order.length > 0; k = (k + 1) % order.length, spare--) cells[order[k]![1]]! += 1
  // Over budget from the minimum-one rule: take cells back from the free space, then the largest.
  while (spare < 0) {
    const free = segments.findIndex((s, i) => s.kind === 'free' && cells[i]! > 0)
    const i = free >= 0 ? free : cells.indexOf(Math.max(...cells))
    cells[i]! -= 1
    spare++
  }
  return cells
}

const toLimit = (l: SessionRateLimit): Limit => {
  const at = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  return Number.isNaN(at) ? { kind: l.kind, percentUsed: l.percentUsed } : { kind: l.kind, percentUsed: l.percentUsed, resetsAt: at }
}

// The last two parts of a path, so memory files read as `.claude/CLAUDE.md`.
const tail = (path: string) => {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/')
}

const byTokens = (a: Row, b: Row) => b.tokens - a.tokens

let lastFetch = 0
let isFetching = false
let isFetchingDetails = false
let tick: { cancel: () => void } | undefined
let handoff: string | undefined
// Raised once past the zone; lowered when the window drops back under its start, after a compact.
let hasAlerted = false

async function refresh($: EngineInterface, force = false) {
  const at = await $.clock.now()
  if (isFetching || (!force && at - lastFetch < REFRESH_MS)) return
  if (!(await read($, isOn))) return
  isFetching = true
  lastFetch = at
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const b = usage.context.breakdown
    if (!b) return
    const segments: Segment[] = b.categories
      .filter(c => c.kind !== 'deferred' && c.tokens > 0)
      .map(c => ({ name: c.name, color: c.color, tokens: c.tokens, kind: c.kind as Segment['kind'] }))
    const next: Snapshot = {
      segments,
      total: b.totalTokens,
      max: b.rawMaxTokens,
      percent: b.percentage,
      startedAt: usage.startedAt,
      limits: usage.rateLimits.map(toLimit),
    }
    if (b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined) next.compactIn = Math.max(0, b.autoCompactThreshold - b.totalTokens)
    // Time first, so the new snapshot never draws against a stale clock.
    await update($, now, () => at)
    await update($, snapshot, () => next)
    const zone = zoneOf(next.percent, await read($, zoneAtom))
    if (zone === 'over' && !hasAlerted) {
      hasAlerted = true
      $.ui.toast(`Context ${next.percent}%: past the working zone. ${handoff ? 'Handoff or /compact' : '/compact'} from the row above the prompt.`)
    } else if (zone === 'ok') hasAlerted = false
  } finally {
    isFetching = false
  }
}

// The full breakdown counts every tool and memory file, as /context does, so it
// is read only for the details pane: on opening it and after each turn while it is open.
async function refreshDetails($: EngineInterface) {
  if (isFetchingDetails) return
  isFetchingDetails = true
  try {
    const b = (await $.session.usage({ breakdown: 'full' })).context.breakdown
    if (!b) return
    const servers = new Map<string, { tokens: number; tools: number; loaded: number }>()
    for (const t of b.mcpTools) {
      const s = servers.get(t.serverName) ?? { tokens: 0, tools: 0, loaded: 0 }
      servers.set(t.serverName, { tokens: s.tokens + t.tokens, tools: s.tools + 1, loaded: s.loaded + (t.isLoaded ? 1 : 0) })
    }
    const next: Details = {
      model: b.model,
      max: b.rawMaxTokens,
      total: b.totalTokens,
      categories: b.categories.filter(c => c.tokens > 0).map(c => ({ name: c.name, color: c.color, tokens: c.tokens, kind: c.kind })),
      memoryFiles: b.memoryFiles.map(f => ({ name: tail(f.path), tokens: f.tokens, note: f.type })).sort(byTokens),
      mcpServers: [...servers]
        .map(([name, s]) => ({ name, tokens: s.tokens, note: `${s.loaded}/${s.tools} tools loaded` }))
        .sort(byTokens),
      agents: b.agents.map(a => ({ name: a.agentType, tokens: a.tokens, note: a.source })).sort(byTokens),
      api: b.apiUsage && {
        uncached: b.apiUsage.input_tokens,
        cacheRead: b.apiUsage.cache_read_input_tokens,
        cacheWrite: b.apiUsage.cache_creation_input_tokens,
        output: b.apiUsage.output_tokens,
      },
    }
    if (b.skills)
      next.skills = {
        total: b.skills.totalSkills,
        included: b.skills.includedSkills,
        tokens: b.skills.tokens,
        top: b.skills.skillFrontmatter
          .map(s => ({ name: s.name, tokens: s.tokens, note: s.pluginName ?? s.source }))
          .sort(byTokens)
          .slice(0, 10),
      }
    if (b.slashCommands)
      next.commands = { total: b.slashCommands.totalCommands, included: b.slashCommands.includedCommands, tokens: b.slashCommands.tokens }
    await update($, details, () => next)
  } finally {
    isFetchingDetails = false
  }
}

async function openDetails($: EngineInterface) {
  await update($, isDetailsOpen, () => true)
  await $.ui.open({ id: PANE, title: 'Context details' })
  await refreshDetails($).catch(() => {})
}

async function setZone($: EngineInterface, t: Thresholds | 'reset') {
  const next = t === 'reset' ? DEFAULT_THRESHOLDS : t
  await update($, zoneAtom, () => next)
  if (t === 'reset') await $.store.delete(ZONE_KEY)
  else await $.store.set(ZONE_KEY, next)
  // The toast is armed again for the new zone.
  hasAlerted = false
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar',
      description: 'Toggle the context bar; details: token breakdown; zone: set where it turns yellow and red',
      argumentHint: '[details | zone [<yellow%> <red%> | reset]]',
    })
    // Only a session that draws the band needs the minute ticker; a reload drops
    // the old module's timers, and the cancel covers session.start firing twice in one load.
    tick?.cancel()
    if (e.isInteractive)
      tick = $.clock.every(TICK_MS, () => {
        void $.clock.now().then(at => update($, now, () => at))
      })
    handoff = findHandoff(await $.command.list().catch(() => []))
    const saved = (await $.store.get(ZONE_KEY).catch(() => undefined)) as Partial<Thresholds> | undefined
    await update($, zoneAtom, () => (saved ? thresholdsOf(saved.warnAt, saved.alertAt) : DEFAULT_THRESHOLDS))
    // Draw the bar as soon as the session opens; never let a failed read block startup.
    await refresh($, true).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb.toLowerCase() === 'details') {
      await openDetails($)
      return { text: 'Context details opened.' }
    }
    if (verb.toLowerCase() === 'zone') {
      const asked = parseZone(rest.join(' '))
      if (asked === undefined) return { text: 'Usage: /context-bar zone, /context-bar zone 50 60, /context-bar zone reset' }
      if (asked === 'open') {
        await $.ui.open({ id: ZONE_PANE, title: 'Working zone', focus: true, closeOnEscape: true })
        return { text: 'Working zone opened.' }
      }
      await setZone($, asked)
      const t = await read($, zoneAtom)
      return { text: `Working zone: yellow from ${t.warnAt}%, red from ${t.alertAt}%.` }
    }
    const nextOn = !(await read($, isOn))
    await update($, isOn, () => nextOn)
    if (nextOn) await refresh($, true)
    return { text: nextOn ? 'Context bar on.' : 'Context bar off.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, isDetailsOpen, () => false)
    return next(e)
  })

  on('session.measure', ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($, true)
    if (await read($, isDetailsOpen)) void refreshDetails($).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)
    const snap = await read($, snapshot)
    if (!snap || snap.segments.length === 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const info = infoLine(snap, await read($, now))
    const thresholds = await read($, zoneAtom)
    const zone = zoneOf(snap.percent, thresholds)
    const figure = ` ${snap.percent}%`
    const summary = ` ${tiny(snap.total)}/${tiny(snap.max)}${info ? ` · ${info}` : ''}`
    // A short bar, narrower still when the summary would not fit beside it.
    const width = Math.max(8, Math.min(BAR_CELLS, e.props.bodyColumns - figure.length - summary.length))
    const cells = allocate(snap.segments, snap.max, width)
    // The buttons put the command in the prompt box rather than run it: a handoff wants to be
    // told what the next session is for, and either can still be thought better of.
    const fill = (text: string) => void $.prompt.fill({ text }).catch(() => {})

    const bar = (
      <Text wrap="truncate">
        {snap.segments.map((s, i) =>
          cells[i]! > 0 ? (
            <Text color={s.color} dimColor={s.kind === 'free'}>
              {GLYPH[s.kind].repeat(cells[i]!)}
            </Text>
          ) : null,
        )}
        <Text color={ZONE_COLOR[zone]} dimColor={zone === 'ok'} bold={zone === 'over'}>
          {figure}
        </Text>
        <Text dimColor>{summary}</Text>
      </Text>
    )
    // The band is shared: what the plugins beneath draw there stays, under the bar.
    const below = await next(e)
    if (zone !== 'over' || e.props.maxRows < 2)
      return (
        <Box flexDirection="column">
          {bar}
          {below}
        </Box>
      )
    return (
      <Box flexDirection="column">
        {bar}
        <Box flexDirection="row" gap={1}>
          <Text color="error">
            ⚠ past the working zone ({thresholds.warnAt}–{thresholds.alertAt}%)
          </Text>
          {handoff ? <Button key="handoff" label="handoff" hotkey="h" plain onPress={() => fill(`/${handoff} `)} /> : null}
          <Button key="compact" label="/compact" hotkey="c" plain onPress={() => fill('/compact ')} />
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: ZONE_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, zoneAtom)
    const snap = await read($, snapshot)
    const step = (which: keyof Thresholds, label: string, color: string) => (
      <Box flexDirection="row" gap={1}>
        <Text color={color}>{label}</Text>
        <Button key={`${which}-down`} label="−" onPress={() => void setZone($, nudge(t, which, -ZONE_STEP))} />
        <Text bold>{String(t[which]).padStart(3)}%</Text>
        <Button key={`${which}-up`} label="+" onPress={() => void setZone($, nudge(t, which, ZONE_STEP))} />
      </Box>
    )
    const zone = snap ? zoneOf(snap.percent, t) : undefined
    return (
      <Box flexDirection="column">
        {step('warnAt', 'Yellow from', 'warning')}
        {step('alertAt', 'Red from   ', 'error')}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text dimColor>Presets</Text>
          {PRESETS.map((p, i) => (
            <Button
              key={`preset-${i + 1}`}
              label={`${p.warnAt}–${p.alertAt}`}
              hotkey={String(i + 1)}
              variant={p.warnAt === t.warnAt && p.alertAt === t.alertAt ? 'primary' : 'secondary'}
              onPress={() => void setZone($, p)}
            />
          ))}
        </Box>
        {snap && zone ? (
          <Text>
            <Text dimColor>Now </Text>
            <Text color={ZONE_COLOR[zone]} bold>
              {snap.percent}%
            </Text>
            <Text dimColor>
              {zone === 'ok' ? ': under the zone' : zone === 'warn' ? ': yellow' : ': red, the warning row and a toast'}
            </Text>
          </Text>
        ) : null}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="reset" label={`Reset to ${DEFAULT_THRESHOLDS.warnAt}–${DEFAULT_THRESHOLDS.alertAt}`} hotkey="r" dimColor onPress={() => void setZone($, 'reset')} />
          <Text dimColor>Saved for every session · Esc closes</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const d = await read($, details)
    const refreshButton = <Button key="refresh" label="Refresh" hotkey="r" dimColor onPress={() => refreshDetails($).catch(() => {})} />
    if (!d)
      return (
        <Box flexDirection="column">
          <Text dimColor>Counting tokens…</Text>
          {refreshButton}
        </Box>
      )

    const pct = (n: number) => (d.max > 0 ? `${((n / d.max) * 100).toFixed(1)}%` : '')
    const line = (r: Row, color?: string) => (
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Text wrap="truncate">
            {color ? <Text color={color}>■ </Text> : '  '}
            {r.name}
            {r.note ? <Text dimColor>  {r.note}</Text> : null}
          </Text>
        </Box>
        <Text>
          {' '}
          {short(r.tokens).padStart(6)} <Text dimColor>{pct(r.tokens).padStart(6)}</Text>
        </Text>
      </Box>
    )
    const section = (title: string, rows: Row[], extra?: string) =>
      rows.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            {title}
            {extra ? <Text dimColor>  {extra}</Text> : null}
          </Text>
          {rows.map(r => line(r))}
        </Box>
      )

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{d.model}</Text>
          <Text dimColor>
            {'  '}
            {short(d.total)}/{short(d.max)} ({pct(d.total)})
          </Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Categories</Text>
          {d.categories.map(c => line({ name: c.name, tokens: c.tokens, note: c.kind === 'deferred' ? 'loaded on demand' : undefined }, c.color))}
        </Box>
        {section('Memory files', d.memoryFiles)}
        {section('MCP servers', d.mcpServers)}
        {d.skills ? section('Skills', d.skills.top, `${d.skills.included}/${d.skills.total} listed, ${short(d.skills.tokens)} in all; largest shown`) : null}
        {section('Custom agents', d.agents)}
        {d.commands ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Slash commands</Text>
            <Text dimColor>
              {'  '}
              {d.commands.included}/{d.commands.total} listed, {short(d.commands.tokens)} tokens
            </Text>
          </Box>
        ) : null}
        {d.api ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Last API call</Text>
            <Text dimColor>
              {'  '}cache read {short(d.api.cacheRead)}  ·  cache write {short(d.api.cacheWrite)}  ·  uncached {short(d.api.uncached)}  ·  output{' '}
              {short(d.api.output)}
            </Text>
          </Box>
        ) : null}
        <Box marginTop={1}>{refreshButton}</Box>
      </Box>
    )
  })
}
