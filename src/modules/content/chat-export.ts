import type { Conversation, MessageRole, MessageStatus, StoredMessage } from "@/core/types/app-state";

export const CHAT_EXPORT_FORMAT = "mobile-agent-chat";
export const CHAT_EXPORT_VERSION = 1 as const;

export type ChatExportFile = {
    format: typeof CHAT_EXPORT_FORMAT;
    version: typeof CHAT_EXPORT_VERSION;
    exportedAt: string;
    conversation: Conversation;
    messages: StoredMessage[];
};

const MESSAGE_ROLES: MessageRole[] = ["system", "user", "assistant"];
const MESSAGE_STATUSES: MessageStatus[] = ["streaming", "completed", "failed"];

/**
 * Serializes a conversation plus its ordered messages into the portable
 * chat-export JSON format.
 */
export function serializeConversationExport(
    conversation: Conversation,
    messages: StoredMessage[],
): string {
    const payload: ChatExportFile = {
        format: CHAT_EXPORT_FORMAT,
        version: CHAT_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        conversation,
        messages,
    };

    return JSON.stringify(payload, null, 2);
}

/**
 * Parses and validates a chat-export JSON document. Throws a descriptive
 * error when the document is not a supported chat export.
 */
export function parseConversationExport(json: string): ChatExportFile {
    let parsed: unknown;

    try {
        parsed = JSON.parse(json);
    } catch {
        throw new Error("This file is not valid JSON.");
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("This file is not a valid chat export.");
    }

    const record = parsed as Record<string, unknown>;

    if (record.format !== CHAT_EXPORT_FORMAT) {
        throw new Error(
            "This file is not a Mobile Agent chat export (`mobile-agent-chat`).",
        );
    }

    if (record.version !== CHAT_EXPORT_VERSION) {
        throw new Error(
            `Unsupported chat export version: ${String(record.version)}.`,
        );
    }

    const rawConversation = record.conversation;

    if (
        typeof rawConversation !== "object" ||
        rawConversation === null ||
        Array.isArray(rawConversation)
    ) {
        throw new Error("This chat export is missing a conversation.");
    }

    const conversationRecord = rawConversation as Record<string, unknown>;

    if (typeof conversationRecord.title !== "string") {
        throw new Error("This chat export is missing a conversation title.");
    }

    if (!Array.isArray(record.messages)) {
        throw new Error("This chat export is missing its messages.");
    }

    const messages = record.messages.map((rawMessage, index) => {
        if (
            typeof rawMessage !== "object" ||
            rawMessage === null ||
            Array.isArray(rawMessage)
        ) {
            throw new Error(`Message ${index + 1} in this chat export is invalid.`);
        }

        const message = rawMessage as Record<string, unknown>;

        if (typeof message.role !== "string" || !MESSAGE_ROLES.includes(message.role as MessageRole)) {
            throw new Error(`Message ${index + 1} in this chat export has an invalid role.`);
        }

        if (typeof message.content !== "string") {
            throw new Error(`Message ${index + 1} in this chat export has no content.`);
        }

        if (
            typeof message.status !== "string" ||
            !MESSAGE_STATUSES.includes(message.status as MessageStatus)
        ) {
            throw new Error(`Message ${index + 1} in this chat export has an invalid status.`);
        }

        const storedMessage: StoredMessage = {
            id: typeof message.id === "string" ? message.id : `message-${index + 1}`,
            conversationId: typeof message.conversationId === "string" ? message.conversationId : "conversation",
            role: message.role as MessageRole,
            content: message.content,
            metadata:
                message.metadata === null || message.metadata === undefined
                    ? null
                    : (message.metadata as StoredMessage["metadata"]),
            status: message.status as MessageStatus,
            error: typeof message.error === "string" ? message.error : null,
            sequence: typeof message.sequence === "number" ? message.sequence : index + 1,
            createdAt: typeof message.createdAt === "string" ? message.createdAt : "",
            updatedAt: typeof message.updatedAt === "string" ? message.updatedAt : "",
        };

        return storedMessage;
    });

    return {
        format: CHAT_EXPORT_FORMAT,
        version: CHAT_EXPORT_VERSION,
        exportedAt: typeof record.exportedAt === "string" ? record.exportedAt : new Date().toISOString(),
        conversation: conversationRecord as unknown as Conversation,
        messages,
    };
}