import type { BuiltInToolKey, BuiltInToolSettings } from "@/core/types/app-state";

export const DEFAULT_BUILT_IN_TOOL_SETTINGS: BuiltInToolSettings = {
  workspaceListFiles: true,
  workspaceRead: true,
  workspaceWrite: true,
  workspaceCreateFile: true,
  workspaceGrep: true,
  workspaceGlob: true,
  workspaceEdit: true,
  downloadFile: true,
  folderListDirectory: true,
  folderRead: true,
  folderWrite: true,
  folderCreateFile: true,
  folderCreateDirectory: true,
  folderRenameEntry: true,
  folderMoveEntry: true,
  folderDeleteEntry: true,
  folderGrep: true,
  folderGlob: true,
  folderEdit: true,
  todos: true,
  question: true,
  skill: true,
  schedules: true,
};

export const ALL_BUILT_IN_TOOL_KEYS = Object.keys(
  DEFAULT_BUILT_IN_TOOL_SETTINGS,
) as BuiltInToolKey[];

const LEGACY_TOOL_KEY_MAP: Partial<Record<string, BuiltInToolKey>> = {  askQuestion: "question",
  folderEditFile: "folderEdit",
  folderReadFile: "folderRead",
  folderSearchText: "folderGrep",
  folderWriteFile: "folderWrite",
  loadSkill: "skill",
  updateTodos: "todos",
  workspaceEditFile: "workspaceEdit",
  workspaceReadFile: "workspaceRead",
  workspaceSearchText: "workspaceGrep",
  workspaceWriteFile: "workspaceWrite",
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
    label: "Glob / find files",
    keys: ["workspaceGlob", "folderGlob"],
  },
  {
    label: "Download file",
    keys: ["downloadFile"],
  },
  {
    label: "Read file",
    keys: ["workspaceRead", "folderRead"],
  },
  {
    label: "Write file",
    keys: ["workspaceWrite", "folderWrite"],
  },
  {
    label: "Edit file",
    keys: ["workspaceEdit", "folderEdit"],
  },
  {
    label: "Create file",
    keys: ["workspaceCreateFile", "folderCreateFile"],
  },
  {
    label: "Search files",
    keys: ["workspaceGrep", "folderGrep"],
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

export const ALWAYS_ENABLED_BUILT_IN_TOOLS: BuiltInToolKey[] = [
  "todos",
  "question",
  "skill",
  "schedules",
];

export function normalizeBuiltInToolSettings(
  input?: Partial<BuiltInToolSettings> | null,
): BuiltInToolSettings {
  const normalized: BuiltInToolSettings = {
    ...DEFAULT_BUILT_IN_TOOL_SETTINGS,
    ...(input ?? {}),
  };

  for (const key of ALWAYS_ENABLED_BUILT_IN_TOOLS) {
    normalized[key] = true;
  }

  return remapLegacyToolKeys(normalized);
}

function remapLegacyToolKeys(
  settings: BuiltInToolSettings,
): BuiltInToolSettings {
  const result: BuiltInToolSettings = { ...settings };

  for (const [legacyKey, currentKey] of Object.entries(LEGACY_TOOL_KEY_MAP)) {
    if (!currentKey) {
      continue;
    }

    if (legacyKey in result && !(currentKey in result)) {
      result[currentKey] = result[legacyKey as keyof BuiltInToolSettings];
    }
  }

  return result;
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
