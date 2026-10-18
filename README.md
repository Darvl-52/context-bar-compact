# context-bar-compact

A Claude Code mod: one line above the prompt, with how full this session's context window is on
the left and your account's rate limits on the right.

```
██████░░░░░░░░░░░▒▒▒ 30% 60k/200k · compacts in 100k             5-hour 42% resets in 2h14m · weekly 18%
```

**On the left, this session's window**

- The bar, 20 cells: `█` what is in the window, in the colours `/context` gives its categories
  (system prompt, tools, memory files, messages…), `░` the free space, `▒` the buffer kept for
  auto-compaction.
- `30%` the share of the window in use, coloured by the working zone (below): green, yellow or red.
- `60k/200k` tokens in the window out of its size.
- `compacts in 100k` how many tokens are left before Claude Code compacts the conversation; absent
  when auto-compaction is off.

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
- from 50% it turns yellow;
- from 60% it turns red, a toast says so once, and a second row offers a way out:

```
█████████████░░░▒▒▒▒ 62% 124k/200k · compacts in 36k             5-hour 42% resets in 2h14m · weekly 18%
⚠ past the working zone (50–60%)  h: handoff  c: /compact
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

## Commands

| Command                   | What it does                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/context-bar`            | Hide or show the bar for this session.                                                                                                                                                                              |
| `/context-bar details`    | Open a pane with the full breakdown: each category, memory files, MCP servers and how many of their tools are loaded, the largest skills, custom agents and the cache split of the last API call. `r` refreshes it. |
| `/context-bar zone`       | Open the working-zone pane: −/+ for yellow and red, presets `1`–`4`, `r` resets.                                                                                                                                    |
| `/context-bar zone 40 70` | Yellow from 40%, red from 70%, without the pane.                                                                                                                                                                    |
| `/context-bar zone reset` | Back to 50–60.                                                                                                                                                                                                      |

Keys on the warning row, once the band has the focus (a click, or ctrl+x tab):

| Key | What it does                                                          |
| --- | --------------------------------------------------------------------- |
| `h` | Put `/mattpocock-skills:handoff ` in the prompt box (when installed). |
| `c` | Put `/compact ` in the prompt box.                                    |

It reads only the usage numbers Claude Code already has, the same ones `/context` shows, and sends
nothing anywhere. The details pane costs a few extra requests, like running `/context`, so it
refreshes only while it is open.

## Install

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

## Credit

A compact fork of [context-bar](https://github.com/akash001uts/claude-mods) by Akash Bhatnagar
(MIT), which draws the same data over three lines.
