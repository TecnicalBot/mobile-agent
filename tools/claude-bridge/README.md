# Claude ACP bridge

A dependency-free HTTP/SSE bridge for
[`@agentclientprotocol/claude-agent-acp`](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp),
the Agent Client Protocol adapter for Claude Code.

The Mobile Agent app does not need Node, Termux, or a Claude install on the
phone. Run this bridge on any machine that can run Claude Code, and point the
app at it. The app never receives a Claude password, OAuth token, or API key;
the adapter reads the Claude Code login on the host.

## Requirements

- Node.js 22 or newer.
- `@agentclientprotocol/claude-agent-acp` installed on the bridge host.
- Either a Claude Code login (Claude subscription or Console billing) or an
  `ANTHROPIC_API_KEY`.
- The app and bridge on the same network, or a tunnel/VPN between them.

```bash
npm install -g @agentclientprotocol/claude-agent-acp
```

### Sign in with a Claude subscription

Claude Code stores its login in `~/.claude` and the operating system keychain.
The adapter uses that login automatically, including claude.ai subscription
usage.

```bash
# If Claude Code is installed:
claude auth login

# Or use the CLI bundled with the adapter:
npx @agentclientprotocol/claude-agent-acp --cli auth login --claudeai
```

Confirm the account and plan:

```bash
claude auth status
```

To keep separate accounts, give each one its own config directory:

```bash
mkdir -p ~/.claude_personal
CLAUDE_CONFIG_DIR=~/.claude_personal claude auth login
CLAUDE_CONFIG_DIR=~/.claude_personal node tools/claude-bridge/bridge.mjs --port 7802 --token change-me
```

### Sign in with an Anthropic API key

Set `ANTHROPIC_API_KEY` when starting the bridge:

```bash
ANTHROPIC_API_KEY=sk-ant-... node tools/claude-bridge/bridge.mjs --port 7802 --token change-me
```

This uses Anthropic Console/API billing instead of a subscription. It is the
right default for a shared or distributed deployment. Anthropic's Agent SDK
terms say third-party products must not offer claude.ai login or subscription
rate limits without prior approval, so distributed use should use API-key or
Console authentication.

## Run

```bash
node tools/claude-bridge/bridge.mjs
```

The default is `http://127.0.0.1:7802`, which only accepts local connections.

To connect from a phone on the same Wi-Fi:

```bash
node tools/claude-bridge/bridge.mjs --host 0.0.0.0 --port 7802 --token change-me
```

Then enter this in **Settings → Harnesses → Claude**:

- **Bridge URL:** `http://<computer-LAN-IP>:7802`
- **Token:** `change-me`
- **Working directory:** optional. Leave blank to use the bridge's default
  directory, or enter an absolute path on the bridge host.

The token is required when binding to a non-loopback address. Use a long random
value, and only run the bridge on a trusted network. For internet access, put it
behind HTTPS (Caddy, Tailscale, Cloudflare Tunnel, WireGuard, etc.) rather than
exposing plain HTTP.

### Useful flags

```bash
node tools/claude-bridge/bridge.mjs \
  --host 0.0.0.0 \
  --port 7802 \
  --token "$(openssl rand -hex 24)" \
  --cwd ~/code/my-project \
  --claude-agent-acp /usr/local/bin/claude-agent-acp
```

| Flag | Description |
| --- | --- |
| `--host` | Bind address. Default `127.0.0.1`. |
| `--port` | Bind port. Default `7802`. |
| `--token` | Bearer token. Also `CLAUDE_BRIDGE_TOKEN`. |
| `--claude-agent-acp` | Path to the adapter. Alias: `--agent`. |
| `--cwd` | Default working directory for new sessions. |
| `--agent-arg` | Extra adapter argument. Repeatable. |

Environment variables work too:

```bash
CLAUDE_BRIDGE_HOST=0.0.0.0 \
CLAUDE_BRIDGE_PORT=7802 \
CLAUDE_BRIDGE_TOKEN=change-me \
node tools/claude-bridge/bridge.mjs
```

`CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY`, and any other Claude environment
variables should be set for the bridge process. The bridge passes its
environment to the adapter.

## API

The bridge is intentionally thin. The app speaks ACP JSON-RPC directly. Both
harnesses share the implementation in [`tools/acp-bridge/bridge.mjs`](../acp-bridge/bridge.mjs).

### `GET /health`

```json
{
  "ok": true,
  "service": "claude-bridge",
  "version": "1.2.0",
  "agent": "claude-agent-acp",
  "agentVersion": "0.101.0",
  "cwd": "/home/me/project",
  "home": "/home/me"
}
```

### `GET /events`

Server-Sent Events.

- `event: ready` — bridge is connected to `claude-agent-acp`.
- `event: message` — one JSON-RPC message from the adapter, as a JSON string.
- `event: log` — stderr/log output from the adapter.
- `event: bridge` — bridge lifecycle (`exit`, `error`, `shutdown`).

The app correlates request IDs from this stream.

### `POST /rpc`

Write one JSON-RPC message to the adapter:

```bash
curl -s http://127.0.0.1:7802/rpc \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}'
```

The bridge returns `202 Accepted` immediately. The response arrives on
`/events`.

### `POST /files`

Upload one large phone attachment as a raw binary body. The bridge streams it
into a session-scoped folder on the host and returns the absolute path:

```bash
curl -sS -X POST \
  'http://127.0.0.1:7802/files?name=report.pdf&directory=%2Fhome%2Fme%2Fproject' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @report.pdf
```

```json
{
  "path": "/home/me/project/.mobile-agent/uploads/<id>/report.pdf",
  "size": 24738291,
  "name": "report.pdf"
}
```

- `name` is sanitized; path separators cannot escape the upload folder.
- `directory` is the session working directory. It defaults to `--cwd`.
- The default limit is 200 MiB per file. The response is `413` above that.

## Protocol notes

- The app negotiates ACP v1. The adapter supports v1 and the experimental v2
  preview; this bridge does not force `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2`.
- The adapter exposes models, permission modes, reasoning effort, MCP servers,
  permissions, session resume/close, and auth status over ACP.
- Claude Code slash commands and `.claude/skills` are pushed as
  `available_commands_update`; the app lists them in the composer's `/` menu.
- `_auth/status_update` is shown in Claude settings so you can confirm whether
  the bridge is using a subscription, an API key, or another backend.
- Claude permission modes include `default`, `acceptEdits`, `plan`, `auto`, and
  `bypassPermissions`. The app maps `plan` to its Plan toggle and leaves the
  rest to the adapter.
- Claude Code may hold a turn while a usage limit resets. Stop the turn from the
  app if you do not want to wait.
- The adapter spawns Claude Code with the login found in `CLAUDE_CONFIG_DIR` or
  `~/.claude`. It does not send credentials to the app.

## MCP servers and phone tools

The app passes its selected MCP servers in `session/new` and `session/resume`:

```json
{
  "sessionId": "…",
  "cwd": "/home/me/project",
  "mcpServers": [
    {
      "type": "http",
      "name": "GitHub",
      "url": "https://mcp.example.com/mcp",
      "headers": [{ "name": "Authorization", "value": "Bearer …" }]
    }
  ]
}
```

- App MCP servers are remote-only (`http` or `sse`).
- Header-auth servers use the values saved in the app's secure store.
- OAuth servers use a refreshed access token as a bearer header. A missing token
  still leaves the server available so Claude can surface its own authorization
  flow.
- When device sharing is active, the phone bridge is added as another HTTP MCP
  server. The bridge host must be able to reach the phone's advertised address
  (same LAN or a tunnel such as Tailscale).

## Security notes

- `claude-agent-acp` can run commands and edit files on the bridge host. Treat
  the bridge token like a shell password.
- Bind to `127.0.0.1` and use an SSH/Tailscale tunnel if you do not need LAN
  access.
- When no token is configured, the bridge does not send permissive CORS
  headers, so a random web page cannot drive a loopback-only bridge. Set a
  token if you need a browser client.
- The bridge does not log message contents. Agent stderr is forwarded to
  `/events` and the bridge console.
- The app stores only the bridge URL and token in the device secure store. It
  never stores Claude credentials.

## How it fits together

```text
Mobile Agent app (phone/tablet/desktop)
        │  HTTP POST /rpc  +  SSE GET /events
        ▼
Claude ACP bridge (this process)
        │  newline-delimited JSON-RPC over stdin/stdout
        ▼
claude-agent-acp
        │  Claude Agent SDK + Claude Code login / API key
        ▼
Anthropic
```

This matches the approach used by T3 Code: the host's existing Claude Code
login provides subscription access, and the app is only a remote client.
