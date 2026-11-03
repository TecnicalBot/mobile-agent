import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Crypto from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";
import { useSQLiteContext } from "expo-sqlite";
import { AppState } from "react-native";
import { createRepositories } from "@/core/db/database";
import { resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import { usePhoneBridge } from "@/providers/phone-bridge-state";
import {
  useChat as useDirectChat,
  useConfig as useDirectConfig,
} from "@/providers/app-state";
import { buildOpenCodePromptFiles } from "@/modules/harnesses/opencode-attachments";
import {
  attachOpenCodePhoneTools,
  PhoneToolsConnectionError,
} from "@/modules/harnesses/opencode-phone-tools";
import type {
  AgentInfo,
  ModelInfo,
  OpenCodeClient,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client";
import type {
  Conversation,
  ModelRef,
  PendingToolApproval,
  PendingQuestionnaireAnswer,
  SendMessageInput,
} from "@/core/types/app-state";
import { useOpenCode } from "@/hooks/use-opencode";
import { makeOpenCodeClient } from "@/modules/harnesses/opencode";
import { readOpenCodeAgents } from "@/modules/harnesses/opencode-agents";
import {
  OPENCODE_CONTINUATION_PROMPT,
  openCodeStalledAssistant,
} from "@/modules/harnesses/opencode-recovery";
import {
  loadOpenCodeConnection,
  saveOpenCodeConnection,
  type SavedOpenCodeConnection,
} from "@/modules/harnesses/opencode-storage";
import {
  openCodeFormAnswer,
  openCodeModelRef,
  presentOpenCodeConversation,
  presentOpenCodeAgent,
  presentOpenCodeMessages,
  presentOpenCodeModel,
  presentOpenCodeQuestionnaire,
} from "@/modules/harnesses/opencode-presentation";
import { createOpenCodeConversationAdapter } from "@/modules/harnesses/opencode-transfer";
import {
  findLinkBySession,
  linkedSessionIDs,
  loadHarnessConversationLinks,
  removeHarnessConversationLink,
  saveHarnessConversationLink,
  type HarnessConversationLinks,
} from "@/modules/harnesses/links";

async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 20000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function useHarnessController() {
  const database = useSQLiteContext();
  const repositories = useMemo(() => createRepositories(database), [database]);
  const directConfig = useDirectConfig();
  const directChat = useDirectChat();
  const syncConversationMessages = directChat.syncConversationMessages;
  const phoneBridge = usePhoneBridge();
  const [phoneToolsEnabled, setPhoneToolsEnabled] = useState(false);
  const [phoneToolsError, setPhoneToolsError] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIdsState] = useState<string[]>([]);
  const phoneBindings = useRef(
    new WeakMap<OpenCodeClient, Map<string, Promise<void>>>(),
  );
  useEffect(() => {
    setPhoneToolsEnabled(false);
    setPhoneToolsError(null);
    phoneBindings.current = new WeakMap();
  }, [phoneBridge.sharing?.id]);
  const [client, setClient] = useState<OpenCodeClient | null>(null);
  const conversationAdapter = useMemo(
    () => (client ? createOpenCodeConversationAdapter(client) : null),
    [client],
  );
  const [links, setLinks] = useState<HarnessConversationLinks>({});
  const linksRef = useRef<HarnessConversationLinks>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [defaultAgentID, setDefaultAgentID] = useState<string | null>(null);
  const [selectedAgentID, setSelectedAgentID] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [active, setActive] = useState(false);
  const [sessionID, setSessionID] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const connection = useRef<SavedOpenCodeConnection | null>(null);
  const generation = useRef(0);
  const mutation = useRef(false);
  const wasRunning = useRef(false);
  const recoveredUserMessageID = useRef<string | null>(null);
  const {
    snapshot,
    error: streamError,
    refresh,
  } = useOpenCode(client, active ? sessionID : null);

  useEffect(() => {
    linksRef.current = links;
  }, [links]);

  useEffect(() => {
    let cancelled = false;
    loadHarnessConversationLinks(repositories)
      .then((next) => {
        if (!cancelled) {
          linksRef.current = next;
          setLinks(next);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  useEffect(() => {
    wasRunning.current = false;
    recoveredUserMessageID.current = null;
  }, [sessionID]);

  const connect = useCallback(async () => {
    const epoch = ++generation.current;
    setStatus("connecting");
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const saved = await loadOpenCodeConnection();
      if (!saved) {
        if (epoch === generation.current) setStatus("disconnected");
        return;
      }
      const api = makeOpenCodeClient(
        saved,
        expoFetch as typeof globalThis.fetch,
      );
      const location = saved.directory.trim()
        ? { directory: saved.directory.trim() }
        : undefined;
      const [info, catalog, list, agentCatalog] = await Promise.all([
        api.server.info({ signal: controller.signal }),
        api.model.list(
          { location, types: ["chat"] },
          { signal: controller.signal },
        ),
        api.session.list(
          { directory: location?.directory, limit: 50, archived: false },
          { signal: controller.signal },
        ),
        readOpenCodeAgents(api, location?.directory, controller.signal),
      ]);
      if (!/^2\./.test(info.version))
        throw new Error("OpenCode V2 is required.");
      if (epoch !== generation.current) return;
      const previous = connection.current;
      if (
        previous &&
        (previous.url !== saved.url ||
          previous.username !== saved.username ||
          previous.password !== saved.password ||
          previous.directory !== saved.directory)
      ) {
        // Native session IDs belong to their connection, never carry them to a new host.
        setActive(false);
        setSessionID(null);
        setSelectedRef(null);
        setPhoneToolsEnabled(false);
        setSelectedAgentID(null);
      }
      connection.current = saved;
      setClient(api);
      setModels(catalog.data.filter((model) => model.enabled));
      setAgents(agentCatalog.agents);
      setDefaultAgentID(agentCatalog.defaultAgent?.id ?? null);
      setSessions(list.data);
      setStatus("connected");
    } catch {
      if (epoch === generation.current) {
        setClient(null);
        setStatus("disconnected");
        setError(
          "Could not connect to OpenCode. Check the server and reconnect in Settings → Harnesses.",
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void connect();
    return () => {
      generation.current += 1;
    };
    // This counter intentionally invalidates outstanding requests on unmount.
  }, [connect]);

  useEffect(() => {
    if (!client) return;
    let disposed = false;
    let reading = false;
    let controller: AbortController | null = null;
    const epoch = generation.current;
    const sync = async () => {
      if (disposed || reading || AppState.currentState !== "active") return;
      reading = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const directory = connection.current?.directory.trim() || undefined;
        const list = await client.session.list(
          { directory, limit: 50, archived: false },
          { signal: controller.signal },
        );
        if (!disposed && epoch === generation.current) {
          setSessions(list.data);
          setStatus("connected");
        }
      } catch {
        if (!disposed && epoch === generation.current)
          setStatus("disconnected");
      } finally {
        clearTimeout(timeout);
        reading = false;
      }
    };
    const interval = setInterval(() => {
      void sync();
    }, 15000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(interval);
      listener.remove();
    };
  }, [client]);

  useEffect(() => {
    if (!snapshot) return;
    setSessions((old) => [
      snapshot.session,
      ...old.filter((session) => session.id !== snapshot.session.id),
    ]);
    if (snapshot.session.model) {
      const model = models.find(
        (item) =>
          item.id === snapshot.session.model?.id &&
          item.providerID === snapshot.session.model?.providerID,
      );
      if (model) setSelectedRef(openCodeModelRef(model));
    }
  }, [snapshot, models]);

  useEffect(() => {
    if (snapshot?.session.id === sessionID) {
      setSelectedAgentID(snapshot.session.agent ?? null);
    }
  }, [snapshot?.session.id, snapshot?.session.agent, sessionID]);

  // OpenCode can end a turn with no text and no tool call (reasoning-only or
  // completely empty). Treat that as a stall, not a successful answer, and
  // resume once per user message with a hidden synthetic prompt. Reacting only
  // after we observed the session running avoids resurrecting old sessions that
  // were opened with a historical empty stop.
  useEffect(() => {
    if (!client || !sessionID || snapshot?.session.id !== sessionID) return;
    if (snapshot.running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    const stalled = openCodeStalledAssistant(snapshot.messages);
    if (!stalled) {
      wasRunning.current = false;
      return;
    }
    const lastUser = [...snapshot.messages]
      .reverse()
      .find((message) => message.type === "user");
    const recoveryKey = lastUser?.id ?? "no-user-message";
    if (recoveredUserMessageID.current === recoveryKey) return;
    recoveredUserMessageID.current = recoveryKey;
    wasRunning.current = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    void client.session
      .synthetic(
        {
          sessionID,
          text: OPENCODE_CONTINUATION_PROMPT,
          delivery: "queue",
          resume: true,
        },
        { signal: controller.signal },
      )
      .catch(() => {
        setError(
          "OpenCode stopped before finishing the response. Continue the chat to retry.",
        );
      })
      .finally(() => clearTimeout(timeout));
  }, [client, sessionID, snapshot]);

  const disconnect = useCallback(() => {
    generation.current++;
    setClient(null);
    setModels([]);
    setAgents([]);
    setDefaultAgentID(null);
    setSelectedAgentID(null);
    setSessions([]);
    setStatus("disconnected");
    setActive(false);
    setSessionID(null);
    setSelectedRef(null);
    setError(null);
    setPhoneToolsEnabled(false);
  }, []);

  const mutate = useCallback(
    async (
      work: (api: OpenCodeClient, signal: AbortSignal) => Promise<void>,
    ) => {
      if (!client || mutation.current)
        throw new Error("OpenCode is not ready.");
      mutation.current = true;
      setMutating(true);
      setError(null);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        await work(client, controller.signal);
        refresh();
      } catch (cause) {
        setError(
          "OpenCode request failed. Refresh before retrying; it may already have been accepted.",
        );
        throw cause;
      } finally {
        clearTimeout(timeout);
        mutation.current = false;
        setMutating(false);
      }
    },
    [client, refresh],
  );

  const syncSessionToLocal = useCallback(
    async (input: {
      conversationId: string;
      rawMessages: SessionMessageInfo[];
      session: SessionInfo;
    }) => {
      if (!conversationAdapter) return;
      await syncConversationMessages({
        conversationId: input.conversationId,
        title: input.session.title || "OpenCode chat",
        providerId: conversationAdapter.providerId,
        modelId: input.session.model?.id ?? null,
        agentId: input.session.agent ?? null,
        agentMode: input.session.agent === "plan" ? "plan" : "build",
        // A local mirror never owns the running state; the harness does.
        // Completed/failed is safer than leaving a streaming row behind when
        // the user switches to a direct model mid-turn.
        messages: presentOpenCodeMessages(
          input.rawMessages,
          input.session.id,
          false,
          input.conversationId,
          true,
        ),
      });
    },
    [conversationAdapter, syncConversationMessages],
  );

  const attachConversation = async (
    conversationId: string,
    ref: ModelRef,
  ): Promise<void> => {
    if (!client || !conversationAdapter)
      throw new Error("Connect a harness before switching models.");
    const model = models.find((item) => openCodeModelRef(item) === ref);
    if (!model) throw new Error("OpenCode model is unavailable.");
    const conversation =
      await repositories.conversationRepository.getById(conversationId);
    if (!conversation) throw new Error("Chat not found.");
    const localMessages =
      await repositories.messageRepository.listByConversation(conversationId);
    const existing = linksRef.current[conversationId];
    let nextSessionID: string | null = null;
    let nextSession: SessionInfo | null = null;

    if (existing && existing.providerId === conversationAdapter.providerId) {
      // Only an export failure means the remote session is unusable. Local
      // sync or metadata failures must not create a duplicate session.
      const exported = await withTimeout((signal) =>
        conversationAdapter.exportConversation(
          { conversationId, sessionID: existing.sessionID },
          signal,
        ),
      ).catch(() => null);
      const remoteIDs = new Set(exported?.messageIDs ?? []);
      if (
        exported &&
        localMessages.every((message) => remoteIDs.has(message.id))
      ) {
        nextSessionID = existing.sessionID;
        nextSession = await withTimeout((signal) =>
          client.session.get({ sessionID: existing.sessionID }, { signal }),
        );
        if ((nextSession.title ?? "") !== (conversation.title ?? "")) {
          await withTimeout((signal) =>
            client.session.update(
              {
                sessionID: existing.sessionID,
                title: conversation.title || "Linked chat",
              },
              { signal },
            ),
          );
          nextSession = {
            ...nextSession,
            title: conversation.title || "Linked chat",
          };
        }
        // Keep remote-only messages that arrived after the last local sync.
        await syncConversationMessages({
          conversationId,
          title: nextSession.title || exported.title,
          providerId: conversationAdapter.providerId,
          modelId: exported.model?.id ?? null,
          agentId: exported.agent,
          agentMode: exported.agent === "plan" ? "plan" : "build",
          messages: exported.messages,
        });
      }
    }

    if (!nextSessionID) {
      const importAgent =
        conversation.agentId &&
        agents.some((agent) => agent.id === conversation.agentId)
          ? conversation.agentId
          : defaultAgentID;
      const imported = await withTimeout((signal) =>
        conversationAdapter.importConversation(
          {
            conversationId,
            title: conversation.title || "New chat",
            messages: localMessages,
            agent: importAgent,
            agentMode: conversation.agentMode,
            model: { id: model.id, providerID: model.providerID },
            directory: connection.current?.directory,
          },
          signal,
        ),
      );
      nextSessionID = imported.sessionID;
      // Link the new session before any follow-up read or local sync. If one
      // of those fails, the imported transcript is still discoverable instead
      // of becoming an orphaned remote session.
      const nextLinks = await saveHarnessConversationLink(repositories, {
        conversationId,
        providerId: conversationAdapter.providerId,
        sessionID: imported.sessionID,
      });
      linksRef.current = nextLinks;
      setLinks(nextLinks);
      nextSession = await withTimeout((signal) =>
        client.session.get({ sessionID: imported.sessionID }, { signal }),
      );
      if (existing && existing.providerId === conversationAdapter.providerId) {
        await withTimeout(async (signal) => {
          await conversationAdapter.archiveSession?.(
            existing.sessionID,
            signal,
          );
        }).catch(() => {});
        setSessions((old) =>
          old.filter((session) => session.id !== existing.sessionID),
        );
      }
      await syncConversationMessages({
        conversationId,
        title: nextSession.title || conversation.title || "Linked chat",
        providerId: conversationAdapter.providerId,
        modelId: model.id,
        agentId: importAgent,
        agentMode: conversation.agentMode,
        messages: localMessages,
      });
    }

    if (
      !nextSession?.model ||
      nextSession.model.id !== model.id ||
      nextSession.model.providerID !== model.providerID
    ) {
      await withTimeout((signal) =>
        client.session.switchModel(
          {
            sessionID: nextSessionID!,
            model: { id: model.id, providerID: model.providerID },
          },
          { signal },
        ),
      );
      if (nextSession)
        nextSession = {
          ...nextSession,
          model: { id: model.id, providerID: model.providerID },
        };
    }

    if (nextSession) {
      setSessions((old) => [
        nextSession!,
        ...old.filter((session) => session.id !== nextSession!.id),
      ]);
    }
    setSelectedRef(ref);
    setSelectedAgentID(nextSession?.agent ?? null);
    setSelectedFileIdsState(conversation.selectedFileIds);
    setActive(true);
    setSessionID(nextSessionID);
    setError(null);
  };

  const forgetConversation = async (conversationId: string): Promise<void> => {
    const link = linksRef.current[conversationId];
    if (
      link &&
      conversationAdapter &&
      link.providerId === conversationAdapter.providerId
    ) {
      await withTimeout(async (signal) => {
        await conversationAdapter.archiveSession?.(link.sessionID, signal);
      }).catch(() => {});
      setSessions((old) =>
        old.filter((session) => session.id !== link.sessionID),
      );
    }
    const nextLinks = await removeHarnessConversationLink(
      repositories,
      conversationId,
    );
    linksRef.current = nextLinks;
    setLinks(nextLinks);
  };

  const renameLinkedConversation = async (
    conversationId: string,
    title: string,
  ): Promise<void> => {
    if (!client || !conversationAdapter) return;
    const link = linksRef.current[conversationId];
    if (!link || link.providerId !== conversationAdapter.providerId) return;
    await mutate(async (api, signal) => {
      await api.session.update(
        { sessionID: link.sessionID, title },
        { signal },
      );
    });
    setSessions((old) =>
      old.map((session) =>
        session.id === link.sessionID ? { ...session, title } : session,
      ),
    );
  };

  const detachConversation = async (): Promise<string | null> => {
    if (!client || !sessionID || !conversationAdapter) return null;
    const link = findLinkBySession(
      linksRef.current,
      sessionID,
      conversationAdapter.providerId,
    );
    const conversationId = link?.conversationId ?? Crypto.randomUUID();

    if (snapshot?.session.id === sessionID) {
      await syncSessionToLocal({
        conversationId,
        rawMessages: snapshot.messages,
        session: snapshot.session,
      });
    } else {
      const exported = await withTimeout((signal) =>
        conversationAdapter.exportConversation(
          { conversationId, sessionID },
          signal,
        ),
      );
      await syncConversationMessages({
        conversationId,
        title: exported.title,
        providerId: conversationAdapter.providerId,
        modelId: exported.model?.id ?? null,
        agentId: exported.agent,
        agentMode: exported.agent === "plan" ? "plan" : "build",
        messages: exported.messages,
      });
    }

    if (!link) {
      const nextLinks = await saveHarnessConversationLink(repositories, {
        conversationId,
        providerId: conversationAdapter.providerId,
        sessionID,
      });
      linksRef.current = nextLinks;
      setLinks(nextLinks);
    }
    return conversationId;
  };

  const selectModel = async (ref: ModelRef) => {
    const model = models.find((item) => openCodeModelRef(item) === ref);
    if (!model) throw new Error("OpenCode model is unavailable.");
    if (active && sessionID)
      await mutate(async (api, signal) => {
        await api.session.switchModel(
          { sessionID, model: { id: model.id, providerID: model.providerID } },
          { signal },
        );
      });
    setSelectedRef(ref);
    setActive(true);
  };

  const selectSession = async (id: string) => {
    if (!client) return;
    const session = sessions.find((item) => item.id === id);
    setError(null);
    setSessionID(id);
    setSelectedAgentID(null);
    setSelectedFileIdsState([]);
    setActive(true);
    if (session?.model) {
      const model = models.find(
        (item) =>
          item.id === session.model?.id &&
          item.providerID === session.model?.providerID,
      );
      setSelectedRef(model ? openCodeModelRef(model) : null);
    }
  };

  const selectedModel =
    models.find((model) => openCodeModelRef(model) === selectedRef) ??
    (active ? models[0] : undefined);
  const currentModel = selectedModel
    ? presentOpenCodeModel(selectedModel)
    : null;
  const currentSession =
    snapshot?.session.id === sessionID
      ? snapshot.session
      : sessions.find((session) => session.id === sessionID);
  // Selecting a remote session leaves the previous snapshot in place until
  // useOpenCode replaces it. Keep the chat loader visible for that gap instead
  // of rendering the old conversation as if it were the selected one.
  const loading = Boolean(
    active &&
    sessionID &&
    snapshot?.session.id !== sessionID &&
    !error &&
    !streamError,
  );
  const currentConversation: Conversation | null = currentSession
    ? presentOpenCodeConversation(currentSession)
    : null;
  const agentDirectory = currentSession?.location.directory;
  useEffect(() => {
    if (!client || !agentDirectory) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    void readOpenCodeAgents(client, agentDirectory, controller.signal)
      .then((catalog) => {
        if (!controller.signal.aborted) {
          setAgents(catalog.agents);
          setDefaultAgentID(catalog.defaultAgent?.id ?? null);
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [client, agentDirectory]);
  const currentAgentID =
    selectedAgentID ?? currentSession?.agent ?? defaultAgentID;
  const currentAgent = agents.find((agent) => agent.id === currentAgentID);
  const selectAgent = async (idOrName: string | null) => {
    const agent = agents.find(
      (item) =>
        (item.id === idOrName || item.name === idOrName) &&
        !item.hidden &&
        item.mode !== "subagent",
    );
    if (!agent) throw new Error("This OpenCode agent is unavailable.");
    if (sessionID) {
      await mutate(async (api, signal) => {
        await api.session.switchAgent(
          { sessionID, agent: agent.id },
          { signal },
        );
        setSessions((previous) =>
          previous.map((session) =>
            session.id === sessionID
              ? { ...session, agent: agent.id }
              : session,
          ),
        );
      });
    }
    setSelectedAgentID(agent.id);
  };
  const messages = useMemo(
    () =>
      snapshot?.session.id === sessionID
        ? presentOpenCodeMessages(
            snapshot.messages,
            sessionID!,
            snapshot.running,
          )
        : [],
    [snapshot, sessionID],
  );

  const linkedConversationId = useMemo(() => {
    if (!sessionID || !conversationAdapter) return null;
    return (
      findLinkBySession(links, sessionID, conversationAdapter.providerId)
        ?.conversationId ?? null
    );
  }, [conversationAdapter, links, sessionID]);

  const visibleSessions = useMemo(() => {
    if (!conversationAdapter) return sessions;
    const hidden = linkedSessionIDs(links, conversationAdapter.providerId);
    return sessions.filter((session) => !hidden.has(session.id));
  }, [conversationAdapter, links, sessions]);

  // Persist the remote transcript when the harness becomes idle. The active
  // chat remains remote-owned, but the local row is the thread that direct
  // providers will continue from after a model switch.
  useEffect(() => {
    if (!conversationAdapter || !sessionID || !snapshot) return;
    if (snapshot.session.id !== sessionID || snapshot.running) return;
    const link = findLinkBySession(
      links,
      sessionID,
      conversationAdapter.providerId,
    );
    if (!link) return;
    void syncSessionToLocal({
      conversationId: link.conversationId,
      rawMessages: snapshot.messages,
      session: snapshot.session,
    }).catch(() => {});
  }, [conversationAdapter, links, sessionID, snapshot, syncSessionToLocal]);

  const ensurePhoneTools = async (
    api: OpenCodeClient,
    directory: string,
    signal: AbortSignal,
  ) => {
    const shared = phoneBridge.sharing;
    if (!shared) throw new Error("Start phone tool sharing first.");
    let bindings = phoneBindings.current.get(api);
    if (!bindings) {
      bindings = new Map();
      phoneBindings.current.set(api, bindings);
    }
    const key = `${shared.id}:${directory}`;
    let binding = bindings.get(key);
    if (!binding) {
      binding = attachOpenCodePhoneTools({
        client: api,
        directory,
        url: shared.url,
        token: shared.token,
        instanceID: shared.id,
        signal,
      })
        .then((remove) => {
          phoneBridge.onRevoke(remove, shared.id);
        })
        .catch((cause) => {
          bindings.delete(key);
          setPhoneToolsEnabled(false);
          setPhoneToolsError(
            cause instanceof PhoneToolsConnectionError
              ? cause.message
              : "Could not register phone tools with OpenCode. Check the OpenCode connection and retry.",
          );
          throw cause;
        })
        .finally(() => {
          // Deduplicate only in-flight work. A completed promise is not proof
          // that the server is still connected after a restart/disconnect.
          if (bindings.get(key) === binding) bindings.delete(key);
        });
      bindings.set(key, binding);
    }
    await binding;
    setPhoneToolsError(null);
  };

  const resolveDirectory = async (api: OpenCodeClient, signal: AbortSignal) =>
    sessionID
      ? (await api.session.get({ sessionID }, { signal })).location.directory
      : (
          await api.location.get(
            connection.current?.directory
              ? { location: { directory: connection.current.directory } }
              : undefined,
            { signal },
          )
        ).directory;

  const connectPhoneTools = async () => {
    if (!client) throw new Error("Connect OpenCode first.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const directory = await resolveDirectory(client, controller.signal);
      await ensurePhoneTools(client, directory, controller.signal);
      setPhoneToolsEnabled(true);
    } finally {
      clearTimeout(timeout);
    }
  };

  // The effects below must not re-run when a render recreates these closures.
  const ensurePhoneToolsRef = useRef(ensurePhoneTools);
  ensurePhoneToolsRef.current = ensurePhoneTools;
  const resolveDirectoryRef = useRef(resolveDirectory);
  resolveDirectoryRef.current = resolveDirectory;

  // Tell the bridge which address the harness reached us on. It then advertises
  // a matching interface instead of assuming the harness is on this phone.
  const noteHarnessUrl = phoneBridge.noteHarnessUrl;
  useEffect(() => {
    noteHarnessUrl(
      status === "connected" ? (connection.current?.url ?? null) : null,
    );
  }, [noteHarnessUrl, status]);

  // Attaching is automatic: a paired harness should not need a manual tap after
  // every reconnect, network change, or app restart.
  const sharedPhone = phoneBridge.sharing;
  const sharedPhoneRef = useRef(sharedPhone);
  sharedPhoneRef.current = sharedPhone;
  useEffect(() => {
    const shared = sharedPhoneRef.current;
    if (!shared || !client || status !== "connected") return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let disposed = false;
    void (async () => {
      const directory = await resolveDirectoryRef.current(
        client,
        controller.signal,
      );
      await ensurePhoneToolsRef.current(client, directory, controller.signal);
      if (!disposed) setPhoneToolsEnabled(true);
    })()
      .catch(() => {
        if (!disposed) setPhoneToolsEnabled(false);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [client, status, sharedPhone?.id]);

  const sendMessage = async (input: SendMessageInput) => {
    await mutate(async (api, signal) => {
      let id = sessionID;
      if (!id) {
        const session = await api.session.create(
          {
            agent: currentAgentID ?? undefined,
            location: connection.current?.directory.trim()
              ? { directory: connection.current.directory.trim() }
              : undefined,
            model: selectedModel
              ? { id: selectedModel.id, providerID: selectedModel.providerID }
              : undefined,
          },
          { signal },
        );
        id = session.id;
        setSessions((old) => [session, ...old]);
        setSessionID(id);
        if (connection.current) {
          connection.current = { ...connection.current, sessionID: id };
          await saveOpenCodeConnection(connection.current);
        }
      }
      if (phoneBridge.sharing) {
        const session = await api.session.get({ sessionID: id }, { signal });
        await ensurePhoneTools(api, session.location.directory, signal);
      }

      // The harness host cannot read phone paths, so selected files travel as
      // self-contained data URLs. This keeps the same composer attachments the
      // direct agent accepts usable with OpenCode.
      let text = input.content;
      let files: Awaited<ReturnType<typeof buildOpenCodePromptFiles>>["files"] =
        [];
      if (input.selectedFileIds?.length) {
        const selected = await repositories.workspaceRepository.getByIds(
          input.selectedFileIds,
        );
        const attachment = await buildOpenCodePromptFiles({
          files: selected,
          resolveFile: resolveWorkspaceFile,
          signal,
        });
        files = attachment.files;
        if (attachment.skipped.length)
          text += `\n\n[Not attached: ${attachment.skipped.join(", ")}. Files over 20 MB or missing from the workspace are skipped.]`;
      }

      await api.session.prompt(
        {
          sessionID: id,
          text,
          files: files.length ? files : undefined,
          delivery: input.delivery === "steer" ? "steer" : "queue",
        },
        { signal },
      );
      setSelectedFileIdsState([]);
    });
  };

  const permission =
    snapshot?.session.id === sessionID ? snapshot.permissions[0] : undefined;
  const approvalMode = currentConversation
    ? (directConfig.conversationApprovalModes?.[currentConversation.id] ??
      "ask")
    : "ask";
  // "Always allow" is stored per chat by the shared approval drawer. OpenCode
  // still owns the permission, so reply once per request instead of writing a
  // broader saved permission into the harness.
  const [autoApproveFailure, setAutoApproveFailure] = useState<string | null>(
    null,
  );
  const approvedToolsForChat = currentConversation
    ? (directConfig.conversationApprovedTools?.[currentConversation.id] ?? [])
    : [];
  const autoApprove =
    approvalMode === "auto" ||
    (permission ? approvedToolsForChat.includes(permission.action) : false);
  const autoApprovePermissionID = autoApprove ? permission?.id : undefined;
  useEffect(() => {
    if (!autoApprovePermissionID || !client || !sessionID) return;
    void client.permission
      .reply({
        sessionID,
        requestID: autoApprovePermissionID,
        decision: "once",
      })
      .catch(() => setAutoApproveFailure(autoApprovePermissionID));
  }, [autoApprovePermissionID, client, sessionID]);
  const pendingToolApproval: PendingToolApproval | null =
    permission && (!autoApprove || autoApproveFailure === permission.id)
      ? {
          id: permission.id,
          toolName: permission.action,
          inputSummary: permission.resources.join("\n"),
          chatTitle: currentConversation?.title ?? "OpenCode",
          conversationId: sessionID!,
          runId: sessionID!,
        }
      : null;
  const form =
    snapshot?.session.id === sessionID ? snapshot.forms[0] : undefined;
  const pendingQuestionnaire = form
    ? presentOpenCodeQuestionnaire(
        form,
        currentConversation?.title ?? "OpenCode",
      )
    : null;
  const replyPermission = async (decision: "once" | "always" | "reject") => {
    if (!permission || !sessionID) return;
    await mutate(async (api, signal) => {
      await api.permission.reply(
        { sessionID, requestID: permission.id, decision },
        { signal },
      );
    });
  };

  return {
    active,
    connected: status === "connected",
    status,
    error: error || (active ? streamError : null),
    models,
    availableModels:
      status === "connected" ? models.map(presentOpenCodeModel) : [],
    sessions: visibleSessions,
    linkedConversationId,
    client,
    sessionID,
    agents: agents.map(presentOpenCodeAgent),
    currentAgentID,
    currentAgentName: currentAgent?.name ?? "Select agent",
    selectAgent,
    currentModel,
    currentConversation,
    messages,
    snapshot,
    selectedFileIds,
    setSelectedFileIds: async (fileIds: string[]) =>
      setSelectedFileIdsState(fileIds),
    pendingToolApproval,
    pendingQuestionnaire,
    mutating,
    loading,
    connectPhoneTools,
    phoneToolsError,
    phoneToolsEnabled: phoneToolsEnabled && Boolean(phoneBridge.sharing),
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
    mutate,
    deactivate: () => {
      setActive(false);
      setSessionID(null);
      setSelectedAgentID(null);
      setSelectedFileIdsState([]);
      setError(null);
    },
    newChat: async () => {
      setSessionID(null);
      setSelectedAgentID(null);
      setSelectedFileIdsState([]);
      setError(null);
      return null;
    },
    stop: async () => {
      if (sessionID)
        await mutate(async (api, signal) => {
          await api.session.interrupt({ sessionID }, { signal });
        });
    },
    replyPermission,
    submitQuestionnaire: async (answers: PendingQuestionnaireAnswer[]) => {
      if (!form || !sessionID) return;
      await mutate(async (api, signal) => {
        await api.session.form.reply(
          {
            sessionID,
            formID: form.id,
            answer: openCodeFormAnswer(form, answers),
          },
          { signal },
        );
      });
    },
    dismissQuestionnaire: async () => {
      if (!form || !sessionID) return;
      await mutate(async (api, signal) => {
        await api.session.form.cancel(
          { sessionID, formID: form.id },
          { signal },
        );
      });
    },
  };
}

const HarnessContext = createContext<ReturnType<
  typeof useHarnessController
> | null>(null);
export function HarnessProvider({ children }: { children: ReactNode }) {
  const value = useHarnessController();
  return (
    <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>
  );
}
export function useHarness() {
  const value = useContext(HarnessContext);
  if (!value) throw new Error("HarnessProvider is required.");
  return value;
}
