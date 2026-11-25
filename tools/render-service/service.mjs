#!/usr/bin/env node
/**
 * Remote render node for the Mobile Agent video pipeline.
 *
 * Implements the contract in `docs/remote-render.md` §7:
 *
 *   GET    /v1/health
 *   GET    /v1/capabilities
 *   POST   /v1/probe        { html }                    -> plan
 *   POST   /v1/render       { html, offset, length }    -> video/mp4
 *   DELETE /v1/jobs/:id                                 -> cancels an in-flight render
 *
 * v1 renders SILENT, CLIP-FREE scenes. Anything else fails loudly rather than
 * producing a wrong file — see README.md §Status.
 *
 *   node tools/render-service/service.mjs
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { detectCapabilities, setCanvasMode } from "./capabilities.mjs";
import { launchChrome, openPage } from "./chromium.mjs";
import { buildDocument, renderSegment, waitForHarness } from "./render.mjs";

const PORT = Number(process.env.MA_RENDER_PORT || 8787);
const HOST = process.env.MA_RENDER_HOST || "127.0.0.1";
const TOKEN = process.env.MA_RENDER_TOKEN || "";
const CONCURRENCY = Math.max(1, Number(process.env.MA_RENDER_CONCURRENCY || 4));
// A scene is usually a few KB, but the app can fall back to data-URI images
// (15 MB each) on builds without its loopback asset server. Keep ample room and
// fail with 413 rather than truncating a document.
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const ALLOW_SOFTWARE = process.env.MA_ALLOW_SOFTWARE === "1";

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  return async function run(fn) {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = waiting.shift();
      if (next) next();
    }
  };
}

const limit = createLimiter(CONCURRENCY);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Body is not valid JSON"), { status: 400 });
  }
}

function authorize(req) {
  if (!TOKEN) return true;
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

async function main() {
  const capabilities = await detectCapabilities();

  if (!capabilities.hardware && !ALLOW_SOFTWARE) {
    console.error(
      [
        "No hardware encoder could be opened on this machine.",
        `Tried: ${capabilities.rejected.map((entry) => entry.encoder).join(", ") || "none present"}`,
        "Rendering here would run on the CPU: slower than the phone and no cheaper.",
        "Fix the driver (README.md §GPU) or start with MA_ALLOW_SOFTWARE=1 to debug.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const chrome = await launchChrome({ hasGpu: Boolean(capabilities.gpu) });
  log(
    `capabilities: encoder=${capabilities.preferred ?? "none"} gpu=${capabilities.gpu?.name ?? "none"}`,
  );

  // One page probe decides `canvas`, because "GPU present" and "Chromium is
  // actually rasterizing on the GPU" are different claims.
  try {
    const page = await openPage(chrome.port);
    await page.send("Page.enable");
    const { frameTree } = await page.send("Page.getFrameTree");
    await page.send("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html: "<!doctype html><html><body></body></html>",
    });
    const info = await page.evaluate(
      `(() => {
         const probe = document.createElement('canvas');
         const gl = probe.getContext('webgl2') || probe.getContext('webgl');
         if (!gl) return { renderer: 'none', canvas: 'cpu' };
         const ext = gl.getExtension('WEBGL_debug_renderer_info');
         const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
         const software = /swiftshader|llvmpipe|software|basic render/i.test(String(renderer));
         return { renderer: String(renderer), canvas: software ? 'cpu' : 'gpu' };
       })()`,
    );
    setCanvasMode(info.canvas);
    log(`canvas: ${info.canvas} (${info.renderer})`);
    page.close();
  } catch (error) {
    setCanvasMode("cpu");
    log(`canvas probe failed: ${error.message}`);
  }

  const jobs = new Map();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    try {
      if (path === "/v1/health" && req.method === "GET") {
        return sendJson(res, 200, { ok: true, version: 1 });
      }

      if (!authorize(req)) {
        return sendJson(res, 401, { error: "Missing or invalid bearer token." });
      }

      if (path === "/v1/capabilities" && req.method === "GET") {
        return sendJson(res, 200, {
          encoders: capabilities.encoders,
          preferred: capabilities.preferred,
          hardware: capabilities.hardware,
          gpu: capabilities.gpu,
          canvas: capabilities.canvas,
          rejected: capabilities.rejected,
        });
      }

      if (path === "/v1/probe" && req.method === "POST") {
        const body = await readJson(req);
        if (typeof body.html !== "string" || !body.html) {
          return sendJson(res, 400, { error: "`html` is required." });
        }
        const plan = await limit(async () => {
          const page = await openPage(chrome.port);
          try {
            return await probePage(page, body.html);
          } finally {
            page.close();
          }
        });
        return sendJson(res, 200, plan);
      }

      if (path === "/v1/render" && req.method === "POST") {
        const body = await readJson(req);
        if (typeof body.html !== "string" || !body.html) {
          return sendJson(res, 400, { error: "`html` is required." });
        }
        const encoder = body.encoder || capabilities.preferred;
        if (!encoder || !capabilities.encoders.includes(encoder)) {
          return sendJson(res, 400, {
            error: `Unknown or unavailable encoder "${encoder}".`,
            encoders: capabilities.encoders,
          });
        }

        const jobId = typeof body.jobId === "string" && body.jobId ? body.jobId : randomUUID();
        const controller = new AbortController();
        jobs.set(jobId, controller);

        // The app's pool cancels by closing the request; wire that to ffmpeg.
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });

        const dir = await mkdtemp(join(tmpdir(), "ma-seg-"));
        const outPath = join(dir, "segment.mp4");
        try {
          const result = await limit(async () => {
            const page = await openPage(chrome.port);
            try {
              return await renderSegment({
                page,
                html: body.html,
                segment: { offset: Number(body.offset) || 0, length: Number(body.length) || 0 },
                encoder,
                outPath,
                signal: controller.signal,
              });
            } finally {
              page.close();
            }
          });

          const info = await stat(outPath);
          res.writeHead(200, {
            "content-type": "video/mp4",
            "content-length": info.size,
            "x-ma-encoder": encoder,
            "x-ma-frames": String(result.frames),
            "x-ma-plan": JSON.stringify(result.plan),
          });
          await new Promise((resolve, reject) => {
            createReadStream(outPath)
              .on("error", reject)
              .on("end", resolve)
              .pipe(res);
          });
        } finally {
          jobs.delete(jobId);
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
        return;
      }

      const cancel = /^\/v1\/jobs\/([^/]+)$/.exec(path);
      if (cancel && req.method === "DELETE") {
        const controller = jobs.get(cancel[1]);
        if (!controller) return sendJson(res, 404, { error: "No such job." });
        controller.abort();
        return sendJson(res, 202, { cancelled: true });
      }

      return sendJson(res, 404, { error: "Not found." });
    } catch (error) {
      const status = error?.status ?? 500;
      if (!res.headersSent) {
        sendJson(res, status, { error: String(error?.message ?? error) });
      } else {
        res.destroy();
      }
      if (status >= 500) log(`request failed: ${error?.stack ?? error}`);
    }
  });

  // A 45 s segment at 1080p can legitimately take a while on a cold page.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.listen(PORT, HOST, () => {
    log(`render service on http://${HOST}:${PORT} (concurrency ${CONCURRENCY})`);
  });

  const shutdown = async () => {
    log("shutting down");
    server.close();
    await chrome.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Load a document and ask the page for its plan, without rendering a frame. */
async function probePage(page, html) {
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  const { frameTree } = await page.send("Page.getFrameTree");
  await page.send("Page.setDocumentContent", {
    frameId: frameTree.frame.id,
    html: buildDocument(html),
  });
  try {
    await waitForHarness(page);
  } catch (error) {
    throw Object.assign(error, { status: 400 });
  }
  return page.evaluate("window.__maPlan()");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
