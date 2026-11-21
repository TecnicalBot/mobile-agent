import * as Crypto from "expo-crypto";
import { and, asc, desc, eq, inArray, ne, notLike } from "drizzle-orm";

import { documentSections, workspaceFileConversations, workspaceFiles } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type { AppDatabase, WorkspaceRepository } from "@/core/db/repositories/types";
import type { WorkspaceFile } from "@/core/types/app-state";

export function createWorkspaceRepository(db: AppDatabase, conversationId?: string): WorkspaceRepository {
  const linked = new Set<string>();
  const link = async (files: WorkspaceFile[]) => {
    if (!conversationId) return;
    const pending = files.filter((file) => !linked.has(file.id));
    if (pending.length === 0) return;
    await db.insert(workspaceFileConversations)
      .values(pending.map((file) => ({ fileId: file.id, conversationId })))
      .onConflictDoNothing();
    for (const file of pending) linked.add(file.id);
  };
  return {
    forConversation(id) {
      return createWorkspaceRepository(db, id);
    },
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
        sourceMarkdown: input.sourceMarkdown ?? null,
        sourceSpec: input.sourceSpec ?? null,
        isIntermediate: input.isIntermediate ?? false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const row = (
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, id)).limit(1)
      )[0];

      if (!row) {
        throw new Error("Failed to create workspace file");
      }

      await link([row]);
      return row;
    },
    async getById(id) {
      const row = (
        (
          await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, id)).limit(1)
        )[0] ?? null
      );
      if (row) await link([row]);
      return row;
    },
    async getByIds(ids) {
      if (ids.length === 0) {
        return [];
      }

      const rows = await db.select().from(workspaceFiles).where(inArray(workspaceFiles.id, ids));
      const idSet = new Set(ids);

      const files = rows
        .filter((row) => idSet.has(row.id))
        .sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
      await link(files);
      return files;
    },
    async list() {
      return db
        .select()
        .from(workspaceFiles)
        .where(
          and(
            ne(workspaceFiles.sourceKind, "artifact"),
            notLike(workspaceFiles.relativePath, "prompts/%"),
            notLike(workspaceFiles.relativePath, "tools/%"),
          ),
        )
        .orderBy(desc(workspaceFiles.updatedAt));
    },
    async deleteAll() {
      await db.delete(workspaceFileConversations);
      await db.delete(documentSections);
      await db.delete(workspaceFiles);
    },
    async delete(id) {
      await db.delete(workspaceFileConversations).where(eq(workspaceFileConversations.fileId, id));
      await db.delete(documentSections).where(eq(documentSections.fileId, id));
      await db.delete(workspaceFiles).where(eq(workspaceFiles.id, id));
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
          sourceMarkdown:
            input.sourceMarkdown !== undefined
              ? input.sourceMarkdown
              : current.sourceMarkdown,
          sourceSpec:
            input.sourceSpec !== undefined
              ? input.sourceSpec
              : current.sourceSpec,
          updatedAt: input.updatedAt ?? nowIso(),
        })
        .where(eq(workspaceFiles.id, id));
    },
    async replaceDocumentSections(fileId, sections) {
      const timestamp = nowIso();

      await db
        .delete(documentSections)
        .where(eq(documentSections.fileId, fileId));

      if (sections.length === 0) {
        return;
      }

      await db.insert(documentSections).values(
        sections.map((section, position) => ({
          id: Crypto.randomUUID(),
          fileId,
          position,
          title: section.title,
          level: section.level,
          body: section.body,
          charCount: section.body.length,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      );
    },
    async listDocumentSections(fileId) {
      return db
        .select()
        .from(documentSections)
        .where(eq(documentSections.fileId, fileId))
        .orderBy(asc(documentSections.position));
    },
  };
}
