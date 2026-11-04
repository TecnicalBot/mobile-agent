import type {
  OpenCodeClient,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client";
import type { StoredMessage } from "@/core/types/app-state";

import {
  OPENCODE_PROVIDER_ID,
  openCodeStoredMessageID,
  presentOpenCodeMessages,
} from "./opencode-presentation";
import type {
  HarnessConversationAdapter,
  HarnessConversationTransfer,
} from "./types";

const EMPTY_TOKENS = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
} as const;

function newSessionID() {
  return `ses_mobile_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function storedMessageID(message: StoredMessage, index: number) {
  const suffix = message.id.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48);
  return `msg_${index.toString(36)}_${suffix || "message"}`;
}

/**
 * Project local chat rows into the transcript shape OpenCode imports. This is
 * intentionally text-only: tool traces are device-local metadata and are not
 * safe to replay remotely, but the conversational context is preserved.
 */
export function localMessagesToOpenCode(
  input: HarnessConversationTransfer,
): SessionMessageInfo[] {
  const model = input.model ?? { id: "unknown", providerID: "unknown" };
  const agent = input.agent ?? "build";
  const messages: SessionMessageInfo[] = [];
  let lastCreated = Date.now() - input.messages.length;

  input.messages.forEach((message, index) => {
    const parsed = Date.parse(message.createdAt);
    const created = Number.isFinite(parsed)
      ? Math.max(parsed, lastCreated + 1)
      : lastCreated + 1;
    lastCreated = created;
    const id = storedMessageID(message, index);
    const metadata = {
      mobileAgentConversationId: input.conversationId,
      mobileAgentMessageId: message.id,
    };

    if (message.role === "system") {
      messages.push({
        id,
        type: "system",
        text: message.content,
        time: { created },
        metadata,
      });
      return;
    }

    if (message.role === "user") {
      messages.push({
        id,
        type: "user",
        text: message.content,
        time: { created },
        metadata,
      });
      return;
    }

    const content = message.content.trim();
    if (!content) return;
    // Local rows are history. Import them as finished turns even when the
    // phone run was interrupted; a stale streaming status makes OpenCode
    // think the imported session is still running and swallow the next prompt.
    messages.push({
      id,
      type: "assistant",
      agent,
      model,
      content: [{ type: "text", text: message.content }],
      time: { created, completed: created + 1 },
      finish: "stop",
      metadata,
    });
  });

  return messages;
}

/**
 * Local rows that exist only in the phone transcript. They were added while the
 * chat was attached to a direct provider, so the remote harness has never seen
 * them.
 */
export function detachedLocalMessages(
  remoteMessages: StoredMessage[],
  localMessages: StoredMessage[],
): StoredMessage[] {
  const remoteIDs = new Set(remoteMessages.map((message) => message.id));
  return localMessages.filter((message) => !remoteIDs.has(message.id));
}

/**
 * Keep the full local thread when a remote export is synced back into the app.
 * `syncConversationMessages` deletes rows missing from its input, so merging is
 * required to avoid losing messages that were sent while the harness was
 * detached.
 */
export function mergeHarnessTranscript(
  remoteMessages: StoredMessage[],
  localMessages: StoredMessage[],
): StoredMessage[] {
  const localOnly = detachedLocalMessages(remoteMessages, localMessages);
  if (!localOnly.length) return remoteMessages;

  return [...remoteMessages, ...localOnly]
    .map((message, index) => {
      const parsed = Date.parse(message.createdAt);
      return {
        index,
        message,
        time: Number.isFinite(parsed) ? parsed : 0,
      };
    })
    .sort(
      (left, right) =>
        left.time - right.time ||
        left.message.sequence - right.message.sequence ||
        left.index - right.index,
    )
    .map(({ message }) => message);
}

/** Hidden, model-facing context that catches the harness up after a detach. */
export function buildDetachedTranscriptText(
  messages: StoredMessage[],
): string | null {
  const lines = messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => {
      const content = message.content.trim();
      if (!content) return null;
      return `${message.role === "user" ? "User" : "Assistant"}: ${content}`;
    })
    .filter((line): line is string => Boolean(line));

  if (!lines.length) return null;

  const maxLength = 20_000;
  let transcript = lines.join("\n\n");
  if (transcript.length > maxLength) {
    // Keep the most recent exchange; that is the context the next turn needs.
    transcript = `[Earlier detached messages omitted.]\n\n${transcript.slice(-maxLength)}`;
  }

  return [
    "While the OpenCode harness was detached, the user continued this chat with another provider.",
    "Treat the exchange below as prior context. Do not repeat it or answer it directly; continue the conversation from it.",
    "",
    transcript,
  ].join("\n");
}

export function createOpenCodeConversationAdapter(
  client: OpenCodeClient,
): HarnessConversationAdapter {
  return {
    providerId: OPENCODE_PROVIDER_ID,

    async exportConversation(input, signal) {
      const transfer = await client.session.export(
        { sessionID: input.sessionID },
        { signal },
      );
      return {
        title: transfer.info.title || "OpenCode chat",
        messageIDs: transfer.messages.map(openCodeStoredMessageID),
        messages: presentOpenCodeMessages(
          transfer.messages,
          input.sessionID,
          false,
          input.conversationId,
          true,
        ),
        agent: transfer.info.agent ?? null,
        model: transfer.info.model
          ? {
              id: transfer.info.model.id,
              providerID: transfer.info.model.providerID,
            }
          : null,
        running: false,
      };
    },

    async importConversation(input, signal) {
      const sessionID = newSessionID();
      let template: SessionInfo | null = null;
      let temporarySessionID: string | null = null;

      const listed = await client.session.list(
        {
          directory: input.directory ?? undefined,
          limit: 1,
          archived: false,
        },
        { signal },
      );
      template = listed.data[0] ?? null;

      if (!template) {
        template = await client.session.create(
          {
            title: input.title,
            location: input.directory
              ? { directory: input.directory }
              : undefined,
          },
          { signal },
        );
        temporarySessionID = template.id;
      }

      try {
        await client.session.import(
          {
            info: {
              id: sessionID,
              projectID: template.projectID,
              cost: 0,
              tokens: EMPTY_TOKENS,
              time: { created: Date.now(), updated: Date.now() },
              title: input.title || "Linked chat",
              metadata: {
                ...(template.metadata ?? {}),
                mobileAgentConversationId: input.conversationId,
              },
              location: template.location,
              ...(input.agent ? { agent: input.agent } : {}),
              ...(input.model ? { model: input.model } : {}),
            },
            messages: localMessagesToOpenCode(input),
          },
          { signal },
        );
      } finally {
        if (temporarySessionID) {
          await client.session
            .remove({ sessionID: temporarySessionID }, { signal })
            .catch(() => {});
        }
      }

      return { sessionID };
    },

    async archiveSession(sessionID, signal) {
      await client.session.update({ sessionID, archived: true }, { signal });
    },
  };
}
