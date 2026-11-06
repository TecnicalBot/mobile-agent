#!/usr/bin/env node
/* global Buffer */
/**
 * Portable HTTP/SSE bridge for `agy acp`.
 *
 * The Antigravity CLI speaks newline-delimited JSON-RPC over stdio. This bridge
 * keeps that process alive and exposes it over ordinary HTTP so phones, tablets,
 * and remote clients can talk to Antigravity without sharing a terminal.
 *
 *   POST /rpc     -> write one JSON-RPC message to `agy acp`
 *   GET  /events  -> SSE stream of every JSON-RPC message from `agy acp`
 *   POST /files   -> stream a large attachment into the session directory
 *   GET  /health  -> bridge and agent metadata
 *
 * No npm dependencies. Run it on the same machine as the Antigravity CLI:
 *
 *   node bridge.mjs --host 0.0.0.0 --port 7801 --token <secret>
 *
 * The token is required whenever the bridge listens on a non-loopback address.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const VERSION = "1.1.0";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

function usage() {
  return `Antigravity ACP bridge ${VERSION}

Usage:
  node bridge.mjs [options]

Options:
  --host <address>       Bind address (default: 127.0.0.1)
  --port <number>        Bind port (default: 7801)
  --token <secret>       Bearer token. Also ANTIGRAVITY_BRIDGE_TOKEN.
                         Required when binding outside loopback.
  --agy <path>           Antigravity CLI binary (default: agy)
  --cwd <path>           Default session working directory (default: process cwd)
  --add-dir <path>       Extra workspace root passed to agy acp. Repeatable.
  --agy-arg <value>      Extra argument passed to agy acp. Repeatable.
  --dangerously-skip-permissions
                         Pass Antigravity's auto-approval flag.
  --help                 Show this help.

Examples:
  node bridge.mjs
  node bridge.mjs --host 0.0.0.0 --port 7801 --token change-me
  node bridge.mjs --agy /usr/local/bin/agy --cwd ~/code/project
`;
}

function parseArgs(argv) {
  const options = {
    host: process.env.ANTIGRAVITY_BRIDGE_HOST || "127.0.0.1",
    port: Number(process.env.ANTIGRAVITY_BRIDGE_PORT || 7801),
    token: process.env.ANTIGRAVITY_BRIDGE_TOKEN || "",
    agy: process.env.ANTIGRAVITY_AGY || "agy",
    cwd: process.env.ANTIGRAVITY_BRIDGE_CWD || process.cwd(),
    addDirs: [],
    agyArgs: [],
    skipPermissions: false,
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
      case "--agy":
        options.agy = next();
        break;
      case "--cwd":
        options.cwd = next();
        break;
      case "--add-dir":
        options.addDirs.push(next());
        break;
      case "--agy-arg":
        options.agyArgs.push(next());
        break;
      case "--dangerously-skip-permissions":
        options.skipPermissions = true;
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

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }
  if (!LOOPBACK_HOSTS.has(options.host) && !options.token.trim()) {
    throw new Error(
      "Refusing to listen on a non-loopback address without --token (or ANTIGRAVITY_BRIDGE_TOKEN).",
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

function isAuthorized(request, url, token) {
  if (!token) return true;
  const header = request.headers.authorization;
  if (header === `Bearer ${token}`) return true;
  if (request.headers["x-antigravity-token"] === token) return true;
  // EventSource cannot set headers. Our app uses fetch, but allowing a query
  // token keeps other SSE clients usable over the same bridge.
  return url.searchParams.get("token") === token;
}

const options = parseArgs(process.argv.slice(2));
const agentVersion = readAgentVersion(options.agy);
const startedAt = Date.now();
const clients = new Set();
let shuttingDown = false;

const agyArgs = ["acp"];
if (options.skipPermissions) agyArgs.push("--dangerously-skip-permissions");
for (const directory of options.addDirs) agyArgs.push("--add-dir", directory);
agyArgs.push(...options.agyArgs);

const child = spawn(options.agy, agyArgs, {
  cwd: options.cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

child.on("error", (error) => {
  console.error(`[bridge] Could not start ${options.agy}: ${error.message}`);
  broadcast("bridge", {
    type: "error",
    message: `Could not start ${options.agy}: ${error.message}`,
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
  console.error(`[agy:${stream}] ${line}`);
  broadcast("log", JSON.stringify({ stream, line }));
}

function writeToAgent(message) {
  if (child.stdin.destroyed || !child.stdin.writable) {
    throw new Error("Antigravity process is not writable.");
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
  console.error(`[bridge] Antigravity exited (${detail}).`);
  broadcast("bridge", {
    type: "exit",
    code,
    signal,
    message: `Antigravity ACP process exited (${detail}).`,
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Antigravity-Token",
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

  if (!isAuthorized(request, url, options.token)) {
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
        service: "antigravity-bridge",
        version: VERSION,
        pid: process.pid,
        agent: options.agy,
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
        service: "antigravity-bridge",
        version: VERSION,
        agent: options.agy,
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
    `[bridge] Antigravity ACP bridge ${VERSION} listening on http://${options.host}:${options.port}`,
  );
  console.log(`[bridge] cwd: ${options.cwd}`);
  console.log(
    `[bridge] agent: ${options.agy}${agentVersion ? ` (${agentVersion})` : ""}`,
  );
  if (!options.token) {
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
