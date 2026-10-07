/**
 * AbortSignal.timeout() is not reliable across React Native's bundled
 * AbortController polyfill, so build timeout signals by hand.
 */
export function createTimeoutSignal(
  ms: number | undefined,
  parent?: AbortSignal,
): { cancel: () => void; signal: AbortSignal } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason);
    } else {
      parent.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  if (typeof ms === "number" && ms > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      controller.abort(new Error(`Timed out after ${ms}ms`));
    }, ms);
  }

  return {
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal,
  };
}

export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
