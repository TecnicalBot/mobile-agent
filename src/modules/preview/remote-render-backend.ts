import { File, Paths } from "expo-file-system";

import {
  concatDeviceSegments,
  profileIdFor,
  requireHardwareEncoding,
  type RenderBackend,
  type RenderCapabilities,
  type RenderProfile,
  type SegmentArtifact,
  type SegmentRequest,
} from "@/modules/preview/render-backend";
import type { VideoRenderPlan } from "@/modules/preview/video-render";
import { normalizeRemoteRenderBaseUrl } from "@/modules/preview/remote-render-settings";

/**
 * A GPU render node as a segment producer. See `tools/render-service/` for the
 * server and `docs/remote-render.md` for the design.
 *
 * What is *not* here is deliberate: no cache, no progress aggregation, no
 * pruning, no concat policy. Those belong to `render-segments.ts` so the remote
 * and device paths cannot drift. This file only speaks HTTP and writes bytes
 * into the device cache.
 */

export type RemoteRenderConfig = {
  /** Service root, e.g. `http://192.168.1.20:8787`. */
  baseUrl: string;
  /** Bearer token, when the node requires one. */
  token?: string | null;
  /** Parallel segment requests. Clamped by the node's own limit. */
  concurrency?: number;
  capabilitiesTimeoutMs?: number;
  probeTimeoutMs?: number;
};

const DEFAULT_CAPABILITIES_TIMEOUT_MS = 10_000;
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
/**
 * A 45 s segment is well under a minute on a mid-range GPU; ten minutes is a
 * "something is badly wrong" backstop, not a normal limit.
 */
const RENDER_TIMEOUT_MS = 10 * 60_000;
const CANCEL_TIMEOUT_MS = 3_000;

function abortError(what: string) {
  const error = new Error(`${what} cancelled.`);
  error.name = "AbortError";
  return error;
}

/** Fetch with both a caller abort and a hard deadline, and actionable errors. */
async function request(
  what: string,
  url: string,
  init: RequestInit,
  options: { signal?: AbortSignal; timeoutMs: number },
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;

  const forwardAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", forwardAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (options.signal?.aborted) throw abortError(what);
    if (timedOut) {
      throw new Error(
        `The render node did not answer during ${what} within ${Math.round(
          options.timeoutMs / 1000,
        )} s. Check that it is reachable and healthy (GET /v1/health).`,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach the render node at ${url} during ${what}: ${detail}. ` +
        `Check the address in Settings → Video rendering, and that the node is running.`,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Not JSON; fall through to the raw body.
  }
  const body = text.trim();
  return body ? body.slice(0, 400) : `HTTP ${response.status}`;
}

async function fetchCapabilities(
  baseUrl: string,
  token: string | null,
  timeoutMs: number,
): Promise<RenderCapabilities> {
  const response = await request(
    "capabilities",
    `${baseUrl}/v1/capabilities`,
    { headers: token ? { authorization: `Bearer ${token}` } : undefined },
    { timeoutMs },
  );

  if (!response.ok) {
    throw Object.assign(
      new Error(`The render node rejected the capabilities request: ${await readError(response)}`),
      { status: response.status },
    );
  }

  const body = (await response.json()) as Partial<RenderCapabilities>;
  return {
    encoders: Array.isArray(body.encoders)
      ? body.encoders.filter((name): name is string => typeof name === "string")
      : [],
    preferred: typeof body.preferred === "string" ? body.preferred : null,
    hardware: body.hardware === true,
    gpu: body.gpu,
    canvas: body.canvas === "gpu" ? "gpu" : "cpu",
  };
}

function makeJobId() {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Best effort: cancelling the HTTP request does not kill a running ffmpeg. */
function cancelRemoteJob(baseUrl: string, token: string | null, jobId: string) {
  void request(
    "cancel",
    `${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`,
    { method: "DELETE", headers: token ? { authorization: `Bearer ${token}` } : undefined },
    { timeoutMs: CANCEL_TIMEOUT_MS },
  ).catch(() => {
    // The render is already failing/aborting; a missed cancel is not new info.
  });
}

/**
 * Resolve the node, prove it can hardware-encode, and return a backend. Async
 * on purpose: the encoder has to be known *before* the first profile is built,
 * and a target that cannot encode must fail here rather than after minutes of
 * work.
 */
export async function createRemoteRenderBackend(
  config: RemoteRenderConfig,
): Promise<RenderBackend> {
  const baseUrl = normalizeRemoteRenderBaseUrl(config.baseUrl);
  if (!baseUrl) {
    throw new Error(
      `"${config.baseUrl}" is not a usable render-node address. Use a full URL including the port, e.g. http://192.168.1.20:8787.`,
    );
  }

  const token = config.token?.trim() || null;
  const concurrency = Math.max(1, Math.min(8, Math.round(config.concurrency ?? 4)));
  const capabilities = await fetchCapabilities(
    baseUrl,
    token,
    config.capabilitiesTimeoutMs ?? DEFAULT_CAPABILITIES_TIMEOUT_MS,
  );

  // Throws a one-line, actionable error on a software-only box. This is the
  // promise behind "remote rendering uses the GPU".
  const encoder = requireHardwareEncoding(capabilities);
  const codec = encoder.startsWith("hevc") ? "hevc" : "h264";

  return {
    id: "remote",
    label: capabilities.gpu?.name
      ? `${capabilities.gpu.name} (remote)`
      : "Remote render node",
    kind: "remote",
    concurrency,
    supportsProbe: true,
    capabilities: async () => capabilities,

    profileFor: (plan: Pick<VideoRenderPlan, "width" | "height" | "fps"> | null): RenderProfile => ({
      id: profileIdFor({
        encoder,
        width: plan?.width ?? 0,
        height: plan?.height ?? 0,
        fps: plan?.fps ?? 0,
        codec,
      }),
      width: plan?.width ?? 0,
      height: plan?.height ?? 0,
      fps: plan?.fps ?? 0,
      codec,
      pixelFormat: "yuv420p",
      // The node's encoder chooses its own rate from its quality mode.
      bitrateKbps: 0,
      encoder,
      hardware: true,
    }),

    probe: async (documentHtml, options) => {
      const response = await request(
        "probe",
        `${baseUrl}/v1/probe`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ html: documentHtml }),
        },
        {
          signal: options?.signal,
          timeoutMs: config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        },
      );

      if (!response.ok) {
        throw new Error(`The render node could not read the scene: ${await readError(response)}`);
      }

      const plan = (await response.json()) as VideoRenderPlan;
      if (
        !plan ||
        typeof plan.duration !== "number" ||
        typeof plan.sharedHash !== "string" ||
        !Array.isArray(plan.shots)
      ) {
        throw new Error("The render node returned a malformed scene plan.");
      }
      return plan;
    },

    renderSegment: async (request_: SegmentRequest): Promise<SegmentArtifact> => {
      const jobId = makeJobId();
      const offset = request_.segment?.offset ?? 0;
      const length = request_.segment?.length ?? request_.duration ?? 0;

      request_.onProgress?.(0);

      let response: Response;
      try {
        response = await request(
          "render",
          `${baseUrl}/v1/render`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              html: request_.documentHtml,
              offset,
              length,
              jobId,
              // A resumed run pins the encoder recorded by its cached
              // segments; the profile already does this, but an explicit pin
              // makes a mismatched node fail with its own error text.
              ...(request_.pinnedEncoder ? { encoder: request_.pinnedEncoder } : {}),
            }),
          },
          { signal: request_.signal, timeoutMs: RENDER_TIMEOUT_MS },
        );
      } catch (error) {
        if (request_.signal?.aborted) cancelRemoteJob(baseUrl, token, jobId);
        throw error;
      }

      if (!response.ok) {
        throw new Error(
          `The render node could not render ${offset}s–${offset + length}s: ${await readError(
            response,
          )}`,
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new Error("The render node returned an empty video segment.");
      }

      // A fresh name per job: the caller moves this into its cache file, and
      // a retry must never overwrite a segment that is still being read.
      const file = new File(Paths.cache, `remote-${jobId}.mp4`);
      file.write(bytes);

      request_.onProgress?.(1);
      return {
        uri: file.uri,
        encoder,
        hasAudio: false,
        audioWarnings: [],
      };
    },

    // Segments are already on the device by now; join them natively, exactly
    // like the device backend. Never upload them back to the node.
    concat: async (uris, outUri) => {
      await concatDeviceSegments(uris, outUri);
    },
  };
}
