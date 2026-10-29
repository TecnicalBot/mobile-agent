import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import type { PhoneBridgeGrant } from "./capabilities";
import type { BridgeReach } from "./reach";

const KEY = "phone_bridge_sharing_v1";
const sharingSchema = z.object({
  version: z.literal(1),
  reach: z.enum(["loopback", "lan", "tailnet"]),
  grant: z
    .object({
      workspace: z.boolean(),
      skills: z.boolean(),
      folder: z
        .object({
          uri: z.string().startsWith("content://"),
          displayName: z.string(),
          platform: z.literal("android"),
          sourceType: z.literal("external-folder"),
          grantedAt: z.string(),
        })
        .nullable(),
    })
    .refine(
      (grant) => grant.workspace || grant.skills || grant.folder !== null,
    ),
});

export type SavedBridgeSharing = {
  version: 1;
  reach: BridgeReach;
  grant: PhoneBridgeGrant;
};
let writes: Promise<unknown> = Promise.resolve();

export async function loadBridgeSharing(): Promise<SavedBridgeSharing | null> {
  await writes;
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const result = sharingSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Preserve call order so an explicit Stop always wins over an older Start. */
export function saveBridgeSharing(
  value: SavedBridgeSharing | null,
): Promise<void> {
  const encoded = value ? JSON.stringify(sharingSchema.parse(value)) : null;
  const write = writes.then(() =>
    encoded === null
      ? SecureStore.deleteItemAsync(KEY)
      : SecureStore.setItemAsync(KEY, encoded),
  );
  writes = write.catch(() => {});
  return write;
}
