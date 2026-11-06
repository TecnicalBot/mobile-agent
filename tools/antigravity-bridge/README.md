# Antigravity ACP bridge

A dependency-free HTTP/SSE bridge for Google Antigravity CLI's Agent Client
Protocol server (`agy acp`).

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
  "version": "1.0.0",
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

## Protocol notes

- Antigravity accepts one active `session/prompt` per session. The app queues
  messages sent while a response is streaming and sends them after the current
  turn settles.
- `session/cancel` is a JSON-RPC notification (no `id`). It resolves the active
  prompt with `stopReason: "cancelled"`.
- `session/set_config_option` is used for `model`, `thought_level`, and `mode`.
  Some models omit `thought_level`; switch models first, then read the returned
  `configOptions`.
- `session/resume` works after `session/close`, so a linked chat can reattach
  without losing the remote session.
- Permission prompts arrive as server-initiated
  `session/request_permission` requests. Reply with
  `{"outcome":{"outcome":"selected","optionId":"allow"}}` or
  `{"outcome":{"outcome":"cancelled"}}`.

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
