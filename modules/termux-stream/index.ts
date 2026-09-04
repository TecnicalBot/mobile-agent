import { requireOptionalNativeModule } from "expo";
import type { NativeModule } from "expo";
import { Platform } from "react-native";

type TermuxStreamEvents = {
  onOutput(event: { data: string }): void;
  onDone(event: { exit_code: number; state: string }): void;
  onError(event: { message: string }): void;
  onConnectionChange(event: { connected: boolean }): void;
};

declare class TermuxStreamNativeModule extends NativeModule<TermuxStreamEvents> {
  connect(host: string, port: number, token: string): Promise<boolean>;
  disconnect(): Promise<void>;
  startStream(taskId: string): Promise<void>;
  stopStream(): Promise<void>;
  isConnected(): Promise<boolean>;
  isReachable(host: string, port: number): Promise<boolean>;
}

export type TermuxOutputEvent = { data: string };
export type TermuxDoneEvent = { exit_code: number; state: string };
export type TermuxErrorEvent = { message: string };
export type TermuxConnectionChangeEvent = { connected: boolean };

export type TermuxStreamEvent =
  | { type: "output"; data: string }
  | { type: "done"; exitCode: number; state: string }
  | { type: "error"; message: string }
  | { type: "connectionChange"; connected: boolean };

const TermuxStream =
  Platform.OS === "android"
    ? (requireOptionalNativeModule<TermuxStreamNativeModule>(
        "TermuxStream",
      ) ?? null)
    : null;

export function subscribeToTermuxStream(
  callback: (event: TermuxStreamEvent) => void,
): () => void {
  if (!TermuxStream) return () => {};

  const subs = [
    TermuxStream.addListener("onOutput", (event) => {
      callback({ type: "output", data: event.data });
    }),
    TermuxStream.addListener("onDone", (event) => {
      callback({ type: "done", exitCode: event.exit_code, state: event.state });
    }),
    TermuxStream.addListener("onError", (event) => {
      callback({ type: "error", message: event.message });
    }),
    TermuxStream.addListener("onConnectionChange", (event) => {
      callback({
        type: "connectionChange",
        connected: event.connected,
      });
    }),
  ];

  return () => {
    subs.forEach((sub) => sub.remove());
  };
}

export async function connectTermuxStream(
  config: { host: string; port: number; token: string },
): Promise<boolean> {
  if (Platform.OS !== "android" || !TermuxStream) return false;
  try {
    return (await TermuxStream.connect(
      config.host,
      config.port,
      config.token,
    )) as boolean;
  } catch (e) {
    console.error("[TermuxStream] connect failed:", e);
    return false;
  }
}

export async function disconnectTermuxStream(): Promise<void> {
  if (Platform.OS === "android" && TermuxStream) {
    try {
      await TermuxStream.disconnect();
    } catch (e) {
      console.error("[TermuxStream] disconnect failed:", e);
    }
  }
}

export async function startTermuxStream(taskId: string): Promise<boolean> {
  if (Platform.OS !== "android" || !TermuxStream) return false;
  try {
    await TermuxStream.startStream(taskId);
    return true;
  } catch (e) {
    console.error("[TermuxStream] startStream failed:", e);
    return false;
  }
}

export async function stopTermuxStream(): Promise<void> {
  if (Platform.OS === "android" && TermuxStream) {
    try {
      await TermuxStream.stopStream();
    } catch (e) {
      console.error("[TermuxStream] stopStream failed:", e);
    }
  }
}

export async function isTermuxStreamConnected(): Promise<boolean> {
  if (Platform.OS === "android" && TermuxStream) {
    try {
      return (await TermuxStream.isConnected()) as boolean;
    } catch (e) {
      console.error("[TermuxStream] isConnected failed:", e);
      return false;
    }
  }
  return false;
}

export async function isTermuxStreamReachable(
  host: string,
  port: number,
): Promise<boolean> {
  if (Platform.OS === "android" && TermuxStream) {
    try {
      return (await TermuxStream.isReachable(host, port)) as boolean;
    } catch (e) {
      console.error("[TermuxStream] isReachable failed:", e);
      return false;
    }
  }
  return false;
}
