import { tool } from "ai";
import { z } from "zod";
import type { Repositories } from "@/core/db/database";
import type {
  ExternalFolderSession,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import { adaptAiBridgeTool } from "./ai-tool-adapter";
import type { BridgeTool } from "./types";

export type PhoneBridgeGrant = {
  folder: ExternalFolderSession | null;
  workspace: boolean;
  skills: boolean;
};

/** Explicit allowlist. Never export every app tool or accept capabilities from a client. */
export async function createPhoneBridgeCapabilities(input: {
  grant: PhoneBridgeGrant;
  repositories: Repositories;
  onRecord: (record: ToolExecutionRecord) => void;
}) {
  const { grant, repositories, onRecord } = input;
  const tools: BridgeTool[] = [];
  if (grant.folder) {
    // SAF document trees cannot contain host filesystem symlinks. Other platforms
    // need a symlink-aware resolver before folders can be shared safely.
    if (
      grant.folder.platform !== "android" ||
      !grant.folder.uri.startsWith("content://")
    )
      throw new Error(
        "Bridge folder access currently requires an Android document-tree grant.",
      );
    const { createExternalFolderTools } =
      await import("@/modules/tools/external-folder-tools");
    const folder = createExternalFolderTools({
      session: grant.folder,
      onRecord,
      supportsImageInput: false,
    }).tools;
    tools.push(
      adaptAiBridgeTool("phoneFolderList", folder.listDirectory, true),
      adaptAiBridgeTool("phoneFolderRead", folder.read, true),
      adaptAiBridgeTool("phoneFolderWrite", folder.write, false),
      adaptAiBridgeTool(
        "phoneFolderCreateDirectory",
        folder.createDirectory,
        false,
      ),
    );
  }
  if (grant.workspace) {
    const [
      { createCreateFileTool },
      { createReadTool },
      { createListFilesTool },
      { createRenderVideoTool },
    ] = await Promise.all([
      import("@/modules/tools/built-in/create-file"),
      import("@/modules/tools/built-in/read"),
      import("@/modules/tools/built-in/list-files"),
      import("@/modules/tools/built-in/render-video"),
    ]);
    const params = {
      repository: repositories.workspaceRepository,
      onRecord,
      supportsImageInput: false,
    };
    tools.push(
      adaptAiBridgeTool("createFile", createCreateFileTool(params), false),
      adaptAiBridgeTool("read", createReadTool(params), true),
      adaptAiBridgeTool("listFiles", createListFilesTool(params), true),
      adaptAiBridgeTool("renderVideo", createRenderVideoTool(params), false),
    );
  }
  if (grant.skills) {
    const { createSkillTools } =
      await import("@/modules/tools/built-in/skill-tools");
    const repository = {
      ...repositories.skillRepository,
      list: async () =>
        (await repositories.skillRepository.list()).filter(
          (skill) => skill.enabled,
        ),
    };
    const skills = createSkillTools({ repository, onRecord }).tools;
    tools.push(
      adaptAiBridgeTool(
        "listSkills",
        tool({
          description:
            "List the enabled Mobile Agent skills. Load a matching skill before generating documents or videos.",
          inputSchema: z.object({}),
          execute: async () =>
            (await repository.list()).map((skill) => ({
              name: skill.title,
              description: skill.description,
            })),
        }),
        true,
      ),
      adaptAiBridgeTool("skill", skills.skill, true),
      adaptAiBridgeTool("skillReadFile", skills.skillReadFile, true),
    );
  }
  return tools;
}
