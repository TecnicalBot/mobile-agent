import type { Conversation, MessageMetadata, StoredMessage, WorkspaceFile } from "@/core/types/app-state";
import { workspaceFileFromUrl } from "./workspace-link";

export type LibraryFile = WorkspaceFile & {
  uri: string;
  conversationIds: string[];
  /** Generated images predate workspace storage; keep their original location. */
  generated?: boolean;
};
export type LibraryConversation = Pick<Conversation, "id" | "title" | "updatedAt">;
export type LibraryCatalog = { files: LibraryFile[]; conversations: LibraryConversation[] };
export type LibraryMessage = Pick<StoredMessage, "conversationId" | "content" | "metadata" | "createdAt">;
export type LibraryCategory = "all" | "images" | "videos" | "audio" | "docs";
export const UNASSIGNED_LIBRARY_ID = "__unassigned__";

/** Incremental so loading a large library never retains every chat transcript. */
export function createLibraryCatalog(
  files: (WorkspaceFile & { uri: string })[],
  conversations: LibraryConversation[],
  links: { fileId: string; conversationId: string }[] = [],
) {
  const entries = new Map<string, LibraryFile>(
    files.map((file) => [file.id, { ...file, conversationIds: [] }]),
  );
  const byUri = new Map([...entries.values()].map((file) => [file.uri, file]));
  const conversationIds = new Set(conversations.map((chat) => chat.id));
  const attach = (file: LibraryFile | undefined, chatId: string) => {
    if (file && conversationIds.has(chatId) && !file.conversationIds.includes(chatId)) {
      file.conversationIds.push(chatId);
    }
  };
  for (const link of links) attach(entries.get(link.fileId), link.conversationId);

  const references = (value: unknown, result = new Set<string>(), depth = 0): Set<string> => {
    if (depth > 12) return result;
    if (typeof value === "string") {
      if (entries.has(value)) result.add(value);
      const local = byUri.get(value);
      if (local) result.add(local.id);
      for (const match of value.matchAll(/workspace:\/\/([^\s<>)\]?#"']+)/g)) {
        let id = match[1];
        try { id = decodeURIComponent(id); } catch { /* Keep malformed references harmless. */ }
        if (entries.has(id)) result.add(id);
      }
      if (/^[{[]/.test(value.trim())) {
        try { references(JSON.parse(value), result, depth + 1); } catch { /* A truncated trace is not JSON. */ }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) references(item, result, depth + 1);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) references(item, result, depth + 1);
    }
    return result;
  };

  return {
    addMessage(message: LibraryMessage) {
      if (!conversationIds.has(message.conversationId)) return;
      const metadata = message.metadata;
      const ids = references([
        metadata?.selectedFileIds,
        metadata?.generatedVideos,
        metadata?.pluginOutputs?.map((output) => output.attachments),
        metadata?.toolExecutions?.map((tool) => [tool.outputData, tool.outputSummary, tool.preview, tool.mediaResult]),
      ]);
      // Only explicit local links count; ordinary prose mentioning a name does not.
      for (const match of message.content.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*)?\)/g)) {
        const file = workspaceFileFromUrl(match[1], files);
        if (file) ids.add(file.id);
      }
      for (const match of message.content.matchAll(/workspace:\/\/([^\s<>)\]?#"']+)/g)) {
        references(match[0], ids);
      }
      for (const id of ids) attach(entries.get(id), message.conversationId);

      // Backfill preview classification from old tool records, not arbitrary filenames.
      for (const tool of metadata?.toolExecutions ?? []) {
        const toolName = tool.toolName.replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (toolName.endsWith("previewscene") || toolName.endsWith("getvideoframe")) {
          for (const id of references([tool.outputData, tool.preview?.images])) {
            const file = entries.get(id);
            if (file) file.isIntermediate = true;
          }
        } else if (toolName.endsWith("rendervideo")) {
          // The saved HTML source is an implementation detail; keep it
          // available but out of the library's default view.
          for (const id of references(tool.outputData)) {
            const file = entries.get(id);
            if (file && /\.source\.html$/i.test(file.displayName)) {
              file.isIntermediate = true;
            }
          }
        }
      }
      for (const image of metadata?.generatedImages ?? []) {
        let file = byUri.get(image.uri);
        if (!file) {
          const extension = image.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
          file = {
            id: `generated:${image.id}`,
            displayName: `Generated image ${image.id.slice(0, 8)}.${extension}`,
            originalName: null,
            mimeType: image.mimeType,
            size: null,
            relativePath: "",
            sourceKind: "created",
            sourceMarkdown: null,
            sourceSpec: null,
            createdAt: message.createdAt,
            updatedAt: message.createdAt,
            uri: image.uri,
            generated: true,
            conversationIds: [],
          };
          entries.set(file.id, file);
          byUri.set(file.uri, file);
        }
        attach(file, message.conversationId);
      }
    },
    finish(): LibraryCatalog {
      return {
        files: [...entries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
        conversations,
      };
    },
  };
}

export function filterLibraryFiles(
  catalog: LibraryCatalog,
  options: { query: string; category: LibraryCategory; conversationId?: string; showIntermediate: boolean },
) {
  const query = options.query.trim().toLocaleLowerCase();
  const titles = new Map(catalog.conversations.map((chat) => [chat.id, chat.title]));
  return catalog.files.filter((file) => {
    if (!options.showIntermediate && file.isIntermediate) return false;
    if (options.conversationId === UNASSIGNED_LIBRARY_ID) {
      if (file.conversationIds.length > 0) return false;
    } else if (options.conversationId && !file.conversationIds.includes(options.conversationId)) {
      return false;
    }
    const mime = file.mimeType ?? "";
    if (options.category === "images" && !mime.startsWith("image/")) return false;
    if (options.category === "videos" && !mime.startsWith("video/")) return false;
    if (options.category === "audio" && !mime.startsWith("audio/")) return false;
    if (options.category === "docs" && /^(image|video|audio)\//.test(mime)) return false;
    return !query || [file.displayName, file.originalName, ...file.conversationIds.map((id) => titles.get(id))]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
  });
}

export function groupLibraryFiles(catalog: LibraryCatalog, files: LibraryFile[]) {
  const groups = new Map<string, LibraryFile[]>();
  for (const file of files) {
    for (const id of file.conversationIds.length ? file.conversationIds : [UNASSIGNED_LIBRARY_ID]) {
      const group = groups.get(id) ?? [];
      group.push(file);
      groups.set(id, group);
    }
  }
  const titles = new Map(catalog.conversations.map((chat) => [chat.id, chat.title]));
  return [...groups].map(([id, entries]) => ({
    id,
    title: titles.get(id) ?? "Unassigned",
    files: entries,
    size: entries.reduce((total, file) => total + (file.size ?? 0), 0),
    updatedAt: entries[0]?.updatedAt ?? "",
  })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

export function parseLibraryMetadata(raw: string | null): MessageMetadata | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as MessageMetadata : null;
  } catch {
    return null;
  }
}
