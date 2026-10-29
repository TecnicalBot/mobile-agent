import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { BridgeReach } from "./reach";

const TOKEN_KEY = "phone_bridge_token_v1";
const PREFERENCE_KEY = "phone_bridge_reach_v1";
const MANUAL_ADDRESS_KEY = "phone_bridge_manual_address_v1";

export type BridgePreference = "auto" | BridgeReach;
/**
 * One credential per phone, not one per sharing session. Rotating per session
 * forced every harness to rewrite its config on every start, which is what made
 * the old bridge churn. Revoking is an explicit action instead.
 */
export function createBridgeToken() {
  return `${Crypto.randomUUID().replace(/-/g, "")}${Crypto.randomUUID().replace(/-/g, "")}`;
}

export async function loadBridgeToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token && token.length >= 32 ? token : null;
}

export async function ensureBridgeToken(): Promise<string> {
  const existing = await loadBridgeToken();
  if (existing) return existing;
  const token = createBridgeToken();
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  return token;
}

/** Revoking invalidates every harness that was configured with the old token. */
export async function rotateBridgeToken(): Promise<string> {
  const token = createBridgeToken();
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  return token;
}

export async function loadBridgePreference(): Promise<BridgePreference> {
  const value = await SecureStore.getItemAsync(PREFERENCE_KEY);
  return value === "loopback" || value === "lan" || value === "tailnet"
    ? value
    : "auto";
}

export async function saveBridgePreference(preference: BridgePreference) {
  await SecureStore.setItemAsync(PREFERENCE_KEY, preference);
}

export async function loadManualBridgeAddress(): Promise<string | null> {
  return SecureStore.getItemAsync(MANUAL_ADDRESS_KEY);
}

export async function saveManualBridgeAddress(address: string | null) {
  if (address) await SecureStore.setItemAsync(MANUAL_ADDRESS_KEY, address);
  else await SecureStore.deleteItemAsync(MANUAL_ADDRESS_KEY);
}

export function tokenFingerprint(token: string) {
  return token.slice(0, 8);
}
