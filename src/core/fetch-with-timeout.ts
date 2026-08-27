const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();

  if (init.signal?.aborted) {
    controller.abort();
  } else {
    init.signal?.addEventListener("abort", onAbort, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    throw normalizeFetchError(error, timeoutMs);
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

function normalizeFetchError(error: unknown, timeoutMs: number) {
  if (error instanceof Error) {
    const name = error.name;
    const isTimeout =
      name === "AbortError" || name === "TimeoutError" || error.message.includes("timed out");

    if (isTimeout) {
      return new Error(`Request timed out after ${timeoutMs}ms.`);
    }

    return new Error(
      error.message.startsWith("Network request failed") ||
        name === "TypeError" ||
        error.message.includes("fetch")
        ? `Network request failed (no response). Check your connection and try again.`
        : error.message,
    );
  }

  return new Error(`Network request failed (no response): ${String(error)}`);
}
