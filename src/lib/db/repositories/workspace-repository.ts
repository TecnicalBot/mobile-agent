import * as Crypto from "expo-crypto";
import { desc, eq } from "drizzle-orm";

import { workspaceFiles } from "@/lib/db/schema";
import { nowIso } from "@/lib/db/repositories/shared";
import type { AppDatabase, WorkspaceRepository } from "@/lib/db/repositories/types";

export function createWorkspaceRepository(db: AppDatabase): WorkspaceRepository {
  return {
    async create(input) {
      const id = input.id ?? Crypto.randomUUID();
      const timestamp = nowIso();

      await db.insert(workspaceFiles).values({
        id,
        displayName: input.displayName,
        mimeType: input.mimeType ?? null,
        originalName: input.originalName ?? null,
        relativePath: input.relativePath,
        size: input.size ?? null,
        sourceKind: input.sourceKind,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const row = (
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, id)).limit(1)
      )[0];

      if (!row) {
        throw new Error("Failed to create workspace file");
      }

      return row;
    },
    async getById(id) {
      return (
        (
          await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, id)).limit(1)
        )[0] ?? null
      );
    },
    async getByIds(ids) {
      if (ids.length === 0) {
        return [];
      }

      const rows = await db.select().from(workspaceFiles);
      const idSet = new Set(ids);

      return rows
        .filter((row) => idSet.has(row.id))
        .sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
    },
    async list() {
      return db.select().from(workspaceFiles).orderBy(desc(workspaceFiles.updatedAt));
    },
    async updateMetadata(id, input) {
      const current = (
        await db
          .select()
          .from(workspaceFiles)
          .where(eq(workspaceFiles.id, id))
          .limit(1)
      )[0];

      if (!current) {
        return;
      }

      await db
        .update(workspaceFiles)
        .set({
          displayName: input.displayName ?? current.displayName,
          mimeType: input.mimeType !== undefined ? input.mimeType : current.mimeType,
          originalName:
            input.originalName !== undefined
              ? input.originalName
              : current.originalName,
          relativePath: input.relativePath ?? current.relativePath,
          size: input.size !== undefined ? input.size : current.size,
          updatedAt: input.updatedAt ?? nowIso(),
        })
        .where(eq(workspaceFiles.id, id));
    },
  };
}
