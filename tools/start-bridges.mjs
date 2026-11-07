#!/usr/bin/env node
/**
 * Start every ACP harness bridge with one command.
 *
 * Each harness still runs in its own process on its own port, so one agent
 * crashing cannot take the other down. The bridges share one stable token
 * file, so the app only needs to be configured once.
 *
 *   node tools/start-bridges.mjs --lan
 *   node tools/start-bridges.mjs --host 192.168.1.20
 */

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultTokenFile } from "./acp-bridge/bridge.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BRIDGES = [
  {
    id: "antigravity",
    label: "Antigravity",
    script: join(ROOT, "antigravity-bridge", "bridge.mjs"),
    defaultPort: 7801,
  },
  {
    id: "claude",
    label: "Claude",
    script: join(ROOT, "claude-bridge", "bridge.mjs"),
    defaultPort: 7802,
  },
];

function usage() {
  return `Start every ACP harness bridge with one command.

Usage:
  node tools/start-bridges.mjs [options]

Options:
  --host <address>          Bind address for both bridges (default 127.0.0.1)
  --lan                     Shortcut for --host 0.0.0.0
  --antigravity-port <n>    Antigravity port (default 7801)
  --claude-port <n>         Claude port (default 7802)
  --token-file <path>       Shared stable token file
                            (default ${defaultTokenFile()})
  --cwd <path>              Default session working directory for both bridges
  --only <harness>          Start only "antigravity" or "claude"
  --help                    Show this help

Examples:
  node tools/start-bridges.mjs --lan
  node tools/start-bridges.mjs --host 192.168.1.20 --cwd ~/code
  node tools/start-bridges.mjs --only claude
`;
}

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    ports: Object.fromEntries(
      BRIDGES.map((bridge) => [bridge.id, bridge.defaultPort]),
    ),
    tokenFile: "",
    cwd: "",
    only: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };

    switch (arg) {
      case "--host":
        options.host = next();
        break;
      case "--lan":
        options.host = "0.0.0.0";
        break;
      case "--antigravity-port":
        options.ports.antigravity = Number(next());
        break;
      case "--claude-port":
        options.ports.claude = Number(next());
        break;
      case "--token-file":
        options.tokenFile = next();
        break;
      case "--cwd":
        options.cwd = next();
        break;
      case "--only":
        options.only = next();
        break;
      case "--help":
      case "-h":
        process.stdout.write(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.only && !BRIDGES.some((bridge) => bridge.id === options.only))
    throw new Error(`--only must be "antigravity" or "claude".`);
  for (const [id, port] of Object.entries(options.ports)) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error(`The ${id} port must be between 1 and 65535.`);
  }

  return options;
}

function bridgeArgs(bridge, options, tokenFile) {
  const args = [
    bridge.script,
    "--host",
    options.host,
    "--port",
    String(options.ports[bridge.id]),
    // Always pass the file explicitly so loopback-only runs use the same
    // stable token as the LAN-facing bridge.
    "--token-file",
    tokenFile,
  ];
  if (options.cwd) args.push("--cwd", options.cwd);
  return args;
}

function displayHost(host) {
  if (host === "0.0.0.0" || host === "::") return "<this-computer-LAN-IP>";
  return host;
}

const options = parseArgs(process.argv.slice(2));
const selected = BRIDGES.filter(
  (bridge) => !options.only || bridge.id === options.only,
);
const tokenFile = (options.tokenFile || defaultTokenFile()).replace(
  /^~(?=$|\/|\\)/,
  homedir(),
);

const children = new Map();
let shuttingDown = false;

function finish(bridge, code) {
  if (!children.has(bridge.id)) return;
  children.delete(bridge.id);
  if (shuttingDown) {
    if (children.size === 0) process.exit(0);
    return;
  }
  if (children.size > 0) {
    console.error(
      `[start] ${bridge.label} stopped. ${[...children.keys()]
        .map((id) => BRIDGES.find((item) => item.id === id)?.label ?? id)
        .join(", ")} still running.`,
    );
    return;
  }
  process.exit(code ?? 1);
}

for (const bridge of selected) {
  console.log(
    `[start] ${bridge.label} bridge -> http://${displayHost(options.host)}:${options.ports[bridge.id]}`,
  );
  const child = spawn(process.execPath, bridgeArgs(bridge, options, tokenFile), {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  children.set(bridge.id, child);
  child.on("error", (error) => {
    console.error(
      `[start] Could not start the ${bridge.label} bridge: ${error.message}`,
    );
    finish(bridge, 1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown)
      console.error(
        `[start] ${bridge.label} bridge exited (${signal ? `signal ${signal}` : `code ${code}`}).`,
      );
    finish(bridge, code);
  });
}

console.log(`[start] Shared token file: ${tokenFile}`);
console.log(
  "[start] Copy the token from that file into each harness once. Restarts reuse it.",
);

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[start] Stopping bridges (${signal}).`);
  if (children.size === 0) process.exit(0);
  for (const child of children.values()) {
    try {
      child.kill(signal);
    } catch {
      // The process may have already exited.
    }
  }
  const timer = setTimeout(() => {
    for (const child of children.values()) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may have already exited.
      }
    }
    process.exit(0);
  }, 3000);
  timer.unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
