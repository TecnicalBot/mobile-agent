# Mobile Agent

Mobile Agent is an open-source AI agent built specifically for mobile devices that runs entirely on your phone.

## Demo

[![Mobile Agent demo](https://img.youtube.com/vi/_P_SQ0MW-aU/maxresdefault.jpg)](https://youtu.be/_P_SQ0MW-aU?si=klxA4b7RU3Y2j5iy)

## Features

- Connects with Antigravity, Claude, Opencode.
- Generate/Edit videos without any video generate model.
- On-device models that can run completely offline
- Runs completely on-device
- No external server required
- MCP support
- Skills system
- Persistent memory
- Multi-modal support
- Direct access to phone's internal storage
- Android permission-based access
- Community plugins
- Voice to text support.

## Installation

The application is distributed through GitHub Releases.

1. Download the latest APK from the Releases page.
2. Install the APK on your Android device.
3. Grant the required permissions.
4. Start using Mobile Agent.

## Connect Antigravity or Claude

Antigravity and Claude run as host-side ACP harnesses. On the computer that has
`agy` and/or `claude-agent-acp` installed, run the installer once:

```bash
curl -fsSL https://raw.githubusercontent.com/tecnicalbot/mobile-agent/main/tools/install.sh | sh
mabridge
```

The installer adds a portable Node.js when needed. `mabridge` starts both
bridges on your LAN and prints a five-minute pairing QR. In the app, open
**Settings → Harnesses** and scan the QR. One scan configures both harnesses;
the stable bridge token is created once and reused across restarts. The bridges
keep running in the foreground until you press Ctrl+C.

Use `mabridge --no-pair` to print the URLs and token instead, or see
[Antigravity](tools/antigravity-bridge/README.md) and
[Claude](tools/claude-bridge/README.md) for manual setup, flags, and security
notes.

## Contributing

Contributions are welcome. Feel free to open an issue for bug reports, feature requests, or submit a pull request if you'd like to contribute.

## License

This project is licensed under the MIT License.
