/**
 * Chrome Custom Tabs on Android resolve `openBrowserAsync` immediately with
 * `{ type: "opened" }`, so there is no dismissal event to await and a canceled
 * sign-in would otherwise leave the UI spinning until the callback timeout.
 *
 * Instead we watch the app lifecycle: once the app has left the foreground and
 * comes back without the loopback callback having fired, the sign-in was
 * canceled. The return to the app is followed by a short grace period so a
 * callback that lands at the same moment still wins the race.
 *
 * `react-native` is imported lazily so this module stays loadable under the
 * Node test runner.
 */
/**
 * True when `error` is one of the sign-in-canceled errors thrown by the OAuth
 * helpers (browser dismissed before the loopback callback fired). The UI uses
 * this to stay quiet: a canceled sign-in is not an error worth alerting about.
 */
export function isOAuthCanceledError(error: unknown) {
  return error instanceof Error && error.name === "OAuthCanceledError";
}

export async function watchForOAuthCancel(message: string) {
  const { AppState, Platform } = await import("react-native");

  if (Platform.OS !== "android") {
    return {
      cancelPromise: new Promise<never>(() => {}),
      dispose() {},
    };
  }

  let leftApp = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  let rejectCanceled: (error: Error) => void = () => {};
  const cancelPromise = new Promise<never>((_, reject) => {
    rejectCanceled = reject;
  });
  // The rejection usually loses the race, so keep it from going unhandled.
  cancelPromise.catch(() => {});

  const subscription = AppState.addEventListener("change", (state) => {
    if (disposed) {
      return;
    }

    if (state !== "active") {
      leftApp = true;

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      return;
    }

    if (!leftApp) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      const error = new Error(message);
      error.name = "OAuthCanceledError";
      rejectCanceled(error);
    }, 1500);
  });

  return {
    cancelPromise,
    dispose() {
      disposed = true;

      if (timer) {
        clearTimeout(timer);
      }

      subscription.remove();
    },
  };
}
