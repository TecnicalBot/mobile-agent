/**
 * Chrome launcher + a minimal DevTools Protocol client.
 *
 * Deliberately dependency-free: Node 24 ships a global WebSocket, so a render
 * node needs nothing but `node` and `ffmpeg`. (Playwright would add ~300 MB and
 * pin its own Chromium build, which is exactly what you do not want when the
 * point is the host's GPU driver.)
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/opt/google/chrome/chrome",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

function findChrome() {
  for (const candidate of CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error(
    "No Chrome/Chromium found. Set CHROME_PATH to the binary (see tools/render-service/README.md).",
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return readFileSync(path, "utf8");
    await sleep(50);
  }
  return null;
}

/** Chrome flags that matter for frame-accurate, GPU-rasterized capture. */
export function chromeFlags({ hasGpu }) {
  const flags = [
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    // Rendering is driven frame by frame; throttling would only add jitter.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-device-scale-factor=1",
    // Keep the page's canvas at its declared size regardless of window size.
    "--window-size=1920,1920",
  ];

  if (hasGpu) {
    flags.push(
      "--use-angle=gl",
      "--enable-gpu-rasterization",
      "--enable-zero-copy",
      "--ignore-gpu-blocklist",
      // Fail loudly instead of silently rasterizing on the CPU, which is the
      // whole reason this service exists.
      "--disable-software-rasterizer",
    );
  } else {
    // No GPU: allow the software path rather than refusing to start, and let
    // /v1/capabilities report canvas: "cpu" so the app can refuse the target.
    flags.push("--enable-unsafe-swiftshader");
  }

  if (process.getuid?.() === 0 || process.env.MA_RENDER_NO_SANDBOX === "1") {
    // Chrome refuses to start as root with the sandbox on. Documented in the
    // README: run this as an unprivileged user in production.
    flags.push("--no-sandbox");
  }

  // Escape hatch for a host that needs one more flag to reach the GPU
  // (`--use-gl=egl`, a different ANGLE backend, a display override). Appended
  // last so it can win over the defaults above.
  const extra = process.env.MA_RENDER_CHROME_FLAGS;
  if (extra) flags.push(...extra.split(/\s+/).filter(Boolean));

  return flags;
}

export async function launchChrome({ hasGpu = false, timeoutMs = 25_000 } = {}) {
  const binary = findChrome();
  const profileDir = mkdtempSync(join(tmpdir(), "ma-render-"));
  const flags = [...chromeFlags({ hasGpu }), `--user-data-dir=${profileDir}`, "about:blank"];

  const child = spawn(binary, flags, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
  });

  const exited = new Promise((resolve) => child.once("exit", resolve));
  const activePort = await Promise.race([
    waitForFile(join(profileDir, "DevToolsActivePort"), timeoutMs),
    exited.then(() => null),
  ]);

  if (!activePort) {
    child.kill("SIGKILL");
    rmSync(profileDir, { recursive: true, force: true });
    throw new Error(
      `Chrome did not expose a debugging port within ${timeoutMs} ms.\n${stderr.trim()}`,
    );
  }

  const [port] = activePort.split("\n");
  return {
    port: Number(port),
    async close() {
      child.kill("SIGKILL");
      await exited.catch(() => {});
      rmSync(profileDir, { recursive: true, force: true });
    },
  };
}

/** A page target's CDP session. One session = one job; close it when done. */
export async function openPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(`Could not open a page target: HTTP ${response.status}`);
  }
  const target = await response.json();
  const page = await connect(target.webSocketDebuggerUrl);

  // Closing the socket alone leaves the target alive in Chrome, and a render
  // node opens one target per segment. Close the target too, or memory grows
  // with every job until the process is restarted.
  const closeSocket = page.close;
  return {
    ...page,
    close() {
      closeSocket();
      void fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(
        () => {
          // Target already gone.
        },
      );
    },
  };
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP socket failed")), {
      once: true,
    });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
      else entry.resolve(message.result);
      return;
    }
    const handler = listeners.get(message.method);
    if (handler) handler(message.params);
  });

  const closed = new Promise((resolve) => socket.addEventListener("close", resolve, { once: true }));

  return {
    closed,
    send(method, params = {}, timeoutMs = 120_000) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, handler) {
      listeners.set(method, handler);
    },
    async evaluate(expression, { awaitPromise = true, timeoutMs = 120_000 } = {}) {
      const result = await this.send(
        "Runtime.evaluate",
        {
          expression,
          awaitPromise,
          returnByValue: true,
          allowUnsafeEvalBlockedByCSP: true,
        },
        timeoutMs,
      );
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails;
        throw new Error(
          detail.exception?.description ?? detail.text ?? "Page evaluation failed",
        );
      }
      return result.result?.value;
    },
    close() {
      try {
        socket.close();
      } catch {
        // Already gone.
      }
    },
  };
}
