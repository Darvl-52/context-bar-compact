# context-bar-compact

A Claude Code mod: your context window, rate limits and room before compaction in one line above
the prompt.

```
██████▒░░░░░░░░░░░░░ 30% 60k/200k · 5h 42% ↻2h14m · 7d 18% · 100k to compact
```

- The bar is 20 cells, coloured by the same categories `/context` uses.
- `5h` and `7d` are your rate limits (subscription accounts only); `↻` is the time until the 5-hour
  window resets.
- `to compact` is how many tokens are left before auto-compaction.
- On a narrow terminal the bar shrinks first, then the end of the line is cut.

### The working zone

Answers get worse well before the window is full, so the bar watches the share in use:

- under 50% the figure is dim;
- from 50% it turns yellow;
- from 60% it turns red, a toast says so once, and a second row offers a way out:

```
████████████▒░░░░░░░ 62% 124k/200k · 5h 42% ↻2h14m · 7d 18% · 36k to compact
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
