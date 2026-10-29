import { requireNativeModule } from "expo";
import { Platform } from "react-native";
import type { BridgeInterface } from "@/modules/bridge/reach";

type BridgeNetworkModule = {
  listInterfaces(): Promise<BridgeInterface[]>;
};

// A JS update can arrive before the matching native module (for example an OTA
// update on an older build). Degrade to no addresses instead of crashing.
function loadNative(): BridgeNetworkModule | null {
  if (Platform.OS !== "android") return null;
  try {
    return requireNativeModule<BridgeNetworkModule>("BridgeNetwork");
  } catch {
    return null;
  }
}

const Native = loadNative();

/** Local IPv4/IPv6 addresses. Returns an empty list rather than throwing. */
export async function listBridgeInterfaces(): Promise<BridgeInterface[]> {
  if (!Native) return [];
  try {
    return await Native.listInterfaces();
  } catch {
    return [];
  }
}
