/**
 * Platform-neutral ID generation.
 *
 * Replaces direct `expo-crypto` usage so that the database and scheduler layers
 * stay bundleable for non-Expo hosts (the Electron main process runs these same
 * modules under plain Node).
 *
 * `expo-crypto` is unavailable in Node, and its web implementation is a thin
 * shim. `globalThis.crypto` is present in every target we care about:
 *   - Node 19+ (the Electron main process)
 *   - Browsers / the Electron renderer
 *   - React Native, once `initializeCrypto()` installs `react-native-quick-crypto`
 *
 * We prefer the platform `randomUUID` and fall back to building an RFC 4122 v4
 * UUID from `getRandomValues`, which is the primitive `isCryptoReady()` already
 * guarantees before the app renders.
 */

function requireWebCrypto(): Crypto {
  const webCrypto = globalThis.crypto;

  if (!webCrypto?.getRandomValues) {
    throw new Error(
      "randomId() requires globalThis.crypto.getRandomValues. Call initializeCrypto() during startup.",
    );
  }

  return webCrypto;
}

export function randomId(): string {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = requireWebCrypto().getRandomValues(new Uint8Array(16));

  // Version 4, variant 1 (RFC 4122 section 4.4).
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
