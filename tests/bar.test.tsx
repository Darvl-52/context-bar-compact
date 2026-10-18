import { expect, mock, test } from 'claude-code/testing'
import type { ContextCategory, SessionUsage } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

import { allocate, findHandoff, handoffTitle, isHandoffFile, limitColor, nudge, resumeText, parseZone, thresholdsOf, zoneOf } from '../hooks/register'

const row = (name: string, tokens: number, color: string, kind: ContextCategory['kind']): ContextCategory => ({
  name,
  tokens,
  color,
  kind,
  isDeferred: kind === 'deferred',
})

const USAGE: SessionUsage = {
  startedAt: 0,
  rateLimits: [],
  context: {
    tokens: 60_000,
    window: 200_000,
    percent: 30,
    breakdown: {
      categories: [
        row('System prompt', 4_000, 'promptBorder', 'used'),
        row('Messages', 56_000, 'permission', 'used'),
        row('MCP tools', 9_000, 'suggestion', 'deferred'),
        row('Free space', 107_000, 'inactive', 'free'),
        row('Autocompact buffer', 33_000, 'warning', 'buffer'),
      ],
      totalTokens: 60_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'model-default',
      percentage: 30,
      gridRows: [],
      model: 'test',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
}

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}

test('allocate fills the width exactly and keeps small categories visible', () => {
  const segs = [
    { name: 'a', color: 'x', tokens: 100, kind: 'used' as const },
    { name: 'b', color: 'x', tokens: 50_000, kind: 'used' as const },
    { name: 'free', color: 'x', tokens: 149_900, kind: 'free' as const },
  ]
  const cells = allocate(segs, 200_000, 60)
  expect(cells.reduce((a, b) => a + b, 0)).toBe(60)
  expect(cells[0]).toBe(1)
})

test('is on by default in a new session', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'context-bar' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /30%/ })).toBeDefined()
  await ui.unmount()
})

test('draws the bar, toggles off and on with /context-bar', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: USAGE }))
  // Stands in for the engine's own band when the mod passes.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  const toggle = () =>
    $.command.run({ command: 'context-bar', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    // Off then on forces a fresh breakdown read.
    expect((await toggle()).text).toBe('Context bar off.')
    let ui = await $.ui.mount({ plugin: 'context-bar-compact', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /30%/ })).toBeUndefined()
    await ui.unmount()

    expect((await toggle()).text).toBe('Context bar on.')
    ui = await $.ui.mount({ plugin: 'context-bar-compact', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /30% 60k\/200k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Messages/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /MCP tools/ })).toBeUndefined()
    await ui.unmount()
  }
})

const HOUR = 3_600_000
// Two hours into a session, with both rate-limit windows read and compaction on at 160k.
const RICH: SessionUsage = {
  ...USAGE,
  startedAt: 1_000,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(1_000 + 2 * HOUR + 2 * HOUR + 14 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 18 },
  ],
  context: {
    ...USAGE.context,
    breakdown: {
      ...USAGE.context.breakdown!,
      autoCompactThreshold: 160_000,
      memoryFiles: [
        { path: 'C:\\Users\\me\\.claude\\CLAUDE.md', type: 'User', tokens: 1_200 },
        { path: 'C:\\proj\\.claude\\CLAUDE.md', type: 'Project', tokens: 3_400 },
      ],
      mcpTools: [
        { name: 'mcp__gmail__send', serverName: 'gmail', tokens: 700, isLoaded: true },
        { name: 'mcp__gmail__read', serverName: 'gmail', tokens: 500, isLoaded: false },
      ],
      apiUsage: { input_tokens: 10, output_tokens: 900, cache_read_input_tokens: 55_000, cache_creation_input_tokens: 4_000 },
    },
  },
}

test('the one line shows rate limits and room before compaction', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 + 2 * HOUR })
  on('session.usage', () => ({ value: RICH }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('command.register', () => ({ value: { command: 'context-bar' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })

  // 80 columns hold the short labels only.
  let ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /30% 60k\/200k · compacts in 100k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h 42% ↻2h14m · 7d 18%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session/ })).toBeUndefined()
  await ui.unmount()

  // A wide terminal spells them out, apart from the window's figures.
  ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 140 } })
  expect(await ui.find({ type: 'Text', text: /^5-hour 42% resets in 2h14m · weekly 18%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▒ 30% 60k\/200k · compacts in 100k$/ })).toBeDefined()
  await ui.unmount()

  // The minute ticker moves the reset countdown without a new usage read.
  await clock.advance(5 * 60_000)
  ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /↻2h9m/ })).toBeDefined()
  await ui.unmount()

  // A single row is enough for everything.
  ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND, props: { ...BAND.props, maxRows: 1 } })
  expect(await ui.find({ type: 'Text', text: /compacts in/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /30%/ })).toBeDefined()
  await ui.unmount()
})

test('a rate limit reads green with room, yellow from 75%, red from 90%', () => {
  expect(limitColor(42)).toBe('success')
  expect(limitColor(75)).toBe('warning')
  expect(limitColor(90)).toBe('error')
})

test('no limits or compaction off a subscription with compaction off', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: USAGE }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('command.register', () => ({ value: { command: 'context-bar' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /5h|5-hour|compacts in|session/ })).toBeUndefined()
  await ui.unmount()
})

test('/context-bar details opens the breakdown pane without toggling the bar', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: RICH }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  const run = (args: string) =>
    $.command.run({ command: 'context-bar', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  expect((await run(' details ')).text).toBe('Context details opened.')
  expect(opened).toEqual(['context-details'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'context-bar-compact',
      surface,
      component: 'Pane',
      requestId: 'context-details',
      props: { title: 'Context details', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: /…\/\.claude\/CLAUDE\.md/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /3\.4k/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /gmail/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /1\/2 tools loaded/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /cache read 55\.0k/ })).toBeDefined()
    await pane.unmount()
  }

  // The bar is still on: the next plain toggle turns it off.
  expect((await run('')).text).toBe('Context bar off.')
})

// The same window at a given fill, for the working-zone tests.
const at = (percent: number): SessionUsage => ({
  ...USAGE,
  context: {
    ...USAGE.context,
    percent,
    breakdown: { ...USAGE.context.breakdown!, percentage: percent, totalTokens: percent * 2_000 },
  },
})

test('the working zone: plain under 50%, a warning from 50%, past it from 60%', () => {
  expect([49, 50, 59, 60, 95].map(p => zoneOf(p))).toEqual(['ok', 'warn', 'warn', 'over', 'over'])
})

test('the handoff command is found by name, Matt Pocock\'s first', () => {
  expect(findHandoff([{ name: 'review' }, { name: 'mattpocock-skills:handoff', plugin: 'mattpocock-skills' }])).toBe('mattpocock-skills:handoff')
  expect(findHandoff([{ name: 'other:handoff', plugin: 'other' }, { name: 'mattpocock-skills:handoff', plugin: 'mattpocock-skills' }])).toBe(
    'mattpocock-skills:handoff',
  )
  expect(findHandoff([{ name: 'handoff' }])).toBe('handoff')
  expect(findHandoff([{ name: 'handoffs' }, { name: 'compact' }])).toBeUndefined()
})

const zoneSession = async (
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  commands: { name: string; plugin?: string }[],
  stored: Record<string, unknown> = {},
) => {
  let usage = at(62)
  const toasts: string[] = []
  const fills: string[] = []
  const clock = mock.clock(on)
  mock.store(on, stored)
  on('session.usage', () => ({ value: usage }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('command.list', () => ({ value: commands.map(c => ({ ...c, description: '', source: 'plugin' as const })) }))
  on('command.register', () => ({ value: { command: 'context-bar' } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })
  // A fresh read, as after a turn: /context-bar off and on again forces one.
  const toggle = () =>
    $.command.run({ command: 'context-bar', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const turn = async (next: SessionUsage) => {
    usage = next
    await toggle()
    await toggle()
    await clock.advance(10)
  }
  return { toasts, fills, turn }
}

test('past 60% the band offers a handoff and /compact, and a toast says so once', async ($, on) => {
  const { toasts, fills, turn } = await zoneSession($, on, [{ name: 'mattpocock-skills:handoff', plugin: 'mattpocock-skills' }])
  const ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /past the working zone \(50–60%\)/ })).toBeDefined()
  await ui.press({ key: 'handoff' })
  await ui.press({ key: 'compact' })
  expect(fills).toEqual(['/mattpocock-skills:handoff ', '/compact '])
  await ui.unmount()

  // Still past it: no second toast. Back under 50% after a compact, then past again: one more.
  await turn(at(70))
  await turn(at(20))
  await turn(at(65))
  expect(toasts).toHaveLength(2)
  expect(toasts[0]).toMatch(/^Context 62%: past the working zone\. Handoff or \/compact/)
})

test('without the handoff skill only /compact is offered', async ($, on) => {
  await zoneSession($, on, [])
  const ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'handoff' })).toBeUndefined()
  expect(await ui.find({ key: 'compact' })).toBeDefined()
  await ui.unmount()
})

test('under 60% there is no warning row', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: at(55) }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('command.list', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'context-bar' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /55%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /working zone/ })).toBeUndefined()
  await ui.unmount()
})

test('a zone is read in order, nudged without crossing, and parsed from the command', () => {
  expect(thresholdsOf(undefined, undefined)).toEqual({ warnAt: 50, alertAt: 60 })
  expect(thresholdsOf(40, 70)).toEqual({ warnAt: 40, alertAt: 70 })
  expect(thresholdsOf(80, 70)).toEqual({ warnAt: 70, alertAt: 80 })
  expect(thresholdsOf(0, 'x')).toEqual({ warnAt: 50, alertAt: 60 })
  expect(zoneOf(65, { warnAt: 40, alertAt: 70 })).toBe('warn')

  expect(nudge({ warnAt: 50, alertAt: 60 }, 'warnAt', 5)).toEqual({ warnAt: 55, alertAt: 60 })
  expect(nudge({ warnAt: 55, alertAt: 60 }, 'warnAt', 10)).toEqual({ warnAt: 65, alertAt: 65 })
  expect(nudge({ warnAt: 50, alertAt: 60 }, 'alertAt', -15)).toEqual({ warnAt: 45, alertAt: 45 })
  expect(nudge({ warnAt: 98, alertAt: 98 }, 'alertAt', 5)).toEqual({ warnAt: 98, alertAt: 100 })

  expect(parseZone('')).toBe('open')
  expect(parseZone('reset')).toBe('reset')
  expect(parseZone('40 70')).toEqual({ warnAt: 40, alertAt: 70 })
  expect(parseZone('40% 70%')).toEqual({ warnAt: 40, alertAt: 70 })
  expect(parseZone('70 40')).toEqual({ warnAt: 40, alertAt: 70 })
  expect(parseZone('40')).toBeUndefined()
  expect(parseZone('0 200')).toBeUndefined()
})

const runZone = ($: Parameters<TestBody>[0], args: string) =>
  $.command.run({ command: 'context-bar', args: `zone ${args}`.trim(), origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

test('/context-bar zone 40 70: 65% warns but offers nothing yet, and 72% does', async ($, on) => {
  const { turn } = await zoneSession($, on, [])
  expect((await runZone($, '40 70')).text).toBe('Working zone: yellow from 40%, red from 70%.')
  await turn(at(65))
  let ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /working zone/ })).toBeUndefined()
  await ui.unmount()
  await turn(at(72))
  ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /past the working zone \(40–70%\)/ })).toBeDefined()
  await ui.unmount()
  expect((await runZone($, 'nonsense')).text).toMatch(/^Usage:/)
})

test('a zone saved in an earlier session is the one in force', async ($, on) => {
  await zoneSession($, on, [], { zone: { warnAt: 70, alertAt: 80 } })
  // 62% is under a 70–80 zone: no warning row.
  const ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /working zone/ })).toBeUndefined()
  await ui.unmount()
})

test('the zone pane: presets, −/+ and reset, each shown at once', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await zoneSession($, on, [])
  expect((await runZone($, '')).text).toBe('Working zone opened.')
  const pane = await $.ui.mount({
    plugin: 'context-bar-compact',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'context-zone',
    props: { title: 'Working zone', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(await pane.find({ type: 'Text', text: /62%: red/ })).toBeDefined()

  await pane.press({ key: 'preset-3' })
  expect(await pane.find({ type: 'Text', text: /62%: yellow/ })).toBeDefined()
  await pane.press({ key: 'warnAt-up' })
  expect(await pane.find({ type: 'Text', text: /65%/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /62%: under the zone/ })).toBeDefined()

  await pane.press({ key: 'reset' })
  expect(await pane.find({ type: 'Text', text: /62%: red/ })).toBeDefined()
  await pane.unmount()
})

test('the band is shared: what is drawn beneath stays under the bar', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: at(30) }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('command.list', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'context-bar' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /30%/ })).toBeDefined()
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('a handoff file is a Markdown file the handoff skill writes, or one named so in a temp dir', () => {
  expect(isHandoffFile('/var/folders/4f/x/T/handoff-claude-mods.md', false)).toBe(true)
  expect(isHandoffFile('C:\\Users\\me\\AppData\\Local\\Temp\\Handoff.md', false)).toBe(true)
  expect(isHandoffFile('/var/folders/4f/x/T/notes-for-next.md', false)).toBe(false)
  expect(isHandoffFile('/var/folders/4f/x/T/notes-for-next.md', true)).toBe(true)
  expect(isHandoffFile('/proj/docs/handoff.md', false)).toBe(false)
  expect(isHandoffFile('/tmp/handoff.txt', true)).toBe(false)
  expect(handoffTitle('Intro\n# Handoff: моды Claude Code\n\n## Next', '/tmp/a.md')).toBe('моды Claude Code')
  expect(handoffTitle('no heading', '/tmp/pyrus-handoff.md')).toBe('pyrus-handoff')
})

const PATH = '/var/folders/4f/x/T/handoff-claude-mods.md'
const handoffSession = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], stored: Record<string, unknown> = {}) => {
  const fills: string[] = []
  const suggestions: string[] = []
  // The plugin's store, kept here so a test reads what it wrote.
  const store = new Map(Object.entries(stored))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: 10 * HOUR })
  on('session.usage', () => ({ value: USAGE }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('command.register', () => ({ value: { command: 'context-bar' } }))
  // The shell has wandered into a subfolder; the project root stays where the session began.
  on('session.cwd', () => ({ value: '/proj/sub' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.exists', () => ({ value: true }))
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('prompt.suggest', ($, e) => {
    suggestions.push(e.text)
    return { isShown: true }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', ($, e) =>
    e.tool === 'Write'
      ? { result: { type: 'create' as const, filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }
      : { deny: 'unexpected' },
  )
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const send = (text: string, command?: { name: string; args: string }) =>
    $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...(command ? { command } : {}) })
  return { fills, suggestions, store, clock, send }
}

test('after /clear the handoff just written is offered: a row, a suggestion, resume fills it in', async ($, on) => {
  const { fills, suggestions, store, clock, send } = await handoffSession($, on)
  let ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /handoff/ })).toBeUndefined()
  await ui.unmount()

  // The skill names its file as it likes: what /handoff writes is the handoff.
  const NOTES = '/var/folders/4f/x/T/claude-mods-next.md'
  await send('/mattpocock-skills:handoff моды', { name: 'mattpocock-skills:handoff', args: 'моды' })
  await $.tool.call({ tool: 'Write', file_path: NOTES, content: '# Handoff: моды Claude Code\n' })
  // Filed under the project root, where the next session starts, not where the shell had wandered.
  expect(Object.keys(store.get('handoffs') as object)).toEqual(['/proj'])
  await clock.advance(5 * 60_000)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as Parameters<typeof $.session.end>[0])
  await clock.advance(1_000)
  expect(suggestions).toEqual([resumeText(NOTES)])

  ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /^↩ handoff 5m ago: моды Claude Code$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /30% 60k\/200k/ })).toBeDefined()
  await ui.press({ key: 'resume' })
  expect(fills).toEqual([resumeText(NOTES)])
  await ui.unmount()

  // Sent, it is spent: gone from the band and from the store.
  await send(resumeText(NOTES))
  ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /↩ handoff/ })).toBeUndefined()
  await ui.unmount()
  expect(store.get('handoffs')).toEqual({})
})

test('a new session in the folder is offered its handoff; another folder, a stale one or a dismissed one is not', async ($, on) => {
  const h = { path: PATH, cwd: '/proj', at: 10 * HOUR - 2 * HOUR, title: 'моды' }
  const { store } = await handoffSession($, on, { handoffs: { '/proj': h, '/old': { ...h, cwd: '/old', at: 10 * HOUR - 25 * HOUR } } })
  let ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /^↩ handoff 2h0m ago: моды$/ })).toBeDefined()
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ type: 'Text', text: /↩ handoff/ })).toBeUndefined()
  await ui.unmount()
  expect(Object.keys(store.get('handoffs') as object)).toEqual(['/old'])
})

test('a handoff older than a day is not offered', async ($, on) => {
  const h = { path: PATH, cwd: '/proj', at: 10 * HOUR - 25 * HOUR, title: 'моды' }
  const { suggestions } = await handoffSession($, on, { handoffs: { '/proj': h } })
  const ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /↩ handoff/ })).toBeUndefined()
  await ui.unmount()
  expect(suggestions).toEqual([])
})

test('a reload of the mod does not offer the handoff again', async ($, on) => {
  const h = { path: PATH, cwd: '/proj', at: 10 * HOUR, title: 'моды' }
  const { suggestions, clock, send } = await handoffSession($, on, { handoffs: { '/proj': h } })
  await clock.advance(1_000)
  await send('something else')
  // A reload runs session.start again in the same session.
  await $.session.start({ cwd: '/proj/sub', surface: 'terminal', isInteractive: true })
  await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /↩ handoff/ })).toBeUndefined()
  await ui.unmount()
  expect(suggestions).toEqual([resumeText(PATH)])
})

test('the handoff row shows with the bar off, and any other prompt puts it away', async ($, on) => {
  const h = { path: PATH, cwd: '/proj', at: 10 * HOUR, title: 'моды' }
  const { store, send } = await handoffSession($, on, { handoffs: { '/proj': h } })
  await $.command.run({ command: 'context-bar', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  let ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /^↩ handoff just now: моды$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /60k\/200k/ })).toBeUndefined()
  await ui.unmount()

  await send('something else')
  ui = await $.ui.mount({ plugin: 'context-bar-compact', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /↩ handoff/ })).toBeUndefined()
  await ui.unmount()
  expect(store.get('handoffs')).toEqual({ '/proj': h })
})
