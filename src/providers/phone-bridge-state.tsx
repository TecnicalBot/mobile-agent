import * as Crypto from "expo-crypto";
import { useSQLiteContext } from "expo-sqlite";
import { AppState, Text, View } from "react-native";
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
import {
  loadBridgeSharing,
  saveBridgeSharing,
  type SavedBridgeSharing,
} from "@/modules/bridge/sharing-storage";
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
  /** New for each listener, even when its persistent pairing token is reused. */
  id: string;
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
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const sharingRef = useRef(sharing);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<ExternalFolderSession | null>(null);
  const [approval, setApproval] = useState<BridgeApproval | null>(null);
  // "Always allow" is scoped to this sharing session and tool. It is never
  // persisted: stopping or changing the grant resets every remembered approval.
  const approvedToolsRef = useRef<Set<string>>(new Set());
  const [approvedTools, setApprovedTools] = useState<string[]>([]);
  // Explicit user choice for this sharing session, never restored from a
  // chat's saved settings or persisted across reload/revocation.
  const [approvalMode, setApprovalModeState] = useState<"ask" | "auto">("ask");
  const approvalModeRef = useRef<"ask" | "auto">("ask");
  const grantKeyRef = useRef<string | null>(null);
  const [interfaces, setInterfaces] = useState<BridgeInterface[]>([]);
  const [harnessUrl, setHarnessUrl] = useState<string | null>(null);
  const [preference, setPreferenceState] = useState<BridgePreference>("auto");
  const [manualAddress, setManualAddressState] = useState<string | null>(null);
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;
  const manualAddressRef = useRef(manualAddress);
  manualAddressRef.current = manualAddress;
  const desiredSharing = useRef<SavedBridgeSharing | null>(null);
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
    let cancelled = false;
    const epoch = generation.current;
    void refreshInterfaces();
    void Promise.all([
      loadBridgePreference(),
      loadManualBridgeAddress(),
      loadBridgeSharing(),
    ])
      .then(async ([savedPreference, savedAddress, savedSharing]) => {
        if (cancelled || epoch !== generation.current) return;
        preferenceRef.current = savedPreference;
        manualAddressRef.current = savedAddress;
        setPreferenceState(savedPreference);
        setManualAddressState(savedAddress);
        setSettingsLoaded(true);
        desiredSharing.current = savedSharing;
        if (savedSharing) {
          setFolder(savedSharing.grant.folder);
          await startRef.current(savedSharing.grant);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettingsLoaded(true);
          setError(
            "Could not restore device sharing settings. Start sharing again.",
          );
        }
      });
    void isBackgroundAgentHeld()
      .then((held) => {
        backgroundHeld.current = held;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshInterfaces]);

  function clearApprovals() {
    approvalModeRef.current = "ask";
    setApprovalModeState("ask");
    approvedToolsRef.current.clear();
    setApprovedTools([]);
  }

  function setApprovalMode(mode: "ask" | "auto") {
    if (mode === "ask") {
      clearApprovals();
      return;
    }
    // This only skips prompts for the existing grant. It cannot start sharing,
    // expand its tools/folder, or authorize a future sharing session.
    if (!sharingRef.current) return;
    approvalModeRef.current = "auto";
    setApprovalModeState("auto");
    if (AppState.currentState === "active" || backgroundHeld.current)
      resolveApproval.current?.(true);
  }

  async function stopRuntime() {
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
    if (!directBusy.current && !desiredSharing.current) {
      await stopBackgroundAgent().catch(() => {});
      backgroundHeld.current = false;
    }
  }

  async function stop() {
    desiredSharing.current = null;
    clearApprovals();
    // Revoke this runtime immediately; serialize persisted writes so a late
    // Start cannot silently re-enable sharing after the user explicitly stops.
    const closing = stopRuntime();
    try {
      await saveBridgeSharing(null);
    } catch {
      setError(
        "Sharing stopped, but its saved settings could not be cleared. Retry Stop before reloading.",
      );
    }
    await closing;
  }

  function approve(request: BridgeApproval) {
    if (
      approvalModeRef.current === "auto" ||
      approvedToolsRef.current.has(request.toolName)
    ) {
      return Promise.resolve(
        sharingRef.current !== null &&
          !request.signal.aborted &&
          (AppState.currentState === "active" || backgroundHeld.current),
      );
    }
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
    // A re-bind on the same grant keeps remembered approvals; a different
    // folder or capability set is a new sharing session.
    const nextGrantKey = JSON.stringify([
      grant.folder?.uri ?? null,
      grant.workspace,
      grant.skills,
    ]);
    if (grantKeyRef.current !== null && grantKeyRef.current !== nextGrantKey)
      clearApprovals();
    grantKeyRef.current = nextGrantKey;
    let epoch = generation.current;
    let endpoint: ReturnType<typeof createBridgeMcpServer> | null = null;
    let phase: "prepare" | "listen" | "save" = "prepare";
    try {
      const closing = stopRuntime();
      epoch = generation.current;
      await closing;
      if (epoch !== generation.current) return;
      const token = await ensureBridgeToken();
      const available = await refreshInterfaces();
      const manual = manualAddressRef.current?.trim() || null;
      const effectivePreference =
        preferenceRef.current === "auto" && !harnessUrl
          ? (desiredSharing.current?.reach ?? "auto")
          : preferenceRef.current;
      const selection = manual
        ? {
            reach: (isTailnetAddress(manual)
              ? "tailnet"
              : "lan") as BridgeReach,
            address: manual,
            url: `http://${manual}:${PHONE_BRIDGE_PORT}/mcp`,
            needsOverride: false,
          }
        : selectReach({
            harnessUrl,
            interfaces: available,
            port: PHONE_BRIDGE_PORT,
            preference: effectivePreference,
          });
      // Do not restore a network grant onto a different reach just because
      // the old interface or paired harness has not come back yet.
      if (
        !harnessUrl &&
        desiredSharing.current &&
        effectivePreference !== "auto" &&
        selection.reach !== effectivePreference
      )
        throw new Error("The previously shared network is unavailable.");
      if (selection.reach !== "loopback" && !selection.address)
        throw new Error("No reachable network interface.");
      if (grant.folder) createExternalFolderService().listEntries(grant.folder);
      const tools = await createPhoneBridgeCapabilities({
        grant,
        repositories: createRepositories(database),
        onRecord: (record) => {
          if (epoch !== generation.current) return;
          setRecords((previous) => [...previous.slice(-49), record]);
        },
        onWorkspaceChanged: () => refreshFiles.current(),
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
      phase = "save";
      const savedSharing: SavedBridgeSharing = {
        version: 1,
        grant,
        reach: selection.reach,
      };
      await saveBridgeSharing(savedSharing);
      if (epoch !== generation.current) return;
      desiredSharing.current = savedSharing;
      const urls = bridgeUrls(available, listener.port);
      const shared: PhoneBridgeSharing = {
        id: Crypto.randomUUID(),
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
      backgroundHeld.current = await isBackgroundAgentHeld().catch(() => false);
      if (!backgroundHeld.current) await startBackgroundAgent();
      backgroundHeld.current = await isBackgroundAgentHeld().catch(() => false);
      await setBackgroundAgentNotificationState("running", listener.url).catch(
        () => {},
      );
    } catch {
      const ownsFailure = epoch === generation.current;
      if (ownsFailure) await stopRuntime();
      else await endpoint?.close();
      // stopRuntime advances the generation; this failure still belongs to
      // this start unless an external Stop/restart already invalidated it.
      if (ownsFailure && epoch + 1 === generation.current)
        setError(
          phase === "save"
            ? "Could not save device sharing settings. Sharing was stopped."
            : phase === "listen"
              ? "Could not open device sharing. Check the network and try again."
              : "Could not prepare device sharing. Check the shared folder and network.",
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
      // Keep the harness registration during reload. Deleting it asynchronously
      // here can race with restoration. Explicit Stop still removes it.
      revokeCallbacks.current = [];
      if (!directBusy.current && !desiredSharing.current)
        void stopBackgroundAgent().catch(() => {});
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
        if (!shared) {
          const saved = desiredSharing.current;
          if (settingsLoaded && saved && !starting.current)
            await startRef.current(saved.grant);
          return;
        }
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
            "Device sharing paused: no reachable network. Reconnect Wi-Fi or Tailscale.",
          );
          await stopRuntime();
          return;
        }
        await startRef.current(shared.grant);
      })().catch(() => {});
    };
    const timer = setInterval(check, NETWORK_POLL_MS);
    check();
    return () => clearInterval(timer);
  }, [
    harnessUrl,
    manualAddress,
    preference,
    refreshInterfaces,
    settingsLoaded,
  ]);

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
    busy: busy || !settingsLoaded,
    error,
    folder,
    approval,
    approvedTools,
    approvalMode,
    setApprovalMode,
    clearApprovals,
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
    onRevoke: (callback: () => Promise<void>, instanceID: string) => {
      if (sharingRef.current?.id === instanceID)
        revokeCallbacks.current.push(callback);
      else if (!sharingRef.current) void callback().catch(() => {});
    },
    clearFolder: async () => {
      await stop();
      setFolder(null);
    },
    answer: (accepted: boolean, always = false) => {
      if (always && approval) {
        approvedToolsRef.current.add(approval.toolName);
        setApprovedTools([...approvedToolsRef.current]);
      }
      resolveApproval.current?.(accepted);
    },
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
            <DrawerTitle>Device access request</DrawerTitle>
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
          <DrawerFooter className="gap-sp-2">
            <Button
              variant="secondary"
              onPress={() => value.answer(true, true)}
            >
              Always allow this tool
            </Button>
            <Text className="text-center font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Stops asking for this tool until sharing stops or its access
              changes.
            </Text>
            <View className="flex-row gap-sp-2">
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
            </View>
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
