import * as Crypto from "expo-crypto";
import { useSQLiteContext } from "expo-sqlite";
import { AppState, Text } from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  isBackgroundAgentHeld,
  setBackgroundAgentNotificationState,
  startBackgroundAgent,
  stopBackgroundAgent,
  subscribeToPhoneBridgeApproval,
} from "background-agent-service";
import { listBridgeInterfaces } from "bridge-network";
import { createRepositories } from "@/core/db/database";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import type {
  ExternalFolderSession,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import {
  createPhoneBridgeCapabilities,
  type PhoneBridgeGrant,
} from "@/modules/bridge/capabilities";
import {
  ensureBridgeToken,
  loadBridgePreference,
  loadManualBridgeAddress,
  rotateBridgeToken,
  saveBridgePreference,
  saveManualBridgeAddress,
  type BridgePreference,
} from "@/modules/bridge/credentials";
import { createBridgeMcpServer } from "@/modules/bridge/mcp-server";
import {
  PHONE_BRIDGE_PORT,
  startPhoneBridgeListener,
} from "@/modules/bridge/native-http-server";
import {
  bridgeUrls,
  isTailnetAddress,
  selectReach,
  type BridgeInterface,
  type BridgeReach,
  type BridgeUrls,
} from "@/modules/bridge/reach";
import type { BridgeApproval } from "@/modules/bridge/types";
import { useChat as useDirectChat } from "@/providers/app-state";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

const APPROVAL_TIMEOUT_FOREGROUND_MS = 60_000;
const APPROVAL_TIMEOUT_BACKGROUND_MS = 5 * 60_000;
const NETWORK_POLL_MS = 15_000;
const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "waiting_for_approval",
  "waiting_for_question",
  "retrying",
]);

export type PhoneBridgeSharing = {
  /** Address the connected harness should use. */
  url: string;
  urls: BridgeUrls;
  reach: BridgeReach;
  port: number;
  token: string;
  toolCount: number;
  grant: PhoneBridgeGrant;
  needsOverride: boolean;
};

function usePhoneBridgeController() {
  const database = useSQLiteContext();
  const direct = useDirectChat();
  const [sharing, setSharing] = useState<PhoneBridgeSharing | null>(null);
  const [busy, setBusy] = useState(false);
  const sharingRef = useRef(sharing);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<ExternalFolderSession | null>(null);
  const [approval, setApproval] = useState<BridgeApproval | null>(null);
  const [interfaces, setInterfaces] = useState<BridgeInterface[]>([]);
  const [harnessUrl, setHarnessUrl] = useState<string | null>(null);
  const [preference, setPreferenceState] = useState<BridgePreference>("auto");
  const [manualAddress, setManualAddressState] = useState<string | null>(null);
  const runtime = useRef<{ close: () => Promise<void> } | null>(null);
  const resolveApproval = useRef<((accepted: boolean) => void) | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const revokeCallbacks = useRef<(() => Promise<void>)[]>([]);
  const refreshFiles = useRef(direct.refreshWorkspaceFiles);
  refreshFiles.current = direct.refreshWorkspaceFiles;
  const [records, setRecords] = useState<ToolExecutionRecord[]>([]);
  const backgroundHeld = useRef(false);
  const directBusy = useRef(false);
  directBusy.current = direct.agentRuns.some((run) =>
    ACTIVE_RUN_STATUSES.has(run.status),
  );
  const startRef = useRef<(grant: PhoneBridgeGrant) => Promise<void>>(
    async () => {},
  );

  const refreshInterfaces = useCallback(async () => {
    const next = await listBridgeInterfaces();
    setInterfaces(next);
    return next;
  }, []);

  useEffect(() => {
    void refreshInterfaces();
    void loadBridgePreference().then(setPreferenceState).catch(() => {});
    void loadManualBridgeAddress().then(setManualAddressState).catch(() => {});
    void isBackgroundAgentHeld()
      .then((held) => {
        backgroundHeld.current = held;
      })
      .catch(() => {});
  }, [refreshInterfaces]);

  async function stop() {
    generation.current += 1;
    resolveApproval.current?.(false);
    resolveApproval.current = null;
    setApproval(null);
    sharingRef.current = null;
    setSharing(null);
    const current = runtime.current;
    runtime.current = null;
    await current?.close().catch(() => {});
    const callbacks = revokeCallbacks.current;
    revokeCallbacks.current = [];
    await Promise.allSettled(callbacks.map((callback) => callback()));
    // The direct agent shares this foreground service; never stop it mid-run.
    if (!directBusy.current) {
      await stopBackgroundAgent().catch(() => {});
      backgroundHeld.current = false;
    }
  }

  function approve(request: BridgeApproval) {
    return new Promise<boolean>((resolve) => {
      const active = AppState.currentState === "active";
      if (request.signal.aborted || (!active && !backgroundHeld.current)) {
        resolve(false);
        return;
      }
      let finished = false;
      const finish = (accepted: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        request.signal.removeEventListener("abort", cancel);
        resolveApproval.current = null;
        setApproval(null);
        void setBackgroundAgentNotificationState(
          "running",
          sharingRef.current?.url ?? null,
        ).catch(() => {});
        resolve(accepted);
      };
      const cancel = () => finish(false);
      const timeout = setTimeout(
        cancel,
        active
          ? APPROVAL_TIMEOUT_FOREGROUND_MS
          : APPROVAL_TIMEOUT_BACKGROUND_MS,
      );
      request.signal.addEventListener("abort", cancel, { once: true });
      resolveApproval.current = finish;
      setApproval(request);
      if (!active)
        void setBackgroundAgentNotificationState(
          "waiting_approval",
          request.toolName,
          true,
        ).catch(() => {});
    });
  }

  async function start(grant: PhoneBridgeGrant) {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(null);
    let epoch = generation.current;
    let endpoint: ReturnType<typeof createBridgeMcpServer> | null = null;
    let phase: "prepare" | "listen" = "prepare";
    try {
      await stop();
      epoch = generation.current;
      const token = await ensureBridgeToken();
      const available = await refreshInterfaces();
      const manual = manualAddress?.trim() || null;
      const selection = manual
        ? {
            reach: (isTailnetAddress(manual) ? "tailnet" : "lan") as BridgeReach,
            address: manual,
            url: `http://${manual}:${PHONE_BRIDGE_PORT}/mcp`,
            needsOverride: false,
          }
        : selectReach({
            harnessUrl,
            interfaces: available,
            port: PHONE_BRIDGE_PORT,
            preference,
          });
      if (selection.reach !== "loopback" && !selection.address)
        throw new Error("No reachable network interface.");
      const tools = await createPhoneBridgeCapabilities({
        grant,
        repositories: createRepositories(database),
        onRecord: (record) => {
          if (epoch !== generation.current) return;
          setRecords((previous) => [...previous.slice(-49), record]);
          void refreshFiles.current().catch(() => {});
        },
      });
      if (!tools.length) throw new Error("Choose a capability to share.");
      if (epoch !== generation.current) return;
      endpoint = createBridgeMcpServer({
        token,
        tools,
        randomId: Crypto.randomUUID,
        approve,
        isAvailable: () =>
          epoch === generation.current &&
          (AppState.currentState === "active" || backgroundHeld.current),
      });
      phase = "listen";
      const listener = await startPhoneBridgeListener(endpoint.handle, {
        reach: selection.reach,
        address: selection.address,
      });
      if (epoch !== generation.current) {
        await listener.close();
        await endpoint.close();
        return;
      }
      const server = endpoint;
      runtime.current = {
        close: async () => {
          await listener.close();
          await server.close();
        },
      };
      const urls = bridgeUrls(available, listener.port);
      const shared: PhoneBridgeSharing = {
        url: listener.url,
        urls,
        reach: selection.reach,
        port: listener.port,
        token,
        toolCount: tools.length,
        grant,
        needsOverride: selection.needsOverride,
      };
      sharingRef.current = shared;
      setSharing(shared);
      // Restarting an already-held service would clear a pending direct-agent
      // approval notification, so only start it when it is not held.
      backgroundHeld.current = await isBackgroundAgentHeld().catch(
        () => false,
      );
      if (!backgroundHeld.current) await startBackgroundAgent();
      backgroundHeld.current = await isBackgroundAgentHeld().catch(
        () => false,
      );
      await setBackgroundAgentNotificationState("running", listener.url).catch(
        () => {},
      );
    } catch {
      await endpoint?.close();
      if (epoch === generation.current)
        setError(
          phase === "listen"
            ? "Could not open the phone tools listener. Restart the app and try again."
            : "Could not prepare phone tools. Re-select the shared folder or try again.",
        );
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }
  startRef.current = start;

  async function pickFolder() {
    // Revoke the old grant before opening a picker, not after a new folder is selected.
    await stop();
    const selected = await createExternalFolderService().pickDirectory();
    setFolder(selected);
    return selected;
  }

  useEffect(() => {
    // Fast Refresh can retain React state after cleaning up the listener.
    // Never keep displaying a sharing grant whose MCP sessions were revoked.
    sharingRef.current = null;
    setSharing(null);
    return () => {
      generation.current += 1;
      resolveApproval.current?.(false);
      const current = runtime.current;
      runtime.current = null;
      void current?.close();
      for (const callback of revokeCallbacks.current)
        void callback().catch(() => {});
      revokeCallbacks.current = [];
      if (!directBusy.current) void stopBackgroundAgent().catch(() => {});
    };
  }, []);

  useEffect(
    () =>
      subscribeToPhoneBridgeApproval((accepted) => {
        resolveApproval.current?.(accepted);
      }),
    [],
  );

  // A stable credential means a network change only needs a re-bind, never a
  // new pairing. Re-bind when the reachable address actually changes.
  useEffect(() => {
    const check = () => {
      void (async () => {
        const available = await refreshInterfaces();
        const shared = sharingRef.current;
        if (!shared) return;
        const manual = manualAddress?.trim() || null;
        if (manual) {
          if (`http://${manual}:${shared.port}/mcp` === shared.url) return;
          await startRef.current(shared.grant);
          return;
        }
        // Without a harness address there is nothing to match against. Keep the
        // current reach instead of collapsing back to loopback on disconnect,
        // unless the user explicitly picked a reach.
        if (!harnessUrl && preference === "auto") return;
        const selection = selectReach({
          harnessUrl,
          interfaces: available,
          port: shared.port,
          preference,
        });
        if (selection.url === shared.url) return;
        if (
          selection.reach === "loopback" &&
          shared.reach !== "loopback" &&
          preference === "auto"
        ) {
          setError(
            "Phone tools stopped: no reachable network. Reconnect Wi-Fi or Tailscale.",
          );
          await stop();
          return;
        }
        await startRef.current(shared.grant);
      })().catch(() => {});
    };
    const timer = setInterval(check, NETWORK_POLL_MS);
    check();
    return () => clearInterval(timer);
  }, [harnessUrl, manualAddress, preference, refreshInterfaces]);

  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void refreshInterfaces();
      void isBackgroundAgentHeld()
        .then((held) => {
          backgroundHeld.current = held;
        })
        .catch(() => {});
    });
    return () => listener.remove();
  }, [refreshInterfaces]);

  const setPreference = useCallback((next: BridgePreference) => {
    setPreferenceState(next);
    void saveBridgePreference(next).catch(() => {});
  }, []);

  const setManualAddress = useCallback((next: string | null) => {
    const value = next?.trim() || null;
    setManualAddressState(value);
    void saveManualBridgeAddress(value).catch(() => {});
  }, []);

  return {
    sharing,
    busy,
    error,
    folder,
    approval,
    records,
    interfaces,
    urls: bridgeUrls(interfaces, sharing?.port ?? PHONE_BRIDGE_PORT),
    preference,
    manualAddress,
    setPreference,
    setManualAddress,
    noteHarnessUrl: setHarnessUrl,
    start,
    stop,
    pickFolder,
    refreshInterfaces,
    revoke: async () => {
      await stop();
      await rotateBridgeToken();
      setError("Pairing revoked. Reconnect the harness to use the new token.");
    },
    onRevoke: (callback: () => Promise<void>, token: string) => {
      if (sharingRef.current?.token === token)
        revokeCallbacks.current.push(callback);
      else void callback().catch(() => {});
    },
    clearFolder: async () => {
      await stop();
      setFolder(null);
    },
    answer: (accepted: boolean) => resolveApproval.current?.(accepted),
  };
}

const PhoneBridgeContext = createContext<ReturnType<
  typeof usePhoneBridgeController
> | null>(null);
export function PhoneBridgeProvider({ children }: { children: ReactNode }) {
  const value = usePhoneBridgeController();
  return (
    <PhoneBridgeContext.Provider value={value}>
      {children}
      <Drawer open={value.approval !== null} dismissible={false}>
        <DrawerContent
          closeOnOverlayPress={false}
          showCloseButton={false}
          showHandle={false}
        >
          <DrawerHeader>
            <DrawerTitle>Phone tool approval</DrawerTitle>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-3">
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              {value.approval?.toolName}
            </Text>
            <Text
              selectable
              className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
            >
              {JSON.stringify(value.approval?.arguments, null, 2)?.slice(
                0,
                12000,
              )}
            </Text>
          </DrawerBody>
          <DrawerFooter className="flex-row gap-sp-2">
            <Button
              className="flex-1"
              variant="outline"
              onPress={() => value.answer(false)}
            >
              Deny
            </Button>
            <Button className="flex-1" onPress={() => value.answer(true)}>
              Allow once
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </PhoneBridgeContext.Provider>
  );
}
export function usePhoneBridge() {
  const value = useContext(PhoneBridgeContext);
  if (!value) throw new Error("PhoneBridgeProvider is required.");
  return value;
}
