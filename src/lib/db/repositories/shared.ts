import { drizzle } from "drizzle-orm/expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

import { normalizeBuiltInToolSettings } from "@/lib/config/built-in-tools";
import { appSettings, schema } from "@/lib/db/schema";
import type { AppSettings, DatabaseMode, ToolApprovalMode } from "@/types/app-state";

type AppSettingRow = typeof appSettings.$inferSelect;

export function nowIso() {
  return new Date().toISOString();
}

export function createDrizzleDb(sqliteDb: SQLiteDatabase) {
  return drizzle(sqliteDb, { schema });
}

export function buildSettings(rows: AppSettingRow[]): AppSettings {
  const settingsMap = new Map(rows.map((row) => [row.key, row.value]));

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
    toolApprovalMode:
      (settingsMap.get("tool_approval_mode") as ToolApprovalMode | null) ?? "ask",
  };
}
