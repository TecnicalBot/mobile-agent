import { bridge, hasBridge } from "./bridge";

/**
 * Renderer-side implementation of `expo-secure-store`.
 *
 * `expo-secure-store` has no web implementation at all (its web build exports
 * an empty object), which is why `src/core/services/secrets.ts` throws on the
 * web and takes the whole app down with it. On desktop the values live in the
 * main process, encrypted with the OS keychain via Electron's `safeStorage`.
 */

function secureStorage() {
  return bridge("Secure storage").secrets;
}

export async function getItemAsync(key: string): Promise<string | null> {
  return secureStorage().get(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  await secureStorage().set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  await secureStorage().delete(key);
}

export async function isAvailableAsync(): Promise<boolean> {
  return hasBridge();
}

/** No-op: key synchronisation is not used anywhere in the app. */
export function registerForWebCredentials(): void {}

const SecureStore = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
  isAvailableAsync,
  registerForWebCredentials,
};

export default SecureStore;
