import * as Crypto from "expo-crypto";
import { desc, eq } from "drizzle-orm";

import { normalizeBuiltInToolSettings } from "@/lib/config/built-in-tools";
import { DEFAULT_PROVIDER_CONFIGS } from "@/lib/config/registry";
import {
  appSettings,
  modelPresets,
  providerConfigs,
} from "@/lib/db/schema";
import { buildSettings, nowIso } from "@/lib/db/repositories/shared";
import type { AppDatabase, ConfigRepository } from "@/lib/db/repositories/types";

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
          enabled: false,
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
          .onConflictDoNothing();
      }
    },
    async getSettings() {
      const rows = await db.select().from(appSettings);

      return buildSettings(rows);
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
    async setToolApprovalMode(mode) {
      await this.setSetting("tool_approval_mode", mode);
    },
    async setMaxToolSteps(maxToolSteps) {
      const normalized = Math.max(1, Math.min(100, Math.round(maxToolSteps)));
      await this.setSetting("max_tool_steps", String(normalized));
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
      await db
        .insert(appSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value },
        });
    },
  };
}
