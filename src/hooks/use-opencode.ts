import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { OpenCodeClient } from "@opencode/client";

import {
  readOpenCodeSnapshot,
  type OpenCodeSnapshot,
} from "@/modules/harnesses/opencode";
import { openCodeSnapshotToken } from "@/modules/harnesses/opencode-presentation";

/** Reconcile authoritative snapshots; never replay mutations after a disconnect. */
export function useOpenCode(
  client: OpenCodeClient | null,
  sessionID: string | null,
) {
  const [snapshot, setSnapshot] = useState<OpenCodeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useRef<() => void>(() => {});
  // Polls return fresh objects for identical data. Publishing them re-renders
  // the whole chat, so compare content first and keep the previous snapshot.
  const snapshotToken = useRef<string | null>(null);

  useEffect(() => {
    snapshotToken.current = null;
    setSnapshot(null);
    setError(null);
    if (!client || !sessionID) return;
    let disposed = false;
    let reading = false;
    let dirty = false;
    let foreground = AppState.currentState === "active";
    let request: AbortController | undefined;
    let stream: AbortController | undefined;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;

    async function reconcile() {
      if (disposed || !foreground) return;
      if (reading) {
        dirty = true;
        return;
      }
      reading = true;
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 15000);
      try {
        const next = await readOpenCodeSnapshot(
          client!,
          sessionID!,
          request.signal,
        );
        if (!disposed && foreground) {
          const token = openCodeSnapshotToken(next);
          if (token !== snapshotToken.current) {
            snapshotToken.current = token;
            setSnapshot(next);
          }
          setError(null);
        }
      } catch {
        if (!disposed && foreground)
          setError(
            "Connection lost. Reconnecting; do not resend an unconfirmed prompt.",
          );
      } finally {
        clearTimeout(timeout);
        reading = false;
        if (dirty) {
          dirty = false;
          schedule();
        }
      }
    }

    function schedule() {
      if (scheduled || disposed || !foreground) return;
      scheduled = setTimeout(() => {
        scheduled = undefined;
        void reconcile();
      }, 250);
    }

    async function subscribe() {
      if (disposed || !foreground) return;
      const controller = new AbortController();
      stream = controller;
      try {
        for await (const event of client!.event.subscribe({
          signal: controller.signal,
        })) {
          if (disposed) break;
          backoff = 1000;
          if (
            event.type === "server.connected" ||
            ("data" in event &&
              event.data &&
              typeof event.data === "object" &&
              "sessionID" in event.data &&
              event.data.sessionID === sessionID)
          )
            schedule();
        }
      } catch {
        // Stream failure is repaired with a fresh subscription and snapshot.
      } finally {
        if (!disposed && foreground && !controller.signal.aborted) {
          schedule();
          reconnect = setTimeout(() => {
            void subscribe();
          }, backoff);
          backoff = Math.min(backoff * 2, 30000);
        }
      }
    }

    refresh.current = schedule;
    void reconcile();
    void subscribe();
    // Snapshot fallback also catches events lost during subscription startup.
    const poll = setInterval(() => {
      void reconcile();
    }, 3000);
    const listener = AppState.addEventListener("change", (state) => {
      const wasForeground = foreground;
      foreground = state === "active";
      if (!foreground) {
        stream?.abort();
        request?.abort();
        clearTimeout(reconnect);
      } else if (!wasForeground) {
        void reconcile();
        void subscribe();
      }
    });
    return () => {
      disposed = true;
      refresh.current = () => {};
      request?.abort();
      stream?.abort();
      clearTimeout(scheduled);
      clearTimeout(reconnect);
      clearInterval(poll);
      listener.remove();
    };
  }, [client, sessionID]);

  return { snapshot, error, refresh: () => refresh.current() };
}
