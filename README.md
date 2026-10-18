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

`/context-bar` hides or shows the bar for the session. `/context-bar details` opens a pane with the
full breakdown: each category, memory files, MCP servers and how many of their tools are loaded,
the largest skills, custom agents and the cache split of the last API call.

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
