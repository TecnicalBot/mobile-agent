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
import { fetch as expoFetch } from "expo/fetch";
import { AppState } from "react-native";
import { usePhoneBridge } from "@/providers/phone-bridge-state";
import {
  attachOpenCodePhoneTools,
  PhoneToolsConnectionError,
} from "@/modules/harnesses/opencode-phone-tools";
import type {
  AgentInfo,
  ModelInfo,
  OpenCodeClient,
  SessionInfo,
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

function useHarnessController() {
  const phoneBridge = usePhoneBridge();
  const [phoneToolsEnabled, setPhoneToolsEnabled] = useState(false);
  const [phoneToolsError, setPhoneToolsError] = useState<string | null>(null);
  const phoneBindings = useRef(
    new WeakMap<OpenCodeClient, Map<string, Promise<void>>>(),
  );
  useEffect(() => {
    setPhoneToolsEnabled(false);
    setPhoneToolsError(null);
    phoneBindings.current = new WeakMap();
  }, [phoneBridge.sharing?.id]);
  const [client, setClient] = useState<OpenCodeClient | null>(null);
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
  const {
    snapshot,
    error: streamError,
    refresh,
  } = useOpenCode(client, active ? sessionID : null);

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
    if (input.selectedFileIds?.length)
      throw new Error("Phone attachments are not shared with OpenCode.");
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
      await api.session.prompt(
        {
          sessionID: id,
          text: input.content,
          delivery: input.delivery === "steer" ? "steer" : "queue",
        },
        { signal },
      );
    });
  };

  const permission =
    snapshot?.session.id === sessionID ? snapshot.permissions[0] : undefined;
  const pendingToolApproval: PendingToolApproval | null = permission
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
    sessions,
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
    pendingToolApproval,
    pendingQuestionnaire,
    mutating,
    connectPhoneTools,
    phoneToolsError,
    phoneToolsEnabled: phoneToolsEnabled && Boolean(phoneBridge.sharing),
    connect,
    disconnect,
    selectModel,
    selectSession,
    sendMessage,
    refresh,
    mutate,
    deactivate: () => {
      setActive(false);
      setSessionID(null);
      setSelectedAgentID(null);
      setError(null);
    },
    newChat: async () => {
      setSessionID(null);
      setSelectedAgentID(null);
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
