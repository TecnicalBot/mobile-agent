import type { Repositories } from "@/core/db/repositories/types";

const LINKS_KEY = "harness_conversation_links_json";

export type HarnessConversationLink = {
  conversationId: string;
  providerId: string;
  sessionID: string;
};

export type HarnessConversationLinks = Record<string, HarnessConversationLink>;

function parseLinks(raw: string | null): HarnessConversationLinks {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const links: HarnessConversationLinks = {};
    for (const [conversationId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      if (
        typeof record.providerId !== "string" ||
        typeof record.sessionID !== "string"
      )
        continue;
      links[conversationId] = {
        conversationId,
        providerId: record.providerId,
        sessionID: record.sessionID,
      };
    }
    return links;
  } catch {
    return {};
  }
}

export async function loadHarnessConversationLinks(
  repositories: Repositories,
): Promise<HarnessConversationLinks> {
  const raw = await repositories.configRepository.getSetting(LINKS_KEY);
  return parseLinks(raw);
}

export async function saveHarnessConversationLink(
  repositories: Repositories,
  link: HarnessConversationLink,
): Promise<HarnessConversationLinks> {
  const links = await loadHarnessConversationLinks(repositories);
  const next = { ...links, [link.conversationId]: link };
  await repositories.configRepository.setSetting(
    LINKS_KEY,
    JSON.stringify(next),
  );
  return next;
}

export async function removeHarnessConversationLink(
  repositories: Repositories,
  conversationId: string,
): Promise<HarnessConversationLinks> {
  const links = await loadHarnessConversationLinks(repositories);
  if (!(conversationId in links)) return links;
  const next = { ...links };
  delete next[conversationId];
  await repositories.configRepository.setSetting(
    LINKS_KEY,
    JSON.stringify(next),
  );
  return next;
}

export function findLinkBySession(
  links: HarnessConversationLinks,
  sessionID: string,
  providerId?: string,
): HarnessConversationLink | null {
  for (const link of Object.values(links)) {
    if (link.sessionID !== sessionID) continue;
    if (providerId && link.providerId !== providerId) continue;
    return link;
  }
  return null;
}

export function linkedSessionIDs(
  links: HarnessConversationLinks,
  providerId?: string,
): Set<string> {
  return new Set(
    Object.values(links)
      .filter((link) => !providerId || link.providerId === providerId)
      .map((link) => link.sessionID),
  );
}
