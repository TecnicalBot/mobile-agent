import type { BuiltInToolKey, BuiltInToolSettings } from "@/types/app-state";

export const DEFAULT_BUILT_IN_TOOL_SETTINGS: BuiltInToolSettings = {
  workspaceListFiles: true,
  workspaceReadFile: true,
  workspaceWriteFile: true,
  workspaceCreateFile: true,
  folderListDirectory: true,
  folderReadFile: true,
  folderWriteFile: true,
  folderCreateFile: true,
  folderCreateDirectory: true,
  folderRenameEntry: true,
  folderMoveEntry: true,
  folderDeleteEntry: true,
};

export const BUILT_IN_FILE_TOOL_CONTROLS: Array<{
  keys: BuiltInToolKey[];
  label: string;
}> = [
  {
    label: "List files",
    keys: ["workspaceListFiles", "folderListDirectory"],
  },
  {
    label: "Read file",
    keys: ["workspaceReadFile", "folderReadFile"],
  },
  {
    label: "Write file",
    keys: ["workspaceWriteFile", "folderWriteFile"],
  },
  {
    label: "Create file",
    keys: ["workspaceCreateFile", "folderCreateFile"],
  },
  {
    label: "Create folder",
    keys: ["folderCreateDirectory"],
  },
  {
    label: "Rename",
    keys: ["folderRenameEntry"],
  },
  {
    label: "Move",
    keys: ["folderMoveEntry"],
  },
  {
    label: "Delete",
    keys: ["folderDeleteEntry"],
  },
];

export function normalizeBuiltInToolSettings(
  input?: Partial<BuiltInToolSettings> | null,
): BuiltInToolSettings {
  return {
    ...DEFAULT_BUILT_IN_TOOL_SETTINGS,
    ...(input ?? {}),
  };
}

export function isBuiltInFileToolEnabled(
  settings: BuiltInToolSettings,
  keys: BuiltInToolKey[],
) {
  return keys.some((key) => settings[key]);
}

export function countEnabledBuiltInFileTools(settings: BuiltInToolSettings) {
  return BUILT_IN_FILE_TOOL_CONTROLS.filter((control) =>
    isBuiltInFileToolEnabled(settings, control.keys),
  ).length;
}
