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
import { uploadOpenCodeHostFile } from "@/modules/harnesses/opencode-host-files";
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
import { useAntigravityHarnessController } from "@/hooks/use-antigravity-harness";
import { useClaudeHarnessController } from "@/hooks/use-claude-harness";
import { useOpenCode } from "@/hooks/use-opencode";
import type { HarnessID } from "@/modules/harnesses/catalog";
import { makeOpenCodeClient } from "@/modules/harnesses/opencode";
import { readOpenCodeAgents } from "@/modules/harnesses/opencode-agents";
import {
  OPENCODE_CONTINUATION_PROMPT,
  openCodeConversationFailure,
  openCodeErrorMessage,
  openCodeExecutionFailure,
  openCodePromptReply,
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
  OPENCODE_PROVIDER_ID,
  presentOpenCodeConversation,
  presentOpenCodeAgent,
  presentOpenCodeMessages,
  presentOpenCodeModel,
  presentOpenCodeQuestionnaire,
} from "@/modules/harnesses/opencode-presentation";
import {
  buildDetachedTranscriptText,
  createOpenCodeConversationAdapter,
  mergeHarnessTranscript,
} from "@/modules/harnesses/opencode-transfer";
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useOpenCodeHarnessController() {
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
  const [pendingPrompt, setPendingPrompt] = useState<{
    sessionID: string;
    userID: string;
    previousMessageID: string | null;
    submittedAt: number;
  } | null>(null);
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
      .catch((cause) => {
        if (cancelled) return;
        console.warn("Could not load harness conversation links.", cause);
        setError(
          "Could not load saved OpenCode chat links. Reconnect before switching models.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  useEffect(() => {
    wasRunning.current = false;
    recoveredUserMessageID.current = null;
    setPendingPrompt(null);
  }, [sessionID]);

  const connect = useCallback(async () => {
    const epoch = ++generation.current;
    setStatus("connecting");
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let attemptedUrl: string | null = null;
    try {
      const saved = await loadOpenCodeConnection();
      if (!saved) {
        if (epoch === generation.current) setStatus("disconnected");
        return;
      }
      attemptedUrl = saved.url;
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
    } catch (cause) {
      if (epoch === generation.current) {
        setClient(null);
        setStatus("disconnected");
        const detail =
          cause instanceof Error && cause.message.trim()
            ? cause.message.trim()
            : "";
        const local =
          attemptedUrl !== null &&
          /^https?:\/\/(?:localhost|127\.|\[::1\])/i.test(attemptedUrl);
        setError(
          controller.signal.aborted
            ? `OpenCode connection timed out${
                attemptedUrl ? ` at ${attemptedUrl}` : ""
              }. Check that OpenCode is running and reachable.`
            : attemptedUrl
              ? `Could not connect to OpenCode at ${attemptedUrl}.${
                  local
                    ? " If OpenCode runs in Termux on this phone, keep 127.0.0.1/localhost; if it runs on a computer, use that computer's LAN IP."
                    : " Check the server address, password, and network."
                }${detail ? ` (${detail})` : ""}`
              : "Could not load the saved OpenCode connection. Reconnect in Settings → Harnesses.",
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

  const refreshSessions = useCallback(async () => {
    if (!client) return;
    const epoch = generation.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const directory = connection.current?.directory.trim() || undefined;
      const list = await client.session.list(
        { directory, limit: 50, archived: false },
        { signal: controller.signal },
      );
      if (epoch !== generation.current) return;
      setSessions(list.data);
      setStatus("connected");
    } catch {
      if (epoch === generation.current) setStatus("disconnected");
    } finally {
      clearTimeout(timeout);
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let disposed = false;
    let foreground = AppState.currentState === "active";
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let backoff = 1000;
    const refreshSoon = () => {
      if (disposed || scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = undefined;
        if (!disposed) void refreshSessions();
      }, 250);
    };

    const subscribe = async () => {
      if (disposed || !foreground) return;
      const active = new AbortController();
      controller = active;
      try {
        for await (const event of client.event.subscribe({
          signal: active.signal,
        })) {
          if (disposed) break;
          backoff = 1000;
          if (
            event.type === "server.connected" ||
            event.type === "session.created" ||
            event.type === "session.deleted" ||
            event.type === "session.archived" ||
            event.type === "session.unarchived" ||
            event.type === "session.renamed" ||
            event.type === "session.forked" ||
            event.type === "session.moved"
          ) {
            refreshSoon();
          }
        }
      } catch {
        // The stream is repaired below; the regular list poll also recovers.
      } finally {
        if (!disposed && foreground && !active.signal.aborted) {
          reconnect = setTimeout(() => {
            void subscribe();
          }, backoff);
          backoff = Math.min(backoff * 2, 30000);
        }
      }
    };

    void subscribe();
    const listener = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      if (!foreground) {
        controller?.abort();
        if (reconnect) clearTimeout(reconnect);
      } else {
        backoff = 1000;
        void refreshSessions();
        void subscribe();
      }
    });

    return () => {
      disposed = true;
      controller?.abort();
      listener.remove();
      if (scheduled) clearTimeout(scheduled);
      if (reconnect) clearTimeout(reconnect);
    };
  }, [client, refreshSessions]);

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

  // A prompt can be admitted and then stop before the next snapshot/poll shows
  // the session running. Track the inbound prompt itself so a fast empty turn is
  // still recovered, and so a prompt that never produces a reply becomes an
  // error instead of returning the composer to idle in silence.
  useEffect(() => {
    if (!client || !sessionID || !pendingPrompt) return;
    if (pendingPrompt.sessionID !== sessionID) return;
    if (snapshot?.session.id !== sessionID) {
      // Do not leave the composer stuck in a running state if the snapshot
      // never arrives (for example, the harness connection dropped).
      const age = Date.now() - pendingPrompt.submittedAt;
      if (age < 20000) {
        const timer = setTimeout(() => refresh(), 20000 - age + 50);
        return () => clearTimeout(timer);
      }
      setError(
        "OpenCode did not return this session. Check the connection and retry.",
      );
      setPendingPrompt(null);
      return;
    }

    const reply = openCodePromptReply(snapshot.messages, pendingPrompt);
    if (reply.state === "answered") {
      setPendingPrompt(null);
      return;
    }
    if (reply.state !== "missing") {
      const failure = openCodeExecutionFailure(snapshot.messages);
      if (failure) {
        setError(failure.message);
        setPendingPrompt(null);
        return;
      }
    }
    if (reply.state === "stalled") {
      if (!snapshot.running) {
        setPendingPrompt(null);
        // Let the existing stall recovery inject the continuation prompt.
        wasRunning.current = true;
        refresh();
      }
      return;
    }
    if (snapshot.running) return;

    const age = Date.now() - pendingPrompt.submittedAt;
    if (age < 20000) {
      const timer = setTimeout(() => refresh(), 20000 - age + 50);
      return () => clearTimeout(timer);
    }
    setError(
      reply.state === "missing"
        ? "OpenCode did not start this response. Retry the prompt; it may not have been delivered."
        : "OpenCode did not finish this response. Retry the prompt to continue.",
    );
    setPendingPrompt(null);
  }, [client, pendingPrompt, refresh, sessionID, snapshot]);

  // Execution failures are derived from the latest snapshot below. Do not copy
  // them into local state: an old failure must clear as soon as a newer turn
  // exists, including a rate-limit retry that succeeds.
  const conversationFailure = useMemo(() => {
    if (!snapshot || snapshot.session.id !== sessionID) return null;
    if (snapshot.running || pendingPrompt) return null;
    return openCodeConversationFailure(snapshot.messages);
  }, [pendingPrompt, sessionID, snapshot]);
  const conversationError = conversationFailure
    ? openCodeErrorMessage(conversationFailure)
    : null;

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
      timeoutMs = 20000,
    ) => {
      if (!client || mutation.current)
        throw new Error("OpenCode is not ready.");
      mutation.current = true;
      setMutating(true);
      setError(null);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await work(client, controller.signal);
        refresh();
      } catch (cause) {
        const detail =
          cause instanceof Error && cause.message.trim()
            ? `: ${cause.message.trim()}`
            : "";
        setError(
          `OpenCode request failed${detail}. Refresh before retrying; it may already have been accepted.`,
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
      const remoteMessages = presentOpenCodeMessages(
        input.rawMessages,
        input.session.id,
        false,
        input.conversationId,
        true,
      );
      // Messages sent through a direct provider while the harness was detached
      // do not exist remotely. Preserve them in the local mirror instead of
      // letting the remote export delete them.
      const localMessages =
        await repositories.messageRepository.listByConversation(
          input.conversationId,
        );
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
        messages: mergeHarnessTranscript(remoteMessages, localMessages),
      });
    },
    [conversationAdapter, repositories, syncConversationMessages],
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
      // An export failure is recoverable: keep the original session as long as
      // it still exists. Creating a duplicate session here loses permissions
      // and splits the conversation.
      const exported = await withTimeout((signal) =>
        conversationAdapter.exportConversation(
          { conversationId, sessionID: existing.sessionID },
          signal,
        ),
      ).catch(() => null);
      const existingSession = await withTimeout((signal) =>
        client.session.get({ sessionID: existing.sessionID }, { signal }),
      ).catch(() => null);
      // An export proves the session exists even if the lookup was transiently
      // unavailable. Reuse it and let the snapshot load the session details.
      if (existingSession || exported) {
        nextSessionID = existing.sessionID;
        nextSession = existingSession;
        if (nextSession) {
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
          if (nextSession.time.archived) {
            await withTimeout((signal) =>
              client.session.update(
                { sessionID: existing.sessionID, archived: false },
                { signal },
              ),
            );
            nextSession = {
              ...nextSession,
              time: { ...nextSession.time, archived: undefined },
            };
          }
        }

        if (exported) {
          // Reuse the original session even when the local thread has messages
          // the harness has not seen. Those rows are kept locally, and their text
          // is injected once as hidden context so the harness can pick up where
          // the direct provider left off.
          const remoteIDs = new Set(exported.messageIDs);
          const syncedIDs = new Set(existing.syncedMessageIDs ?? []);
          const localOnly = localMessages.filter(
            (message) => !remoteIDs.has(message.id),
          );
          const toInject = localOnly.filter(
            (message) => !syncedIDs.has(message.id),
          );
          if (toInject.length) {
            const transcript = buildDetachedTranscriptText(toInject);
            if (transcript) {
              try {
                await withTimeout((signal) =>
                  client.session.synthetic(
                    {
                      sessionID: existing.sessionID,
                      text: transcript,
                      delivery: "queue",
                      resume: false,
                    },
                    { signal },
                  ),
                );
                const nextLinks = await saveHarnessConversationLink(
                  repositories,
                  {
                    ...existing,
                    syncedMessageIDs: [
                      ...syncedIDs,
                      ...toInject.map((message) => message.id),
                    ],
                  },
                );
                linksRef.current = nextLinks;
                setLinks(nextLinks);
              } catch (cause) {
                // A catch-up failure must not force a new session. Keep the
                // messages local and retry on the next attach.
                console.warn(
                  "Could not inject detached harness context.",
                  cause,
                );
              }
            }
          }

          // Keep remote-only messages that arrived after the last local sync and
          // preserve messages that only exist in the phone transcript.
          await syncConversationMessages({
            conversationId,
            title: nextSession?.title || exported.title,
            providerId: conversationAdapter.providerId,
            modelId: exported.model?.id ?? null,
            agentId: exported.agent,
            agentMode: exported.agent === "plan" ? "plan" : "build",
            messages: mergeHarnessTranscript(exported.messages, localMessages),
          });
        }
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
      // Carry approvals from the replaced session so "allow always" keeps
      // working even when the old remote session cannot be reused.
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
    // Read the stored link, not our cached copy: another harness may have
    // linked this chat while this controller was idle.
    const currentLinks = await loadHarnessConversationLinks(repositories).catch(
      () => linksRef.current,
    );
    const link = currentLinks[conversationId];
    linksRef.current = currentLinks;
    setLinks(currentLinks);
    // Another harness owns this chat; leave its link for that controller.
    if (link && link.providerId !== OPENCODE_PROVIDER_ID) return;
    if (link) {
      await withTimeout(async (signal) => {
        await conversationAdapter?.archiveSession?.(link.sessionID, signal);
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

    // Carry session-scoped approvals onto the local chat so later provider
    // switches or a re-created harness session keep the same choice.
    const sessionApprovalMode =
      directConfig.conversationApprovalModes?.[sessionID];
    if (sessionApprovalMode) {
      directConfig.setConversationApprovalMode(
        conversationId,
        sessionApprovalMode,
      );
    }
    for (const toolName of
      directConfig.conversationApprovedTools?.[sessionID] ?? []) {
      directChat.approveToolForChat(conversationId, toolName);
    }

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
      const localMessages =
        await repositories.messageRepository.listByConversation(
          conversationId,
        );
      await syncConversationMessages({
        conversationId,
        title: exported.title,
        providerId: conversationAdapter.providerId,
        modelId: exported.model?.id ?? null,
        agentId: exported.agent,
        agentMode: exported.agent === "plan" ? "plan" : "build",
        messages: mergeHarnessTranscript(exported.messages, localMessages),
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
      .catch((cause) => {
        if (!controller.signal.aborted) {
          console.warn("Could not load OpenCode agents.", cause);
          setError(
            "OpenCode connected, but its agents could not be loaded. Reconnect before changing agents.",
          );
        }
      })
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
    }).catch((cause) => {
      console.warn("Could not update the local harness transcript.", cause);
      setError(
        "OpenCode replied, but the local chat copy could not be saved. The reply is still in OpenCode.",
      );
    });
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
      .catch((cause) => {
        if (!disposed) {
          setPhoneToolsEnabled(false);
          setPhoneToolsError(
            cause instanceof PhoneToolsConnectionError
              ? cause.message
              : "Could not register phone tools with OpenCode. Check the OpenCode connection and retry.",
          );
        }
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
      // The harness host cannot read phone paths, so small selected files travel
      // as self-contained data URLs. Large files are written to the harness
      // host's temporary directory and referenced by path, matching OpenCode's
      // own desktop attachment flow instead of being skipped.
      let text = input.content;
      let files: Awaited<ReturnType<typeof buildOpenCodePromptFiles>>["files"] =
        [];
      let uploads: Awaited<
        ReturnType<typeof buildOpenCodePromptFiles>
      >["uploads"] = [];
      let skipped: string[] = [];
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
        uploads = attachment.uploads;
        skipped = attachment.skipped;
      }

      let sessionDirectory = connection.current?.directory.trim() || undefined;
      if (phoneBridge.sharing || uploads.length) {
        const session = await api.session.get({ sessionID: id }, { signal });
        sessionDirectory = session.location.directory;
        if (phoneBridge.sharing)
          await ensurePhoneTools(api, sessionDirectory, signal);
      }

      if (uploads.length) {
        const savedConnection = connection.current;
        if (!savedConnection) throw new Error("OpenCode is not ready.");
        const info = await api.server.info({ signal });
        for (const upload of uploads) {
          const path = await uploadOpenCodeHostFile({
            connection: savedConnection,
            transport: expoFetch as typeof globalThis.fetch,
            directory: sessionDirectory,
            temporaryRoot: info.paths.tmp,
            uploadID: Crypto.randomUUID(),
            fileName: upload.file.displayName,
            bytes: upload.bytes,
            source: upload.source,
            signal,
          }).catch((cause) => {
            const detail =
              cause instanceof Error && cause.message.trim()
                ? `: ${cause.message.trim()}`
                : "";
            throw new Error(
              `Could not send ${upload.file.displayName} to OpenCode${detail}`,
            );
          });
          text += `\n\n[Attached file: \`${path}\` (${formatBytes(upload.size)}). It is too large to inline, so read it with your file tools.]`;
        }
      }

      if (skipped.length)
        text += `\n\n[Not attached: ${skipped.join(", ")}. The file is missing from the phone workspace.]`;

      const previousMessageID =
        snapshot?.session.id === id
          ? (snapshot.messages.at(-1)?.id ?? null)
          : null;
      const prompt = await api.session.prompt(
        {
          sessionID: id,
          text,
          files: files.length ? files : undefined,
          delivery: input.delivery === "steer" ? "steer" : "queue",
          resume: true,
        },
        { signal },
      );
      setPendingPrompt({
        sessionID: id,
        userID: prompt.id,
        previousMessageID,
        submittedAt: Date.now(),
      });
      setSelectedFileIdsState([]);
    }, 120000);
  };

  const permission =
    snapshot?.session.id === sessionID ? snapshot.permissions[0] : undefined;
  // Prefer the linked local chat: approvals then survive a harness session
  // being replaced or re-created. Fall back to the remote session ID so
  // approvals saved before links existed keep working.
  const approvalIDs = [
    linkedConversationId,
    currentConversation?.id,
  ].filter((id): id is string => Boolean(id));
  const approvalMode: "ask" | "auto" = approvalIDs.some(
    (id) => directConfig.conversationApprovalModes?.[id] === "auto",
  )
    ? "auto"
    : "ask";
  // "Always allow" is stored per chat by the shared approval drawer. OpenCode
  // still owns the permission, so reply once per request instead of writing a
  // broader saved permission into the harness.
  const [autoApproveFailure, setAutoApproveFailure] = useState<string | null>(
    null,
  );
  const approvedToolsForChat = [
    ...new Set(
      approvalIDs.flatMap(
        (id) => directConfig.conversationApprovedTools?.[id] ?? [],
      ),
    ),
  ];
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
    connectionUrl:
      status === "connected" ? (connection.current?.url ?? null) : null,
    error: error || (active ? streamError : null) || conversationError,
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
    selectedMcpServerIds: [],
    // OpenCode configures MCP servers on its host, so the app selection is
    // intentionally not forwarded through the harness.
    setSelectedMcpServerIds: async () => {},
    refreshMcpServers: async () => {},
    pendingToolApproval,
    pendingQuestionnaire,
    mutating,
    awaitingPrompt: Boolean(pendingPrompt),
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
    refreshSessions,
    mutate,
    approvalMode,
    deactivate: () => {
      setActive(false);
      setSessionID(null);
      setSelectedAgentID(null);
      setSelectedFileIdsState([]);
      setPendingPrompt(null);
      setError(null);
    },
    newChat: async () => {
      setSessionID(null);
      setSelectedAgentID(null);
      setSelectedFileIdsState([]);
      setPendingPrompt(null);
      setError(null);
      return null;
    },
    stop: async () => {
      setPendingPrompt(null);
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

/**
 * Multi-harness facade. Each harness owns its own transport and state; the
 * shared app surfaces see one active controller plus a per-harness record for
 * settings and connection management.
 */
function useHarnessController() {
  const opencode = useOpenCodeHarnessController();
  const antigravity = useAntigravityHarnessController();
  const claude = useClaudeHarnessController();
  const phoneBridge = usePhoneBridge();
  const harnesses = useMemo(
    () => ({ opencode, antigravity, claude }),
    [opencode, antigravity, claude],
  );
  type Controller = typeof opencode | typeof antigravity | typeof claude;
  const controllers: Controller[] = [opencode, antigravity, claude];

  const activeController =
    controllers.find((controller) => controller.active) ?? null;
  const connectedHarnessUrl =
    activeController?.connectionUrl ??
    controllers.find((controller) => controller.connectionUrl)?.connectionUrl ??
    null;
  // Device sharing follows whichever harness the user is working in. Report the
  // active connection, or any connected harness when no chat is open.
  const noteHarnessUrl = phoneBridge.noteHarnessUrl;
  useEffect(() => {
    noteHarnessUrl(connectedHarnessUrl);
  }, [connectedHarnessUrl, noteHarnessUrl]);
  const activeHarnessID: HarnessID | null = opencode.active
    ? "opencode"
    : antigravity.active
      ? "antigravity"
      : claude.active
        ? "claude"
        : null;
  const connected = activeController
    ? activeController.connected
    : controllers.some((controller) => controller.connected);
  const status =
    activeController?.status ??
    (controllers.some((controller) => controller.status === "connecting")
      ? "connecting"
      : connected
        ? "connected"
        : "disconnected");

  const controllerForRef = (ref: string): Controller =>
    ref.startsWith("harness:claude/")
      ? claude
      : ref.startsWith("harness:antigravity/")
        ? antigravity
        : opencode;

  const otherControllers = (target: Controller) =>
    controllers.filter((controller) => controller !== target);

  const deactivateOther = async (target: Controller) => {
    for (const other of otherControllers(target)) {
      if (!other.active) continue;
      const conversationId = await other
        .detachConversation()
        .catch((error) => {
          console.error(
            "Could not copy the harness transcript locally",
            error,
          );
          return null;
        });
      other.deactivate();
      if (conversationId) return conversationId;
    }
    return null;
  };

  /**
   * Close and unlink a remote session owned by another harness before this
   * one claims the local chat. Each controller guards on the stored provider,
   * so this is also safe to call when the chat is not linked yet.
   */
  const releaseOtherLink = async (
    target: Controller,
    conversationId: string,
  ) => {
    for (const other of otherControllers(target)) {
      await other.forgetConversation(conversationId).catch((error) => {
        console.error(
          "Could not release the other harness session",
          error,
        );
      });
    }
  };

  const selectModel = async (ref: ModelRef) => {
    const target = controllerForRef(ref);
    const conversationId = await deactivateOther(target);
    if (conversationId) {
      await releaseOtherLink(target, conversationId);
      await target.attachConversation(conversationId, ref);
      return;
    }
    await target.selectModel(ref);
  };

  const attachConversation = async (conversationId: string, ref: ModelRef) => {
    const target = controllerForRef(ref);
    await deactivateOther(target);
    await releaseOtherLink(target, conversationId);
    await target.attachConversation(conversationId, ref);
  };

  // The sidebar refreshes sessions when it opens. Keep this identity stable so
  // that effect does not fire on every provider render.
  const opencodeRefreshSessions = opencode.refreshSessions;
  const antigravityRefreshSessions = antigravity.refreshSessions;
  const claudeRefreshSessions = claude.refreshSessions;
  const refreshSessions = useCallback(async () => {
    await Promise.allSettled([
      opencodeRefreshSessions(),
      antigravityRefreshSessions(),
      claudeRefreshSessions(),
    ]);
  }, [
    opencodeRefreshSessions,
    antigravityRefreshSessions,
    claudeRefreshSessions,
  ]);

  return {
    active: controllers.some((controller) => controller.active),
    activeHarnessID,
    connected,
    status,
    error: activeController?.error ?? null,
    authRequired:
      activeHarnessID === "antigravity"
        ? antigravity.authRequired
        : activeHarnessID === "claude"
          ? claude.authRequired
          : false,
    authStatus:
      activeHarnessID === "antigravity"
        ? antigravity.authStatus
        : activeHarnessID === "claude"
          ? claude.authStatus
          : null,
    commands:
      activeController && "commands" in activeController
        ? activeController.commands
        : [],
    models: [...opencode.models, ...antigravity.models, ...claude.models],
    availableModels: [
      ...opencode.availableModels,
      ...antigravity.availableModels,
      ...claude.availableModels,
    ],
    sessions: activeController?.sessions ?? opencode.sessions,
    linkedConversationId: activeController?.linkedConversationId ?? null,
    sessionID: activeController?.sessionID ?? null,
    agents: activeController?.agents ?? [],
    currentAgentID: activeController?.currentAgentID ?? null,
    currentAgentName: activeController?.currentAgentName ?? "Select agent",
    selectAgent: async (idOrName: string | null) => {
      await activeController?.selectAgent(idOrName);
    },
    currentModel: activeController?.currentModel ?? null,
    currentConversation: activeController?.currentConversation ?? null,
    messages: activeController?.messages ?? [],
    snapshot: activeController?.snapshot ?? null,
    selectedFileIds: activeController?.selectedFileIds ?? [],
    setSelectedFileIds: async (fileIds: string[]) => {
      await activeController?.setSelectedFileIds(fileIds);
    },
    selectedMcpServerIds: activeController
      ? activeController.selectedMcpServerIds
      : (opencode.selectedMcpServerIds ?? null),
    setSelectedMcpServerIds: async (selectedMcpServerIds: string[] | null) => {
      await (activeController ?? opencode).setSelectedMcpServerIds(
        selectedMcpServerIds,
      );
    },
    refreshMcpServers: async () => {
      await (activeController ?? opencode).refreshMcpServers();
    },
    pendingToolApproval: activeController?.pendingToolApproval ?? null,
    pendingQuestionnaire: activeController?.pendingQuestionnaire ?? null,
    mutating: activeController?.mutating ?? false,
    awaitingPrompt: activeController?.awaitingPrompt ?? false,
    loading: activeController?.loading ?? false,
    connectPhoneTools: (activeController ?? opencode).connectPhoneTools,
    phoneToolsError: (activeController ?? opencode).phoneToolsError,
    phoneToolsEnabled: (activeController ?? opencode).phoneToolsEnabled,
    harnesses,
    connect: async () => {
      await Promise.allSettled([
        opencode.connect(),
        antigravity.connect(),
        claude.connect(),
      ]);
    },
    disconnect: () => {
      opencode.disconnect();
      antigravity.disconnect();
      claude.disconnect();
    },
    selectModel,
    attachConversation,
    detachConversation: async () =>
      (await activeController?.detachConversation()) ?? null,
    forgetConversation: async (conversationId: string) => {
      for (const controller of controllers) {
        await controller.forgetConversation(conversationId).catch((error) => {
          console.error("Could not archive the harness session", error);
        });
      }
    },
    renameLinkedConversation: async (conversationId: string, title: string) => {
      for (const controller of controllers) {
        await controller
          .renameLinkedConversation(conversationId, title)
          .catch((error) => {
            console.error("Could not rename the harness session", error);
          });
      }
    },
    selectSession: async (id: string) => {
      const owner = controllers.find((controller) =>
        controller.sessions.some((session) => session.id === id),
      );
      if (owner) {
        // A remote session can be selected while another harness owns the
        // active chat. Release it first so only one harness is active.
        await deactivateOther(owner);
        await owner.selectSession(id);
        return;
      }
      if (activeController) {
        await activeController.selectSession(id);
        return;
      }
      await opencode.selectSession(id);
    },
    sendMessage: async (input: SendMessageInput) => {
      if (!activeController)
        throw new Error("Select a harness model before sending a message.");
      await activeController.sendMessage(input);
    },
    refresh: async () => {
      if (activeController) {
        await activeController.refresh();
        return;
      }
      await Promise.allSettled([
        opencode.refresh(),
        antigravity.refresh(),
        claude.refresh(),
      ]);
    },
    refreshSessions,
    mutate: activeController?.mutate ?? opencode.mutate,
    approvalMode: activeController?.approvalMode ?? "ask",
    deactivate: () => {
      opencode.deactivate();
      antigravity.deactivate();
      claude.deactivate();
    },
    newChat: async () => {
      await deactivateOther(activeController ?? opencode);
      await activeController?.newChat();
      return null;
    },
    stop: async () => {
      await activeController?.stop();
    },
    replyPermission: async (decision: "once" | "always" | "reject") => {
      await activeController?.replyPermission(decision);
    },
    submitQuestionnaire: async (answers: PendingQuestionnaireAnswer[]) => {
      await activeController?.submitQuestionnaire(answers);
    },
    dismissQuestionnaire: async () => {
      await activeController?.dismissQuestionnaire();
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
