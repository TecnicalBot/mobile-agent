#!/usr/bin/env node
/* global Buffer */
/**
 * Portable HTTP/SSE bridge for an ACP agent that speaks newline-delimited
 * JSON-RPC over stdio.
 *
 * The bridge keeps the agent process alive and exposes it over ordinary HTTP so
 * phones, tablets, and remote clients can talk to it without sharing a terminal.
 *
 *   POST /rpc     -> write one JSON-RPC message to the agent
 *   GET  /events  -> SSE stream of every JSON-RPC message from the agent
 *   POST /files   -> stream a large attachment into the session directory
 *   GET  /health  -> bridge and agent metadata
 *
 * No npm dependencies. Run this file directly for any harness:
 *
 *   node bridge.mjs --harness antigravity --host 0.0.0.0 --port 7801
 *   node bridge.mjs --harness claude --host 0.0.0.0 --port 7802
 *   node bridge.mjs --harness all --lan
 *
 * The repo also has thin launchers in `antigravity-bridge/` and
 * `claude-bridge/`. The single file is the portable download.
 *
 * The token is required whenever the bridge listens on a non-loopback address.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BRIDGE_VERSION = "1.3.0";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * One token file is shared by every harness bridge. Restarting a bridge (or
 * switching between Antigravity and Claude) reuses the same token instead of
 * forcing the app to reconnect.
 */
export function defaultTokenFile() {
  if (process.env.MOBILE_AGENT_BRIDGE_TOKEN_FILE)
    return process.env.MOBILE_AGENT_BRIDGE_TOKEN_FILE;
  const root =
    process.platform === "win32"
      ? process.env.APPDATA || homedir()
      : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(root, "mobile-agent", "bridge-token");
}

function readTokenFile(path) {
  try {
    return readFileSync(path, "utf8").trim() || null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(
      `Could not read the bridge token file at ${path}: ${error.message}`,
    );
  }
}

function createTokenFile(path) {
  const token = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, `${token}\n`, { flag: "wx", mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows does not use POSIX permissions.
    }
    return { token, created: true };
  } catch (error) {
    if (error.code === "EEXIST") {
      const existing = readTokenFile(path);
      if (existing) return { token: existing, created: false };
      // A previous run left an empty token file. Fill it instead of failing.
      writeFileSync(path, `${token}\n`, { mode: 0o600 });
      try {
        chmodSync(path, 0o600);
      } catch {
        // Windows does not use POSIX permissions.
      }
      return { token, created: true };
    }
    throw new Error(
      `Could not create the bridge token file at ${path}: ${error.message}`,
    );
  }
}

/**
 * Resolve the token without surprising existing loopback users:
 * - `--token` always wins and is never persisted.
 * - an explicit `--token-file` is read or created.
 * - the shared default file is reused when it exists.
 * - outside loopback, the shared file is created automatically.
 */
export function resolveBridgeToken({ host, token, tokenFile }) {
  if (token.trim()) return { token, source: "flag", created: false };

  const path = (tokenFile || defaultTokenFile()).replace(
    /^~(?=$|\/|\\)/,
    homedir(),
  );
  const existing = readTokenFile(path);
  if (existing) return { token: existing, source: path, created: false };

  if (!tokenFile && LOOPBACK_HOSTS.has(host))
    return { token: "", source: null, created: false };

  const created = createTokenFile(path);
  return { token: created.token, source: path, created: created.created };
}

/**
 * @typedef {object} BridgeProfile
 * @property {string} label Display name used in logs, docs, and usage text.
 * @property {string} service Value reported by `/health` and `/events`.
 * @property {number} defaultPort Default TCP port.
 * @property {string} envPrefix Prefix for environment-variable configuration.
 * @property {string} commandFlag CLI flag for the agent executable.
 * @property {string} commandEnv Environment variable for the agent executable.
 * @property {string} defaultCommand Default agent executable.
 * @property {string[]} defaultArgs Arguments always passed to the agent.
 * @property {string} argFlag CLI flag for repeated extra agent arguments.
 * @property {boolean} supportsAddDir Whether the agent accepts `--add-dir`.
 * @property {boolean} supportsSkipPermissions Whether the agent accepts its
 *   own auto-approval flag.
 * @property {string} signInHint One-line setup hint for `--help`.
 * @property {string[]} acceptedTokenHeaders Extra non-standard token headers.
 */

/** @type {BridgeProfile} */
export const ANTIGRAVITY_PROFILE = {
  label: "Antigravity",
  service: "antigravity-bridge",
  defaultPort: 7801,
  envPrefix: "ANTIGRAVITY_BRIDGE",
  commandFlag: "--agy",
  commandEnv: "ANTIGRAVITY_AGY",
  defaultCommand: "agy",
  defaultArgs: ["acp"],
  argFlag: "--agy-arg",
  supportsAddDir: true,
  supportsSkipPermissions: true,
  signInHint: "Sign in once with `agy acp --login`.",
  acceptedTokenHeaders: ["x-antigravity-token"],
};

/** @type {BridgeProfile} */
export const CLAUDE_PROFILE = {
  label: "Claude",
  service: "claude-bridge",
  defaultPort: 7802,
  envPrefix: "CLAUDE_BRIDGE",
  commandFlag: "--claude-agent-acp",
  commandEnv: "CLAUDE_AGENT_ACP",
  defaultCommand: "claude-agent-acp",
  defaultArgs: [],
  argFlag: "--agent-arg",
  supportsAddDir: false,
  supportsSkipPermissions: false,
  signInHint:
    "Sign in once with `claude auth login` (subscription) or set ANTHROPIC_API_KEY.",
  acceptedTokenHeaders: ["x-claude-token", "x-agent-token"],
};

function usage(profile) {
  const commandName = basename(profile.defaultCommand);
  const skipLine = profile.supportsSkipPermissions
    ? `\n  --dangerously-skip-permissions\n                         Pass ${profile.label}'s auto-approval flag.`
    : "";
  const addDirLine = profile.supportsAddDir
    ? `\n  --add-dir <path>       Extra workspace root passed to ${commandName}. Repeatable.`
    : "";
  return `${profile.label} ACP bridge ${BRIDGE_VERSION}

Usage:
  node bridge.mjs [options]

Options:
  --host <address>       Bind address (default: 127.0.0.1)
  --port <number>        Bind port (default: ${profile.defaultPort})
  --token-file <path>    Stable bridge token. Read on restart, created on
                         first use. Default: ${defaultTokenFile()}
                         Also ${profile.envPrefix}_TOKEN_FILE.
  ${profile.commandFlag} <path>
                         ${profile.label} agent binary (default: ${profile.defaultCommand})
  --agent <path>         Alias for ${profile.commandFlag}.
  --cwd <path>           Default session working directory (default: process cwd)
${addDirLine}
  ${profile.argFlag} <value>
                         Extra argument passed to the agent. Repeatable.
${skipLine}
  --help                 Show this help.

Advanced:
  --token <secret>       One-off token override. Not saved. Prefer --token-file.
                         Also ${profile.envPrefix}_TOKEN.

Setup:
  ${profile.signInHint}

Token:
  You only need one token for every harness bridge. Omit --token and
  --token-file to use the shared default above. The first bridge creates
  the file and prints the token; every restart and every other harness
  reuses it automatically. Copy that token into the app once.

Examples:
  node bridge.mjs
  node bridge.mjs --host 0.0.0.0 --port ${profile.defaultPort}
  node bridge.mjs --host 0.0.0.0 --port ${profile.defaultPort} --token-file ~/.config/mobile-agent/bridge-token
  node bridge.mjs ${profile.commandFlag} /usr/local/bin/${commandName} --cwd ~/code/project
`;
}

function parseArgs(profile, argv) {
  const env = (name) => process.env[`${profile.envPrefix}_${name}`];
  const options = {
    host: env("HOST") || "127.0.0.1",
    port: Number(env("PORT") || profile.defaultPort),
    token: env("TOKEN") || "",
    tokenFile: env("TOKEN_FILE") || "",
    agent:
      process.env[profile.commandEnv] || env("AGENT") || profile.defaultCommand,
    cwd: env("CWD") || process.cwd(),
    addDirs: [],
    agentArgs: [],
    skipPermissions: false,
    tokenSource: null,
    tokenCreated: false,
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
      case "--port":
        options.port = Number(next());
        break;
      case "--token":
        options.token = next();
        break;
      case "--token-file":
        options.tokenFile = next();
        break;
      case "--agent":
        options.agent = next();
        break;
      case "--cwd":
        options.cwd = next();
        break;
      case "--add-dir":
        if (!profile.supportsAddDir)
          throw new Error(`${profile.label} does not accept --add-dir.`);
        options.addDirs.push(next());
        break;
      case "--dangerously-skip-permissions":
        if (!profile.supportsSkipPermissions)
          throw new Error(
            `${profile.label} does not accept --dangerously-skip-permissions.`,
          );
        options.skipPermissions = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(usage(profile));
        process.exit(0);
        break;
      default:
        if (arg === profile.commandFlag) {
          options.agent = next();
          break;
        }
        if (arg === profile.argFlag) {
          options.agentArgs.push(next());
          break;
        }
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }

  const resolvedToken = resolveBridgeToken(options);
  options.token = resolvedToken.token;
  options.tokenSource = resolvedToken.source;
  options.tokenCreated = resolvedToken.created;

  if (!LOOPBACK_HOSTS.has(options.host) && !options.token.trim()) {
    throw new Error(
      `Refusing to listen on a non-loopback address without a token (use --token, --token-file, or ${profile.envPrefix}_TOKEN).`,
    );
  }

  options.cwd = resolve(options.cwd.replace(/^~(?=$|\/|\\)/, homedir()));
  options.addDirs = options.addDirs.map((value) =>
    resolve(value.replace(/^~(?=$|\/|\\)/, homedir())),
  );
  return options;
}

function readAgentVersion(binary) {
  try {
    const result = spawnSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 2500,
    });
    if (result.status !== 0) return null;
    return (result.stdout || result.stderr || "").trim().split(/\s+/).at(-1) || null;
  } catch {
    return null;
  }
}

function isAuthorized(request, url, token, profile) {
  if (!token) return true;
  const header = request.headers.authorization;
  if (header === `Bearer ${token}`) return true;
  if (request.headers["x-acp-token"] === token) return true;
  for (const name of profile.acceptedTokenHeaders) {
    if (request.headers[name] === token) return true;
  }
  // EventSource cannot set headers. Our app uses fetch, but allowing a query
  // token keeps other SSE clients usable over the same bridge.
  return url.searchParams.get("token") === token;
}

/** Start a bridge for one ACP harness. Never returns unless the process exits. */
export function runBridge(profile, argv = process.argv.slice(2)) {
  const options = parseArgs(profile, argv);
  const agentVersion = readAgentVersion(options.agent);
  const startedAt = Date.now();
  const clients = new Set();
  let shuttingDown = false;

  const agentArgs = [...profile.defaultArgs];
  if (options.skipPermissions) agentArgs.push("--dangerously-skip-permissions");
  for (const directory of options.addDirs) agentArgs.push("--add-dir", directory);
  agentArgs.push(...options.agentArgs);

  const child = spawn(options.agent, agentArgs, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`[bridge] Could not start ${options.agent}: ${error.message}`);
    broadcast("bridge", {
      type: "error",
      message: `Could not start ${options.agent}: ${error.message}`,
    });
    shutdown(1);
  });

  function sendEvent(response, event, data) {
    try {
      response.write(`event: ${event}\n`);
      for (const line of String(data).split("\n")) response.write(`data: ${line}\n`);
      response.write("\n");
    } catch {
      // The client disconnected. Cleanup happens on the close handler.
    }
  }

  function broadcast(event, data) {
    for (const response of clients) sendEvent(response, event, data);
  }

  function log(stream, line) {
    if (!line.trim()) return;
    const name = basename(options.agent);
    console.error(`[${name}:${stream}] ${line}`);
    broadcast("log", JSON.stringify({ stream, line }));
  }

  function writeToAgent(message) {
    if (child.stdin.destroyed || !child.stdin.writable) {
      throw new Error(`${profile.label} process is not writable.`);
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  stdout.on("line", (line) => {
    if (!line.trim()) return;
    // Forward the exact JSON-RPC envelope. The app owns request correlation.
    broadcast("message", line);
  });

  const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity });
  stderr.on("line", (line) => log("stderr", line));

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const detail = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[bridge] ${profile.label} exited (${detail}).`);
    broadcast("bridge", {
      type: "exit",
      code,
      signal,
      message: `${profile.label} ACP process exited (${detail}).`,
    });
    for (const response of clients) {
      try {
        response.end();
      } catch {
        // Ignore a socket that is already gone.
      }
    }
    clients.clear();
    setTimeout(() => process.exit(code ?? 1), 50).unref();
  });

  // Prompts can inline up to 20 MiB of attachments, which grows by roughly 4/3
  // after base64 encoding. Leave room for JSON framing and the prompt itself.
  function readJsonBody(request, limit = 40 * 1024 * 1024) {
    return new Promise((resolveBody, reject) => {
      let size = 0;
      const chunks = [];
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error("Request body is too large."));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        try {
          resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Error("Request body must be valid JSON."));
        }
      });
      request.on("error", reject);
    });
  }

  function sanitizeUploadName(value) {
    const name = basename(String(value || "attachment"))
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[^A-Za-z0-9._ -]+/g, "-")
      .slice(0, 160)
      .trim();
    return name && name !== "." && name !== ".." ? name : "attachment";
  }

  function uploadDirectory(value) {
    const requested = String(value || "").trim();
    return resolve(requested || options.cwd);
  }

  /**
   * Stream a raw request body into a session-scoped upload folder. Large files
   * never enter the bridge's JS heap, so phone attachments can be much larger
   * than the ACP prompt body limit.
   */
  async function writeUpload(request, path) {
    let size = 0;
    await pipeline(
      request,
      new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > MAX_UPLOAD_BYTES) {
            callback(new Error("Upload is too large."));
            return;
          }
          callback(null, chunk);
        },
      }),
      createWriteStream(path),
    );
    return size;
  }

  function commonHeaders() {
    return {
      // Without a token the bridge only listens on loopback. Do not advertise
      // CORS to arbitrary web pages in that mode; a token is what makes a
      // cross-origin client safe. Native apps are unaffected by CORS.
      ...(options.token ? { "Access-Control-Allow-Origin": "*" } : {}),
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, X-Acp-Token, X-Claude-Token, X-Agent-Token, X-Antigravity-Token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Cache-Control": "no-store",
    };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, commonHeaders());
      response.end();
      return;
    }

    if (!isAuthorized(request, url, options.token, profile)) {
      response.writeHead(401, {
        ...commonHeaders(),
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, {
        ...commonHeaders(),
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          ok: !child.killed && child.exitCode === null,
          service: profile.service,
          version: BRIDGE_VERSION,
          pid: process.pid,
          agent: options.agent,
          agentVersion,
          cwd: options.cwd,
          home: homedir(),
          uptimeMs: Date.now() - startedAt,
          sessions: "multiple",
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      response.writeHead(200, {
        ...commonHeaders(),
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write("retry: 1000\n\n");
      sendEvent(
        response,
        "ready",
        JSON.stringify({
          service: profile.service,
          version: BRIDGE_VERSION,
          agent: options.agent,
          agentVersion,
          cwd: options.cwd,
          home: homedir(),
        }),
      );
      clients.add(response);
      const heartbeat = setInterval(() => {
        try {
          response.write(": keepalive\n\n");
        } catch {
          // Cleanup below.
        }
      }, 15000);
      heartbeat.unref();
      const cleanup = () => {
        clearInterval(heartbeat);
        clients.delete(response);
      };
      request.on("close", cleanup);
      response.on("close", cleanup);
      response.on("error", cleanup);
      return;
    }

    if (request.method === "POST" && url.pathname === "/rpc") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        response.writeHead(400, {
          ...commonHeaders(),
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({ error: error.message }));
        return;
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        response.writeHead(400, {
          ...commonHeaders(),
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({ error: "Expected one JSON-RPC object." }));
        return;
      }
      try {
        writeToAgent(body);
      } catch (error) {
        response.writeHead(503, {
          ...commonHeaders(),
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({ error: error.message }));
        return;
      }
      response.writeHead(202, {
        ...commonHeaders(),
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ accepted: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/files") {
      const name = sanitizeUploadName(url.searchParams.get("name"));
      const directory = uploadDirectory(url.searchParams.get("directory"));
      const folder = join(directory, ".mobile-agent", "uploads", randomUUID());
      const path = join(folder, name);
      try {
        await mkdir(folder, { recursive: true });
        const size = await writeUpload(request, path);
        response.writeHead(201, {
          ...commonHeaders(),
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({ path, size, name }));
      } catch (error) {
        await unlink(path).catch(() => {});
        if (response.headersSent) {
          response.destroy();
          return;
        }
        const tooLarge = /too large/i.test(error.message);
        response.writeHead(tooLarge ? 413 : 400, {
          ...commonHeaders(),
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    response.writeHead(404, {
      ...commonHeaders(),
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify({ error: "Not found" }));
  });

  server.on("error", (error) => {
    console.error(`[bridge] HTTP server error: ${error.message}`);
    shutdown(1);
  });

  server.listen(options.port, options.host, () => {
    console.log(
      `[bridge] ${profile.label} ACP bridge ${BRIDGE_VERSION} listening on http://${options.host}:${options.port}`,
    );
    console.log(`[bridge] cwd: ${options.cwd}`);
    console.log(
      `[bridge] agent: ${options.agent}${agentVersion ? ` (${agentVersion})` : ""}`,
    );
    if (options.tokenSource === "flag") {
      console.log(
        "[bridge] Using --token. Omit --token to reuse the stable shared token file.",
      );
    } else if (options.tokenSource) {
      if (options.tokenCreated) {
        console.log(
          `[bridge] Created a stable shared bridge token at ${options.tokenSource}`,
        );
        console.log(`[bridge] Token: ${options.token}`);
        console.log(
          "[bridge] Copy this token into every harness. The other bridge will reuse it automatically.",
        );
      } else {
        console.log(
          `[bridge] Using the stable shared bridge token from ${options.tokenSource}`,
        );
      }
    } else if (!options.token) {
      console.log("[bridge] No token configured; loopback clients only.");
    }
  });

  function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[bridge] Shutting down.");
    for (const response of clients) {
      try {
        sendEvent(response, "bridge", JSON.stringify({ type: "shutdown" }));
        response.end();
      } catch {
        // Ignore.
      }
    }
    clients.clear();
    try {
      server.close();
    } catch {
      // Ignore.
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore.
    }
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore.
      }
      process.exit(exitCode);
    }, 1500).unref();
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

const BRIDGE_PROFILES = {
  antigravity: ANTIGRAVITY_PROFILE,
  claude: CLAUDE_PROFILE,
};

function displayBridgeHost(host) {
  if (host === "0.0.0.0" || host === "::") return "<this-computer-LAN-IP>";
  return host;
}

function allBridgesUsage() {
  return `Mobile Agent ACP bridges ${BRIDGE_VERSION}

Usage:
  node bridge.mjs --harness <antigravity|claude> [options]
  node bridge.mjs --harness all [options]
  node bridge.mjs [options]                 (same as --harness all)

Single-harness options:
  node bridge.mjs --harness antigravity --help
  node bridge.mjs --harness claude --help

All-harness options:
  --host <address>          Bind address for both bridges (default 127.0.0.1)
  --lan                     Shortcut for --host 0.0.0.0
  --antigravity-port <n>    Antigravity port (default 7801)
  --claude-port <n>         Claude port (default 7802)
  --token-file <path>       Shared stable token file
                            (default ${defaultTokenFile()})
  --cwd <path>              Default session working directory for both
  --only <harness>          Start only "antigravity" or "claude"
  --help                    Show this help

Both harnesses keep their own process, so one agent crashing does not stop the
other. Each restart reuses the same stable token file.
`;
}

function parseAllBridgesArgs(argv) {
  const options = {
    host: "127.0.0.1",
    ports: {
      antigravity: ANTIGRAVITY_PROFILE.defaultPort,
      claude: CLAUDE_PROFILE.defaultPort,
    },
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
        process.stdout.write(allBridgesUsage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.only && !BRIDGE_PROFILES[options.only])
    throw new Error(`--only must be "antigravity" or "claude".`);
  for (const [id, port] of Object.entries(options.ports)) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error(`The ${id} port must be between 1 and 65535.`);
  }
  return options;
}

/** Start every harness bridge in its own child process. */
export function runAllBridges(argv = process.argv.slice(2)) {
  const options = parseAllBridgesArgs(argv);
  const selected = Object.entries(BRIDGE_PROFILES).filter(
    ([id]) => !options.only || id === options.only,
  );
  const tokenFile = (options.tokenFile || defaultTokenFile()).replace(
    /^~(?=$|\/|\\)/,
    homedir(),
  );
  const script = fileURLToPath(import.meta.url);
  const children = new Map();
  let shuttingDown = false;

  function finish(id, code) {
    if (!children.has(id)) return;
    children.delete(id);
    const label = BRIDGE_PROFILES[id]?.label ?? id;
    if (shuttingDown) {
      if (children.size === 0) process.exit(0);
      return;
    }
    if (children.size > 0) {
      console.error(
        `[start] ${label} stopped. ${[...children.keys()]
          .map((childID) => BRIDGE_PROFILES[childID]?.label ?? childID)
          .join(", ")} still running.`,
      );
      return;
    }
    process.exit(code ?? 1);
  }

  for (const [id, profile] of selected) {
    const port = options.ports[id];
    const args = [
      script,
      "--harness",
      id,
      "--host",
      options.host,
      "--port",
      String(port),
      "--token-file",
      tokenFile,
    ];
    if (options.cwd) args.push("--cwd", options.cwd);
    console.log(
      `[start] ${profile.label} bridge -> http://${displayBridgeHost(options.host)}:${port}`,
    );
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    children.set(id, child);
    child.on("error", (error) => {
      console.error(
        `[start] Could not start the ${profile.label} bridge: ${error.message}`,
      );
      finish(id, 1);
    });
    child.on("exit", (code, signal) => {
      if (!shuttingDown)
        console.error(
          `[start] ${profile.label} bridge exited (${signal ? `signal ${signal}` : `code ${code}`}).`,
        );
      finish(id, code);
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
}

function directHarnessArgv(argv) {
  let harness = null;
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--harness") {
      rest.push(arg);
      continue;
    }
    harness = argv[index + 1];
    if (harness === undefined)
      throw new Error("--harness requires antigravity, claude, or all.");
    index += 1;
  }
  return { harness, rest };
}

function runDirect(argv) {
  const { harness, rest } = directHarnessArgv(argv);
  if (!harness || harness === "all") {
    runAllBridges(rest);
    return;
  }
  const profile = BRIDGE_PROFILES[harness];
  if (!profile) {
    console.error(
      `Unknown harness "${harness}". Use "antigravity", "claude", or "all".`,
    );
    process.exit(1);
  }
  runBridge(profile, rest);
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return pathToFileURL(resolve(entry)).href === import.meta.url;
  }
}

if (isMainModule()) runDirect(process.argv.slice(2));
