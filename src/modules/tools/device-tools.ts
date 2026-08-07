import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { ToolExecutionRecord } from "@/core/types/app-state";
import {
  captureScreenshot,
  drag,
  getClipboard,
  getUiTree,
  isAccessibilityPermissionGranted,
  isScreenCaptureActive,
  launchDeepLink,
  listInstalledApps,
  longPress,
  longPressNode,
  openApp,
  performGlobalAction,
  requestScreenCapturePermission,
  scroll,
  setClipboard,
  swipe,
  tapAt,
  tapNode,
  typeText,
  type DeviceUiNode,
} from "device-automation";

export type DeviceToolFactoryParams = {
  onRecord?: (record: ToolExecutionRecord) => void;
};

const NOT_ENABLED_HINT =
  "The accessibility service is not enabled. Tell the user to open Settings -> Accessibility -> Mobile Agent and enable 'Mobile Agent device control' (or tap the Enable button in the app's Settings -> Tools -> Device controls -> Permissions), then try again.";

const GRANTED_NOT_RUNNING_HINT =
  "The accessibility service is enabled in system Settings but is not running — Android usually stops it when the app process is killed. Tell the user to reopen the app (it reconnects automatically) or re-toggle 'Mobile Agent device control' in Settings -> Accessibility, then try again.";

async function accessibilityHint(): Promise<string> {
  const granted = await isAccessibilityPermissionGranted();
  return granted ? GRANTED_NOT_RUNNING_HINT : NOT_ENABLED_HINT;
}

function toResultMessage(result: { success: boolean; error?: string }) {
  return result.success ? "Done." : result.error ?? "Action failed.";
}

function formatNode(node: DeviceUiNode): string {
  const label = node.text || node.description;
  const flags = [
    node.clickable ? "clickable" : "",
    node.editable ? "editable" : "",
    node.scrollable ? "scrollable" : "",
    node.checkable ? (node.checked ? "checked" : "unchecked") : "",
    node.focused ? "focused" : "",
    !node.enabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(",");
  const bounds = `(${node.bounds[0]},${node.bounds[1]},${node.bounds[2]}x${node.bounds[3]})`;
  const suffix = flags ? ` ${flags}` : "";
  return `[${node.index}] ${node.role} "${label}" ${bounds}${suffix}`;
}

function formatUiTree(result: {
  nodeCount?: number;
  truncated?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  nodes?: DeviceUiNode[];
}): string {
  const dims =
    result.screenWidth != null && result.screenHeight != null
      ? `, ${result.screenWidth}x${result.screenHeight}`
      : "";
  const header = `SCREEN (${result.nodeCount ?? 0} nodes${dims}${
    result.truncated ? ", truncated" : ""
  })`;
  const body = (result.nodes ?? [])
    .map(formatNode)
    .join("\n");
  return `${header}\n${body}`;
}

export function createDeviceTools(params: DeviceToolFactoryParams = {}) {
  const { onRecord } = params;

  const record = (
    toolName: string,
    inputSummary: string,
    status: ToolExecutionRecord["status"],
    extra?: { outputSummary?: string; error?: string },
  ) => {
    onRecord?.(
      createRecord({
        toolName,
        status,
        inputSummary,
        outputSummary: extra?.outputSummary,
        error: extra?.error ?? null,
      }),
    );
  };

  const readScreenTool = tool({
    description:
      "Read the current screen on the phone as a list of UI elements (index, role, text, bounds, flags). Use this first to perceive the screen, and re-read after every action to verify the result. Requires the accessibility service to be enabled.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const tree = await getUiTree();
        if (!tree.success) {
          return await accessibilityHint();
        }
        const screen = formatUiTree(tree);
        record("readScreen", "(screen)", "completed", {
          outputSummary: screen.slice(0, 240),
        });
        return screen;
      } catch (error) {
        record("readScreen", "(screen)", "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const tapTool = tool({
    description:
      "Tap an element on the phone screen. Provide either the node index from readScreen (preferred) or x/y coordinates in pixels. Read the screen first to get valid indices.",
    inputSchema: z
      .object({
        index: z
          .number()
          .int()
          .nonnegative()
          .describe("Node index from the latest readScreen output."),
        x: z.number().int().nonnegative().describe("X coordinate in pixels."),
        y: z.number().int().nonnegative().describe("Y coordinate in pixels."),
      })
      .refine((v) => v.index !== undefined || (v.x !== undefined && v.y !== undefined), {
        message: "Provide either index, or both x and y.",
      }),
    execute: async (input) => {
      const inputSummary = summarizeValue(input);
      try {
        let result;
        if (input.index !== undefined) {
          result = await tapNode(input.index);
        } else {
          result = await tapAt(input.x!, input.y!);
        }
        record("tap", inputSummary, result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success
          ? "Tapped."
          : (result.error ?? "Tap failed.");
      } catch (error) {
        record("tap", inputSummary, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const typeTool = tool({
    description:
      "Type text into the focused text field on the phone. The target field must already be focused (tap it first with the tap tool).",
    inputSchema: z.object({
      text: z.string().min(1).describe("The exact text to type."),
    }),
    execute: async ({ text }) => {
      const inputSummary = summarizeValue({ text });
      try {
        const result = await typeText(text);
        record("type", inputSummary, result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success
          ? "Typed."
          : (result.error ?? "Typing failed.");
      } catch (error) {
        record("type", inputSummary, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const swipeTool = tool({
    description:
      "Swipe from one point to another on the phone screen. Use for scrolling, dismissing items, or pulling to refresh.",
    inputSchema: z.object({
      x1: z.number().int(),
      y1: z.number().int(),
      x2: z.number().int(),
      y2: z.number().int(),
      durationMs: z.number().int().positive().default(300),
    }),
    execute: async ({ x1, y1, x2, y2, durationMs }) => {
      const inputSummary = summarizeValue({ x1, y1, x2, y2, durationMs });
      try {
        const result = await swipe(x1, y1, x2, y2, durationMs);
        record("swipe", inputSummary, result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success ? "Swiped." : (result.error ?? "Swipe failed.");
      } catch (error) {
        record("swipe", inputSummary, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const longPressTool = tool({
    description:
      "Long-press an element on the phone screen (either a node index from readScreen, or x/y coordinates). Use for context menus, app icons, drag handles, and selection.",
    inputSchema: z
      .object({
        index: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Node index from the latest readScreen output."),
        x: z.number().int().nonnegative().optional().describe("X coordinate in pixels."),
        y: z.number().int().nonnegative().optional().describe("Y coordinate in pixels."),
        durationMs: z
          .number()
          .int()
          .positive()
          .default(600)
          .describe("How long to hold, in milliseconds."),
      })
      .refine((v) => v.index !== undefined || (v.x !== undefined && v.y !== undefined), {
        message: "Provide either index, or both x and y.",
      }),
    execute: async (input) => {
      const inputSummary = summarizeValue(input);
      try {
        const result =
          input.index !== undefined
            ? await longPressNode(input.index, input.durationMs)
            : await longPress(input.x!, input.y!, input.durationMs);
        record("longPress", inputSummary, result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success
          ? "Long-pressed."
          : (result.error ?? "Long-press failed.");
      } catch (error) {
        record("longPress", inputSummary, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const dragTool = tool({
    description:
      "Press-and-drag from one point to another on the phone screen. Use for moving items (e.g. rearranging app icons, dragging cards) where a quick swipe is too fast.",
    inputSchema: z.object({
      x1: z.number().int().describe("Start X coordinate in pixels."),
      y1: z.number().int().describe("Start Y coordinate in pixels."),
      x2: z.number().int().describe("End X coordinate in pixels."),
      y2: z.number().int().describe("End Y coordinate in pixels."),
      durationMs: z.number().int().positive().default(800),
    }),
    execute: async ({ x1, y1, x2, y2, durationMs }) => {
      const inputSummary = summarizeValue({ x1, y1, x2, y2, durationMs });
      try {
        const result = await drag(x1, y1, x2, y2, durationMs);
        record("drag", inputSummary, result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success ? "Dragged." : (result.error ?? "Drag failed.");
      } catch (error) {
        record("drag", inputSummary, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const setClipboardTool = tool({
    description:
      "Write text to the phone's clipboard. Useful as an alternative to typing when an app rejects programmatic text input or has no text field (e.g. paste it manually), or to move text between steps.",
    inputSchema: z.object({
      text: z.string().describe("The exact text to put on the clipboard."),
    }),
    execute: async ({ text }) => {
      const inputSummary = summarizeValue({ text });
      try {
        const result = await setClipboard(text);
        record("setClipboard", inputSummary, result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success
          ? "Clipboard set."
          : (result.error ?? "Failed to set clipboard.");
      } catch (error) {
        record("setClipboard", inputSummary, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const getClipboardTool = tool({
    description:
      "Read the current text from the phone's clipboard. Note: on Android 10+ the app must have focus to read it, so this may fail while another app is on screen.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const result = await getClipboard();
        record("getClipboard", "(clipboard)", result.success ? "completed" : "failed", {
          outputSummary: result.success ? summarizeValue(result.text) : toResultMessage(result),
        });
        return result.success
          ? `Clipboard: ${result.text}`
          : (result.error ?? "Failed to read clipboard.");
      } catch (error) {
        record("getClipboard", "(clipboard)", "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const scrollTool = tool({
    description:
      "Scroll the currently visible scrollable area in a direction. Prefer this over swipe for lists: it uses the list's own scroll action and falls back to a swipe gesture inside the list bounds.",
    inputSchema: z.object({
      direction: z.enum(["up", "down", "left", "right"]),
    }),
    execute: async ({ direction }) => {
      try {
        const result = await scroll(direction);
        record("scroll", direction, result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success
          ? `Scrolled ${direction}.`
          : (result.error ?? "Scroll failed.");
      } catch (error) {
        record("scroll", direction, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const pressBackTool = tool({
    description: "Press the system Back button.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const result = await performGlobalAction("back");
        record("pressBack", "(back)", result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success ? "Back pressed." : (result.error ?? "Failed.");
      } catch (error) {
        record("pressBack", "(back)", "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const pressHomeTool = tool({
    description: "Go to the phone home screen.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const result = await performGlobalAction("home");
        record("pressHome", "(home)", result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success ? "Home." : (result.error ?? "Failed.");
      } catch (error) {
        record("pressHome", "(home)", "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const openAppTool = tool({
    description:
      "Open an installed app on the phone by its package name (e.g. com.whatsapp). Use listInstalledApps to discover package names.",
    inputSchema: z.object({
      packageName: z.string().min(1).describe("Android package name, e.g. com.whatsapp."),
    }),
    execute: async ({ packageName }) => {
      try {
        const result = await openApp(packageName);
        record("openApp", packageName, result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success
          ? `Opened ${packageName}.`
          : (result.error ?? `Failed to open ${packageName}.`);
      } catch (error) {
        record("openApp", packageName, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const launchDeepLinkTool = tool({
    description:
      "Open a URL or deep link on the phone (e.g. https://wa.me/1234567890, https://maps.google.com). The system opens it in the appropriate app.",
    inputSchema: z.object({
      uri: z.string().min(1).describe("A full http(s) URL or app deep link."),
    }),
    execute: async ({ uri }) => {
      try {
        const result = await launchDeepLink(uri);
        record("launchDeepLink", uri, result.success ? "completed" : "failed", {
          outputSummary: toResultMessage(result),
        });
        return result.success
          ? `Opened ${uri}.`
          : (result.error ?? `Failed to open ${uri}.`);
      } catch (error) {
        record("launchDeepLink", uri, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const listInstalledAppsTool = tool({
    description:
      "List apps installed on the phone (package name and label). Use to discover the package name before openApp.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const apps = await listInstalledApps();
        const summary = summarizeValue(apps.slice(0, 5));
        record("listInstalledApps", "(apps)", "completed", {
          outputSummary: summary,
        });
        if (apps.length === 0) {
          return "No launchable apps found.";
        }
        return apps
          .map((app) => `${app.label} (${app.packageName})`)
          .join("\n");
      } catch (error) {
        record("listInstalledApps", "(apps)", "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const takeScreenshotTool = tool({
    description:
      "Capture a screenshot of the phone screen and return it as a base64 JPEG data URL. Use this when readScreen's UI tree is not enough (canvas/drawing content, images, videos, games, or apps with few accessibility nodes). Screen capture is started on demand for this call and stops automatically when the run finishes, so the system only captures while the agent actually needs it. On Android 14+ the consent dialog reappears for each new capture session; on older versions it is usually requested only once. Screenshots capture everything on screen, so avoid using them when sensitive data (passwords, codes) is visible.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        if (!(await isScreenCaptureActive())) {
          const permission = await requestScreenCapturePermission();
          if (!permission.success || !permission.granted) {
            return (
              permission.error ??
              "Screen capture permission was not granted. Ask the user to allow it and try again."
            );
          }
        }
        const shot = await captureScreenshot();
        if (!shot.success || !shot.imageBase64) {
          return shot.error ?? "Screenshot failed.";
        }
        const dataUrl = `data:${shot.mimeType ?? "image/jpeg"};base64,${shot.imageBase64}`;
        record("takeScreenshot", "(screen)", "completed", {
          outputSummary: `${shot.width}x${shot.height} image`,
        });
        return `Screenshot (${shot.width}x${shot.height}px): ${dataUrl}`;
      } catch (error) {
        record("takeScreenshot", "(screen)", "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  return {
    readScreen: readScreenTool,
    tap: tapTool,
    type: typeTool,
    swipe: swipeTool,
    longPress: longPressTool,
    drag: dragTool,
    scroll: scrollTool,
    pressBack: pressBackTool,
    pressHome: pressHomeTool,
    openApp: openAppTool,
    launchDeepLink: launchDeepLinkTool,
    listInstalledApps: listInstalledAppsTool,
    setClipboard: setClipboardTool,
    getClipboard: getClipboardTool,
    takeScreenshot: takeScreenshotTool,
  };
}

export function buildDeviceSystemPrompt(): string {
  return [
    "You can control the Android phone directly. Follow this loop:",
    "- Always start by calling readScreen to see the current screen. It returns numbered UI elements.",
    "- Prefer tapping by element index (from the latest readScreen result). If that fails, tap by pixel coordinates.",
    "- If the UI tree is missing important content (canvas, images, video, games), use takeScreenshot to get a picture of the screen.",
    "- Re-read the screen after navigation (openApp, back, launchDeepLink, scroll, swipe, drag) and whenever you are unsure. You may continue without re-reading after type, paste, or taps that errored on an unchanged screen.",
    "- For text entry, tap the target field first, then use type. If typing is rejected, use setClipboard and paste, or type character by character.",
    "- Use longPress for context menus and drag for pick-and-place moves.",
    "- If a tool reports that the accessibility service is not enabled, stop and tell the user to enable it in Settings > Accessibility > Mobile Agent (or in the app's Settings > Tools > Device automation), then wait.",
    "- Use openApp with the package name to switch apps, and listInstalledApps to discover package names.",
    "- When the user asks to message someone on WhatsApp/Telegram, prefer launchDeepLink with a https://wa.me/<number>?text=... or https://t.me/<username> URL, then readScreen and tap/type to send if needed.",
  ].join("\n");
}

export { formatUiTree };
