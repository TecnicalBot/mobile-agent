import * as Crypto from "expo-crypto";
import { asc, eq } from "drizzle-orm";

import { agents } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type {
  AgentRepository,
  AppDatabase,
} from "@/core/db/repositories/types";

export function createAgentRepository(db: AppDatabase): AgentRepository {
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

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create agent");
      }

      return row;
    },
    async delete(id) {
      await db.delete(agents).where(eq(agents.id, id));
    },
    async getById(id) {
      return (
        (await db.select().from(agents).where(eq(agents.id, id)).limit(1))[0] ??
        null
      );
    },
    async getByName(name) {
      return (
        (
          await db
            .select()
            .from(agents)
            .where(eq(agents.name, name))
            .limit(1)
        )[0] ?? null
      );
    },
    async list() {
      return db.select().from(agents).orderBy(asc(agents.name));
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
    },
  };
}
