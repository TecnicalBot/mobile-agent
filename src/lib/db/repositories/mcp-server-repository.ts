import * as Crypto from "expo-crypto";
import { desc, eq } from "drizzle-orm";

import { mcpServers } from "@/lib/db/schema";
import { nowIso } from "@/lib/db/repositories/shared";
import type { AppDatabase, McpServerRepository } from "@/lib/db/repositories/types";

export function createMcpServerRepository(
  db: AppDatabase,
): McpServerRepository {
  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(mcpServers).values({
        id,
        label: input.label,
        url: input.url,
        transport: input.transport,
        authMode: input.authMode,
        enabled: input.enabled ?? true,
        headerNames: input.headerNames ?? [],
        oauthClientId: input.oauthClientId ?? null,
        oauthAuthorizationUrl: input.oauthAuthorizationUrl ?? null,
        oauthTokenUrl: input.oauthTokenUrl ?? null,
        oauthScopes: input.oauthScopes ?? null,
        oauthAllowedAuthOrigin: input.oauthAllowedAuthOrigin ?? null,
        lastStatus: "untested",
        lastError: null,
        toolCount: null,
        serverInfo: null,
        serverInstructions: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create MCP server");
      }

      return row;
    },
    async delete(id) {
      await db.delete(mcpServers).where(eq(mcpServers.id, id));
    },
    async getById(id) {
      return (
        await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
      )[0] ?? null;
    },
    async list() {
      return db.select().from(mcpServers).orderBy(desc(mcpServers.updatedAt));
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      await db
        .update(mcpServers)
        .set({
          authMode: input.authMode ?? current.authMode,
          enabled: input.enabled ?? current.enabled,
          headerNames: input.headerNames ?? current.headerNames,
          label: input.label ?? current.label,
          oauthAllowedAuthOrigin:
            input.oauthAllowedAuthOrigin !== undefined
              ? input.oauthAllowedAuthOrigin
              : current.oauthAllowedAuthOrigin,
          oauthAuthorizationUrl:
            input.oauthAuthorizationUrl !== undefined
              ? input.oauthAuthorizationUrl
              : current.oauthAuthorizationUrl,
          oauthClientId:
            input.oauthClientId !== undefined
              ? input.oauthClientId
              : current.oauthClientId,
          oauthScopes:
            input.oauthScopes !== undefined
              ? input.oauthScopes
              : current.oauthScopes,
          oauthTokenUrl:
            input.oauthTokenUrl !== undefined
              ? input.oauthTokenUrl
              : current.oauthTokenUrl,
          transport: input.transport ?? current.transport,
          url: input.url ?? current.url,
          updatedAt: nowIso(),
        })
        .where(eq(mcpServers.id, id));
    },
    async updateConnectionState(id, input) {
      await db
        .update(mcpServers)
        .set({
          lastError: input.lastError ?? null,
          lastStatus: input.lastStatus,
          serverInfo: input.serverInfo ?? null,
          serverInstructions: input.serverInstructions ?? null,
          toolCount: input.toolCount ?? null,
          updatedAt: nowIso(),
        })
        .where(eq(mcpServers.id, id));
    },
  };
}
