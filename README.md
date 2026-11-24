# pi-timeout

A [Pi](https://github.com/earendil-works/pi) coding agent extension that adds a configurable default timeout (**180s** by default) to the built-in `bash` tool.

[![CI](https://github.com/zhexusun10/pi-timeout/actions/workflows/ci.yml/badge.svg)](https://github.com/zhexusun10/pi-timeout/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pi-simple-timeout)](https://www.npmjs.com/package/pi-simple-timeout)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Installation

```bash
pi install npm:pi-simple-timeout
```

Then start a new Pi session, or run `/reload` in an existing session.

GitHub installation also works:

```bash
pi install git:github.com/zhexusun10/pi-timeout
```

## What It Changes

| Area | Before (Pi built-in `bash`) | After (`pi-timeout`) |
| --- | --- | --- |
| `bash` schema `timeout` description | `Timeout in seconds (optional, no default timeout)` | `Timeout in seconds (optional, default 180s)` (updates live with your TUI setting) |
| Agent omits `timeout` | Runs with no timeout | Times out after the configured default (`180s` by default) |
| Return message on default timeout | — | `Default timeout: Command timed out after 180 seconds` |
| Agent specifies explicit `timeout` | `Command timed out after <N> seconds` | Unchanged (`Command timed out after <N> seconds`) |

Built-in `bash` rendering, output truncation, `outputSchema`, `shellPath`, and `shellCommandPrefix` settings are preserved.

## Adjusting the Timeout in TUI

Run `/timeout` in Pi:

- `/timeout` — Open the interactive TUI selector to choose a preset (`30s`, `60s`, `120s`, `180s [default]`, `300s`, `600s`), enter a custom value (`Custom...`), disable the default timeout (`Disable`), or reset to `180s`.
- `/timeout <value>` — Set directly without opening the dialog:
  - `/timeout 120` or `/timeout 120s`
  - `/timeout 5m`
  - `/timeout reset` (or `/timeout default`)
  - `/timeout off` (or `/timeout none`)

Updating the timeout immediately refreshes the active `bash` tool schema and persists your choice to `~/.pi/agent/pi-timeout.json` (or `$PI_TIMEOUT_SETTINGS` if set).

## Configuration

```json
{
  "version": 1,
  "defaultTimeoutSeconds": 180
}
```

## Development

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run verify:load
npm pack
```

## License

MIT
