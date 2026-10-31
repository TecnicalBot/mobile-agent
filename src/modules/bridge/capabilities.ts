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
    // The folder grant is already the user's consent to read and edit this
    // tree. Expose the same file operations the direct agent has instead of a
    // read-only subset that forces the harness to fall back to host paths.
    const folderTools: [keyof typeof folder, string, boolean][] = [
      ["listDirectory", "phoneFolderList", true],
      ["read", "phoneFolderRead", true],
      ["glob", "phoneFolderGlob", true],
      ["grep", "phoneFolderGrep", true],
      ["viewFile", "phoneFolderViewFile", true],
      ["write", "phoneFolderWrite", false],
      ["edit", "phoneFolderEdit", false],
      ["createFile", "phoneFolderCreateFile", false],
      ["createDirectory", "phoneFolderCreateDirectory", false],
      ["deleteEntry", "phoneFolderDelete", false],
      ["moveEntry", "phoneFolderMove", false],
      ["renameEntry", "phoneFolderRename", false],
    ];
    for (const [key, name, readOnly] of folderTools)
      tools.push(adaptAiBridgeTool(name, folder[key], readOnly));
  }
  if (grant.workspace) {
    const { createWorkspaceTools } =
      await import("@/modules/tools/workspace-tools");
    const workspace = createWorkspaceTools({
      repository: repositories.workspaceRepository,
      onRecord,
      supportsImageInput: false,
    }).tools;
    // Keep the network-facing tools out of the bridge. The workspace grant is
    // about files and media the user already has on the phone.
    const workspaceTools: [keyof typeof workspace, boolean][] = [
      ["createFile", false],
      ["read", true],
      ["write", false],
      ["edit", false],
      ["listFiles", true],
      ["glob", true],
      ["grep", true],
      ["viewFile", true],
      ["downloadFile", false],
      ["updateDocument", false],
      ["mergeDocuments", false],
      ["splitDocument", false],
      ["mergePdfs", false],
      ["splitPdf", false],
      ["ocr", false],
      ["getVideoFrame", false],
      ["renderVideo", false],
      ["previewScene", false],
      ["previewMix", false],
    ];
    for (const [name, readOnly] of workspaceTools)
      tools.push(adaptAiBridgeTool(name, workspace[name], readOnly));
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
    const enabledSkills = await repository.list();
    const skillSummary = enabledSkills
      .slice(0, 40)
      .map((skill) => skill.title)
      .join(", ");
    tools.push(
      adaptAiBridgeTool(
        "listSkills",
        tool({
          description:
            "List the enabled Mobile Agent phone skills, separate from host-native skills. Load a matching skill with this server's skill tool before generating documents or videos." +
            (skillSummary
              ? ` Available at connection time: ${skillSummary}.`
              : ""),
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
