import { drizzle } from "drizzle-orm/expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

import { normalizeBuiltInToolSettings } from "@/modules/config/built-in-tools";
import { appSettings, schema } from "@/core/db/schema";
import type {
  AppSettings,
  DatabaseMode,
  ThemeMode,
  ToolApprovalMode,
} from "@/core/types/app-state";

type AppSettingRow = typeof appSettings.$inferSelect;

export function nowIso() {
  return new Date().toISOString();
}

export function createDrizzleDb(sqliteDb: SQLiteDatabase) {
  return drizzle(sqliteDb, { schema });
}

export function buildSettings(rows: AppSettingRow[]): AppSettings {
  const settingsMap = new Map(rows.map((row) => [row.key, row.value]));
  const parsedMaxToolSteps = Number(settingsMap.get("max_tool_steps"));
  const storedThemeMode = settingsMap.get("theme_mode");

  const parsedNotificationSettings = (() => {
    const raw = settingsMap.get("notification_settings_json");

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<
        AppSettings["notificationSettings"]
      >;

      return {
        approvalRequests: parsed.approvalRequests !== false,
        runFinished: parsed.runFinished !== false,
      };
    } catch {
      return null;
    }
  })();

  const parsedProtectedApps = (() => {
    const raw = settingsMap.get("device_protected_apps_json");

    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      );
    } catch {
      return [];
    }
  })();

  return {
    activeConversationId: settingsMap.get("active_conversation_id") ?? null,
    activeModelRef:
      (settingsMap.get("active_model_ref") as AppSettings["activeModelRef"]) ??
      null,
    builtInToolSettings: normalizeBuiltInToolSettings(
      (() => {
        const raw = settingsMap.get("built_in_tool_settings_json");

        if (!raw) {
          return null;
        }

        try {
          return JSON.parse(raw) as Partial<AppSettings["builtInToolSettings"]>;
        } catch {
          return null;
        }
      })(),
    ),
    databaseMode:
      (settingsMap.get("database_mode") as DatabaseMode | null) ?? "local",
    databaseUrl: settingsMap.get("database_url") ?? null,
    memoryEnabled: settingsMap.get("memory_enabled") !== "false",
    maxToolSteps:
      Number.isInteger(parsedMaxToolSteps) && parsedMaxToolSteps >= 1
        ? Math.min(parsedMaxToolSteps, 100)
        : 50,
    protectedApps: parsedProtectedApps,
    themeMode: (["system", "light", "dark"] as const).includes(
      storedThemeMode as ThemeMode,
    )
      ? (storedThemeMode as ThemeMode)
      : "system",
    toolApprovalMode:
      (settingsMap.get("tool_approval_mode") as ToolApprovalMode | null) ?? "ask",
    backgroundAgentEnabled:
      settingsMap.get("background_agent_enabled") !== "false",
    notificationSettings: parsedNotificationSettings ?? {
      approvalRequests: true,
      runFinished: true,
    },
  };
}
