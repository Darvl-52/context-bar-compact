import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Details, Handoff, Lang, Limit, Pace, Row, Segment, Snapshot, Thresholds } from '../types'

// Session values, read and written with $.state, which Claude Code has from 2.1.281.
// On at the start of every session; /context-bar hides it for that session only.
const isOn = { plugin: 'context-bar-compact', key: 'isOn' } as const
const snapshot = { plugin: 'context-bar-compact', key: 'snapshot' } as const
// The time the band last read, bumped each minute so the reset countdowns move.
const now = { plugin: 'context-bar-compact', key: 'now' } as const
const details = { plugin: 'context-bar-compact', key: 'details' } as const
const isDetailsOpen = { plugin: 'context-bar-compact', key: 'isDetailsOpen' } as const
// The working zone in force: what /context-bar zone saved, else the defaults.
const zoneState = { plugin: 'context-bar-compact', key: 'zone' } as const
// The handoff offered above the prompt, until it is taken up, dismissed or another prompt is sent.
const offer = { plugin: 'context-bar-compact', key: 'handoff' } as const
// Set at the session's first start: a reload runs session.start again, and must not offer the
// handoff a second time.
const hasStarted = { plugin: 'context-bar-compact', key: 'hasStarted' } as const
// How the window grew over the last turns, for the turns left before compaction.
const paceState = { plugin: 'context-bar-compact', key: 'pace' } as const
// When the main loop last had a reply: the prompt cache expires counted from it.
const repliedAt = { plugin: 'context-bar-compact', key: 'repliedAt' } as const
// The language in force: what /context-bar lang saved, else English.
const langState = { plugin: 'context-bar-compact', key: 'lang' } as const

const PANE = 'context-details'
const ZONE_PANE = 'context-zone'
const ZONE_KEY = 'zone'
const LANG_KEY = 'lang'
const ZONE_STEP = 5
// The latest handoff per folder, kept in the store so a new process finds it too.
const HANDOFFS_KEY = 'handoffs'
// A handoff older than this is no longer offered.
const HANDOFF_MAX_AGE_MS = 24 * 3_600_000
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
const LIMIT_WARN_AT = 75
const LIMIT_ALERT_AT = 90
// The least room kept between the window's figures and the rate limits.
const GAP = 3
// The turns averaged for the pace, and the fewest counted before turns left are shown.
const PACE_TURNS = 5
const PACE_MIN_TURNS = 2
// Claude Code keeps the prompt cache an hour on a subscription and five minutes otherwise. A mod
// cannot read the setting, so a session with rate limits, a subscription's, is taken for the hour.
const CACHE_TTL_SUBSCRIPTION_MS = 3_600_000
const CACHE_TTL_MS = 5 * 60_000
// The categories named on the row under a yellow or red bar.
const LARGEST = 3
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
const ZONE_COLOR: Record<Zone, string> = { ok: 'success', warn: 'warning', over: 'error' }

// Russian plural: 1 ход, 2 хода, 5 ходов.
const plural = (n: number, one: string, few: string, many: string) => {
  const ten = n % 10
  const hundred = n % 100
  return ten === 1 && hundred !== 11 ? one : ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14) ? few : many
}

// Every word the mod shows. English is the default; `/context-bar lang ru` switches to Russian for
// every session. Claude Code names the window's categories in English; Russian translates the
// ones it knows and keeps the rest.
const EN = {
  units: { m: 'm', h: 'h', d: 'd' },
  compactsIn: 'compacts in',
  turns: (n: number) => (n < 1 ? '<1 turn' : `~${n} turn${n === 1 ? '' : 's'}`),
  limitLong: { five_hour: '5-hour', seven_day: 'weekly', spend_limit: 'spend' } as Record<string, string>,
  limitShort: { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' } as Record<string, string>,
  resetsIn: 'resets in',
  category: (name: string) => name,
  handoffAt: (ago?: string) => (ago === undefined ? 'just now' : `${ago} ago`),
  resume: 'resume',
  dismiss: 'dismiss',
  pastZone: (t: Thresholds) => `⚠ past the working zone (${t.warnAt}–${t.alertAt}%)`,
  largest: 'largest',
  cold: (idle: string, tokens: string) => `◌ cache cold after ${idle} idle: the next reply re-sends ${tokens} uncached`,
  toast: (percent: number, hasHandoff: boolean) =>
    `Context ${percent}%: past the working zone. ${hasHandoff ? 'Handoff or /compact' : '/compact'} from the row above the prompt.`,
  resumeText: (path: string) => `Read ${path} and pick up from there.`,
  description: 'Toggle the context bar; details: token breakdown; zone: set where it turns yellow and red; lang: en or ru',
  barOn: 'Context bar on.',
  barOff: 'Context bar off.',
  detailsOpened: 'Context details opened.',
  detailsTitle: 'Context details',
  zoneUsage: 'Usage: /context-bar zone, /context-bar zone 50 60, /context-bar zone reset',
  zoneOpened: 'Working zone opened.',
  zoneTitle: 'Working zone',
  zoneSet: (t: Thresholds) => `Working zone: yellow from ${t.warnAt}%, red from ${t.alertAt}%.`,
  langUsage: 'Usage: /context-bar lang en, /context-bar lang ru',
  langSet: 'Language: English.',
  yellowFrom: 'Yellow from',
  redFrom: 'Red from   ',
  presets: 'Presets',
  nowLabel: 'Now ',
  zoneNow: { ok: ': under the zone', warn: ': yellow', over: ': red, the warning row and a toast' } as Record<Zone, string>,
  resetTo: (t: Thresholds) => `Reset to ${t.warnAt}–${t.alertAt}`,
  savedHint: 'Saved for every session · Esc closes',
  counting: 'Counting tokens…',
  refresh: 'Refresh',
  categories: 'Categories',
  onDemand: 'loaded on demand',
  memoryFiles: 'Memory files',
  mcpServers: 'MCP servers',
  skills: 'Skills',
  customAgents: 'Custom agents',
  slashCommands: 'Slash commands',
  toolsLoaded: (loaded: number, tools: number) => `${loaded}/${tools} tools loaded`,
  skillsNote: (included: number, total: number, tokens: string) => `${included}/${total} listed, ${tokens} in all; largest shown`,
  commandsNote: (included: number, total: number, tokens: string) => `${included}/${total} listed, ${tokens} tokens`,
  lastCall: 'Last API call',
  apiLine: (read: string, write: string, uncached: string, output: string) =>
    `cache read ${read}  ·  cache write ${write}  ·  uncached ${uncached}  ·  output ${output}`,
}

const CATEGORY_RU: Record<string, string> = {
  'System prompt': 'Системный промпт',
  'System tools': 'Системные инструменты',
  'MCP tools': 'MCP-инструменты',
  'Custom agents': 'Свои агенты',
  'Memory files': 'Файлы памяти',
  Skills: 'Скиллы',
  Messages: 'Сообщения',
  'Free space': 'Свободно',
  'Autocompact buffer': 'Буфер автосжатия',
}

const RU: typeof EN = {
  units: { m: 'м', h: 'ч', d: 'д' },
  compactsIn: 'сжатие через',
  turns: n => (n < 1 ? '<1 хода' : `~${n} ${plural(n, 'ход', 'хода', 'ходов')}`),
  limitLong: { five_hour: '5 часов', seven_day: 'неделя', spend_limit: 'расход' },
  limitShort: { five_hour: '5ч', seven_day: '7д', spend_limit: 'расход' },
  resetsIn: 'сброс через',
  category: name => CATEGORY_RU[name] ?? name,
  handoffAt: ago => (ago === undefined ? 'только что' : `${ago} назад`),
  resume: 'продолжить',
  dismiss: 'убрать',
  pastZone: t => `⚠ за рабочей зоной (${t.warnAt}–${t.alertAt}%)`,
  largest: 'больше всего',
  cold: (idle, tokens) => `◌ кэш остыл, простой ${idle}: следующий ответ заново отправит ${tokens} без кэша`,
  toast: (percent, hasHandoff) =>
    `Контекст ${percent}%: за рабочей зоной. ${hasHandoff ? 'Handoff или /compact' : '/compact'} — в строке над полем ввода.`,
  resumeText: path => `Прочитай ${path} и продолжи с того места.`,
  description: 'Полоса контекста вкл/выкл; details: разбивка токенов; zone: где желтеет и краснеет; lang: en или ru',
  barOn: 'Полоса контекста включена.',
  barOff: 'Полоса контекста выключена.',
  detailsOpened: 'Детали контекста открыты.',
  detailsTitle: 'Детали контекста',
  zoneUsage: 'Как вызвать: /context-bar zone, /context-bar zone 50 60, /context-bar zone reset',
  zoneOpened: 'Рабочая зона открыта.',
  zoneTitle: 'Рабочая зона',
  zoneSet: t => `Рабочая зона: жёлтая от ${t.warnAt}%, красная от ${t.alertAt}%.`,
  langUsage: 'Как вызвать: /context-bar lang en, /context-bar lang ru',
  langSet: 'Язык: русский.',
  yellowFrom: 'Жёлтая от ',
  redFrom: 'Красная от',
  presets: 'Пресеты',
  nowLabel: 'Сейчас ',
  zoneNow: { ok: ': ниже зоны', warn: ': жёлтая', over: ': красная, строка-предупреждение и уведомление' },
  resetTo: t => `Сбросить на ${t.warnAt}–${t.alertAt}`,
  savedHint: 'Сохраняется для всех сессий · Esc закрывает',
  counting: 'Считаю токены…',
  refresh: 'Обновить',
  categories: 'Категории',
  onDemand: 'загружается по запросу',
  memoryFiles: 'Файлы памяти',
  mcpServers: 'MCP-серверы',
  skills: 'Скиллы',
  customAgents: 'Свои агенты',
  slashCommands: 'Слэш-команды',
  toolsLoaded: (loaded, tools) => `загружено ${loaded} из ${tools} инструментов`,
  skillsNote: (included, total, tokens) => `${included} из ${total} в списке, ${tokens} всего; показаны крупнейшие`,
  commandsNote: (included, total, tokens) => `${included} из ${total} в списке, ${tokens} токенов`,
  lastCall: 'Последний вызов API',
  apiLine: (read, write, uncached, output) => `чтение кэша ${read}  ·  запись в кэш ${write}  ·  без кэша ${uncached}  ·  ответ ${output}`,
}

export type Words = typeof EN
export const WORDS: Record<Lang, Words> = { en: EN, ru: RU }

// Matt Pocock's handoff skill, when its plugin is installed: the command's name as typed.
export const findHandoff = (commands: readonly { name: string; plugin?: string }[]) =>
  commands.find(c => c.plugin === 'mattpocock-skills' && /(^|:)handoff$/.test(c.name))?.name ??
  commands.find(c => /(^|:)handoff$/.test(c.name))?.name

export const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

// The band's figures: whole thousands from 10k up, so the line stays short.
export const tiny = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : short(n)

export const span = (ms: number, w: Words = EN) => {
  const { m: mu, h: hu, d: du } = w.units
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}${mu}`
  const hours = Math.floor(m / 60)
  if (hours < 24) return `${hours}${hu}${m % 60}${mu}`
  return `${Math.floor(hours / 24)}${du}${hours % 24}${hu}`
}

// The pace after a turn ends at `total` tokens. A smaller window than the last turn's (a compact,
// a /clear) starts it over; a turn that added nothing is not counted.
export const nextPace = (pace: Pace | null, total: number): Pace => {
  if (pace === null || total < pace.lastTotal) return { lastTotal: total, deltas: [] }
  const grew = total - pace.lastTotal
  return { lastTotal: total, deltas: grew > 0 ? [...pace.deltas, grew].slice(-PACE_TURNS) : pace.deltas }
}

// Whole turns at the recent pace before `compactIn` runs out; unknown until the pace has a few.
export const turnsLeft = (compactIn: number, pace: Pace | null) => {
  if (pace === null || pace.deltas.length < PACE_MIN_TURNS) return undefined
  return Math.floor(compactIn / (pace.deltas.reduce((a, b) => a + b, 0) / pace.deltas.length))
}

// The figures beside the bar, all about this session's window: its size, then room before
// auto-compaction, and how many turns that room lasts at the recent pace.
export const contextLine = (snap: Snapshot, turns?: number, w: Words = EN) =>
  ` ${tiny(snap.total)}/${tiny(snap.max)}` +
  (snap.compactIn !== undefined ? ` · ${w.compactsIn} ${tiny(snap.compactIn)}${turns !== undefined ? ` (${w.turns(turns)})` : ''}` : '')

// What fills the window most, for the row under a yellow or red bar.
export const largest = (segments: readonly Segment[]) =>
  segments
    .filter(s => s.kind === 'used')
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, LARGEST)

export const cacheTtlOf = (limits: readonly Limit[]) => (limits.length > 0 ? CACHE_TTL_SUBSCRIPTION_MS : CACHE_TTL_MS)

export type LimitPart = { label: string; percent: number; reset: string }
// The account's rate limits, drawn apart from the window at the right end. Spelled out
// (`5-hour`, `resets in`) where the line has room, in the short form (`5h`, `↻`) where it has not.
export const limitParts = (limits: readonly Limit[], at: number, isShort: boolean, w: Words = EN): LimitPart[] =>
  limits.map(l => {
    const label = (isShort ? w.limitShort : w.limitLong)[l.kind] ?? l.kind
    const left = l.resetsAt !== undefined && l.resetsAt > at ? span(l.resetsAt - at, w) : undefined
    return { label, percent: l.percentUsed, reset: left === undefined ? '' : isShort ? ` ↻${left}` : ` ${w.resetsIn} ${left}` }
  })

export const limitsText = (parts: readonly LimitPart[]) => parts.map(p => `${p.label} ${p.percent}%${p.reset}`).join(' · ')

// A rate limit reads green while there is room, yellow as it runs short, red near the end.
export const limitColor = (percent: number) => (percent >= LIMIT_ALERT_AT ? 'error' : percent >= LIMIT_WARN_AT ? 'warning' : 'success')

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

// The handoff skill names its file freely; a Markdown file written while it runs, or one in a
// temporary directory with `handoff` in its name, is taken for one.
export const isHandoffFile = (path: string, isRunning: boolean) =>
  /\.md$/i.test(path) && (isRunning || (/handoff/i.test(path.split(/[\\/]/).pop() ?? '') && /([\\/](T|tmp|Temp)[\\/])/i.test(path)))

// The document's first heading, without a leading `Handoff:`; else the file's name.
export const handoffTitle = (content: string, path: string) => {
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim()
  const title = heading?.replace(/^handoff\s*[:—–-]\s*/i, '').trim()
  return title || (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, '')
}

export const resumeText = (path: string, w: Words = EN) => w.resumeText(path)

// The language and zone in force, kept by the module too: a /clear empties $.state and the module
// lives on, so a read falls back here until the values are set again.
const kept: { lang: Lang; zone: Thresholds } = { lang: 'en', zone: DEFAULT_THRESHOLDS }

const wordsIn = async ($: EngineInterface) => WORDS[(await $.state.get(langState)).value ?? kept.lang]

let lastFetch = 0
let isFetching = false
let isFetchingDetails = false
let tick: { cancel: () => void } | undefined
let handoff: string | undefined
// Raised once past the zone; lowered when the window drops back under its start, after a compact.
let hasAlerted = false
// True from a /handoff until its turn completes: the Markdown file written meanwhile is the handoff.
let isHandingOff = false

async function refresh($: EngineInterface, force = false) {
  const at = await $.clock.now()
  if (isFetching || (!force && at - lastFetch < REFRESH_MS)) return
  if (!((await $.state.get(isOn)).value ?? true)) return
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
    await $.state.set(now, at)
    await $.state.set(snapshot, next)
    const zone = zoneOf(next.percent, (await $.state.get(zoneState)).value ?? kept.zone)
    if (zone === 'over' && !hasAlerted) {
      hasAlerted = true
      $.ui.toast((await wordsIn($)).toast(next.percent, handoff !== undefined))
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
    const w = await wordsIn($)
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
        .map(([name, s]) => ({ name, tokens: s.tokens, note: w.toolsLoaded(s.loaded, s.tools) }))
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
    await $.state.set(details, next)
  } finally {
    isFetchingDetails = false
  }
}

// After a turn of the main loop: a fresh read, the window's growth for the pace, and, when the
// model answered, the time the prompt cache counts from.
async function afterTurn($: EngineInterface, hasReplied: boolean) {
  await refresh($, true)
  const snap = (await $.state.get(snapshot)).value ?? null
  if (snap) await $.state.set(paceState, nextPace((await $.state.get(paceState)).value ?? null, snap.total))
  if (hasReplied) await $.state.set(repliedAt, await $.clock.now())
}

async function openDetails($: EngineInterface) {
  await $.state.set(isDetailsOpen, true)
  await $.ui.open({ id: PANE, title: (await wordsIn($)).detailsTitle })
  await refreshDetails($).catch(() => {})
}

async function setZone($: EngineInterface, t: Thresholds | 'reset') {
  const next = t === 'reset' ? DEFAULT_THRESHOLDS : t
  kept.zone = next
  await $.state.set(zoneState, next)
  if (t === 'reset') await $.store.delete(ZONE_KEY)
  else await $.store.set(ZONE_KEY, next)
  // The toast is armed again for the new zone.
  hasAlerted = false
}

const savedHandoffs = async ($: EngineInterface) =>
  ((await $.store.get(HANDOFFS_KEY).catch(() => undefined)) as Record<string, Handoff> | undefined) ?? {}

// What a fresh start in this folder is offered: its latest handoff, if recent and still on disk.
// The prompt box shows the request to read it as its dim suggestion, Tab to take.
async function offerHandoff($: EngineInterface, cwd: string) {
  const saved = (await savedHandoffs($))[cwd]
  const at = await $.clock.now()
  const isLive = saved !== undefined && at - saved.at < HANDOFF_MAX_AGE_MS && (await $.fs.exists(saved.path).catch(() => false))
  await $.state.set(offer, isLive ? saved : null)
  if (isLive) {
    const text = resumeText(saved.path, await wordsIn($))
    void $.clock.sleep(300).then(() => $.prompt.suggest({ text })).catch(() => {})
  }
}

async function forgetHandoff($: EngineInterface, spent: Handoff) {
  const all = await savedHandoffs($)
  if (all[spent.cwd]?.path === spent.path) {
    delete all[spent.cwd]
    await $.store.set(HANDOFFS_KEY, all)
  }
  await $.state.set(offer, null)
}

// What the session starts from, read again from the store: the language and the zone. Run at the
// start and after a /clear, which empties $.state and fires no session.start.
async function restore($: EngineInterface) {
  const lang = await $.store.get(LANG_KEY).catch(() => undefined)
  kept.lang = lang === 'ru' ? 'ru' : 'en'
  await $.state.set(langState, kept.lang)
  const saved = (await $.store.get(ZONE_KEY).catch(() => undefined)) as Partial<Thresholds> | undefined
  kept.zone = saved ? thresholdsOf(saved.warnAt, saved.alertAt) : DEFAULT_THRESHOLDS
  await $.state.set(zoneState, kept.zone)
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await restore($)
    await $.command.register({
      name: 'context-bar',
      description: (await wordsIn($)).description,
      argumentHint: '[details | zone [<yellow%> <red%> | reset] | lang en|ru]',
    })
    // Only a session that draws the band needs the minute ticker; a reload drops
    // the old module's timers, and the cancel covers session.start firing twice in one load.
    tick?.cancel()
    if (e.isInteractive)
      tick = $.clock.every(TICK_MS, () => {
        void $.clock.now().then(at => $.state.set(now, at))
      })
    handoff = findHandoff(await $.command.list().catch(() => []))
    // Draw the bar as soon as the session opens; never let a failed read block startup.
    await refresh($, true).catch(() => {})
    const isReload = (await $.state.get(hasStarted)).value ?? false
    await $.state.set(hasStarted, true)
    const root = await $.session.root().catch(() => undefined)
    if (e.isInteractive && !isReload && root !== undefined) await offerHandoff($, root).catch(() => {})
    return next(e)
  })

  // A /clear (a /resume, a compaction) starts no session.start, and a /clear or /resume empties
  // $.state: what the session started from is read again, and after a /clear the conversation
  // that follows is offered the handoff just written.
  on('classic.SessionStart', async ($, e, next) => {
    const ran = await next(e)
    if (e.source === 'startup') return ran
    await restore($)
    await $.state.set(hasStarted, true)
    if (e.source === 'clear') {
      // A new conversation: no pace yet, and no cache of its own to lose.
      await $.state.set(paceState, null)
      await $.state.set(repliedAt, 0)
      const root = await $.session.root().catch(() => undefined)
      if (root !== undefined) await offerHandoff($, root).catch(() => {})
    }
    await refresh($, true).catch(() => {})
    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.command && /(^|:)handoff$/.test(e.command.name)) isHandingOff = true
    const waiting = (await $.state.get(offer)).value ?? null
    // Taken up, it is spent; any other prompt only puts it away for this conversation.
    if (waiting && !e.isMeta) {
      if (e.text.includes(waiting.path)) await forgetHandoff($, waiting)
      else await $.state.set(offer, null)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && isHandoffFile(e.file_path, isHandingOff)) {
      // The project root, not the shell's directory: a `cd` during the session would file the
      // handoff under a folder the next session never starts in.
      const cwd = await $.session.root()
      const written: Handoff = { path: e.file_path, cwd, at: await $.clock.now(), title: handoffTitle(e.content, e.file_path) }
      await $.store.set(HANDOFFS_KEY, { ...(await savedHandoffs($)), [cwd]: written })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const w = await wordsIn($)
    if (verb.toLowerCase() === 'details') {
      await openDetails($)
      return { text: w.detailsOpened }
    }
    if (verb.toLowerCase() === 'zone') {
      const asked = parseZone(rest.join(' '))
      if (asked === undefined) return { text: w.zoneUsage }
      if (asked === 'open') {
        await $.ui.open({ id: ZONE_PANE, title: w.zoneTitle, focus: true, closeOnEscape: true })
        return { text: w.zoneOpened }
      }
      await setZone($, asked)
      return { text: w.zoneSet((await $.state.get(zoneState)).value ?? kept.zone) }
    }
    if (verb.toLowerCase() === 'lang') {
      const asked = rest[0]?.toLowerCase()
      if (asked !== 'en' && asked !== 'ru') return { text: w.langUsage }
      kept.lang = asked
      await $.state.set(langState, asked)
      await $.store.set(LANG_KEY, asked)
      // The breakdown's notes are worded when read: read it again in the new language.
      if ((await $.state.get(isDetailsOpen)).value ?? false) void refreshDetails($).catch(() => {})
      return { text: WORDS[asked].langSet }
    }
    const nextOn = !((await $.state.get(isOn)).value ?? true)
    await $.state.set(isOn, nextOn)
    if (nextOn) await refresh($, true)
    return { text: nextOn ? w.barOn : w.barOff }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set(isDetailsOpen, false)
    return next(e)
  })

  on('session.measure', ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turns fill its own window, not this one.
    if (e.agentId !== undefined) return next(e)
    isHandingOff = false
    void afterTurn($, e.usage !== undefined).catch(() => {})
    if ((await $.state.get(isDetailsOpen)).value ?? false) void refreshDetails($).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const waiting = (await $.state.get(offer)).value ?? null
    const snap = ((await $.state.get(isOn)).value ?? true) ? ((await $.state.get(snapshot)).value ?? null) : null
    const hasBar = snap !== null && snap.segments.length > 0
    if (!hasBar && !waiting) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const w = await wordsIn($)
    const at = (await $.state.get(now)).value ?? 0
    // The buttons put the command in the prompt box rather than run it: a handoff wants to be
    // told what the next session is for, and either can still be thought better of.
    const fill = (text: string) => void $.prompt.fill({ text }).catch(() => {})
    // A handoff left by an earlier conversation in this folder, to pick up from; shown whether
    // or not the bar is on.
    const resume = waiting ? (
      <Box flexDirection="row" gap={1}>
        <Box flexShrink={1}>
          <Text wrap="truncate" color="suggestion" bold>
            ↩ handoff {w.handoffAt(at - waiting.at < 60_000 ? undefined : span(at - waiting.at, w))}: {waiting.title}
          </Text>
        </Box>
        <Button key="resume" label={w.resume} hotkey="r" plain onPress={() => fill(resumeText(waiting.path, w))} />
        <Button key="dismiss" label={w.dismiss} hotkey="x" plain dimColor onPress={() => void forgetHandoff($, waiting)} />
      </Box>
    ) : null
    if (!hasBar)
      return (
        <Box flexDirection="column">
          {resume}
          {await next(e)}
        </Box>
      )

    const thresholds = (await $.state.get(zoneState)).value ?? kept.zone
    const zone = zoneOf(snap.percent, thresholds)
    const figure = ` ${snap.percent}%`
    const pace = (await $.state.get(paceState)).value ?? null
    const context = contextLine(snap, snap.compactIn !== undefined ? turnsLeft(snap.compactIn, pace) : undefined, w)
    // The widest layout that fits: the long labels beside a full bar, else the short labels and
    // a bar narrowed to the room left; past that the line is cut at its end.
    const roomFor = (isShort: boolean) => {
      const right = limitsText(limitParts(snap.limits, at, isShort, w)).length
      return e.props.bodyColumns - figure.length - context.length - (right > 0 ? GAP + right : 0)
    }
    const isShort = roomFor(false) < BAR_CELLS
    const width = isShort ? Math.max(8, Math.min(BAR_CELLS, roomFor(true))) : BAR_CELLS
    const cells = allocate(snap.segments, snap.max, width)
    const limits = limitParts(snap.limits, at, isShort, w)
    const left = (
      <Text wrap="truncate">
        {snap.segments.map((s, i) =>
          cells[i]! > 0 ? (
            <Text color={s.color} dimColor={s.kind === 'free'}>
              {GLYPH[s.kind].repeat(cells[i]!)}
            </Text>
          ) : null,
        )}
        <Text color={ZONE_COLOR[zone]} bold={zone === 'over'}>
          {figure}
        </Text>
        <Text dimColor>{context}</Text>
      </Text>
    )
    const right =
      limits.length === 0 ? null : (
        <Text wrap="truncate">
          {limits.map((l, i) => (
            <Text>
              <Text dimColor>{`${i > 0 ? ' · ' : ''}${l.label} `}</Text>
              <Text color={limitColor(l.percent)} bold={l.percent >= LIMIT_ALERT_AT}>
                {l.percent}%
              </Text>
              <Text dimColor>{l.reset}</Text>
            </Text>
          ))}
        </Text>
      )
    // The window on the left, the account's limits pinned to the right end.
    const bar = (
      <Box flexDirection="row" justifyContent="space-between" gap={GAP}>
        {left}
        {right}
      </Box>
    )
    // Past the zone: what to do about it.
    const over =
      zone === 'over' ? (
        <Box flexDirection="row" gap={1}>
          <Text color="error">{w.pastZone(thresholds)}</Text>
          {handoff ? <Button key="handoff" label="handoff" hotkey="h" plain onPress={() => fill(`/${handoff} `)} /> : null}
          <Button key="compact" label="/compact" hotkey="c" plain onPress={() => fill('/compact ')} />
        </Box>
      ) : null
    // Yellow or red: what fills the window, in the bar's colours, so the cure is plain.
    const top =
      zone === 'ok' ? null : (
        <Text wrap="truncate">
          <Text dimColor>{w.largest} </Text>
          {largest(snap.segments).map((s, i) => (
            <Text>
              {i > 0 ? <Text dimColor> · </Text> : null}
              <Text color={s.color}>■</Text> {w.category(s.name)} <Text color={ZONE_COLOR[zone]}>{tiny(s.tokens)}</Text>
            </Text>
          ))}
        </Text>
      )
    // Idle past the prompt cache's life: the next reply sends the whole window again uncached, and
    // a handoff into a fresh conversation may cost less.
    const replied = (await $.state.get(repliedAt)).value ?? 0
    const cold =
      replied > 0 && at - replied >= cacheTtlOf(snap.limits) ? (
        <Box flexDirection="row" gap={1}>
          <Box flexShrink={1}>
            <Text wrap="truncate" color="warning">
              {w.cold(span(at - replied, w), tiny(snap.total))}
            </Text>
          </Box>
          {handoff && !over ? <Button key="cold-handoff" label="handoff" hotkey="h" plain onPress={() => fill(`/${handoff} `)} /> : null}
        </Box>
      ) : null
    // The band is shared: what the plugins beneath draw there stays, under the bar.
    const below = await next(e)
    const rows = [over, top, cold].filter(r => r !== null).slice(0, Math.max(0, e.props.maxRows - 1))
    return (
      <Box flexDirection="column">
        {bar}
        {rows}
        {resume}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: ZONE_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const w = await wordsIn($)
    const t = (await $.state.get(zoneState)).value ?? kept.zone
    const snap = (await $.state.get(snapshot)).value ?? null
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
        {step('warnAt', w.yellowFrom, 'warning')}
        {step('alertAt', w.redFrom, 'error')}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text dimColor>{w.presets}</Text>
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
            <Text dimColor>{w.nowLabel}</Text>
            <Text color={ZONE_COLOR[zone]} bold>
              {snap.percent}%
            </Text>
            <Text dimColor>{w.zoneNow[zone]}</Text>
          </Text>
        ) : null}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="reset" label={w.resetTo(DEFAULT_THRESHOLDS)} hotkey="r" dimColor onPress={() => void setZone($, 'reset')} />
          <Text dimColor>{w.savedHint}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const w = await wordsIn($)
    const d = (await $.state.get(details)).value ?? null
    const refreshButton = <Button key="refresh" label={w.refresh} hotkey="r" dimColor onPress={() => refreshDetails($).catch(() => {})} />
    if (!d)
      return (
        <Box flexDirection="column">
          <Text dimColor>{w.counting}</Text>
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
          <Text bold>{w.categories}</Text>
          {d.categories.map(c => line({ name: w.category(c.name), tokens: c.tokens, note: c.kind === 'deferred' ? w.onDemand : undefined }, c.color))}
        </Box>
        {section(w.memoryFiles, d.memoryFiles)}
        {section(w.mcpServers, d.mcpServers)}
        {d.skills ? section(w.skills, d.skills.top, w.skillsNote(d.skills.included, d.skills.total, short(d.skills.tokens))) : null}
        {section(w.customAgents, d.agents)}
        {d.commands ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{w.slashCommands}</Text>
            <Text dimColor>
              {'  '}
              {w.commandsNote(d.commands.included, d.commands.total, short(d.commands.tokens))}
            </Text>
          </Box>
        ) : null}
        {d.api ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{w.lastCall}</Text>
            <Text dimColor>
              {'  '}
              {w.apiLine(short(d.api.cacheRead), short(d.api.cacheWrite), short(d.api.uncached), short(d.api.output))}
            </Text>
          </Box>
        ) : null}
        <Box marginTop={1}>{refreshButton}</Box>
      </Box>
    )
  })
}
