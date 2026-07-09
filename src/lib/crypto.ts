import { Platform } from "react-native";

let initialized = false;
let initializationPromise: Promise<void> | null = null;

export async function initializeCrypto() {
  if (Platform.OS === "web") return;

  if (initialized) return;

  if (!initializationPromise) {
    initializationPromise = (async () => {
      const { install } = await import("react-native-quick-crypto");
      install();

      if (!globalThis.crypto?.getRandomValues) {
        throw new Error(
          "Failed to initialize crypto. globalThis.crypto.getRandomValues is unavailable.",
        );
      }

      initialized = true;
    })();
  }

  await initializationPromise;
}

export function isCryptoReady() {
  return !!globalThis.crypto?.getRandomValues;
}
