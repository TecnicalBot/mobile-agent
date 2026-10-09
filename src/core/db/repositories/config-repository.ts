import * as Crypto from "expo-crypto";
import { and, desc, eq } from "drizzle-orm";

import { normalizeBuiltInToolSettings } from "@/modules/config/built-in-tools";
import { DEFAULT_PROVIDER_CONFIGS } from "@/modules/config/registry";
import { appSettings, modelPresets, providerConfigs } from "@/core/db/schema";
import { buildSettings, nowIso } from "@/core/db/repositories/shared";
import type {
  AppDatabase,
  ConfigRepository,
} from "@/core/db/repositories/types";

export function createConfigRepository(db: AppDatabase): ConfigRepository {
  return {
    async createProvider(input) {
      const timestamp = nowIso();

      await db
        .insert(providerConfigs)
        .values({
          id: input.id,
          family: input.family,
          label: input.label,
          authType: input.authType,
          baseUrl: input.baseUrl ?? null,
          enabled: input.enabled ?? false,
          oauthAccountEmail: input.oauthAccountEmail ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onConflictDoNothing();

      const row = (
        await db
          .select()
          .from(providerConfigs)
          .where(eq(providerConfigs.id, input.id))
          .limit(1)
      )[0];

      if (!row) {
        throw new Error("Failed to create provider");
      }

      return row;
    },
    async deleteProvider(providerId) {
      await db.transaction(async (tx) => {
        await tx
          .delete(modelPresets)
          .where(eq(modelPresets.providerId, providerId));
        await tx
          .delete(providerConfigs)
          .where(eq(providerConfigs.id, providerId));
      });
    },
    async ensureDefaultProviders() {
      const timestamp = nowIso();

      for (const provider of DEFAULT_PROVIDER_CONFIGS) {
        await db
          .insert(providerConfigs)
          .values({
            id: provider.id,
            family: provider.family,
            label: provider.label,
            authType: provider.authType,
            baseUrl: provider.baseUrl,
            enabled: provider.enabled,
            oauthAccountEmail: provider.oauthAccountEmail,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .onConflictDoUpdate({
            target: providerConfigs.id,
            set: {
              // Provider families and auth schemes are application-owned. Keep
              // user-editable labels, URLs, credentials, and enabled state.
              authType: provider.authType,
              family: provider.family,
            },
          });
      }

      // Built-in labels we renamed after they first shipped. Only overwrite the
      // stored value when it is still the old default, so custom labels survive.
      const renamedLabels: Record<string, string> = {
        openai: "OpenAI (ChatGPT OAuth)",
      };

      for (const provider of DEFAULT_PROVIDER_CONFIGS) {
        const previousLabel = renamedLabels[provider.id];

        if (!previousLabel || previousLabel === provider.label) {
          continue;
        }

        await db
          .update(providerConfigs)
          .set({ label: provider.label, updatedAt: nowIso() })
          .where(
            and(
              eq(providerConfigs.id, provider.id),
              eq(providerConfigs.label, previousLabel),
            ),
          );
      }
    },
    async getSettings() {
      const rows = await db.select().from(appSettings);

      return buildSettings(rows);
    },
    async getApprovedToolsByConversation() {
      const rows = await db.select().from(appSettings);
      const raw = rows.find(
        (row) => row.key === "conversation_approved_tools_json",
      )?.value;

      if (!raw) {
        return {};
      }

      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        return Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string[]] =>
              Array.isArray(entry[1]) &&
              entry[1].every((item) => typeof item === "string"),
          ),
        );
      } catch {
        return {};
      }
    },
    async setApprovedToolsByConversation(modes: Record<string, string[]>) {
      await this.setSetting(
        "conversation_approved_tools_json",
        JSON.stringify(modes),
      );
    },
    async getConversationApprovalModes() {
      const rows = await db.select().from(appSettings);
      const raw = rows.find(
        (row) => row.key === "conversation_approval_modes_json",
      )?.value;

      if (!raw) {
        return {};
      }

      try {
        const parsed = JSON.parse(raw) as Record<string, "ask" | "auto">;

        return Object.fromEntries(
          Object.entries(parsed).filter(
            ([, mode]) => mode === "ask" || mode === "auto",
          ),
        );
      } catch {
        return {};
      }
    },
    async listModelPresets() {
      return db
        .select()
        .from(modelPresets)
        .orderBy(
          modelPresets.providerId,
          desc(modelPresets.isDefault),
          desc(modelPresets.updatedAt),
        );
    },
    async listProviderConfigs() {
      return db.select().from(providerConfigs).orderBy(providerConfigs.label);
    },
    async createModelPreset(input) {
      const timestamp = nowIso();
      const existing = (
        await db
          .select()
          .from(modelPresets)
          .where(eq(modelPresets.providerId, input.providerId))
      ).find((preset) => preset.modelId === input.modelId);

      const presetId = existing?.id ?? Crypto.randomUUID();

      if (existing) {
        await db
          .update(modelPresets)
          .set({
            label: input.label !== undefined ? input.label : existing.label,
            options:
              input.options !== undefined ? input.options : existing.options,
            updatedAt: timestamp,
          })
          .where(eq(modelPresets.id, existing.id));
      } else {
        await db.insert(modelPresets).values({
          id: presetId,
          providerId: input.providerId,
          modelId: input.modelId,
          label: input.label ?? null,
          isDefault: false,
          options: input.options ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      if (input.makeDefault) {
        await this.setDefaultModelPreset(presetId);
      }

      const row = (
        await db
          .select()
          .from(modelPresets)
          .where(eq(modelPresets.id, presetId))
          .limit(1)
      )[0];

      if (!row) {
        throw new Error("Failed to save model preset");
      }

      return row;
    },
    async deleteModelPreset(modelPresetId) {
      await db.delete(modelPresets).where(eq(modelPresets.id, modelPresetId));
    },
    async setDatabaseSettings(input) {
      if (input.databaseMode !== undefined) {
        await this.setSetting("database_mode", input.databaseMode);
      }

      if (input.databaseUrl !== undefined) {
        await this.setSetting("database_url", input.databaseUrl);
      }
    },
    async setBuiltInToolSettings(input) {
      const settings = await this.getSettings();
      const nextSettings = normalizeBuiltInToolSettings({
        ...settings.builtInToolSettings,
        ...input,
      });

      await this.setSetting(
        "built_in_tool_settings_json",
        JSON.stringify(nextSettings),
      );
    },
    async setMemoryEnabled(enabled) {
      await this.setSetting("memory_enabled", enabled ? "true" : "false");
    },
    async setSchedulingEnabled(enabled) {
      await this.setSetting("scheduling_enabled", enabled ? "true" : "false");
    },
    async setThemeMode(mode) {
      await this.setSetting("theme_mode", mode);
    },
    async setConversationApprovalModes(
      modes: Record<string, "ask" | "auto">,
    ) {
      await this.setSetting(
        "conversation_approval_modes_json",
        JSON.stringify(modes),
      );
    },
    async setNotificationSettings(input) {
      const settings = await this.getSettings();
      const nextSettings = {
        ...settings.notificationSettings,
        ...input,
      };

      await this.setSetting(
        "notification_settings_json",
        JSON.stringify(nextSettings),
      );
    },
    async setDefaultModelPreset(modelPresetId) {
      const targetPreset = (
        await db
          .select()
          .from(modelPresets)
          .where(eq(modelPresets.id, modelPresetId))
          .limit(1)
      )[0];

      if (!targetPreset) {
        return;
      }

      await db
        .update(modelPresets)
        .set({
          isDefault: false,
          updatedAt: nowIso(),
        })
        .where(eq(modelPresets.providerId, targetPreset.providerId));

      await db
        .update(modelPresets)
        .set({
          isDefault: true,
          updatedAt: nowIso(),
        })
        .where(eq(modelPresets.id, modelPresetId));
    },
    async updateProvider(providerId, input) {
      const current = (
        await db
          .select()
          .from(providerConfigs)
          .where(eq(providerConfigs.id, providerId))
          .limit(1)
      )[0];

      if (!current) {
        return;
      }

      await db
        .update(providerConfigs)
        .set({
          baseUrl: input.baseUrl ?? current.baseUrl,
          enabled: input.enabled ?? current.enabled,
          label: input.label ?? current.label,
          oauthAccountEmail:
            input.oauthAccountEmail !== undefined
              ? input.oauthAccountEmail
              : current.oauthAccountEmail,
          updatedAt: nowIso(),
        })
        .where(eq(providerConfigs.id, providerId));
    },
    async setProviderOauthEmail(providerId, email) {
      await db
        .update(providerConfigs)
        .set({
          oauthAccountEmail: email,
          updatedAt: nowIso(),
        })
        .where(eq(providerConfigs.id, providerId));
    },
    async setSetting(key, value) {
      await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value },
      });
    },
  };
}
