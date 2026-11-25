import type { RemoteRenderSettings } from "@/core/types/app-state";

/**
 * Off by default, and it must stay that way: enabling a remote node ships the
 * scene HTML and anything it references off the device. Showing this as an
 * opt-in is the whole privacy story for remote rendering.
 */
export const DEFAULT_REMOTE_RENDER_SETTINGS: RemoteRenderSettings = {
  enabled: false,
  baseUrl: null,
  concurrency: 4,
};

export const MAX_REMOTE_RENDER_CONCURRENCY = 8;

/**
 * A usable base URL or null. Ports are required to be explicit: a render node
 * on 8787 is not reachable at `http://host` unless something proxies it, and a
 * silent default would turn a typo into a confusing timeout.
 */
export function normalizeRemoteRenderBaseUrl(
  input: string | null | undefined,
): string | null {
  const trimmed = (input ?? "").trim().replace(/\/+$/, "");

  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  // Strip a trailing `/v1` so the same value works whether the user pasted the
  // service root or an endpoint path from the README.
  return `${url.origin}${url.pathname.replace(/\/v1$/, "")}`.replace(/\/+$/, "");
}

export function normalizeRemoteRenderSettings(
  input?: Partial<RemoteRenderSettings> | null,
): RemoteRenderSettings {
  const concurrency = Number(input?.concurrency);
  const baseUrl = normalizeRemoteRenderBaseUrl(input?.baseUrl);

  return {
    // A URL is part of "enabled": an enabled toggle with no address is just a
    // configuration error, and reporting it as off keeps the UI honest.
    enabled: input?.enabled === true && baseUrl !== null,
    baseUrl,
    concurrency: Number.isFinite(concurrency)
      ? Math.max(
          1,
          Math.min(MAX_REMOTE_RENDER_CONCURRENCY, Math.round(concurrency)),
        )
      : DEFAULT_REMOTE_RENDER_SETTINGS.concurrency,
  };
}
