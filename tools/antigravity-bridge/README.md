# Antigravity ACP bridge

A dependency-free HTTP/SSE bridge for Google Antigravity CLI's Agent Client
Protocol server (`agy acp`). This launcher and the Claude launcher share the
implementation in [`tools/acp-bridge/bridge.mjs`](../acp-bridge/bridge.mjs).

The Mobile Agent app does not need Termux, Android, or a local Antigravity
install. Run this bridge on any machine that has `agy` — a laptop, desktop,
home server, VPS, or Termux — and point the app at it.

## Requirements

- Node.js 18 or newer.
- Google Antigravity CLI (`agy`) installed and signed in.
- The app and bridge on the same network, or a tunnel/VPN between them.

Sign in once on the bridge host:

```bash
agy acp --login
# or launch `agy` interactively and sign in with Google
```

## Run

```bash
node bridge.mjs
```

The default is `http://127.0.0.1:7801`, which only accepts local connections.

To connect from a phone on the same Wi-Fi:

```bash
node bridge.mjs --host 0.0.0.0 --port 7801 --token change-me
```

Then enter this in **Settings → Harnesses → Antigravity**:

- **Bridge URL:** `http://<computer-LAN-IP>:7801`
- **Token:** `change-me`
- **Working directory:** optional. Leave blank to use the bridge's default
  directory, or enter an absolute path on the bridge host.

The token is required when binding to a non-loopback address. Use a long random
value, and only run the bridge on a trusted network. For internet access, put it
behind HTTPS (Caddy, Tailscale, Cloudflare Tunnel, WireGuard, etc.) rather than
exposing plain HTTP.

### Useful flags

```bash
node bridge.mjs \
  --host 0.0.0.0 \
  --port 7801 \
  --token "$(openssl rand -hex 24)" \
  --cwd ~/code/my-project \
  --agy /usr/local/bin/agy
```

| Flag | Description |
| --- | --- |
| `--host` | Bind address. Default `127.0.0.1`. |
| `--port` | Bind port. Default `7801`. |
| `--token` | Bearer token. Also `ANTIGRAVITY_BRIDGE_TOKEN`. |
| `--agy` | Path to the Antigravity CLI. |
| `--cwd` | Default working directory for new sessions. |
| `--add-dir` | Additional workspace root. Repeatable. |
| `--agy-arg` | Extra `agy acp` argument. Repeatable. |
| `--dangerously-skip-permissions` | Auto-approve every Antigravity tool. Only use in a sandbox. |

Environment variables work too:

```bash
ANTIGRAVITY_BRIDGE_HOST=0.0.0.0 \
ANTIGRAVITY_BRIDGE_PORT=7801 \
ANTIGRAVITY_BRIDGE_TOKEN=change-me \
node bridge.mjs
```

## API

The bridge is intentionally thin. The app speaks ACP JSON-RPC directly.

### `GET /health`

```json
{
  "ok": true,
  "service": "antigravity-bridge",
  "version": "1.2.0",
  "agent": "agy",
  "agentVersion": "1.5.1",
  "cwd": "/home/me/project",
  "home": "/home/me"
}
```

### `GET /events`

Server-Sent Events.

- `event: ready` — bridge is connected to `agy acp`.
- `event: message` — one JSON-RPC message from `agy acp`, as a JSON string.
- `event: log` — stderr/log output from the agent.
- `event: bridge` — bridge lifecycle (`exit`, `error`, `shutdown`).

The app correlates request IDs from this stream.

### `POST /rpc`

Write one JSON-RPC message to `agy acp`:

```bash
curl -s http://127.0.0.1:7801/rpc \
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
  'http://127.0.0.1:7801/files?name=report.pdf&directory=%2Fhome%2Fme%2Fproject' \
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
- The app only uses this endpoint for files too large to inline in an ACP
  prompt. If the bridge is older and returns `404`, the app falls back to
  embedding the file when it fits, or reports that it was not attached.

## Protocol notes

- Antigravity accepts one active `session/prompt` per session. The app queues
  messages sent while a response is streaming and sends them after the current
  turn settles.
- `session/cancel` is a JSON-RPC notification (no `id`). It resolves the active
  prompt with `stopReason: "cancelled"`.
- `session/set_config_option` is used for `model`, `thought_level`, and `mode`.
  Some models omit `thought_level`; switch models first, then read the returned
  `configOptions`.
- `session/resume` works after `session/close`, and also on an active session.
  The app uses it to reconnect MCP servers without losing the remote session;
  it reapplies the model and mode afterward because a resume can reset them.
- Permission prompts arrive as server-initiated
  `session/request_permission` requests. Reply with
  `{"outcome":{"outcome":"selected","optionId":"allow"}}` or
  `{"outcome":{"outcome":"cancelled"}}`.

## MCP servers and phone tools

The app passes its selected MCP servers to Antigravity in every
`session/new` and `session/resume` request (`session/new` omits `sessionId`):

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

- App MCP servers are remote-only (`http` or `sse`), which maps directly to ACP
  remote MCP entries. Disabled and unselected servers are omitted.
- Header-auth servers use the values saved in the app's secure store.
- OAuth servers use a refreshed access token as a bearer header. A missing
  token still leaves the server available so Antigravity can surface its own
  authorization error.
- Antigravity does not advertise `mcpCapabilities`, but it accepts HTTP MCP
  entries today. SSE entries are passed through for servers configured that
  way. No bridge change is needed: the bridge forwards the `mcpServers`
  parameter unchanged.
- Antigravity prefixes MCP tool names with the server name
  (`mcp_<server>_<tool>`), so server names must match
  `^[a-zA-Z0-9_-]{1,64}$`. The app sanitizes display labels and keeps names
  unique before sending them.
- When device sharing is active, the phone bridge is added as another HTTP MCP
  server (`http://<phone-ip>:<port>/mcp`) with its bearer token. Turning sharing
  on or off reconnects the active Antigravity session so the tool list changes
  immediately. The bridge host must be able to reach the phone's advertised
  address (same LAN or a tunnel such as Tailscale).
- The Device Sharing drawer controls what that MCP server exposes:
  - **Folder** adds `phoneFolder*` read/write tools for the selected Android
    document tree.
  - **Workspace** adds the app workspace file, media, and document tools.
  - **Skills** adds `listSkills`, `skill`, and `skillReadFile` for enabled app
    skills.
  Antigravity sees these as normal MCP tools, just like OpenCode does.

## Security notes

- `agy acp` can run commands and edit files on the bridge host. Treat the
  bridge token like a shell password.
- Bind to `127.0.0.1` and use an SSH/Tailscale tunnel if you do not need LAN
  access.
- When no token is configured, the bridge does not send permissive CORS
  headers, so a random web page cannot drive a loopback-only bridge. Set a
  token if you need a browser client.
- The bridge does not log message contents. Agent stderr is forwarded to
  `/events` and the bridge console.
- Use `--dangerously-skip-permissions` only in a disposable/sandboxed
  environment. By default, the app receives Antigravity's permission requests
  and can allow or deny them.

## How it fits together

```text
Mobile Agent app (phone/tablet/desktop)
        │  HTTP POST /rpc  +  SSE GET /events
        ▼
Antigravity ACP bridge (this process)
        │  newline-delimited JSON-RPC over stdin/stdout
        ▼
agy acp
```

This keeps the app portable: any host that can run Node and `agy` works, and
the phone never needs to know whether Antigravity is running in Termux, on a
desktop, or on a remote server.
