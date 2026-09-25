# @sondv5/teamwork-mcp

[![npm](https://img.shields.io/npm/v/@sondv5/teamwork-mcp)](https://www.npmjs.com/package/@sondv5/teamwork-mcp)
[![GitHub](https://img.shields.io/badge/github-sondv5%2Fteamwork--mcp-181717?logo=github)](https://github.com/sondv5/teamwork-mcp)

MCP server for Teamwork.com using a **personal API key**. The key is stored in the
OS keychain (or an encrypted file), so MCP client config files never contain secrets.

## Features

- MCP server over stdio
- First use opens a local setup page to enter site + API key, verifies it, then saves it
- Supports Windows Credential Manager / macOS Keychain / libsecret, with an AES-256-GCM encrypted file fallback
- Compact tool responses with trimmed fields to save agent tokens

## Install as a Claude Code / Cowork plugin (easiest, no config editing)

This repo is also a Claude Code plugin (`.claude-plugin/plugin.json` +
`.claude-plugin/marketplace.json`). Each teammate runs these two commands once —
the MCP server is wired up automatically, no `mcp.json` editing needed:

```bash
claude plugin marketplace add sondv5/teamwork-mcp
claude plugin install teamwork@teamwork-mcp
```

The first time anyone calls a Teamwork tool, the guided setup page opens automatically
for them to enter **their own** site + API key (stored locally in their OS keychain) —
nothing to configure by hand.

## Install / Run

Run directly with `npx` (no need to clone the repo):

```bash
npx -y @sondv5/teamwork-mcp@latest
```

The first time you call any tool without a key, the server will:

1. Open your browser to a local setup page (`http://127.0.0.1:<port>/setup/<nonce>`)
2. You enter your Teamwork site + API key → the server verifies it with Teamwork and saves it
3. Retry the tool you just called — everything works, no restart needed

Get your key in Teamwork: Profile → Edit My Details → **API & Mobile** tab → *Show your Token*.

For local development:

```bash
npm install
npm run build
node dist/bin.js
```

A CLI is also available for terminal users:

```bash
npx -y @sondv5/teamwork-mcp@latest auth     # enter site + key, verify and save
npx -y @sondv5/teamwork-mcp@latest status   # show the credential in use
npx -y @sondv5/teamwork-mcp@latest logout   # remove the credential
```

## MCP Client Config

```json
{
  "mcpServers": {
    "teamwork": {
      "command": "npx",
      "args": ["-y", "@sondv5/teamwork-mcp@latest"]
    }
  }
}
```

## Local Project Setup

Ready-made templates are included in this repository:

```
.cursor/mcp.json
.mcp.json
.codex/config.toml
opencode.json
```

### Cursor

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "teamwork": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@sondv5/teamwork-mcp@latest"]
    }
  }
}
```

**Or install it as a Cursor plugin** (no per-project file needed — this repo already
ships `.cursor-plugin/plugin.json` + `mcp.json`):

- **Personal / local test**: clone or symlink this repo into `~/.cursor/plugins/local/teamwork-mcp`,
  then reload Cursor (`Developer: Reload Window`).
- **Team (Team/Enterprise plan)**: Dashboard → **Plugins & MCPs** → **Import from Repo** →
  point at `https://github.com/sondv5/teamwork-mcp`. Turn on **Auto Refresh** so updates
  pushed to the repo propagate automatically.
- **Public**: submit at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish)
  (the repo is already MIT-licensed and public, so it qualifies).

### Claude Code

Add it with the CLI from the project root:

```bash
claude mcp add --transport stdio --scope project \
  teamwork -- npx -y @sondv5/teamwork-mcp@latest
```

Or commit a project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "teamwork": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@sondv5/teamwork-mcp@latest"]
    }
  }
}
```

### Codex

User-level config in `~/.codex/config.toml`:

```toml
[mcp_servers.teamwork]
command = "npx"
args = ["-y", "@sondv5/teamwork-mcp@latest"]
```

Recent Codex builds may also load project-local config from `.codex/config.toml`
for trusted projects. If it is not picked up, fall back to `~/.codex/config.toml`.

### OpenCode

Create `opencode.json` in your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "teamwork": {
      "type": "local",
      "command": ["npx", "-y", "@sondv5/teamwork-mcp@latest"],
      "enabled": true
    }
  }
}
```

### Claude Desktop

Edit the config file (`%APPDATA%\Claude\claude_desktop_config.json` on Windows,
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "teamwork": {
      "command": "npx",
      "args": ["-y", "@sondv5/teamwork-mcp@latest"]
    }
  }
}
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json` using the same format as Claude Desktop above.

### VS Code (Agent mode)

Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "teamwork": {
      "command": "npx",
      "args": ["-y", "@sondv5/teamwork-mcp@latest"]
    }
  }
}
```

### Recommended Repo Files

```
.cursor/mcp.json
.mcp.json
.codex/config.toml
opencode.json
```

Commit `.cursor/mcp.json`, `.mcp.json` and `opencode.json` when the MCP server is
part of the team workflow. For Codex, prefer `~/.codex/config.toml` unless your
team has verified that project-local `.codex/config.toml` works with the Codex
version they use.

## Tools (7 grouped tools, action-dispatched)

| Tool | Type | Actions (via `action` param) |
| --- | --- | --- |
| `tasks` | mixed | `list` (search tasks), `get`, `create`, `update` (edit/complete/assign/tags), `list_comments`, `comment` |
| `projects` | read | `list`, `tasklists`, `updates` (health), `milestones` (date range), `activity` (feed) |
| `people` | read | `whoami`, `list` (find users), `my_work` (today/overdue/thisweek) |
| `time` | **write** | `log` (minutes on task/project) |
| `search` | read | global keyword search (tasks/messages/files/comments/milestones/...) |
| `system` | local | `status` (key/site/storage), `logout` (remove key) |
| `request` | mixed | raw V3 escape hatch: `GET/POST/PUT/DELETE` any `/projects/api/v3/...` path (tags, teams, files, notebooks, calendars, timelogs...) |

## Environment Variables (optional, for CI)

`TEAMWORK_SITE` and `TEAMWORK_API_KEY` override the keychain. Note: env vars are plaintext.

## Security

- The API key inherits the user's permissions → prefer a dedicated **standard user**
  (only access to required projects) instead of an admin/owner key.
- Never pass the key via `args` in `mcp.json` (visible in process lists).
- The server only logs to stderr; stdout is reserved for JSON-RPC.

## Dev

```bash
npm install
npm run build        # tsc -> dist/
npm run dev          # watch mode
node dist/bin.js --help
```

## License

MIT
