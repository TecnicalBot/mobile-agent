import { describe, expect, it } from "vitest";
import type { Repositories } from "@/core/db/repositories/types";
import {
  findLinkBySession,
  linkedSessionIDs,
  loadHarnessConversationLinks,
  removeHarnessConversationLink,
  saveHarnessConversationLink,
} from "./links";

function repositoriesWithSetting(initial: string | null) {
  let value = initial;
  return {
    repositories: {
      configRepository: {
        getSetting: async () => value,
        setSetting: async (_key: string, next: string) => {
          value = next;
        },
      },
    } as unknown as Repositories,
    read: () => value,
  };
}

describe("harness conversation links", () => {
  it("returns an empty map for missing or malformed settings", async () => {
    for (const raw of [null, "", "not-json", "[]", '"text"']) {
      const { repositories } = repositoriesWithSetting(raw);
      await expect(loadHarnessConversationLinks(repositories)).resolves.toEqual(
        {},
      );
    }
  });

  it("keeps only valid link records", async () => {
    const { repositories } = repositoriesWithSetting(
      JSON.stringify({
        chat_a: {
          conversationId: "ignored",
          providerId: "opencode",
          sessionID: "ses_a",
        },
        chat_b: { providerId: 1, sessionID: "ses_b" },
        chat_c: { providerId: "opencode" },
      }),
    );

    const links = await loadHarnessConversationLinks(repositories);
    expect(links).toEqual({
      chat_a: {
        conversationId: "chat_a",
        providerId: "opencode",
        sessionID: "ses_a",
      },
    });
  });

  it("saves, replaces, removes, and finds links by session", async () => {
    const { repositories, read } = repositoriesWithSetting(null);

    let links = await saveHarnessConversationLink(repositories, {
      conversationId: "chat_a",
      providerId: "opencode",
      sessionID: "ses_a",
    });
    expect(links.chat_a.sessionID).toBe("ses_a");

    links = await saveHarnessConversationLink(repositories, {
      conversationId: "chat_a",
      providerId: "opencode",
      sessionID: "ses_b",
    });
    expect(links.chat_a.sessionID).toBe("ses_b");
    expect(findLinkBySession(links, "ses_b")).toMatchObject({
      conversationId: "chat_a",
    });
    expect(findLinkBySession(links, "ses_a")).toBeNull();

    expect([...linkedSessionIDs(links, "opencode")]).toEqual(["ses_b"]);
    expect([...linkedSessionIDs(links, "other")]).toEqual([]);

    links = await removeHarnessConversationLink(repositories, "chat_a");
    expect(links).toEqual({});
    expect(JSON.parse(read() ?? "{}")).toEqual({});
  });

  it("ignores provider filters that do not match", async () => {
    const { repositories } = repositoriesWithSetting(null);
    const links = await saveHarnessConversationLink(repositories, {
      conversationId: "chat_a",
      providerId: "opencode",
      sessionID: "ses_a",
    });

    expect(findLinkBySession(links, "ses_a", "other")).toBeNull();
  });
});
