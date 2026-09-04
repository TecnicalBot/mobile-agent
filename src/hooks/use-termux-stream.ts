import { useCallback, useEffect, useRef, useState } from "react";

import { secureSecretStore } from "@/core/services/secrets";
import type { McpServerConfig } from "@/core/types/app-state";
import {
  connectTermuxStream,
  disconnectTermuxStream,
  isTermuxStreamConnected,
  startTermuxStream,
  stopTermuxStream,
  subscribeToTermuxStream,
  type TermuxStreamEvent,
} from "termux-stream";

export type TermuxStreamState = {
  connected: boolean;
  streamingTaskId: string | null;
  error: string | null;
};

/**
 * Resolves the termux-mcp server the user configured as an MCP server and
 * derives the streaming connection (host/port/token) from it. Returns null
 * when no compatible server is configured.
 */
async function resolveTermuxConnection(
  servers: McpServerConfig[],
): Promise<{ host: string; port: number; token: string } | null> {
  const termux = servers.find(
    (server) =>
      server.enabled &&
      /termux/i.test(server.label) &&
      /^https?:\/\//i.test(server.url),
  );
  if (!termux) return null;

  let host = "127.0.0.1";
  let port = 3000;
  try {
    const u = new URL(termux.url);
    host = u.hostname;
    port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 3000;
  } catch {
    // fall through to defaults
  }

  let token = "";
  if (termux.authMode === "headers") {
    try {
      const headers = await secureSecretStore.getMcpHeaderValues(termux.id);
      const auth = headers["Authorization"] ?? headers["authorization"] ?? "";
      const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
      if (bearerMatch) {
        token = bearerMatch[1].trim();
      } else {
        token = auth.trim();
      }
    } catch {}
  }

  return { host, port, token };
}

/**
 * Connects to termux-mcp's /terminal/stream endpoint and exposes the current
 * streaming state plus live terminal output chunks. Intended for the terminal
 * screen: call start(taskId) to begin streaming a background task's output.
 */
export function useTermuxStream() {
  const [state, setState] = useState<TermuxStreamState>({
    connected: false,
    streamingTaskId: null,
    error: null,
  });
  const onEventRef = useRef<((event: TermuxStreamEvent) => void) | null>(null);

  const setConnected = useCallback((connected: boolean) => {
    setState((prev) => ({ ...prev, connected, error: connected ? null : prev.error }));
  }, []);

  const connect = useCallback(async (servers: McpServerConfig[]) => {
    const cfg = await resolveTermuxConnection(servers);
    if (!cfg) {
      setConnected(false);
      setState((prev) => ({ ...prev, error: "No termux-mcp server configured." }));
      return false;
    }
    const ok = await connectTermuxStream(cfg);
    setConnected(ok);
    if (!ok) {
      setState((prev) => ({ ...prev, error: "Could not reach termux-mcp on this device." }));
    } else {
      setState((prev) => ({ ...prev, error: null }));
    }
    return ok;
  }, [setConnected]);

  const disconnect = useCallback(async () => {
    await stopTermuxStream();
    await disconnectTermuxStream();
    setConnected(false);
    setState((prev) => ({ ...prev, streamingTaskId: null }));
  }, [setConnected]);

  const start = useCallback(async (taskId: string) => {
    const ok = await startTermuxStream(taskId);
    if (ok) {
      setState((prev) => ({ ...prev, streamingTaskId: taskId, error: null }));
    }
    return ok;
  }, []);

  const stop = useCallback(async () => {
    await stopTermuxStream();
    setState((prev) => ({ ...prev, streamingTaskId: null }));
  }, []);

  const onEvent = useCallback((cb: (event: TermuxStreamEvent) => void) => {
    onEventRef.current = cb;
    return () => {
      if (onEventRef.current === cb) onEventRef.current = null;
    };
  }, []);

  // Subscribe to native events.
  useEffect(() => {
    const unsubscribe = subscribeToTermuxStream((event) => {
      if (onEventRef.current) {
        onEventRef.current(event);
      }
      switch (event.type) {
        case "connectionChange":
          setConnected(event.connected);
          break;
        case "done":
          setState((prev) => ({ ...prev, streamingTaskId: null }));
          break;
        case "error":
          setState((prev) => ({ ...prev, error: event.message }));
          break;
      }
    });
    isTermuxStreamConnected().catch(() => {});
    return unsubscribe;
  }, [setConnected]);

  return {
    ...state,
    connect,
    disconnect,
    start,
    stop,
    onEvent,
  };
}
