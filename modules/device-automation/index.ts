import { requireNativeModule } from "expo";
import { Platform } from "react-native";

export type DeviceUiNode = {
  index: number;
  role: string;
  text: string;
  description: string;
  resourceId: string;
  bounds: [number, number, number, number];
  clickable: boolean;
  scrollable: boolean;
  editable: boolean;
  focused: boolean;
  checkable: boolean;
  checked: boolean | null;
  enabled: boolean;
  selected: boolean;
};

export type DeviceActionResult = {
  success: boolean;
  error?: string;
};

export type UiTreeResult = DeviceActionResult & {
  nodeCount?: number;
  truncated?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  nodes?: DeviceUiNode[];
};

export type InstalledApp = {
  packageName: string;
  label: string;
};

export type InstallApkResult = DeviceActionResult & {
  status?:
    | "installed"
    | "user_action_required"
    | "failed"
    | "timeout"
    | "cannot_open"
    | "unknown_sources_disabled";
  packageName?: string;
  verified?: boolean;
  sessionId?: number;
  rawStatus?: number;
  legacyStatus?: number;
};

export type ScreenshotResult = DeviceActionResult & {
  mimeType?: string;
  imageBase64?: string;
  width?: number;
  height?: number;
};

export type ForegroundAppResult = DeviceActionResult & {
  packageName?: string;
};

type DeviceAutomationNativeModule = {
  getUiTree(): Promise<UiTreeResult>;
  tapAt(x: number, y: number): Promise<DeviceActionResult>;
  tapNode(index: number): Promise<DeviceActionResult>;
  type(text: string): Promise<DeviceActionResult>;
  swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs: number,
  ): Promise<DeviceActionResult>;
  longPress(
    x: number,
    y: number,
    durationMs: number,
  ): Promise<DeviceActionResult>;
  longPressNode(index: number, durationMs: number): Promise<DeviceActionResult>;
  drag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs: number,
  ): Promise<DeviceActionResult>;
  scroll(direction: "up" | "down" | "left" | "right"): Promise<DeviceActionResult>;
  globalAction(
    action:
      | "back"
      | "home"
      | "recents"
      | "notifications"
      | "quick_settings"
      | "power_dialog",
  ): Promise<DeviceActionResult>;
  isAccessibilityEnabled(): Promise<boolean>;
  isAccessibilityPermissionGranted(): Promise<boolean>;
  setProtectedApps(packages: string[]): Promise<DeviceActionResult>;
  getForegroundApp(): Promise<ForegroundAppResult>;
  openAccessibilitySettings(): Promise<boolean>;
  setClipboard(text: string): Promise<DeviceActionResult>;
  getClipboard(): Promise<DeviceActionResult & { text?: string }>;
  openApp(packageName: string): Promise<DeviceActionResult>;
  launchDeepLink(uri: string): Promise<DeviceActionResult>;
  listInstalledApps(): Promise<InstalledApp[]>;
  installApk(input: {
    uri?: string;
    url?: string;
    pick?: boolean;
  }): Promise<InstallApkResult>;
  requestScreenCapturePermission(): Promise<DeviceActionResult & { granted?: boolean }>;
  captureScreenshot(): Promise<ScreenshotResult>;
  stopScreenCapture(): Promise<DeviceActionResult & { wasActive?: boolean }>;
  isScreenCaptureActive(): Promise<boolean>;
};

const NativeModule =
  Platform.OS === "android"
    ? requireNativeModule<DeviceAutomationNativeModule>("DeviceAutomation")
    : null;

function requireModule(): DeviceAutomationNativeModule {
  if (!NativeModule) {
    throw new Error("DeviceAutomation is only available on Android.");
  }
  return NativeModule;
}

export async function getUiTree(): Promise<UiTreeResult> {
  return requireModule().getUiTree();
}

export async function tapAt(x: number, y: number): Promise<DeviceActionResult> {
  return requireModule().tapAt(x, y);
}

export async function tapNode(index: number): Promise<DeviceActionResult> {
  return requireModule().tapNode(index);
}

export async function typeText(text: string): Promise<DeviceActionResult> {
  return requireModule().type(text);
}

export async function swipe(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs: number,
): Promise<DeviceActionResult> {
  return requireModule().swipe(x1, y1, x2, y2, durationMs);
}

export async function longPress(
  x: number,
  y: number,
  durationMs: number,
): Promise<DeviceActionResult> {
  return requireModule().longPress(x, y, durationMs);
}

export async function longPressNode(
  index: number,
  durationMs: number,
): Promise<DeviceActionResult> {
  return requireModule().longPressNode(index, durationMs);
}

export async function drag(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs: number,
): Promise<DeviceActionResult> {
  return requireModule().drag(x1, y1, x2, y2, durationMs);
}

export async function scroll(
  direction: "up" | "down" | "left" | "right",
): Promise<DeviceActionResult> {
  return requireModule().scroll(direction);
}

export async function performGlobalAction(
  action:
    | "back"
    | "home"
    | "recents"
    | "notifications"
    | "quick_settings"
    | "power_dialog",
): Promise<DeviceActionResult> {
  return requireModule().globalAction(action);
}

export async function isAccessibilityEnabled(): Promise<boolean> {
  if (!NativeModule) return false;
  return requireModule().isAccessibilityEnabled();
}

export async function isAccessibilityPermissionGranted(): Promise<boolean> {
  if (!NativeModule) return false;
  return requireModule().isAccessibilityPermissionGranted();
}

export async function setProtectedApps(
  packages: string[],
): Promise<DeviceActionResult> {
  if (!NativeModule) return { success: true };
  return requireModule().setProtectedApps(packages);
}

export async function getForegroundApp(): Promise<ForegroundAppResult> {
  if (!NativeModule) return { success: false, error: "Not available on this platform." };
  return requireModule().getForegroundApp();
}

export async function setClipboard(text: string): Promise<DeviceActionResult> {
  return requireModule().setClipboard(text);
}

export async function getClipboard(): Promise<
  DeviceActionResult & { text?: string }
> {
  return requireModule().getClipboard();
}

export async function openAccessibilitySettings(): Promise<boolean> {
  if (!NativeModule) return false;
  return requireModule().openAccessibilitySettings();
}

export async function openApp(packageName: string): Promise<DeviceActionResult> {
  return requireModule().openApp(packageName);
}

export async function launchDeepLink(uri: string): Promise<DeviceActionResult> {
  return requireModule().launchDeepLink(uri);
}

export async function listInstalledApps(): Promise<InstalledApp[]> {
  return requireModule().listInstalledApps();
}

export async function installApk(input: {
  uri?: string;
  url?: string;
  pick?: boolean;
}): Promise<InstallApkResult> {
  return requireModule().installApk(input);
}

export async function requestScreenCapturePermission(): Promise<
  DeviceActionResult & { granted?: boolean }
> {
  return requireModule().requestScreenCapturePermission();
}

export async function captureScreenshot(): Promise<ScreenshotResult> {
  return requireModule().captureScreenshot();
}

export async function stopScreenCapture(): Promise<
  DeviceActionResult & { wasActive?: boolean }
> {
  return requireModule().stopScreenCapture();
}

export async function isScreenCaptureActive(): Promise<boolean> {
  if (!NativeModule) return false;
  return requireModule().isScreenCaptureActive();
}
