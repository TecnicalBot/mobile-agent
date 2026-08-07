import type { BuiltInToolKey, BuiltInToolSettings } from "@/core/types/app-state";

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
  deviceReadScreen: false,
  deviceTap: false,
  deviceType: false,
  deviceSwipe: false,
  deviceLongPress: false,
  deviceDrag: false,
  deviceScroll: false,
  deviceNavigate: false,
  deviceOpenApp: false,
  deviceDeepLink: false,
  deviceListApps: false,
  deviceClipboard: false,
  deviceScreenshot: false,
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

export const DEVICE_TOOL_CONTROLS: Array<{
  keys: BuiltInToolKey[];
  label: string;
}> = [
  {
    label: "Read screen",
    keys: ["deviceReadScreen"],
  },
  {
    label: "Tap",
    keys: ["deviceTap"],
  },
  {
    label: "Type",
    keys: ["deviceType"],
  },
  {
    label: "Swipe",
    keys: ["deviceSwipe"],
  },
  {
    label: "Long press",
    keys: ["deviceLongPress"],
  },
  {
    label: "Drag",
    keys: ["deviceDrag"],
  },
  {
    label: "Scroll",
    keys: ["deviceScroll"],
  },
  {
    label: "Back / Home",
    keys: ["deviceNavigate"],
  },
  {
    label: "Open app",
    keys: ["deviceOpenApp"],
  },
  {
    label: "Open link",
    keys: ["deviceDeepLink"],
  },
  {
    label: "List apps",
    keys: ["deviceListApps"],
  },
  {
    label: "Clipboard",
    keys: ["deviceClipboard"],
  },
  {
    label: "Take screenshot",
    keys: ["deviceScreenshot"],
  },
];

export const DEVICE_TOOL_KEYS: BuiltInToolKey[] = DEVICE_TOOL_CONTROLS.flatMap(
  (control) => control.keys,
);

export function isDeviceAutomationEnabled(settings: BuiltInToolSettings) {
  return DEVICE_TOOL_KEYS.some((key) => settings[key]);
}

export type DeviceToolPermissions = {
  accessibilityEnabled: boolean;
  screenCaptureActive: boolean;
};

export function countEnabledDeviceTools(
  settings: BuiltInToolSettings,
  permissions: DeviceToolPermissions,
) {
  if (!permissions.accessibilityEnabled || !permissions.screenCaptureActive) {
    return 0;
  }

  return DEVICE_TOOL_CONTROLS.filter((control) =>
    isBuiltInFileToolEnabled(settings, control.keys),
  ).length;
}

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

export function countEnabledBuiltInTools(
  settings: BuiltInToolSettings,
  permissions: DeviceToolPermissions,
) {
  return (
    countEnabledBuiltInFileTools(settings) +
    countEnabledDeviceTools(settings, permissions)
  );
}
