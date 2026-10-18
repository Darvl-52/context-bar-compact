# context-bar-compact

A Claude Code mod: one line above the prompt, with how full this session's context window is on
the left and your account's rate limits on the right.

```
██████░░░░░░░░░░░▒▒▒ 30% 60k/200k · compacts in 100k (~10 turns)     5-hour 42% resets in 2h14m · weekly 18%
```

**On the left, this session's window**

- The bar, 20 cells: `█` what is in the window, in the colours `/context` gives its categories
  (system prompt, tools, memory files, messages…), `░` the free space, `▒` the buffer kept for
  auto-compaction.
- `30%` the share of the window in use, coloured by the working zone (below): green, yellow or red.
- `60k/200k` tokens in the window out of its size.
- `compacts in 100k` how many tokens are left before Claude Code compacts the conversation; absent
  when auto-compaction is off.
- `(~10 turns)` how many of your turns that room lasts at the pace of the last five, so you know
  whether the task fits before a compact. It shows from the third turn of a conversation and starts
  over after a compact or `/clear`; what subagents read does not count, it fills their own window.

**On the right, your account's rate limits** (subscription accounts only)

- `5-hour 42%` and `weekly 18%` how much of each limit is used: green while there is room, yellow
  from 75%, red from 90%.
- `resets in 2h14m` when that limit starts over, counted down each minute.

On a narrow terminal the limits shorten first, then the bar shrinks, then the end of the line is
cut:

```
██████░░░░░░░░░░░▒▒▒ 30% 60k/200k · compacts in 100k      5h 42% ↻2h14m · 7d 18%
```

Other mods that draw rows above the prompt keep them, under this line.

### The working zone

Answers get worse well before the window is full, so the bar watches the share in use:

- under 50% the figure is green;
- from 50% it turns yellow, and a row names the three categories that fill the window most, each
  with the colour it has on the bar, so you see whether a compact, a handoff or turning off an MCP
  server would help;
- from 60% it turns red, a toast says so once, and another row offers a way out:

```
█████████████░░░▒▒▒▒ 62% 124k/200k · compacts in 36k (~3 turns)  5-hour 42% resets in 2h14m · weekly 18%
⚠ past the working zone (50–60%)  h: handoff  c: /compact
largest ■ Messages 98k · ■ System tools 16k · ■ Memory files 6k
```

`c` puts `/compact ` in the prompt box. `h` appears when Matt Pocock's
[handoff skill](https://github.com/mattpocock/skills) is installed (the `mattpocock-skills` plugin)
and puts `/mattpocock-skills:handoff ` there, for you to finish with what the next session is for:
it writes the conversation to a file in your temp directory that a fresh session can read and pick
up. Neither runs until you press Enter. The toast comes back only after the window has dropped
under 50% again, say after a compact.

Set the zone with `/context-bar zone`: a pane with − and + for each threshold (5% a step),
presets on `1`–`4` (40–50, 50–60, 60–70, 70–80), `r` to go back to 50–60, and your current share
shown in the colour it would take. Every change shows on the bar at once and is kept for every
session. Without the pane, `/context-bar zone 40 70` sets yellow from 40% and red from 70%.

### A cold cache

Claude Code keeps the conversation in the prompt cache for an hour on a subscription and five
minutes otherwise. Away longer than that, the next reply sends the whole window again uncached,
which costs more and counts more against your limits. The bar says so once the time is up:

```
◌ cache cold after 1h12m idle: the next reply re-sends 124k uncached  h: handoff
```

A handoff into a fresh conversation, then `/clear`, may cost less than carrying on. The row goes
away with the next reply. A mod cannot read the cache setting, so a session with rate limits on the
right (a subscription) is taken for the hour.

### In Russian

`/context-bar lang ru` switches every word the mod shows to Russian, and the choice is kept for
every session:

```
██████░░░░░░░░░░░▒▒▒ 30% 60k/200k · сжатие через 100k (~10 ходов)   5 часов 42% сброс через 2ч14м · неделя 18%
```

Claude Code names the window's categories in English; the Russian side translates the ones it
knows (`Messages` is `Сообщения`) and leaves a new one as it is. `/context-bar lang en` goes back.

### Picking up a handoff

When a handoff is written, the bar remembers it for the folder you are in. After `/clear`, or in
the next session started in that folder within a day, a row under the bar offers it:

```
↩ handoff 5m ago: Claude Code mods  r: resume  x: dismiss
```

and the empty prompt box shows `Read <file> and pick up from there.` (in Russian, `Прочитай <file> и
продолжи с того места.`) as its dim suggestion: `Tab`
takes it, `Enter` sends it. `r` puts the same request in the box, `x` forgets the handoff. Once
sent, it is not offered again; any other prompt just puts the row away for that conversation. The
row shows even with the bar turned off.

A handoff is the Markdown file written while `/handoff` runs, or one with `handoff` in its name in
your temp directory.

## Commands

| Command                   | What it does                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/context-bar`            | Hide or show the bar for this session.                                                                                                                                                                              |
| `/context-bar details`    | Open a pane with the full breakdown: each category, memory files, MCP servers and how many of their tools are loaded, the largest skills, custom agents and the cache split of the last API call. `r` refreshes it. |
| `/context-bar zone`       | Open the working-zone pane: −/+ for yellow and red, presets `1`–`4`, `r` resets.                                                                                                                                    |
| `/context-bar zone 40 70` | Yellow from 40%, red from 70%, without the pane.                                                                                                                                                                    |
| `/context-bar zone reset` | Back to 50–60.                                                                                                                                                                                                      |
| `/context-bar lang ru`    | Speak Russian: the bar, its rows, the panes, the toast and the command's replies; `lang en` back to English. Kept for every session.                                                                                |

Keys on the rows under the bar, once the band has the focus (a click, or ctrl+x tab):

| Key | What it does                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------- |
| `h` | Put `/mattpocock-skills:handoff ` in the prompt box (when installed), from the red row or the cold-cache row. |
| `c` | Put `/compact ` in the prompt box.                                                                            |
| `r` | Put the request to read the offered handoff in the prompt box.                                                |
| `x` | Dismiss the offered handoff.                                                                                  |

It reads only the usage numbers Claude Code already has, the same ones `/context` shows, and sends
nothing anywhere. The details pane costs a few extra requests, like running `/context`, so it
refreshes only while it is open.

## Install

Needs Claude Code 2.1.281 or later, the first with the session state mods keep their values in;
on an older one the mod loads but draws nothing. `claude --version` tells, `claude update` updates.

At the prompt of a Claude Code session:

```
/plugin install context-bar-compact --marketplace Darvl-52/context-bar-compact
```

`y` adds the marketplace, then pick a scope. From a shell:

```sh
claude plugin install context-bar-compact --marketplace Darvl-52/context-bar-compact
```

If you have [context-bar](https://github.com/akash001uts/claude-mods) installed, disable it: both
register `/context-bar`.

Mods are early access, and Claude Code may not load an installed plugin's hooks module: with a
third-party provider (Bedrock, Vertex, a gateway) or with telemetry turned off, nothing shows and
`/context-bar` is an unknown command. Set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the environment
Claude Code starts in (your shell profile), then start a new session.
`claude --debug` says why a module was not loaded: search its log for `hooks module`.

## Credit

A compact fork of [context-bar](https://github.com/akash001uts/claude-mods) by Akash Bhatnagar
(MIT), which draws the same data over three lines.
