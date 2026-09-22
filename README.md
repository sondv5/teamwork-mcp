# @sondv5/teamwork-mcp

[![npm](https://img.shields.io/npm/v/@sondv5/teamwork-mcp)](https://www.npmjs.com/package/@sondv5/teamwork-mcp)
[![GitHub](https://img.shields.io/badge/github-sondv5%2Fteamwork--mcp-181717?logo=github)](https://github.com/sondv5/teamwork-mcp)

MCP server cho Teamwork.com dùng **personal API key**. Key được lưu trong OS keychain
(hoặc file mã hóa), nên file cấu hình MCP của client không chứa secret.

## Features

- MCP server over stdio
- Lần đầu dùng sẽ mở trang setup local để nhập site + API key, verify rồi lưu lại
- Hỗ trợ Windows Credential Manager / macOS Keychain / libsecret + fallback file mã hóa AES-256-GCM
- Tools gọn nhẹ, trim field để tiết kiệm token cho agent

## Install / Run

Chạy trực tiếp với `npx` (không cần clone repo):

```bash
npx -y @sondv5/teamwork-mcp@latest
```

Lần đầu gọi bất kỳ tool nào mà chưa có key, server sẽ:

1. Mở browser tới trang setup local (`http://127.0.0.1:<port>/setup/<nonce>`)
2. Bạn nhập Teamwork site + API key → server verify với Teamwork rồi lưu lại
3. Gọi lại tool vừa rồi — mọi thứ hoạt động, không cần restart

Lấy key tại Teamwork: Profile → Edit My Details → tab **API & Mobile** → *Show your Token*.

Cho local development:

```bash
npm install
npm run build
node dist/bin.js
```

CLI vẫn có sẵn cho ai thích terminal:

```bash
npx -y @sondv5/teamwork-mcp@latest auth     # nhập site + key, verify rồi lưu
npx -y @sondv5/teamwork-mcp@latest status   # xem credential đang dùng
npx -y @sondv5/teamwork-mcp@latest logout   # xoá credential
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

Template có sẵn trong repo này:

```
.cursor/mcp.json
.mcp.json
.codex/config.toml
opencode.json
```

### Cursor

Tạo `.cursor/mcp.json` trong project root:

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

Thêm bằng CLI từ project root:

```bash
claude mcp add --transport stdio --scope project \
  teamwork -- npx -y @sondv5/teamwork-mcp@latest
```

Hoặc commit file `.mcp.json` ở project root:

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

Config user-level tại `~/.codex/config.toml`:

```toml
[mcp_servers.teamwork]
command = "npx"
args = ["-y", "@sondv5/teamwork-mcp@latest"]
```

Bản Codex hiện tại cũng có thể đọc config project-local từ `.codex/config.toml`
với project đã trust. Nếu không nhận, fallback về `~/.codex/config.toml`.

### OpenCode

Tạo `opencode.json` trong project root:

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

Sửa file config (`%APPDATA%\Claude\claude_desktop_config.json` trên Windows,
`~/Library/Application Support/Claude/claude_desktop_config.json` trên macOS):

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

Sửa `~/.codeium/windsurf/mcp_config.json`, cùng format như Claude Desktop ở trên.

### VS Code (Agent mode)

Tạo `.vscode/mcp.json` trong project:

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

Commit `.cursor/mcp.json`, `.mcp.json` và `opencode.json` khi MCP server là một
phần workflow của team. Với Codex, ưu tiên `~/.codex/config.toml` trừ khi team
đã verify project-local `.codex/config.toml` hoạt động với bản Codex đang dùng.

## Tools

| Tool | Loại | Mô tả |
| --- | --- | --- |
| `whoami` | read | User sở hữu key + site |
| `list_projects` | read | Liệt kê/tìm project |
| `list_tasklists` | read | Task list trong project |
| `list_tasks` | read | Tìm task theo project/list/từ khoá |
| `get_task` | read | Chi tiết 1 task |
| `my_work` | read | Việc được giao cho tôi (today/overdue/thisweek) |
| `latest_activity` | read | Feed hoạt động mới nhất (như activity widget) |
| `search` | read | Tìm task/message/file/comment/milestone theo từ khoá |
| `upcoming_milestones` | read | Milestone có deadline trong khoảng ngày |
| `project_updates` | read | Status update/health của project |
| `list_task_comments` | read | Đọc thảo luận của task |
| `list_people` | read | Tìm user (tên/email → id) |
| `auth_status` | read | Kiểm tra đã có key chưa, site, nơi lưu |
| `create_task` | **write** | Tạo task trong task list |
| `update_task` | **write** | Sửa task / complete / gán assignee, tag |
| `add_task_comment` | **write** | Comment vào task |
| `log_time` | **write** | Log giờ vào task hoặc project |
| `logout` | local | Xoá API key khỏi máy |

Trong opencode, tên đầy đủ là `<tên server>_<tool>`, ví dụ `teamwork_create_task`.
Nên để các tool **write** ở chế độ `ask` trong `opencode.json`:

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

## Biến môi trường (tuỳ chọn, cho CI)

`TEAMWORK_SITE` và `TEAMWORK_API_KEY` sẽ override keychain. Lưu ý: env là plaintext.

## Bảo mật

- API key kế thừa quyền của user → nên tạo **user riêng** (standard user, chỉ access
  project cần thiết) thay vì dùng key của admin/owner.
- Không truyền key qua `args` trong `mcp.json` (lộ qua process list).
- Server chỉ ghi log ra stderr; stdout dành riêng cho JSON-RPC.

## Dev

```bash
npm install
npm run build        # tsc -> dist/
npm run dev          # watch mode
node dist/bin.js --help
```

Release lên npm tự động qua GitHub Actions khi push tag `v*.*.*`
(xem `.github/workflows/publish.yml`, cần secret `NPM_TOKEN`).

## License

MIT
