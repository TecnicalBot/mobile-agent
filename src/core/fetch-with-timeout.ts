const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const onTimeout = () =>
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  const timeout = setTimeout(onTimeout, timeoutMs);
  const onAbort = () => controller.abort(init.signal?.reason);

  if (init.signal?.aborted) {
    controller.abort(init.signal.reason);
  } else {
    init.signal?.addEventListener("abort", onAbort, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onAbort);
  }
}
