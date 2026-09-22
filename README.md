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

## Tools

| Tool | Type | Description |
| --- | --- | --- |
| `whoami` | read | User owning the key + site |
| `list_projects` | read | List/search projects |
| `list_tasklists` | read | Task lists inside a project |
| `list_tasks` | read | Find tasks by project/list/keyword |
| `get_task` | read | Details of one task |
| `my_work` | read | Work assigned to me (today/overdue/thisweek) |
| `latest_activity` | read | Latest activity feed (like the activity widget) |
| `search` | read | Search tasks/messages/files/comments/milestones by keyword |
| `upcoming_milestones` | read | Milestones with deadlines in a date range |
| `project_updates` | read | Project status updates / health |
| `list_task_comments` | read | Read a task's discussion thread |
| `list_people` | read | Find users (name/email → id) |
| `auth_status` | read | Check key status, site and storage |
| `create_task` | **write** | Create a task in a task list |
| `update_task` | **write** | Edit a task / complete / assign users, tags |
| `add_task_comment` | **write** | Comment on a task |
| `log_time` | **write** | Log hours on a task or project |
| `logout` | local | Remove the API key from this machine |

In opencode, the full name is `<server name>_<tool>`, e.g. `teamwork_create_task`.
Keep the **write** tools in `ask` mode in `opencode.json`:

```json
{
  "permission": {
    "teamwork_*": "allow",
    "teamwork_create_task": "ask",
    "teamwork_update_task": "ask",
    "teamwork_add_task_comment": "ask",
    "teamwork_log_time": "ask",
    "teamwork_logout": "ask"
  }
}
```

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
