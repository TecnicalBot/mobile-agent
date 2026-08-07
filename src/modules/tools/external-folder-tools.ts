import { createCreateDirectoryTool } from "@/modules/tools/built-in/external-folder/create-directory";
import { createExternalCreateFileTool } from "@/modules/tools/built-in/external-folder/create-file";
import { createDeleteEntryTool } from "@/modules/tools/built-in/external-folder/delete-entry";
import { createExternalEditFileTool } from "@/modules/tools/built-in/external-folder/edit-file";
import { createListDirectoryTool } from "@/modules/tools/built-in/external-folder/list-directory";
import { createMoveEntryTool } from "@/modules/tools/built-in/external-folder/move-entry";
import { buildExternalFolderSystemPrompt } from "@/modules/tools/built-in/external-folder/prompts";
import { createExternalReadFileTool } from "@/modules/tools/built-in/external-folder/read-file";
import { createRenameEntryTool } from "@/modules/tools/built-in/external-folder/rename-entry";
import { createExternalSearchTextTool } from "@/modules/tools/built-in/external-folder/search-text";
import type { ExternalFolderToolFactoryParams } from "@/modules/tools/built-in/external-folder/types";
import { createExternalWriteFileTool } from "@/modules/tools/built-in/external-folder/write-file";

export function createExternalFolderTools(params: ExternalFolderToolFactoryParams) {
  return {
    tools: {
      createDirectory: createCreateDirectoryTool(params),
      createFile: createExternalCreateFileTool(params),
      deleteEntry: createDeleteEntryTool(params),
      editFile: createExternalEditFileTool(params),
      listDirectory: createListDirectoryTool(params),
      moveEntry: createMoveEntryTool(params),
      readFile: createExternalReadFileTool(params),
      renameEntry: createRenameEntryTool(params),
      searchText: createExternalSearchTextTool(params),
      writeFile: createExternalWriteFileTool(params),
    },
  };
}

export { buildExternalFolderSystemPrompt };
