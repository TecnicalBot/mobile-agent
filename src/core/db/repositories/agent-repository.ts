import * as Crypto from "expo-crypto";
import { asc, eq } from "drizzle-orm";

import { agentDocs, agents } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type { AgentConfig, AgentDoc } from "@/core/types/app-state";
import type {
  AgentRepository,
  AppDatabase,
} from "@/core/db/repositories/types";

export function createAgentRepository(db: AppDatabase): AgentRepository {
  async function getDocs(agentId: string): Promise<AgentDoc[]> {
    const rows = await db
      .select()
      .from(agentDocs)
      .where(eq(agentDocs.agentId, agentId));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      content: row.content,
      mimeType: row.mimeType,
      size: row.size,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async function replaceDocs(
    agentId: string,
    docs: NonNullable<
      Parameters<AgentRepository["update"]>[1]["docs"]
    >,
  ) {
    const timestamp = nowIso();

    await db.delete(agentDocs).where(eq(agentDocs.agentId, agentId));

    for (const doc of docs) {
      await db.insert(agentDocs).values({
        id: Crypto.randomUUID(),
        agentId,
        name: doc.name,
        content: doc.content,
        mimeType: doc.mimeType ?? null,
        size: doc.size ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  async function insertDocs(
    agentId: string,
    docs: NonNullable<
      Parameters<AgentRepository["create"]>[0]["docs"]
    >,
  ) {
    const timestamp = nowIso();

    for (const doc of docs) {
      await db.insert(agentDocs).values({
        id: Crypto.randomUUID(),
        agentId,
        name: doc.name,
        content: doc.content,
        mimeType: doc.mimeType ?? null,
        size: doc.size ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  function factory(
    row: (typeof agents.$inferSelect) & { docs?: AgentDoc[] },
  ): AgentConfig {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      prompt: row.prompt,
      mode: row.mode,
      modelProviderId: row.modelProviderId,
      modelModelId: row.modelModelId,
      temperature: row.temperature,
      enabled: row.enabled,
      hidden: row.hidden,
      sourceMarkdown: row.sourceMarkdown,
      toolPermissions: row.toolPermissions,
      docs: row.docs ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(agents).values({
        id,
        name: input.name,
        description: input.description ?? null,
        prompt: input.prompt ?? null,
        mode: input.mode ?? "all",
        modelProviderId: input.modelProviderId ?? null,
        modelModelId: input.modelModelId ?? null,
        temperature: input.temperature ?? null,
        enabled: input.enabled ?? true,
        hidden: input.hidden ?? false,
        sourceMarkdown: input.sourceMarkdown ?? null,
        toolPermissions: input.toolPermissions ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      if (input.docs && input.docs.length > 0) {
        await insertDocs(id, input.docs);
      }

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create agent");
      }

      return row;
    },
    async delete(id) {
      await db.delete(agentDocs).where(eq(agentDocs.agentId, id));
      await db.delete(agents).where(eq(agents.id, id));
    },
    async getById(id) {
      const row = (
        await db.select().from(agents).where(eq(agents.id, id)).limit(1)
      )[0] ?? null;

      if (!row) {
        return null;
      }

      return factory({ ...row, docs: await getDocs(id) });
    },
    async getByName(name) {
      const row = (
        await db
          .select()
          .from(agents)
          .where(eq(agents.name, name))
          .limit(1)
      )[0] ?? null;

      if (!row) {
        return null;
      }

      return factory({ ...row, docs: await getDocs(row.id) });
    },
    async list() {
      const rows = await db.select().from(agents).orderBy(asc(agents.name));
      const docRows = await db.select().from(agentDocs);
      const docsByAgent = new Map<string, AgentDoc[]>();

      for (const row of docRows) {
        const list = docsByAgent.get(row.agentId) ?? [];
        list.push({
          id: row.id,
          name: row.name,
          content: row.content,
          mimeType: row.mimeType,
          size: row.size,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
        docsByAgent.set(row.agentId, list);
      }

      return rows.map((row) =>
        factory({ ...row, docs: docsByAgent.get(row.id) ?? [] }),
      );
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      await db
        .update(agents)
        .set({
          description:
            input.description !== undefined
              ? input.description
              : current.description,
          enabled: input.enabled ?? current.enabled,
          hidden: input.hidden ?? current.hidden,
          mode: input.mode ?? current.mode,
          modelModelId:
            input.modelModelId !== undefined
              ? input.modelModelId
              : current.modelModelId,
          modelProviderId:
            input.modelProviderId !== undefined
              ? input.modelProviderId
              : current.modelProviderId,
          name: input.name ?? current.name,
          prompt:
            input.prompt !== undefined ? input.prompt : current.prompt,
          sourceMarkdown:
            input.sourceMarkdown !== undefined
              ? input.sourceMarkdown
              : current.sourceMarkdown,
          temperature:
            input.temperature !== undefined
              ? input.temperature
              : current.temperature,
          toolPermissions:
            input.toolPermissions ?? current.toolPermissions,
          updatedAt: nowIso(),
        })
        .where(eq(agents.id, id));

      if (input.docs !== undefined) {
        await replaceDocs(id, input.docs);
      }
    },
  };
}
