import * as Crypto from "expo-crypto";
import { eq } from "drizzle-orm";

import { providerAccounts, providerAccountState } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type {
  AppDatabase,
  ProviderAccountRepository,
} from "@/core/db/repositories/types";

export function createProviderAccountRepository(
  db: AppDatabase,
): ProviderAccountRepository {
  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(providerAccounts).values({
        id,
        providerId: input.providerId,
        label: input.label,
        credentialKind: input.credentialKind,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const row = (
        await db
          .select()
          .from(providerAccounts)
          .where(eq(providerAccounts.id, id))
          .limit(1)
      )[0];

      if (!row) {
        throw new Error("Failed to create provider account");
      }

      return row;
    },
    async delete(id) {
      await db.transaction(async (tx) => {
        await tx
          .update(providerAccountState)
          .set({ activeAccountId: null })
          .where(eq(providerAccountState.activeAccountId, id));
        await tx.delete(providerAccounts).where(eq(providerAccounts.id, id));
      });
    },
    async deleteByProvider(providerId) {
      await db.transaction(async (tx) => {
        await tx
          .delete(providerAccountState)
          .where(eq(providerAccountState.providerId, providerId));
        await tx
          .delete(providerAccounts)
          .where(eq(providerAccounts.providerId, providerId));
      });
    },
    async getActiveForProvider(providerId) {
      const state = (
        await db
          .select()
          .from(providerAccountState)
          .where(eq(providerAccountState.providerId, providerId))
          .limit(1)
      )[0];

      if (!state?.activeAccountId) {
        return null;
      }

      const account = (
        await db
          .select()
          .from(providerAccounts)
          .where(eq(providerAccounts.id, state.activeAccountId))
          .limit(1)
      )[0];

      return account ?? null;
    },
    async getById(id) {
      const row = (
        await db
          .select()
          .from(providerAccounts)
          .where(eq(providerAccounts.id, id))
          .limit(1)
      )[0];

      return row ?? null;
    },
    async listActiveStates() {
      return db.select().from(providerAccountState);
    },
    async listAll() {
      return db.select().from(providerAccounts);
    },
    async listByProvider(providerId) {
      return db
        .select()
        .from(providerAccounts)
        .where(eq(providerAccounts.providerId, providerId))
        .orderBy(providerAccounts.createdAt);
    },
    async setActiveForProvider(providerId, activeAccountId) {
      if (activeAccountId === null) {
        await db
          .delete(providerAccountState)
          .where(eq(providerAccountState.providerId, providerId));
        return;
      }

      await db
        .insert(providerAccountState)
        .values({ providerId, activeAccountId })
        .onConflictDoUpdate({
          target: providerAccountState.providerId,
          set: { activeAccountId },
        });
    },
    async updateLabel(id, label) {
      await db
        .update(providerAccounts)
        .set({ label, updatedAt: nowIso() })
        .where(eq(providerAccounts.id, id));
    },
  };
}