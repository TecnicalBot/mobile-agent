import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createRepositories } from "@/core/db/database";
import { resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import type {
  PendingQuestionnaireAnswer,
  PendingToolApproval,
  SendMessageInput,
} from "@/core/types/app-state";
import { useChat as useDirectChat, useConfig as useDirectConfig } from "@/providers/app-state";
import { usePhoneBridge } from "@/providers/phone-bridge-state";
import {
  bytesToBase64,
  buildOpenCodePromptFiles,
} from "@/modules/harnesses/opencode-attachments";
import { uploadAcpHostFile } from "@/modules/harnesses/acp-host-files";
import { resolveAcpMcpServers } from "@/modules/harnesses/acp-mcp-credentials";
import type { AcpPhoneTools } from "@/modules/harnesses/acp-mcp";
import {
  acpModeForState,
  acpModelSelection,
  acpModels,
  acpPermissionOption,
  applyAcpUpdate,
  beginAcpTurn,
  buildAcpContext,
  createAcpSessionState,
  detachAcpTurn,
  finishAcpTurn,
  normalizeAcpAvailableCommands,
  presentAcpAgent,
  presentAcpConversation,
  presentAcpModel,
  presentAcpPermission,
  type AcpSessionState,
  type PendingAcpPermission,
} from "@/modules/harnesses/acp-presentation";
import {
  ACP_AUTH_ERROR_PATTERN,
  acpModelRef,
  type AcpHarnessProfile,
} from "@/modules/harnesses/acp-profile";
import {
  makeAcpClient,
  type AcpAuthStatus,
  type AcpAvailableCommand,
  type AcpContentBlock,
  type AcpInitializeResult,
  type AcpMessage,
  type AcpMcpServer,
  type AcpModel,
  type AcpNewSessionResult,
  type AcpPermissionRequest,
  type AcpResumeSessionResult,
  type AcpSessionConfigOption,
  type AcpSessionModeState,
  type AcpSessionNotification,
  type AcpClient,
  type AcpLogEvent,
} from "@/modules/harnesses/acp-client";
import {
  loadAcpConnection,
  type SavedAcpConnection,
} from "@/modules/harnesses/acp-storage";
import {
  findLinkBySession,
  loadHarnessConversationLinks,
  removeHarnessConversationLink,
  saveHarnessConversationLink,
  type HarnessConversationLink,
  type HarnessConversationLinks,
} from "@/modules/harnesses/links";
import { mergeHarnessTranscript } from "@/modules/harnesses/opencode-transfer";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

type PromptResult = {
  stopReason?: string | null;
};

type SetConfigResult = {
  configOptions?: AcpSessionConfigOption[];
};

const EMPTY_LINKS: HarnessConversationLinks = {};

/** Leave room for the prompt itself inside the bridge's 40 MiB JSON body. */
const MAX_INLINE_FALLBACK_BYTES = 24 * 1024 * 1024;

function formatAttachmentSize(bytes: number) {
  if (bytes >= 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function nowISO() {
  return new Date().toISOString();
}

function titleFromContent(content: string) {
  const first = content.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return first.length > 72 ? `${first.slice(0, 72).trimEnd()}…` : first;
}

function modelIDFromRef(profile: AcpHarnessProfile, ref: string) {
  const prefix = profile.modelPrefix;
  return decodeURIComponent(
    ref.startsWith(prefix) ? ref.slice(prefix.length) : ref,
  );
}

function base64ToText(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function dataURLToBlock(
  uri: string,
  name: string,
): AcpContentBlock | null {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma < 0) return null;
  const header = uri.slice(5, comma);
  const mime = header.split(";")[0] || "application/octet-stream";
  const data = uri.slice(comma + 1);
  const resourceURI = `mobile-agent://workspace/${encodeURIComponent(name || "file")}`;
  if (mime.startsWith("image/"))
    return { type: "image", mimeType: mime, data, uri: resourceURI };
  if (mime.startsWith("audio/"))
    return { type: "audio", mimeType: mime, data };
  if (
    mime.startsWith("text/") ||
    /(json|xml|yaml|csv|markdown|javascript|typescript)/i.test(mime)
  ) {
    try {
      return {
        type: "resource",
        resource: { uri: resourceURI, mimeType: mime, text: base64ToText(data) },
      };
    } catch {
      // Fall through to a binary embedded resource.
    }
  }
  return {
    type: "resource",
    resource: { uri: resourceURI, mimeType: mime, blob: data },
  };
}

function findMode(
  modes: AcpSessionModeState | null,
  idOrName: string | null,
) {
  if (!idOrName || !modes) return null;
  return (
    modes.availableModes.find(
      (mode) => mode.id === idOrName || mode.name === idOrName,
    ) ?? null
  );
}

function conversationMode(modeID: string | null): "plan" | "build" {
  return modeID === "plan" ? "plan" : "build";
}

function withDeadline<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function initializeAcp(api: AcpClient) {
  return api.request<AcpInitializeResult>(
    "initialize",
    {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        auth: { terminal: false },
      },
      clientInfo: {
        name: "mobile-agent",
        title: "Mobile Agent",
        version: Constants.expoConfig?.version ?? "0.0.0",
      },
    },
    { timeoutMs: 20000 },
  );
}

export function useAcpHarnessController(profile: AcpHarnessProfile) {
  const database = useSQLiteContext();
  const repositories = useMemo(() => createRepositories(database), [database]);
  const directConfig = useDirectConfig();
  const directChat = useDirectChat();
  const phoneBridge = usePhoneBridge();
  const syncConversationMessages = directChat.syncConversationMessages;

  const connectionRef = useRef<SavedAcpConnection | null>(null);
  const [client, setClient] = useState<AcpClient | null>(null);
  const clientRef = useRef<AcpClient | null>(null);
  const [links, setLinks] = useState<HarnessConversationLinks>(EMPTY_LINKS);
  const linksRef = useRef<HarnessConversationLinks>(EMPTY_LINKS);
  const [sessionsByID, setSessionsByID] = useState<
    Record<string, AcpSessionState>
  >({});
  const sessionsRef = useRef<Record<string, AcpSessionState>>({});
  const [sessionID, setSessionID] = useState<string | null>(null);
  const sessionIDRef = useRef<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [selectedModeID, setSelectedModeID] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIdsState] = useState<string[]>([]);
  const [selectedMcpServerIds, setSelectedMcpServerIdsState] = useState<
    string[] | null
  >(null);
  const selectedMcpServerIdsRef = useRef<string[] | null>(null);
  const [phoneToolsEnabled, setPhoneToolsEnabled] = useState(false);
  const [phoneToolsError, setPhoneToolsError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authStatus, setAuthStatus] = useState<AcpAuthStatus | null>(null);
  const [catalogModels, setCatalogModels] = useState<AcpModel[]>([]);
  const catalogModelsRef = useRef<AcpModel[]>([]);
  const [catalogModes, setCatalogModes] = useState<AcpSessionModeState | null>(
    null,
  );
  const catalogModesRef = useRef<AcpSessionModeState | null>(null);
  const [catalogConfigs, setCatalogConfigs] = useState<
    AcpSessionConfigOption[]
  >([]);
  const catalogConfigsRef = useRef<AcpSessionConfigOption[]>([]);
  const commandsBySessionRef = useRef<Record<string, AcpAvailableCommand[]>>(
    {},
  );
  const [catalogCommands, setCatalogCommands] = useState<
    AcpAvailableCommand[]
  >([]);
  const [cwd, setCwd] = useState("");
  const cwdRef = useRef("");
  const [mutating, setMutating] = useState(false);
  const mutation = useRef(false);
  const [pendingPermission, setPendingPermission] =
    useState<PendingAcpPermission | null>(null);
  const pendingPermissionRef = useRef<PendingAcpPermission | null>(
    null,
  );
  const [waitingPrompts, setWaitingPrompts] = useState(0);
  const [autoApproveFailure, setAutoApproveFailure] = useState<string | null>(
    null,
  );
  const generation = useRef(0);
  const connecting = useRef(false);
  const refreshing = useRef(false);
  const stopEpochs = useRef<Record<string, number>>({});
  const lastSync = useRef<string | null>(null);
  const syncQueues = useRef<Map<string, Promise<void>>>(new Map());
  const promptInFlight = useRef<Map<string, Promise<void>>>(new Map());
  const pendingMcpRefresh = useRef(false);
  const catalogSessionID = useRef<string | null>(null);
  const catalogCwd = useRef<string | null>(null);
  const handleMessageRef = useRef<(message: AcpMessage) => void>(() => {});

  const commitLinks = useCallback((next: HarnessConversationLinks) => {
    linksRef.current = next;
    setLinks(next);
  }, []);

  const commitSession = useCallback((next: AcpSessionState) => {
    sessionsRef.current = {
      ...sessionsRef.current,
      [next.id]: next,
    };
    setSessionsByID(sessionsRef.current);
  }, []);

  const removeSession = useCallback((id: string) => {
    const next = { ...sessionsRef.current };
    delete next[id];
    delete commandsBySessionRef.current[id];
    sessionsRef.current = next;
    setSessionsByID(next);
  }, []);

  const commitPermission = useCallback(
    (next: PendingAcpPermission | null) => {
      pendingPermissionRef.current = next;
      setPendingPermission(next);
    },
    [],
  );

  const bumpStopEpoch = (id: string | null) => {
    if (!id) return;
    stopEpochs.current[id] = (stopEpochs.current[id] ?? 0) + 1;
  };

  useEffect(() => {
    sessionIDRef.current = sessionID;
  }, [sessionID]);

  useEffect(() => {
    selectedMcpServerIdsRef.current = selectedMcpServerIds;
  }, [selectedMcpServerIds]);

  const commitSelectedMcpServerIds = useCallback(
    (next: string[] | null) => {
      selectedMcpServerIdsRef.current = next;
      setSelectedMcpServerIdsState(next);
    },
    [],
  );

  const phoneToolsForSession = useCallback((): AcpPhoneTools | null => {
    const shared = phoneBridge.sharing;
    return shared ? { url: shared.url, token: shared.token } : null;
  }, [phoneBridge.sharing]);

  const buildSessionMcpServers = useCallback(
    (ids: string[] | null) =>
      resolveAcpMcpServers({
        servers: directConfig.mcpServers,
        selectedServerIds: ids,
        phoneTools: phoneToolsForSession(),
      }),
    [directConfig.mcpServers, phoneToolsForSession],
  );

  // The composer's MCP drawer is backed by the direct provider's current
  // selection. Mirror it until a harness session exists, then keep the
  // session-scoped copy in sync below.
  useEffect(() => {
    if (sessionIDRef.current) return;
    commitSelectedMcpServerIds(directConfig.currentSelectedMcpServerIds);
  }, [commitSelectedMcpServerIds, directConfig.currentSelectedMcpServerIds]);

  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  useEffect(() => {
    catalogModelsRef.current = catalogModels;
  }, [catalogModels]);

  useEffect(() => {
    catalogModesRef.current = catalogModes;
  }, [catalogModes]);

  useEffect(() => {
    catalogConfigsRef.current = catalogConfigs;
  }, [catalogConfigs]);

  useEffect(() => {
    let cancelled = false;
    loadHarnessConversationLinks(repositories)
      .then((next) => {
        if (!cancelled) commitLinks(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          console.warn("Could not load harness conversation links.", cause);
          setError(
            `Could not load saved ${profile.label} chat links. Reconnect before switching models.`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [commitLinks, profile.label, repositories]);

  const applyCatalog = useCallback((result: AcpNewSessionResult) => {
    const models = acpModels(result);
    const configs = result.configOptions ?? [];
    catalogModelsRef.current = models;
    catalogConfigsRef.current = configs;
    catalogModesRef.current = result.modes ?? null;
    setCatalogModels(models);
    setCatalogConfigs(configs);
    setCatalogModes(result.modes ?? null);
  }, []);

  /**
   * Read models/modes/config options without accumulating probe sessions.
   * Reuse one resumable catalog session for this app process.
   */
  const readCatalog = async (
    api: AcpClient,
    sessionCwd: string,
  ): Promise<AcpNewSessionResult> => {
    const close = (sessionId: string) =>
      api
        .request(
          "session/close",
          { sessionId },
          { timeoutMs: 5000 },
        )
        .catch(() => {});
    if (catalogSessionID.current && catalogCwd.current === sessionCwd) {
      try {
        const resumed = await api.request<AcpResumeSessionResult>(
          "session/resume",
          {
            sessionId: catalogSessionID.current,
            cwd: sessionCwd,
            mcpServers: [],
          },
          { timeoutMs: 30000 },
        );
        const result: AcpNewSessionResult = {
          ...resumed,
          sessionId: catalogSessionID.current,
        };
        setCatalogCommands(
          commandsBySessionRef.current[result.sessionId] ?? [],
        );
        await close(result.sessionId);
        return result;
      } catch {
        catalogSessionID.current = null;
        catalogCwd.current = null;
      }
    }
    const result = await api.request<AcpNewSessionResult>(
      "session/new",
      { cwd: sessionCwd, mcpServers: [] },
      { timeoutMs: 30000 },
    );
    catalogSessionID.current = result.sessionId;
    catalogCwd.current = sessionCwd;
    setCatalogCommands(commandsBySessionRef.current[result.sessionId] ?? []);
    await close(result.sessionId);
    return result;
  };

  const handleMessage = (message: AcpMessage) => {
    if (message.method === "_auth/status_update") {
      const params =
        message.params && typeof message.params === "object"
          ? (message.params as { authStatus?: unknown })
          : null;
      const value = params?.authStatus;
      if (
        value &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).label === "string"
      ) {
        setAuthStatus(value as AcpAuthStatus);
      }
      return;
    }

    if (message.method === "session/request_permission") {
      if (message.id === undefined) return;
      const params = message.params as
        | (AcpPermissionRequest & { id?: string | number })
        | undefined;
      if (!params?.toolCall) {
        void clientRef
          .current?.respondError(message.id, -32602, "Invalid permission request.")
          .catch(() => {});
        return;
      }
      const state = sessionsRef.current[params.sessionId];
      const pending = presentAcpPermission(
        profile,
        { ...params, id: message.id },
        state?.title ?? `${profile.label}`,
      );
      const previous = pendingPermissionRef.current;
      if (previous && previous.id !== pending.id) {
        void clientRef
          .current?.respond(previous.requestID, {
            outcome: { outcome: "cancelled" },
          })
          .catch(() => {});
      }
      setAutoApproveFailure(null);
      commitPermission(pending);
      return;
    }

    if (
      message.method === "session/update" &&
      message.params &&
      typeof message.params === "object"
    ) {
      const params = message.params as AcpSessionNotification;
      const current = sessionsRef.current[params.sessionId];
      if (params.update?.sessionUpdate === "available_commands_update") {
        const commands = normalizeAcpAvailableCommands(
          params.update.availableCommands,
        );
        commandsBySessionRef.current[params.sessionId] = commands;
        if (params.sessionId === catalogSessionID.current) {
          setCatalogCommands(commands);
        }
      }
      if (!current || !params.update) return;
      const next = applyAcpUpdate(profile, current, params.update);
      if (next !== current) commitSession(next);
      return;
    }

    if (message.method && message.id !== undefined) {
      // We advertise no filesystem, terminal, or elicitation capabilities.
      // Answer anything else instead of leaving the agent waiting forever.
      void clientRef
        .current?.respondError(
          message.id,
          -32601,
          `Mobile Agent does not implement ${message.method}.`,
        )
        .catch(() => {});
    }
  };
  handleMessageRef.current = handleMessage;

  const connect = useCallback(async () => {
    const epoch = ++generation.current;
    connecting.current = true;
    setStatus("connecting");
    setError(null);
    setAuthRequired(false);
    setAuthStatus(null);
    setPhoneToolsError(null);
    pendingMcpRefresh.current = false;
    catalogModelsRef.current = [];
    catalogModesRef.current = null;
    catalogConfigsRef.current = [];
    setCatalogModels([]);
    setCatalogModes(null);
    setCatalogConfigs([]);
    setCatalogCommands([]);
    try {
      const saved = await loadAcpConnection(profile);
      if (epoch !== generation.current) return;
      if (!saved) {
        if (epoch === generation.current) {
          connectionRef.current = null;
          setStatus("disconnected");
        }
        return;
      }
      connectionRef.current = saved;
      clientRef.current?.stop();
      const api = makeAcpClient(saved, {
        agentLabel: profile.label,
        transport: expoFetch as typeof globalThis.fetch,
        onMessage: (message) => handleMessageRef.current(message),
        onLog: (_event: AcpLogEvent) => {},
        onStatus: (next) => {
          if (epoch === generation.current) setStatus(next);
        },
        onBridgeEvent: (event) => {
          if (epoch !== generation.current) return;
          if (event.type === "exit" || event.type === "error") {
            setStatus("disconnected");
            setAuthStatus(null);
            setError(
              typeof event.message === "string"
                ? event.message
                : `The ${profile.label} bridge disconnected. Reconnect in Settings → Harnesses.`,
            );
          }
        },
      });
      clientRef.current = api;
      setClient(api);

      const health = await withDeadline(
        api.health(),
        15000,
        `The ${profile.label} bridge health check timed out.`,
      );
      const sessionCwd = saved.cwd.trim() || health.cwd;
      cwdRef.current = sessionCwd;
      setCwd(sessionCwd);

      await withDeadline(
        api.start(),
        20000,
        `The ${profile.label} bridge event stream timed out.`,
      );
      await initializeAcp(api);
      const result = await readCatalog(api, sessionCwd);
      if (epoch !== generation.current) return;
      applyCatalog(result);
      setStatus("connected");
      setError(null);
      setAuthRequired(false);
    } catch (cause) {
      if (epoch !== generation.current) return;
      const detail = cause instanceof Error ? cause.message.trim() : "";
      if (ACP_AUTH_ERROR_PATTERN.test(detail)) {
        setStatus("connected");
        setAuthRequired(true);
        setError(
          profile.signInHint,
        );
      } else {
        clientRef.current?.stop();
        clientRef.current = null;
        setClient(null);
        setStatus("disconnected");
        setError(
          /401|unauthor/i.test(detail)
            ? `The ${profile.label} bridge rejected this token. Check the token in Settings → Harnesses.`
            : `Could not connect to ${profile.label}. Check the bridge URL, token, and network.${detail ? ` (${detail})` : ""}`,
        );
      }
    } finally {
      if (epoch === generation.current) connecting.current = false;
    }
  }, [applyCatalog, profile]);

  useEffect(() => {
    void connect();
    return () => {
      generation.current += 1;
      clientRef.current?.stop();
    };
    // The connect callback is stable; the counter invalidates outstanding work.
  }, [connect]);

  const disconnect = useCallback(() => {
    generation.current += 1;
    connecting.current = false;
    refreshing.current = false;
    for (const id of Object.keys(stopEpochs.current))
      stopEpochs.current[id] += 1;
    const permission = pendingPermissionRef.current;
    if (permission)
      void clientRef.current
        ?.respond(permission.requestID, {
          outcome: { outcome: "cancelled" },
        })
        .catch(() => {});
    clientRef.current?.stop();
    clientRef.current = null;
    setClient(null);
    connectionRef.current = null;
    catalogModelsRef.current = [];
    catalogConfigsRef.current = [];
    catalogModesRef.current = null;
    setCatalogModels([]);
    setCatalogConfigs([]);
    setCatalogModes(null);
    setCatalogCommands([]);
    sessionsRef.current = {};
    setSessionsByID({});
    setStatus("disconnected");
    setActive(false);
    setSessionID(null);
    setSelectedRef(null);
    setSelectedModeID(null);
    setSelectedFileIdsState([]);
    setError(null);
    setAuthRequired(false);
    setAuthStatus(null);
    commandsBySessionRef.current = {};
    setWaitingPrompts(0);
    setCwd("");
    setPhoneToolsEnabled(false);
    setPhoneToolsError(null);
    pendingMcpRefresh.current = false;
    commitPermission(null);
  }, [commitPermission]);

  const refresh = useCallback(async () => {
    if (connecting.current || refreshing.current) return;
    refreshing.current = true;
    try {
      const api = clientRef.current;
      const saved = connectionRef.current;
      if (!api || !saved) {
        await connect();
        return;
      }
      const epoch = generation.current;
      setError(null);
      try {
        const health = await withDeadline(
          api.health(),
          15000,
          `The ${profile.label} bridge health check timed out.`,
        );
        const sessionCwd = saved.cwd.trim() || health.cwd;
        cwdRef.current = sessionCwd;
        setCwd(sessionCwd);
        await initializeAcp(api);
        const result = await readCatalog(api, sessionCwd);
        if (epoch !== generation.current) return;
        applyCatalog(result);
        setStatus("connected");
        setAuthRequired(false);
      } catch (cause) {
        if (epoch !== generation.current) return;
        const detail = cause instanceof Error ? cause.message.trim() : "";
        if (ACP_AUTH_ERROR_PATTERN.test(detail)) {
          catalogModelsRef.current = [];
          catalogModesRef.current = null;
          catalogConfigsRef.current = [];
          setCatalogModels([]);
          setCatalogModes(null);
          setCatalogConfigs([]);
          setStatus("connected");
          setAuthRequired(true);
          setError(
            profile.signInHint,
          );
        } else {
          setStatus("disconnected");
          setError(
            `Could not refresh ${profile.label}.${detail ? ` (${detail})` : ""}`,
          );
        }
      }
    } finally {
      refreshing.current = false;
    }
  }, [applyCatalog, connect, profile.label, profile.signInHint]);

  const refreshSessions = useCallback(async () => {
    // Opening the sidebar should not reconnect a harness the user disconnected.
    if (!clientRef.current || !connectionRef.current) return;
    await refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (
      work: (api: AcpClient, signal: AbortSignal) => Promise<void>,
      timeoutMs = 20000,
    ) => {
      const api = clientRef.current;
      if (!api || mutation.current)
        throw new Error(`${profile.label} is not ready.`);
      mutation.current = true;
      setMutating(true);
      setError(null);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await work(api, controller.signal);
      } catch (cause) {
        const detail =
          cause instanceof Error && cause.message.trim()
            ? `: ${cause.message.trim()}`
            : "";
        setError(
          `${profile.label} request failed${detail}. Refresh before retrying; it may already have been accepted.`,
        );
        throw cause;
      } finally {
        clearTimeout(timeout);
        mutation.current = false;
        setMutating(false);
      }
    },
    [profile.label],
  );

  const allModels = useMemo((): AcpModel[] => {
    const combined = new Map<string, AcpModel>();
    for (const model of catalogModels) combined.set(model.modelId, model);
    const activeState = sessionID ? sessionsByID[sessionID] : null;
    for (const model of activeState?.models ?? [])
      if (!combined.has(model.modelId)) combined.set(model.modelId, model);
    return [...combined.values()];
  }, [catalogModels, sessionID, sessionsByID]);

  const findModel = (ref: string | null): AcpModel | null => {
    if (!ref) return null;
    const id = modelIDFromRef(profile, ref);
    return (
      allModels.find((model) => model.modelId === id) ??
      Object.values(sessionsRef.current)
        .flatMap((state) => state.models)
        .find((model) => model.modelId === id) ?? {
        modelId: id,
        name: id,
      }
    );
  };

  const persistLink = async (link: HarnessConversationLink) => {
    const next = await saveHarnessConversationLink(repositories, link);
    commitLinks(next);
    return next;
  };

  const persistSelectedMcpServerIds = async (conversationId: string) => {
    const ids = selectedMcpServerIdsRef.current;
    await repositories.conversationRepository
      .updateMetadata(conversationId, { selectedMcpServerIds: ids })
      .catch((cause) => {
        console.warn(
          `Could not save the ${profile.label} MCP selection for this chat.`,
          cause,
        );
      });
  };

  const syncStateToLocal = useCallback(
    (state: AcpSessionState, conversationId: string) => {
      // Serialize writes per conversation. A queued user message and a later
      // prompt settlement can race; the older snapshot must never win.
      const previous =
        syncQueues.current.get(conversationId) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(async () => {
        const localMessages =
          await repositories.messageRepository.listByConversation(
            conversationId,
          );
        await syncConversationMessages({
          conversationId,
          title: state.title || `${profile.label} chat`,
          providerId: profile.providerId,
          modelId: state.modelId,
          agentId: state.modeId,
          agentMode: conversationMode(state.modeId),
          messages: mergeHarnessTranscript(state.messages, localMessages),
        });
      });
      syncQueues.current.set(conversationId, next);
      return next.finally(() => {
        if (syncQueues.current.get(conversationId) === next)
          syncQueues.current.delete(conversationId);
      });
    },
    [profile.label, profile.providerId, repositories, syncConversationMessages],
  );

  const createRemoteSession = async (
    api: AcpClient,
    sessionCwd: string,
    mcpServers: AcpMcpServer[],
    signal?: AbortSignal,
  ) => {
    const result = await api.request<AcpNewSessionResult>(
      "session/new",
      { cwd: sessionCwd, mcpServers },
      { timeoutMs: 30000, signal },
    );
    setPhoneToolsEnabled(Boolean(phoneToolsForSession()));
    setPhoneToolsError(null);
    return result;
  };

  const createRemoteSessionFor = async (
    api: AcpClient,
    sessionCwd: string,
    selectedServerIds: string[] | null,
    signal?: AbortSignal,
  ) =>
    createRemoteSession(
      api,
      sessionCwd,
      await buildSessionMcpServers(selectedServerIds),
      signal,
    );

  const applyModelConfig = async (
    api: AcpClient,
    state: AcpSessionState,
    model: AcpModel,
    signal?: AbortSignal,
  ): Promise<AcpSessionState> => {
    // A prompt can stream while config requests are in flight. Read the live
    // state at each step so this never overwrites newer messages.
    let latest = sessionsRef.current[state.id] ?? state;
    const selection = acpModelSelection(model, latest.configOptions);
    let configs = latest.configOptions;
    const modelOption = configs.find(
      (option) => option.id === "model" || option.category === "model",
    );
    if (
      modelOption &&
      String(modelOption.currentValue) !== selection.modelValue
    ) {
      const result = await api.request<SetConfigResult>(
        "session/set_config_option",
        {
          sessionId: latest.id,
          configId: modelOption.id,
          value: selection.modelValue,
        },
        { timeoutMs: 20000, signal },
      );
      if (result?.configOptions?.length) configs = result.configOptions;
    }
    if (selection.thoughtValue) {
      const thoughtOption = configs.find(
        (option) =>
          option.id === "thought_level" ||
          option.category === "thought_level" ||
          /thought|thinking|reason/i.test(option.id),
      );
      if (
        thoughtOption &&
        String(thoughtOption.currentValue) !== selection.thoughtValue
      ) {
        try {
          const result = await api.request<SetConfigResult>(
            "session/set_config_option",
            {
              sessionId: latest.id,
              configId: thoughtOption.id,
              value: selection.thoughtValue,
            },
            { timeoutMs: 20000, signal },
          );
          if (result?.configOptions?.length) configs = result.configOptions;
        } catch (cause) {
          // The model selection already succeeded; a thinking-level mismatch
          // should not make the caller think the model itself failed.
          console.warn(`Could not set the ${profile.label} thinking level.`, cause);
        }
      }
    }
    latest = sessionsRef.current[state.id] ?? latest;
    return { ...latest, configOptions: configs, modelId: model.modelId };
  };

  const applyModeConfig = async (
    api: AcpClient,
    state: AcpSessionState,
    modeID: string,
    signal?: AbortSignal,
  ): Promise<AcpSessionState> => {
    let latest = sessionsRef.current[state.id] ?? state;
    const option = latest.configOptions.find(
      (entry) => entry.id === "mode" || entry.category === "mode",
    );
    if (!option) return { ...latest, modeId: modeID };
    if (String(option.currentValue) === modeID) {
      latest = sessionsRef.current[state.id] ?? latest;
      return {
        ...latest,
        modeId: modeID,
        modes: latest.modes
          ? { ...latest.modes, currentModeId: modeID }
          : latest.modes,
      };
    }
    const result = await api.request<SetConfigResult>(
      "session/set_config_option",
      { sessionId: latest.id, configId: option.id, value: modeID },
      { timeoutMs: 20000, signal },
    );
    latest = sessionsRef.current[state.id] ?? latest;
    return {
      ...latest,
      modeId: modeID,
      modes: latest.modes
        ? { ...latest.modes, currentModeId: modeID }
        : latest.modes,
      configOptions: result?.configOptions?.length
        ? result.configOptions
        : latest.configOptions,
    };
  };

  const resumeSessionMcp = async (
    selectedServerIds?: string[] | null,
  ): Promise<boolean> => {
    const api = clientRef.current;
    const id = sessionIDRef.current;
    if (!api || !id) return false;
    const state = sessionsRef.current[id];
    if (!state) return false;
    if (state.running || promptInFlight.current.has(id)) {
      // ACP only allows one active prompt and resume during a turn can race
      // the prompt. Apply the new MCP list when the turn settles.
      pendingMcpRefresh.current = true;
      return false;
    }
    const mcpServers = await buildSessionMcpServers(
      selectedServerIds !== undefined
        ? selectedServerIds
        : selectedMcpServerIdsRef.current,
    );
    await api.request<AcpResumeSessionResult>(
      "session/resume",
      { sessionId: id, cwd: state.cwd, mcpServers },
      { timeoutMs: 30000 },
    );
    // Resuming can reset the model/mode selection, so put the user's choices
    // back before the next prompt.
    let next = sessionsRef.current[id] ?? state;
    const modelRef =
      selectedRef ??
      (next.modelId ? acpModelRef(profile, next.modelId) : null);
    const model = modelRef ? findModel(modelRef) : null;
    if (model) next = await applyModelConfig(api, next, model);
    if (next.modeId) next = await applyModeConfig(api, next, next.modeId);
    commitSession(next);
    setPhoneToolsEnabled(Boolean(phoneToolsForSession()));
    setPhoneToolsError(null);
    pendingMcpRefresh.current = false;
    return true;
  };

  const setSelectedMcpServerIds = async (
    selectedServerIds: string[] | null,
  ) => {
    commitSelectedMcpServerIds(selectedServerIds);
    await directChat
      .setCurrentSelectedMcpServerIds(selectedServerIds)
      .catch(() => {});
    if (!sessionIDRef.current) return;
    try {
      await resumeSessionMcp(selectedServerIds);
    } catch (cause) {
      console.warn(`Could not apply the ${profile.label} MCP selection.`, cause);
      setPhoneToolsError(
        "The MCP selection was saved, but this chat could not reconnect to it. Start a new chat or reconnect.",
      );
    }
  };

  const refreshMcpServers = async () => {
    if (!sessionIDRef.current) return;
    try {
      await resumeSessionMcp();
    } catch (cause) {
      console.warn(`Could not refresh ${profile.label} MCP servers.`, cause);
      setPhoneToolsError(
        "Could not reconnect this chat to the selected MCP servers. Start a new chat or reconnect.",
      );
    }
  };

  const connectPhoneTools = async () => {
    if (!phoneBridge.sharing)
      throw new Error("Start device sharing before connecting phone tools.");
    if (!clientRef.current) throw new Error(`Connect ${profile.label} first.`);
    setPhoneToolsError(null);
    try {
      await resumeSessionMcp();
    } catch (cause) {
      setPhoneToolsError(
        `Could not attach phone tools to this ${profile.label} chat. Start a new chat and try again.`,
      );
      throw cause;
    }
    setPhoneToolsEnabled(true);
  };

  const refreshMcpServersRef = useRef(refreshMcpServers);
  refreshMcpServersRef.current = refreshMcpServers;
  const sharingID = phoneBridge.sharing?.id ?? null;
  const lastSharingID = useRef<string | null>(null);
  useEffect(() => {
    if (lastSharingID.current === sharingID) return;
    lastSharingID.current = sharingID;
    if (!sharingID) setPhoneToolsEnabled(false);
    if (!sessionIDRef.current) return;
    // Start/stop sharing changes the phone MCP entry, so reconnect the active
    // session with the new server list. If a prompt is running this is queued
    // until the turn settles.
    void refreshMcpServersRef.current();
  }, [sharingID]);

  const attachConversation = async (
    conversationId: string,
    ref: string,
  ): Promise<void> => {
    const api = clientRef.current;
    if (!api) throw new Error(`Connect ${profile.label} before switching models.`);
    const model = findModel(ref);
    if (!model) throw new Error(`${profile.label} model is unavailable.`);
    const conversation =
      await repositories.conversationRepository.getById(conversationId);
    if (!conversation) throw new Error("Chat not found.");
    const localMessages =
      await repositories.messageRepository.listByConversation(conversationId);
    const existing = linksRef.current[conversationId];
    const sessionCwd =
      existing?.cwd?.trim() ||
      connectionRef.current?.cwd.trim() ||
      cwdRef.current;
    const selectedServerIds = conversation.selectedMcpServerIds ?? null;
    const mcpServers = await buildSessionMcpServers(selectedServerIds);
    commitSelectedMcpServerIds(selectedServerIds);
    let result: AcpNewSessionResult | null = null;
    let resumed = false;

    if (existing && existing.providerId === profile.providerId) {
      try {
        const resumedResult = await api.request<AcpResumeSessionResult>(
          "session/resume",
          {
            sessionId: existing.sessionID,
            cwd: existing.cwd?.trim() || sessionCwd,
            mcpServers,
          },
          { timeoutMs: 30000 },
        );
        result = { ...resumedResult, sessionId: existing.sessionID };
        resumed = true;
      } catch (cause) {
        console.warn(`Could not resume the ${profile.label} session.`, cause);
      }
    }

    if (!result) {
      if (existing?.providerId === profile.providerId) {
        await api
          .request(
            "session/close",
            { sessionId: existing.sessionID },
            { timeoutMs: 5000 },
          )
          .catch(() => {});
      }
      result = await createRemoteSession(api, sessionCwd, mcpServers);
    }
    setPhoneToolsEnabled(Boolean(phoneToolsForSession()));
    setPhoneToolsError(null);
    pendingMcpRefresh.current = false;

    let state = createAcpSessionState(profile, {
      result,
      cwd: sessionCwd,
      messages: localMessages,
      commands: commandsBySessionRef.current[result.sessionId] ?? [],
    });
    state = { ...state, title: conversation.title || `${profile.label} chat` };
    try {
      state = await applyModelConfig(api, state, model);
    } catch (cause) {
      console.warn(`Could not select the ${profile.label} model.`, cause);
      setError(
        `Connected to ${profile.label}, but the selected model could not be applied.`,
      );
    }
    const modes = acpModeForState(state);
    const savedMode = findMode(modes, conversation.agentId);
    const desiredMode =
      savedMode?.id ??
      selectedModeID ??
      (conversation.agentMode === "plan"
        ? "plan"
        : (modes?.currentModeId ?? null));
    if (desiredMode) {
      try {
        state = await applyModeConfig(api, state, desiredMode);
      } catch (cause) {
        console.warn(`Could not select the ${profile.label} mode.`, cause);
      }
    }

    const nextLink: HarnessConversationLink = resumed
      ? {
          ...existing!,
          cwd: state.cwd,
          syncedMessageIDs:
            existing!.syncedMessageIDs ?? localMessages.map((row) => row.id),
        }
      : {
          conversationId,
          providerId: profile.providerId,
          sessionID: state.id,
          cwd: state.cwd,
          syncedMessageIDs: [],
        };
    await persistLink(nextLink);

    // Carry approvals from a replaced session onto the local chat.
    if (existing) {
      const previousMode =
        directConfig.conversationApprovalModes?.[existing.sessionID];
      if (previousMode) {
        directConfig.setConversationApprovalMode(
          conversationId,
          previousMode,
        );
      }
      for (const toolName of
        directConfig.conversationApprovedTools?.[existing.sessionID] ?? []) {
        directChat.approveToolForChat(conversationId, toolName);
      }
    }

    commitSession(state);
    setSelectedRef(
      state.modelId ? acpModelRef(profile, state.modelId) : null,
    );
    setSelectedModeID(state.modeId);
    setSelectedFileIdsState(conversation.selectedFileIds);
    setSessionID(state.id);
    setActive(true);
  };

  const forgetConversation = async (conversationId: string): Promise<void> => {
    // Read the stored link, not our cached copy: another harness may have
    // linked this chat while this controller was idle.
    const currentLinks = await loadHarnessConversationLinks(repositories).catch(
      () => linksRef.current,
    );
    const link = currentLinks[conversationId];
    commitLinks(currentLinks);
    // Another harness owns this chat; leave its link for that controller.
    if (link && link.providerId !== profile.providerId) return;
    if (link) {
      const permission = pendingPermissionRef.current;
      if (permission?.sessionID === link.sessionID) {
        await clientRef.current
          ?.respond(permission.requestID, {
            outcome: { outcome: "cancelled" },
          })
          .catch(() => {});
        commitPermission(null);
      }
      bumpStopEpoch(link.sessionID);
      await clientRef.current
        ?.request(
          "session/close",
          { sessionId: link.sessionID },
          { timeoutMs: 5000 },
        )
        .catch(() => {});
      removeSession(link.sessionID);
      if (sessionID === link.sessionID) {
        setSessionID(null);
        setActive(false);
        setSelectedRef(null);
        setSelectedModeID(null);
        setSelectedFileIdsState([]);
        setWaitingPrompts(0);
        setPhoneToolsEnabled(false);
        pendingMcpRefresh.current = false;
      }
    }
    const next = await removeHarnessConversationLink(
      repositories,
      conversationId,
    );
    commitLinks(next);
  };

  const renameLinkedConversation = async (
    conversationId: string,
    title: string,
  ): Promise<void> => {
    const link = linksRef.current[conversationId];
    if (!link || link.providerId !== profile.providerId) return;
    const state = sessionsRef.current[link.sessionID];
    if (state) commitSession({ ...state, title, updatedAt: nowISO() });
  };

  const detachConversation = async (): Promise<string | null> => {
    const id = sessionIDRef.current;
    if (!id) return null;
    const state = sessionsRef.current[id];
    if (!state) return null;
    const link = findLinkBySession(
      linksRef.current,
      id,
      profile.providerId,
    );
    const conversationId = link?.conversationId ?? Crypto.randomUUID();
    const finished = state.running
      ? detachAcpTurn(profile, state)
      : state;

    // Carry session-scoped approvals onto the local chat so switching
    // providers or re-creating the remote session keeps the same choice.
    const sessionApprovalMode =
      directConfig.conversationApprovalModes?.[id];
    if (sessionApprovalMode) {
      directConfig.setConversationApprovalMode(
        conversationId,
        sessionApprovalMode,
      );
    }
    for (const toolName of
      directConfig.conversationApprovedTools?.[id] ?? []) {
      directChat.approveToolForChat(conversationId, toolName);
    }

    await syncStateToLocal(finished, conversationId);
    if (!link) {
      await persistLink({
        conversationId,
        providerId: profile.providerId,
        sessionID: id,
        cwd: finished.cwd,
        // The in-flight prompt records exactly what it sent when it settles.
        // Marking every message here would lose queued user messages.
        syncedMessageIDs: [],
      });
    }
    return conversationId;
  };

  const selectModel = async (ref: string) => {
    const api = clientRef.current;
    if (!api) throw new Error(`Connect ${profile.label} before switching models.`);
    const model = findModel(ref);
    if (!model) throw new Error(`${profile.label} model is unavailable.`);
    const id = sessionIDRef.current;
    if (active && id) {
      await mutate(async (nextApi, signal) => {
        const current = sessionsRef.current[id];
        if (!current) return;
        let next = await applyModelConfig(
          nextApi,
          current,
          model,
          signal,
        );
        // Some agents reset the mode when the model changes. Reapply it so the
        // UI's selected agent keeps matching the remote session.
        if (current.modeId)
          next = await applyModeConfig(nextApi, next, current.modeId, signal);
        commitSession(next);
      });
    }
    setSelectedRef(ref);
    setActive(true);
    setError(null);
  };

  const selectAgent = async (idOrName: string | null) => {
    const current = sessionIDRef.current
      ? sessionsRef.current[sessionIDRef.current]
      : null;
    const modes =
      (current ? acpModeForState(current) : null) ??
      catalogModesRef.current;
    const mode = findMode(modes, idOrName);
    if (!mode) throw new Error(`This ${profile.label} mode is unavailable.`);
    const id = sessionIDRef.current;
    if (id) {
      await mutate(async (api, signal) => {
        const state = sessionsRef.current[id];
        if (!state) return;
        const next = await applyModeConfig(api, state, mode.id, signal);
        commitSession(next);
      });
    }
    setSelectedModeID(mode.id);
  };

  const selectSession = async (id: string) => {
    const link = findLinkBySession(
      linksRef.current,
      id,
      profile.providerId,
    );
    if (!link) {
      setError(
        `This ${profile.label} session is not linked to a local chat yet. Open the chat from the sidebar to resume it.`,
      );
      return;
    }
    const model = findModel(selectedRef) ?? allModels[0];
    if (!model) {
      setError(`${profile.label} has no available models. Refresh the connection.`);
      return;
    }
    await attachConversation(
      link.conversationId,
      acpModelRef(profile, model.modelId),
    );
  };

  const sendMessage = async (input: SendMessageInput) => {
    const api = clientRef.current;
    if (!api) throw new Error(`Connect ${profile.label} before sending a message.`);
    let id = sessionIDRef.current;
    let state = id ? sessionsRef.current[id] : null;
    let link = id
      ? findLinkBySession(linksRef.current, id, profile.providerId)
      : null;
    let conversationId = link?.conversationId ?? null;
    const sessionCwd =
      link?.cwd?.trim() ||
      connectionRef.current?.cwd.trim() ||
      cwdRef.current;
    const title = titleFromContent(input.content) || `${profile.label} chat`;

    if (!id) {
      const result = await createRemoteSessionFor(
        api,
        sessionCwd,
        selectedMcpServerIdsRef.current,
      );
      state = {
        ...createAcpSessionState(profile, {
          result,
          cwd: sessionCwd,
          commands: commandsBySessionRef.current[result.sessionId] ?? [],
        }),
        title,
      };
      id = state.id;
      conversationId = Crypto.randomUUID();
      await syncConversationMessages({
        conversationId,
        title,
        providerId: profile.providerId,
        modelId: state.modelId,
        agentId: state.modeId,
        agentMode: conversationMode(state.modeId),
        messages: [],
      });
      await persistSelectedMcpServerIds(conversationId);
      link = {
        conversationId,
        providerId: profile.providerId,
        sessionID: id,
        cwd: sessionCwd,
        syncedMessageIDs: [],
      };
      await persistLink(link);
      commitSession(state);
      setSessionID(id);
      setActive(true);
    } else if (!state) {
      throw new Error(`This ${profile.label} session is no longer available.`);
    }

    if (!conversationId) {
      conversationId = Crypto.randomUUID();
      await syncConversationMessages({
        conversationId,
        title,
        providerId: profile.providerId,
        modelId: state.modelId,
        agentId: state.modeId,
        agentMode: conversationMode(state.modeId),
        messages: state.messages,
      });
      await persistSelectedMcpServerIds(conversationId);
      link = {
        conversationId,
        providerId: profile.providerId,
        sessionID: id,
        cwd: state.cwd,
        syncedMessageIDs: state.messages.map((message) => message.id),
      };
      await persistLink(link);
    }

    const selectedModel = selectedRef ? findModel(selectedRef) : null;
    if (selectedModel) {
      state = await applyModelConfig(api, state, selectedModel);
      commitSession(state);
    }
    // A mode chosen before the first message was never applied to the new
    // remote session, which starts in the agent's default mode.
    if (selectedModeID) {
      state = await applyModeConfig(api, state, selectedModeID);
      commitSession(state);
    }

    let text = input.content;
    const attachmentBlocks: AcpContentBlock[] = [];
    if (input.selectedFileIds?.length) {
      const selected = await repositories.workspaceRepository.getByIds(
        input.selectedFileIds,
      );
      const attachment = await buildOpenCodePromptFiles({
        files: selected,
        resolveFile: resolveWorkspaceFile,
      });
      for (const file of attachment.files) {
        const block = dataURLToBlock(file.uri, file.name ?? "file");
        if (block) attachmentBlocks.push(block);
      }
      for (const upload of attachment.uploads) {
        const connection = connectionRef.current;
        if (connection) {
          try {
            const path = await uploadAcpHostFile({
              agentLabel: profile.label,
              connection,
              transport: expoFetch as typeof globalThis.fetch,
              directory: state.cwd,
              fileName: upload.file.displayName,
              bytes: upload.bytes,
              source: upload.source,
            });
            text += `\n\n[Attached file: \`${path}\` (${formatAttachmentSize(
              upload.size,
            )}). It is too large to inline, so read it with your file tools.]`;
            continue;
          } catch (cause) {
            console.warn(
              `Could not upload ${upload.file.displayName} to the ${profile.label} bridge.`,
              cause,
            );
          }
        }
        // An older bridge without /files can still receive a large attachment
        // when no native streaming handle forced it out of the inline path.
        if (upload.bytes && upload.bytes.byteLength <= MAX_INLINE_FALLBACK_BYTES) {
          const block = dataURLToBlock(
            `data:${upload.file.mimeType ?? "application/octet-stream"};base64,${bytesToBase64(
              upload.bytes,
            )}`,
            upload.file.displayName,
          );
          if (block) {
            attachmentBlocks.push(block);
            continue;
          }
        }
        text += `\n\n[Not attached: ${upload.file.displayName}. The bridge could not receive this file. Update the bridge and try again.]`;
      }
      if (attachment.skipped.length) {
        text += `\n\n[Not attached: ${attachment.skipped.join(
          ", ",
        )}. The file is missing from the phone workspace.]`;
      }
    }

    if (!text.trim() && !attachmentBlocks.length)
      throw new Error("Add a message or a file before sending.");

    // ACP only allows one active prompt per session. Queue any message sent
    // while a response is streaming and let that turn finish first.
    const previous = promptInFlight.current.get(id);
    const epoch = stopEpochs.current[id] ?? 0;
    state = sessionsRef.current[id] ?? state;
    state = beginAcpTurn(
      state,
      text,
      nowISO(),
      input.selectedFileIds ?? [],
    );
    const userMessageID = state.messages[state.messages.length - 1].id;
    commitSession(state);
    setSelectedFileIdsState([]);
    // Persist the outgoing row before the remote turn starts so switching chats
    // (or closing the app) still shows what was sent.
    if (conversationId) {
      await syncStateToLocal(state, conversationId).catch((cause) => {
        console.warn(`Could not save the outgoing ${profile.label} message.`, cause);
      });
    }

    setWaitingPrompts((count) => count + 1);
    let promptPromise: Promise<void> | undefined;
    promptPromise = (async () => {
      try {
        if (previous) await previous.catch(() => {});
        const current = sessionsRef.current[id];
        if (epoch !== (stopEpochs.current[id] ?? 0)) {
          // Stop/new chat was requested while this prompt was queued.
          if (current) {
            const at = nowISO();
            const stopped = {
              ...current,
              messages: current.messages.map((message) =>
                message.id === userMessageID
                  ? {
                      ...message,
                      status: "failed" as const,
                      error: "Stopped before sending.",
                      updatedAt: at,
                    }
                  : message,
              ),
              updatedAt: at,
            };
            commitSession(stopped);
            const stoppedLink = findLinkBySession(
              linksRef.current,
              id,
              profile.providerId,
            );
            if (stoppedLink) {
              await syncStateToLocal(
                stopped,
                stoppedLink.conversationId,
              ).catch((cause) => {
                console.warn(
                  `Could not save the cancelled ${profile.label} message.`,
                  cause,
                );
              });
            }
          }
          return;
        }
        if (current && !current.running)
          commitSession({ ...current, running: true });

        const promptState = sessionsRef.current[id] ?? state;
        const promptLink =
          findLinkBySession(linksRef.current, id, profile.providerId) ??
          link;
        const promptBlocks: AcpContentBlock[] = [];
        // Only messages before this turn are detached context. Anything after
        // it was queued while the previous response was still streaming.
        const currentIndex = promptState.messages.findIndex(
          (message) => message.id === userMessageID,
        );
        const context = buildAcpContext(
          profile,
          currentIndex >= 0
            ? promptState.messages.slice(0, currentIndex)
            : promptState.messages,
          promptLink?.syncedMessageIDs ?? [],
        );
        if (context.text)
          promptBlocks.push({ type: "text", text: context.text });
        if (text.trim()) promptBlocks.push({ type: "text", text });
        promptBlocks.push(...attachmentBlocks);
        if (!promptBlocks.length)
          throw new Error("Add a message or a file before sending.");

        const promptApi = clientRef.current;
        if (!promptApi) throw new Error(`${profile.label} is not ready.`);
        const result = await promptApi.request<PromptResult>(
          "session/prompt",
          { sessionId: id, prompt: promptBlocks },
          { timeoutMs: 30 * 60 * 1000 },
        );
        const liveState = sessionsRef.current[id];
        // The session may have been forgotten while the prompt was running.
        if (!liveState) return;
        const assistantID = liveState.currentAssistantId ?? null;
        const finished = finishAcpTurn(
          profile,
          liveState,
          result?.stopReason ?? "end_turn",
        );
        commitSession(finished);
        const liveLink = findLinkBySession(
          linksRef.current,
          id,
          profile.providerId,
        );
        if (liveLink) {
          // Persist even when the user switched chats mid-turn; the post-turn
          // effect only mirrors the currently selected session.
          await syncStateToLocal(finished, liveLink.conversationId).catch(
            (cause) => {
              console.warn(
                `Could not copy the ${profile.label} transcript locally.`,
                cause,
              );
            },
          );
          const synced = new Set([
            ...(liveLink.syncedMessageIDs ?? []),
            ...context.ids,
            userMessageID,
          ]);
          if (assistantID) synced.add(assistantID);
          await persistLink({
            ...liveLink,
            cwd: finished.cwd,
            syncedMessageIDs: [...synced],
          });
        }
      } catch (cause) {
        const liveState = sessionsRef.current[id];
        if (liveState) {
          const failed = finishAcpTurn(profile, liveState, null, true);
          commitSession(failed);
          const failureLink = findLinkBySession(
            linksRef.current,
            id,
            profile.providerId,
          );
          if (failureLink) {
            await syncStateToLocal(failed, failureLink.conversationId).catch(
              (error) => {
                console.warn(
                  `Could not copy the ${profile.label} transcript locally.`,
                  error,
                );
              },
            );
          }
        }
        const detail =
          cause instanceof Error ? cause.message.trim() : "";
        if (ACP_AUTH_ERROR_PATTERN.test(detail)) {
          setAuthRequired(true);
          setError(
            profile.signInHint,
          );
        } else {
          setError(
            `${profile.label} could not finish this response.${detail ? ` (${detail})` : ""}`,
          );
        }
        throw cause;
      } finally {
        if (pendingPermissionRef.current?.sessionID === id)
          commitPermission(null);
        setWaitingPrompts((count) => Math.max(0, count - 1));
        if (promptInFlight.current.get(id) === promptPromise)
          promptInFlight.current.delete(id);
        if (pendingMcpRefresh.current && id === sessionIDRef.current) {
          pendingMcpRefresh.current = false;
          await resumeSessionMcp().catch((cause) => {
            console.warn(
              `Could not apply the ${profile.label} MCP selection after the turn.`,
              cause,
            );
            setPhoneToolsError(
              "The MCP selection changed during this turn, but the chat could not reconnect to it. Start a new chat or reconnect.",
            );
          });
        }
      }
    })();
    promptInFlight.current.set(id, promptPromise);
    // Resolve once the turn is dispatched. ACP settles `session/prompt` only
    // when the response finishes, and awaiting that here would hold the
    // composer for the whole turn, blocking queued messages. Failures are
    // handled inside the prompt task and surfaced through `error`.
    void promptPromise.catch(() => {});
  };

  const respondPermission = async (
    permission: PendingAcpPermission,
    decision: "once" | "always" | "reject",
  ) => {
    const api = clientRef.current;
    if (!api) throw new Error(`${profile.label} is not ready.`);
    const option = acpPermissionOption(permission.options, decision);
    if (decision !== "reject" && !option)
      throw new Error(`${profile.label} did not offer an allow option.`);
    const result = option
      ? {
          outcome: {
            outcome: "selected",
            optionId: option.optionId,
          },
        }
      : { outcome: { outcome: "cancelled" } };
    await api.respond(permission.requestID, result);
    if (pendingPermissionRef.current?.id === permission.id)
      commitPermission(null);
  };

  const cancelPermission = async (
    permission: PendingAcpPermission,
  ) => {
    await clientRef.current?.respond(permission.requestID, {
      outcome: { outcome: "cancelled" },
    });
    if (pendingPermissionRef.current?.id === permission.id)
      commitPermission(null);
  };

  const cancelPendingPermission = async (sessionID?: string | null) => {
    const permission = pendingPermissionRef.current;
    if (!permission) return;
    if (sessionID && permission.sessionID !== sessionID) return;
    await cancelPermission(permission).catch(() => {});
  };

  const stop = async () => {
    const id = sessionIDRef.current;
    bumpStopEpoch(id);
    const permission = pendingPermissionRef.current;
    if (permission) await cancelPermission(permission).catch(() => {});
    const api = clientRef.current;
    if (!id || !api) return;
    const state = sessionsRef.current[id];
    if (state?.running) {
      const stopped = detachAcpTurn(profile, state);
      commitSession({ ...stopped, stopReason: "cancelled" });
    }
    await api
      .notify("session/cancel", { sessionId: id })
      .catch((cause) => {
        setError(
          `Could not stop ${profile.label}.${
            cause instanceof Error ? ` (${cause.message})` : ""
          }`,
        );
      });
    setWaitingPrompts(0);
  };

  const currentSession = sessionID ? sessionsByID[sessionID] : null;
  const modes =
    (currentSession ? acpModeForState(currentSession) : null) ??
    catalogModes;
  const agents = useMemo(
    () => (modes?.availableModes ?? []).map(presentAcpAgent),
    [modes],
  );
  const currentAgentID =
    currentSession?.modeId ??
    selectedModeID ??
    modes?.currentModeId ??
    null;
  const currentAgentName =
    modes?.availableModes.find((mode) => mode.id === currentAgentID)?.name ??
    "Default";

  const linkedConversationId = useMemo(() => {
    if (!sessionID) return null;
    return (
      findLinkBySession(links, sessionID, profile.providerId)
        ?.conversationId ?? null
    );
  }, [links, profile.providerId, sessionID]);

  const currentConversation = currentSession
    ? presentAcpConversation(profile, currentSession)
    : null;
  const selectedModel =
    allModels.find((model) => acpModelRef(profile, model.modelId) === selectedRef) ??
    (currentSession?.modelId
      ? allModels.find((model) => model.modelId === currentSession.modelId)
      : null) ??
    (active ? allModels[0] : null);
  const currentModel = selectedModel
    ? presentAcpModel(profile, selectedModel)
    : null;

  const permissionConversationId = pendingPermission
    ? (findLinkBySession(
        links,
        pendingPermission.sessionID,
        profile.providerId,
      )?.conversationId ?? null)
    : null;
  const currentApprovalIDs = [
    linkedConversationId,
    currentConversation?.id,
  ].filter((id): id is string => Boolean(id));
  const approvalMode: "ask" | "auto" = currentApprovalIDs.some(
    (id) => directConfig.conversationApprovalModes?.[id] === "auto",
  )
    ? "auto"
    : "ask";
  // A permission request belongs to its own session, which may be a chat the
  // user switched away from. Use that chat's approvals, not the active one.
  const permissionApprovalIDs = pendingPermission
    ? [permissionConversationId, pendingPermission.sessionID].filter(
        (id): id is string => Boolean(id),
      )
    : [];
  const autoApprove = Boolean(
    pendingPermission &&
      (permissionApprovalIDs.some(
        (id) => directConfig.conversationApprovalModes?.[id] === "auto",
      ) ||
        permissionApprovalIDs
          .flatMap(
            (id) => directConfig.conversationApprovedTools?.[id] ?? [],
          )
          .includes(pendingPermission.approval.toolName)),
  );
  const autoApprovePermissionID =
    autoApprove &&
    pendingPermission &&
    autoApproveFailure !== pendingPermission.id
      ? pendingPermission.id
      : null;

  useEffect(() => {
    if (!autoApprovePermissionID) return;
    const permission = pendingPermissionRef.current;
    if (!permission || permission.id !== autoApprovePermissionID) return;
    void respondPermission(permission, "once").catch(() =>
      setAutoApproveFailure(autoApprovePermissionID),
    );
    // Deliberately keyed by the request ID: respondPermission reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoApprovePermissionID]);

  useEffect(() => {
    setAutoApproveFailure(null);
  }, [pendingPermission?.id]);

  const permissionSession = pendingPermission
    ? sessionsByID[pendingPermission.sessionID]
    : null;
  const pendingToolApproval: PendingToolApproval | null =
    pendingPermission &&
    (!autoApprove || autoApproveFailure === pendingPermission.id)
      ? {
          ...pendingPermission.approval,
          chatTitle:
            permissionSession?.title ??
            currentConversation?.title ??
            `${profile.label}`,
          conversationId:
            permissionConversationId ?? pendingPermission.sessionID,
          runId: permissionConversationId ?? pendingPermission.sessionID,
        }
      : null;

  const messages = currentSession?.messages ?? [];
  const cachedCommands = sessionID
    ? commandsBySessionRef.current[sessionID]
    : undefined;
  const commands =
    currentSession?.commands.length
      ? currentSession.commands
      : cachedCommands?.length
        ? cachedCommands
        : catalogCommands;
  const snapshot = currentSession
    ? {
        session: currentConversation,
        messages: currentSession.messages,
        running: currentSession.running,
        permissions: pendingPermission ? [pendingPermission] : [],
        forms: [] as unknown[],
      }
    : null;

  // Persist the transcript locally once the turn settles. The local row is the
  // thread that direct providers continue from after a model switch.
  useEffect(() => {
    if (!sessionID || !currentSession || currentSession.running) return;
    const link = findLinkBySession(
      links,
      sessionID,
      profile.providerId,
    );
    if (!link) return;
    const signature = `${currentSession.id}:${currentSession.updatedAt}:${currentSession.messages.length}`;
    if (lastSync.current === signature) return;
    lastSync.current = signature;
    void syncStateToLocal(currentSession, link.conversationId).catch(
      (cause) => {
        console.warn("Could not update the local harness transcript.", cause);
        setError(
          `${profile.label} replied, but the local chat copy could not be saved. The reply is still in ${profile.label}.`,
        );
      },
    );
  }, [
    currentSession,
    links,
    profile.label,
    profile.providerId,
    sessionID,
    syncStateToLocal,
  ]);

  return {
    active,
    connected: status === "connected",
    status,
    error,
    authRequired,
    authStatus,
    commands,
    models: allModels,
    availableModels:
      status === "connected"
        ? allModels.map((model) => presentAcpModel(profile, model))
        : [],
    sessions: [] as never[],
    linkedConversationId,
    client,
    sessionID,
    agents,
    currentAgentID,
    currentAgentName,
    selectAgent,
    currentModel,
    currentConversation,
    messages,
    snapshot,
    selectedFileIds,
    setSelectedFileIds: async (fileIds: string[]) =>
      setSelectedFileIdsState(fileIds),
    selectedMcpServerIds,
    setSelectedMcpServerIds,
    pendingToolApproval,
    pendingQuestionnaire: null,
    mutating,
    awaitingPrompt: waitingPrompts > 0,
    loading: Boolean(active && sessionID && !currentSession),
    connectPhoneTools,
    phoneToolsError,
    phoneToolsEnabled,
    refreshMcpServers,
    connect,
    disconnect,
    selectModel,
    attachConversation,
    detachConversation,
    forgetConversation,
    renameLinkedConversation,
    selectSession,
    sendMessage,
    refresh,
    refreshSessions,
    mutate,
    approvalMode,
    deactivate: () => {
      bumpStopEpoch(sessionIDRef.current);
      void cancelPendingPermission(sessionIDRef.current);
      setActive(false);
      setSessionID(null);
      setSelectedModeID(null);
      setSelectedFileIdsState([]);
      setWaitingPrompts(0);
      setError(null);
      setPhoneToolsEnabled(false);
      setPhoneToolsError(null);
      pendingMcpRefresh.current = false;
      commitPermission(null);
    },
    newChat: async () => {
      bumpStopEpoch(sessionIDRef.current);
      await cancelPendingPermission(sessionIDRef.current);
      if (sessionIDRef.current) {
        await detachConversation().catch(() => {});
      }
      setSessionID(null);
      setSelectedModeID(null);
      setSelectedFileIdsState([]);
      setWaitingPrompts(0);
      setError(null);
      setPhoneToolsEnabled(Boolean(phoneBridge.sharing));
      setPhoneToolsError(null);
      pendingMcpRefresh.current = false;
      commitSelectedMcpServerIds(null);
      commitPermission(null);
      return null;
    },
    stop,
    replyPermission: async (decision: "once" | "always" | "reject") => {
      const permission = pendingPermissionRef.current;
      if (!permission) return;
      await respondPermission(permission, decision);
    },
    submitQuestionnaire: async (_answers: PendingQuestionnaireAnswer[]) => {
      throw new Error(`${profile.label} questions are not supported yet.`);
    },
    dismissQuestionnaire: async () => {},
  };
}

export type AcpHarnessController = ReturnType<typeof useAcpHarnessController>;
