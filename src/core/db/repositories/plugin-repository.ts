import * as Crypto from "expo-crypto";
import { and, desc, eq } from "drizzle-orm";

import { pluginStorage, plugins } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type { AppDatabase, PluginRepository } from "@/core/db/repositories/types";

export function createPluginRepository(db: AppDatabase): PluginRepository {
  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(plugins).values({
        id,
        name: input.name,
        version: input.version,
        description: input.description ?? null,
        author: input.author ?? null,
        source: input.source,
        enabled: input.enabled ?? true,
        options: input.options ?? null,
        lastError: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create plugin");
      }

      return row;
    },
    async delete(id) {
      await db.delete(pluginStorage).where(eq(pluginStorage.pluginId, id));
      await db.delete(plugins).where(eq(plugins.id, id));
    },
    async getById(id) {
      return (
        await db.select().from(plugins).where(eq(plugins.id, id)).limit(1)
      )[0] ?? null;
    },
    async list() {
      return db.select().from(plugins).orderBy(desc(plugins.updatedAt));
    },
    async listEnabled() {
      return db
        .select()
        .from(plugins)
        .where(eq(plugins.enabled, true))
        .orderBy(desc(plugins.updatedAt));
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      await db
        .update(plugins)
        .set({
          author: input.author !== undefined ? input.author : current.author,
          description:
            input.description !== undefined
              ? input.description
              : current.description,
          enabled: input.enabled ?? current.enabled,
          lastError:
            input.lastError !== undefined ? input.lastError : current.lastError,
          name: input.name ?? current.name,
          options:
            input.options !== undefined ? input.options : current.options,
          source: input.source ?? current.source,
          updatedAt: nowIso(),
          version: input.version ?? current.version,
        })
        .where(eq(plugins.id, id));
    },
    storage: {
      async delete(pluginId, key) {
        await db
          .delete(pluginStorage)
          .where(
            and(
              eq(pluginStorage.pluginId, pluginId),
              eq(pluginStorage.key, key),
            ),
          );
      },
      async get(pluginId, key) {
        const row = (
          await db
            .select({ value: pluginStorage.value })
            .from(pluginStorage)
            .where(
              and(
                eq(pluginStorage.pluginId, pluginId),
                eq(pluginStorage.key, key),
              ),
            )
            .limit(1)
        )[0];
        return row?.value ?? null;
      },
      async set(pluginId, key, value) {
        await db
          .insert(pluginStorage)
          .values({ key, pluginId, updatedAt: nowIso(), value })
          .onConflictDoUpdate({
            set: { updatedAt: nowIso(), value },
            target: [pluginStorage.pluginId, pluginStorage.key],
          });
      },
    },
  };
}
