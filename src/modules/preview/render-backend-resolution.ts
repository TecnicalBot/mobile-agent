import type { ConfigRepository } from "@/core/db/repositories/types";
import type { SecretStore } from "@/core/services/secrets";
import {
  createDeviceRenderBackend,
  type RenderBackend,
} from "@/modules/preview/render-backend";
import { createRemoteRenderBackend } from "@/modules/preview/remote-render-backend";
import {
  renderSegments,
  type SegmentRenderResult,
} from "@/modules/preview/render-segments";

/**
 * One place that decides where a video renders. Both surfaces — the
 * `renderVideo` tool and the preview dialog's Export button — call this, so the
 * user's setting cannot apply to one and not the other.
 *
 * Failure policy: a remote node that cannot be *used* (unreachable, no hardware
 * encoder, bad token) falls back to the device with a warning, because failing
 * an export the phone could have finished is worse than a slower one. A scene
 * the node explicitly cannot render yet (audio, clips) gets one clean device
 * retry — see `isUnsupportedSceneError`. Any other mid-run failure propagates:
 * the segment cache is profile-scoped, so switching backends after some
 * segments landed would throw away every remote segment. The user's retry then
 * resolves the backend again from scratch.
 */
export type RenderBackendResolution = {
  backend: RenderBackend;
  /** Set when a remote backend was configured but the device was used instead. */
  warning?: string;
};

/**
 * Load the token lazily. Importing the secret store drags in
 * `expo-secure-store` (and through it React Native), which the video pipeline's
 * Node-side tests must not pull into their module graph. It is only needed when
 * a remote node is actually enabled.
 */
async function readStoredRemoteToken(): Promise<string | null> {
  const { secureSecretStore } = await import("@/core/services/secrets");
  return secureSecretStore.getRemoteRenderToken();
}

export async function resolveRenderBackend(options: {
  configRepository?: ConfigRepository | null;
  secretStore?: Pick<SecretStore, "getRemoteRenderToken"> | null;
  /** Injection point for tests. */
  device?: RenderBackend;
} = {}): Promise<RenderBackendResolution> {
  const device = options.device ?? createDeviceRenderBackend();
  const configRepository = options.configRepository;

  if (!configRepository) {
    return { backend: device };
  }

  let remote;
  try {
    remote = (await configRepository.getSettings()).remoteRender;
  } catch (error) {
    return {
      backend: device,
      warning: `Could not read the video rendering setting (${error instanceof Error ? error.message : String(error)}); rendered on this device.`,
    };
  }

  if (!remote?.enabled || !remote.baseUrl) {
    return { backend: device };
  }

  try {
    const token = options.secretStore
      ? await options.secretStore.getRemoteRenderToken()
      : await readStoredRemoteToken();

    const backend = await createRemoteRenderBackend({
      baseUrl: remote.baseUrl,
      token,
      concurrency: remote.concurrency,
    });

    return { backend };
  } catch (error) {
    return {
      backend: device,
      warning: `Remote rendering is enabled but ${remote.baseUrl} is unusable: ${
        error instanceof Error ? error.message : String(error)
      } Rendered on this device instead.`,
    };
  }
}

/**
 * The node states plainly which scene features it does not have yet (audio,
 * clips). That is not a reason to fail an export the phone can finish, so the
 * whole run is retried once on the device. Nothing has been cached under the
 * remote profile at that point — the node rejects the scene before writing a
 * segment — so the retry is a normal, fresh device render.
 */
function isUnsupportedSceneError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /not supported by this render node/i.test(error.message)
  );
}

export type RenderOutcome = {
  result: SegmentRenderResult;
  /** Present when the run fell back to the device. */
  warning?: string;
};

/**
 * Resolve a backend and render in one call, so every surface gets the same
 * setting, the same device fallback, and the same warning text.
 */
export async function renderVideoWithResolvedBackend(
  options: Parameters<typeof renderSegments>[0],
  deps: {
    configRepository?: ConfigRepository | null;
    secretStore?: Pick<SecretStore, "getRemoteRenderToken"> | null;
  } = {},
): Promise<RenderOutcome> {
  const { backend, warning } = await resolveRenderBackend(deps);

  try {
    const result = await renderSegments({ ...options, backend });
    return { result, warning };
  } catch (error) {
    if (
      backend.kind !== "remote" ||
      options.abortSignal?.aborted ||
      !isUnsupportedSceneError(error)
    ) {
      throw error;
    }

    const result = await renderSegments({
      ...options,
      backend: createDeviceRenderBackend(),
    });

    const detail =
      error instanceof Error ? error.message : String(error);
    return {
      result,
      warning: [warning, `The render node cannot render this scene yet: ${detail} Rendered on this device instead.`]
        .filter(Boolean)
        .join(" "),
    };
  }
}
