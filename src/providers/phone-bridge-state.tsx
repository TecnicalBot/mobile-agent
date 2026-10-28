import * as Crypto from "expo-crypto";
import { useSQLiteContext } from "expo-sqlite";
import { AppState, Text } from "react-native";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { createBridgeMcpServer } from "@/modules/bridge/mcp-server";
import { startPhoneBridgeListener } from "@/modules/bridge/native-http-server";
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

function usePhoneBridgeController() {
  const database = useSQLiteContext();
  const direct = useDirectChat();
  const [sharing, setSharing] = useState<{
    url: string;
    token: string;
    toolCount: number;
    grant: PhoneBridgeGrant;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<ExternalFolderSession | null>(null);
  const [approval, setApproval] = useState<BridgeApproval | null>(null);
  const runtime = useRef<{ close: () => Promise<void> } | null>(null);
  const resolveApproval = useRef<((accepted: boolean) => void) | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const revokeCallbacks = useRef<(() => Promise<void>)[]>([]);
  const refreshFiles = useRef(direct.refreshWorkspaceFiles);
  refreshFiles.current = direct.refreshWorkspaceFiles;
  const [records, setRecords] = useState<ToolExecutionRecord[]>([]);

  async function stop() {
    generation.current += 1;
    resolveApproval.current?.(false);
    resolveApproval.current = null;
    setApproval(null);
    setSharing(null);
    const current = runtime.current;
    runtime.current = null;
    await current?.close();
    const callbacks = revokeCallbacks.current;
    revokeCallbacks.current = [];
    await Promise.allSettled(callbacks.map((callback) => callback()));
  }

  function approve(request: BridgeApproval) {
    return new Promise<boolean>((resolve) => {
      if (request.signal.aborted || AppState.currentState !== "active") {
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
        resolve(accepted);
      };
      const cancel = () => finish(false);
      const timeout = setTimeout(cancel, 60000);
      request.signal.addEventListener("abort", cancel, { once: true });
      resolveApproval.current = finish;
      setApproval(request);
    });
  }

  async function start(grant: PhoneBridgeGrant) {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(null);
    await stop();
    const epoch = generation.current;
    let endpoint: ReturnType<typeof createBridgeMcpServer> | null = null;
    try {
      const token = `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
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
          epoch === generation.current && AppState.currentState === "active",
      });
      const listener = await startPhoneBridgeListener(endpoint.handle);
      if (epoch !== generation.current) {
        listener.close();
        await endpoint.close();
        return;
      }
      const server = endpoint;
      runtime.current = {
        close: async () => {
          listener.close();
          await server.close();
        },
      };
      setSharing({ url: listener.url, token, toolCount: tools.length, grant });
    } catch {
      await endpoint?.close();
      if (epoch === generation.current)
        setError(
          "Could not start phone tools. Check the selected folder and whether the bridge port is already in use.",
        );
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

  async function pickFolder() {
    // Revoke the old grant before opening a picker, not after a new folder is selected.
    await stop();
    const selected = await createExternalFolderService().pickDirectory();
    setFolder(selected);
    return selected;
  }

  useEffect(
    () => () => {
      generation.current += 1;
      resolveApproval.current?.(false);
      const current = runtime.current;
      runtime.current = null;
      void current?.close();
      for (const callback of revokeCallbacks.current)
        void callback().catch(() => {});
      revokeCallbacks.current = [];
    },
    [],
  );

  return {
    sharing,
    busy,
    error,
    folder,
    approval,
    records,
    start,
    stop,
    pickFolder,
    onRevoke: (callback: () => Promise<void>) => {
      revokeCallbacks.current.push(callback);
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
