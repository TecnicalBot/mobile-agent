import * as Crypto from "expo-crypto";
import { eq } from "drizzle-orm";

import { agents } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type {
  AgentRepository,
  AppDatabase,
} from "@/core/db/repositories/types";
import type { AgentConfig, AgentDoc } from "@/core/types/app-state";
import {
  parseAgentMarkdown,
  serializeAgentToMarkdown,
} from "@/modules/agents/agent-markdown";
import {
  AGENT_DOCS_DIR,
  AGENT_MARKDOWN_FILE,
  deleteEntityDir,
  deleteEntitySubdir,
  readAgentDocsManifest,
  readEntityFile,
  sanitizeFileName,
  writeAgentDocsManifest,
  writeEntityFile,
} from "@/modules/content/files";
import type { AgentDocsManifest } from "@/modules/content/files";

export function createAgentRepository(db: AppDatabase): AgentRepository {
  function writeMarkdown(id: string, markdown: string): string {
    return writeEntityFile("agents", id, [AGENT_MARKDOWN_FILE], markdown);
  }

  function writeDocs(
    id: string,
    docs: NonNullable<
      Parameters<AgentRepository["create"]>[0]["docs"]
    >,
    timestamp: string,
  ) {
    deleteEntitySubdir("agents", id, AGENT_DOCS_DIR);

    const manifestDocs: AgentDocsManifest["docs"] = [];

    for (const doc of docs) {
      const file = sanitizeFileName(doc.name);

      writeEntityFile("agents", id, [AGENT_DOCS_DIR, file], doc.content);
      manifestDocs.push({
        file,
        name: doc.name,
        mimeType: doc.mimeType ?? null,
        size: doc.size ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    writeAgentDocsManifest(id, manifestDocs);
  }

  async function readDocs(agentId: string): Promise<AgentDoc[]> {
    const manifest = await readAgentDocsManifest(agentId);

    if (!manifest) {
      return [];
    }

    const result: AgentDoc[] = [];

    for (const meta of manifest.docs) {
      const content = await readEntityFile("agents", agentId, [
        AGENT_DOCS_DIR,
        meta.file,
      ]);

      if (content === null) {
        continue;
      }

      result.push({
        id: meta.name,
        name: meta.name,
        content,
        mimeType: meta.mimeType,
        size: meta.size,
        createdAt: meta.createdAt ?? "",
        updatedAt: meta.updatedAt ?? "",
      });
    }

    return result;
  }

  async function readConfig(row: typeof agents.$inferSelect): Promise<AgentConfig | null> {
    const markdown = await readEntityFile("agents", row.id, [AGENT_MARKDOWN_FILE]);

    if (markdown === null) {
      return null;
    }

    let parsed: ReturnType<typeof parseAgentMarkdown>;

    try {
      parsed = parseAgentMarkdown(markdown);
    } catch {
      return null;
    }

    return {
      id: row.id,
      name: parsed.name,
      description: parsed.description,
      prompt: parsed.prompt,
      mode: parsed.mode,
      modelProviderId: parsed.modelProviderId,
      modelModelId: parsed.modelModelId,
      temperature: parsed.temperature,
      enabled: row.enabled,
      hidden: row.hidden,
      sourceMarkdown: markdown,
      toolPermissions: parsed.toolPermissions,
      docs: await readDocs(row.id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function buildMarkdown(
    agent: Parameters<typeof serializeAgentToMarkdown>[0],
  ): string {
    return serializeAgentToMarkdown(agent, { allowEmptyPrompt: true });
  }

  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      const markdown =
        input.sourceMarkdown !== undefined && input.sourceMarkdown !== null
          ? input.sourceMarkdown
          : buildMarkdown({
              description: input.description ?? null,
              mode: input.mode ?? "all",
              modelModelId: input.modelModelId ?? null,
              modelProviderId: input.modelProviderId ?? null,
              name: input.name,
              prompt: input.prompt ?? null,
              temperature: input.temperature ?? null,
              toolPermissions: input.toolPermissions ?? {},
            });

      const filePath = writeMarkdown(id, markdown);

      if (input.docs && input.docs.length > 0) {
        writeDocs(id, input.docs, timestamp);
      }

      await db.insert(agents).values({
        id,
        filePath,
        enabled: input.enabled ?? true,
        hidden: input.hidden ?? false,
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
      deleteEntityDir("agents", id);
      await db.delete(agents).where(eq(agents.id, id));
    },
    async getById(id) {
      const row = (
        await db.select().from(agents).where(eq(agents.id, id)).limit(1)
      )[0] ?? null;

      if (!row) {
        return null;
      }

      return readConfig(row);
    },
    async getByName(name) {
      const rows = await db.select().from(agents);

      for (const row of rows) {
        const config = await readConfig(row);

        if (config?.name === name) {
          return config;
        }
      }

      return null;
    },
    async list() {
      const rows = await db.select().from(agents);
      const result: AgentConfig[] = [];

      for (const row of rows) {
        const config = await readConfig(row);

        if (config) {
          result.push(config);
        }
      }

      return result.sort((a, b) => a.name.localeCompare(b.name));
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      const markdown =
        input.sourceMarkdown !== undefined && input.sourceMarkdown !== null
          ? input.sourceMarkdown
          : buildMarkdown({
              description:
                input.description !== undefined
                  ? input.description
                  : current.description,
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
              temperature:
                input.temperature !== undefined
                  ? input.temperature
                  : current.temperature,
              toolPermissions: input.toolPermissions ?? current.toolPermissions,
            });

      writeMarkdown(id, markdown);

      if (input.docs !== undefined) {
        writeDocs(id, input.docs, nowIso());
      }

      await db
        .update(agents)
        .set({
          enabled: input.enabled ?? current.enabled,
          hidden: input.hidden ?? current.hidden,
          updatedAt: nowIso(),
        })
        .where(eq(agents.id, id));
    },
  };
}