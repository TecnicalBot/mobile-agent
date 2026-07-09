import { createCreateDirectoryTool } from "@/lib/tools/built-in/external-folder/create-directory";
import { createExternalCreateFileTool } from "@/lib/tools/built-in/external-folder/create-file";
import { createDeleteEntryTool } from "@/lib/tools/built-in/external-folder/delete-entry";
import { createListDirectoryTool } from "@/lib/tools/built-in/external-folder/list-directory";
import { createMoveEntryTool } from "@/lib/tools/built-in/external-folder/move-entry";
import { buildExternalFolderSystemPrompt } from "@/lib/tools/built-in/external-folder/prompts";
import { createExternalReadFileTool } from "@/lib/tools/built-in/external-folder/read-file";
import { createRenameEntryTool } from "@/lib/tools/built-in/external-folder/rename-entry";
import type { ExternalFolderToolFactoryParams } from "@/lib/tools/built-in/external-folder/types";
import { createExternalWriteFileTool } from "@/lib/tools/built-in/external-folder/write-file";

export function createExternalFolderTools(params: ExternalFolderToolFactoryParams) {
  return {
    tools: {
      createDirectory: createCreateDirectoryTool(params),
      createFile: createExternalCreateFileTool(params),
      deleteEntry: createDeleteEntryTool(params),
      listDirectory: createListDirectoryTool(params),
      moveEntry: createMoveEntryTool(params),
      readFile: createExternalReadFileTool(params),
      renameEntry: createRenameEntryTool(params),
      writeFile: createExternalWriteFileTool(params),
    },
  };
}

export { buildExternalFolderSystemPrompt };
