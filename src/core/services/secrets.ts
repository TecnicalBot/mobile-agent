import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthTokens,
} from "@ai-sdk/mcp";
import * as SecureStore from "expo-secure-store";

import {
  getOpenAiAccessToken,
  getOpenAiRefreshToken,
  getOpenAiTokenInfoForAccount,
} from "@/modules/providers/openai-oauth";
import type { ProviderConfig } from "@/core/types/app-state";

function getLegacyProviderApiKeyKey(providerId: string) {
  return `provider_${providerId}_apiKey`;
}

function getProviderAccountApiKeyKey(accountId: string) {
  return `provider_account_${accountId}_apiKey`;
}

function getActiveProviderAccountKey(providerId: string) {
  return `provider_${providerId}_active_account`;
}

function getMcpHeaderValuesKey(serverId: string) {
  return `mcp_${serverId}_headers`;
}

function getMcpOAuthTokensKey(serverId: string) {
  return `mcp_${serverId}_oauth_tokens`;
}

export type PluginSecretMap = Record<string, string>;

function getPluginSecretsKey(pluginId: string) {
  const safe = pluginId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `plugin_secrets_${safe}`;
}

function sanitizeSecretKey(key: string) {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function readPluginSecretMap(pluginId: string): Promise<PluginSecretMap> {
  const raw = await SecureStore.getItemAsync(getPluginSecretsKey(pluginId));

  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

async function writePluginSecretMap(
  pluginId: string,
  map: PluginSecretMap,
): Promise<void> {
  if (Object.keys(map).length === 0) {
    await SecureStore.deleteItemAsync(getPluginSecretsKey(pluginId));
    return;
  }

  await SecureStore.setItemAsync(getPluginSecretsKey(pluginId), JSON.stringify(map));
}

export type McpOAuthTokens = {
  accessToken: string;
  expiresAt?: number | null;
  refreshToken?: string | null;
  tokenType?: string | null;
};

export type McpOAuthSession = {
  authorizationServerInformation?: OAuthAuthorizationServerInformation | null;
  clientInformation?: OAuthClientInformation | null;
  codeVerifier?: string | null;
  expiresAt?: number | null;
  flowType?: "compat" | "discovered" | "manual" | "proxy" | null;
  proxyToken?: string | null;
  redirectUri?: string | null;
  resourceUrl?: string | null;
  state?: string | null;
  tokens?: OAuthTokens | null;
};

export interface SecretStore {
  deleteLegacyProviderApiKey(providerId: string): Promise<void>;
  deleteMcpHeaderValues(serverId: string): Promise<void>;
  deleteMcpOAuthTokens(serverId: string): Promise<void>;
  deletePluginSecret(pluginId: string, key: string): Promise<void>;
  deletePluginSecrets(pluginId: string): Promise<void>;
  deleteProviderAccountApiKey(accountId: string): Promise<void>;
  getActiveProviderAccountId(providerId: string): Promise<string | null>;
  getLegacyProviderApiKey(providerId: string): Promise<string | null>;
  getMcpHeaderValues(serverId: string): Promise<Record<string, string>>;
  getMcpOAuthSession(serverId: string): Promise<McpOAuthSession | null>;
  getMcpOAuthTokens(serverId: string): Promise<McpOAuthTokens | null>;
  getPluginSecret(pluginId: string, key: string): Promise<string | null>;
  getProviderAccountApiKey(accountId: string): Promise<string | null>;
  getProviderApiKey(providerId: string): Promise<string | null>;
  hasProviderCredential(provider: ProviderConfig): Promise<boolean>;
  listPluginSecretKeys(pluginId: string): Promise<string[]>;
  setActiveProviderAccount(
    providerId: string,
    accountId: string | null,
  ): Promise<void>;
  setLegacyProviderApiKey(providerId: string, apiKey: string): Promise<void>;
  setMcpHeaderValues(
    serverId: string,
    headers: Record<string, string>,
  ): Promise<void>;
  setMcpOAuthSession(serverId: string, session: McpOAuthSession): Promise<void>;
  setMcpOAuthTokens(serverId: string, tokens: McpOAuthTokens): Promise<void>;
  setPluginSecret(
    pluginId: string,
    key: string,
    value: string,
  ): Promise<void>;
  setProviderAccountApiKey(accountId: string, apiKey: string): Promise<void>;
  syncActiveProviderAccounts(map: Record<string, string | null>): Promise<void>;
}

function normalizeExpiresAt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseMcpOAuthSession(raw: string | null): McpOAuthSession | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return null;
    }

    if (typeof parsed.accessToken === "string") {
      return {
        codeVerifier: null,
        expiresAt: normalizeExpiresAt(parsed.expiresAt),
        state: null,
        tokens: {
          access_token: parsed.accessToken,
          refresh_token:
            typeof parsed.refreshToken === "string"
              ? parsed.refreshToken
              : undefined,
          token_type:
            typeof parsed.tokenType === "string" ? parsed.tokenType : "Bearer",
        },
      };
    }

    const tokens = isRecord(parsed.tokens)
      ? (parsed.tokens as OAuthTokens)
      : null;
    const clientInformation = isRecord(parsed.clientInformation)
      ? (parsed.clientInformation as OAuthClientInformation)
      : null;
    const authorizationServerInformation = isRecord(
      parsed.authorizationServerInformation,
    )
      ? (parsed.authorizationServerInformation as unknown as OAuthAuthorizationServerInformation)
      : null;

    return {
      authorizationServerInformation,
      clientInformation,
      codeVerifier:
        typeof parsed.codeVerifier === "string" ? parsed.codeVerifier : null,
      expiresAt: normalizeExpiresAt(parsed.expiresAt),
      flowType:
        parsed.flowType === "compat" ||
        parsed.flowType === "discovered" ||
        parsed.flowType === "manual" ||
        parsed.flowType === "proxy"
          ? parsed.flowType
          : null,
      proxyToken:
        typeof parsed.proxyToken === "string" ? parsed.proxyToken : null,
      redirectUri:
        typeof parsed.redirectUri === "string" ? parsed.redirectUri : null,
      resourceUrl:
        typeof parsed.resourceUrl === "string" ? parsed.resourceUrl : null,
      state: typeof parsed.state === "string" ? parsed.state : null,
      tokens: tokens && typeof tokens.access_token === "string" ? tokens : null,
    };
  } catch {
    return null;
  }
}

export const secureSecretStore: SecretStore = {
  async deleteLegacyProviderApiKey(providerId) {
    await SecureStore.deleteItemAsync(getLegacyProviderApiKeyKey(providerId));
  },
  async deleteMcpHeaderValues(serverId) {
    await SecureStore.deleteItemAsync(getMcpHeaderValuesKey(serverId));
  },
  async deleteMcpOAuthTokens(serverId) {
    await SecureStore.deleteItemAsync(getMcpOAuthTokensKey(serverId));
  },
  async deletePluginSecret(pluginId, key) {
    const map = await readPluginSecretMap(pluginId);
    delete map[sanitizeSecretKey(key)];
    await writePluginSecretMap(pluginId, map);
  },
  async deletePluginSecrets(pluginId) {
    await SecureStore.deleteItemAsync(getPluginSecretsKey(pluginId));
  },
  async deleteProviderAccountApiKey(accountId) {
    await SecureStore.deleteItemAsync(getProviderAccountApiKeyKey(accountId));
  },
  async getActiveProviderAccountId(providerId) {
    return SecureStore.getItemAsync(getActiveProviderAccountKey(providerId));
  },
  async getLegacyProviderApiKey(providerId) {
    return SecureStore.getItemAsync(getLegacyProviderApiKeyKey(providerId));
  },
  async getMcpHeaderValues(serverId) {
    const raw = await SecureStore.getItemAsync(getMcpHeaderValuesKey(serverId));

    if (!raw) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === "string" && typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  },
  async getMcpOAuthSession(serverId) {
    return parseMcpOAuthSession(
      await SecureStore.getItemAsync(getMcpOAuthTokensKey(serverId)),
    );
  },
  async getMcpOAuthTokens(serverId) {
    const session = await this.getMcpOAuthSession(serverId);

    if (!session?.tokens?.access_token) {
      return null;
    }

    return {
      accessToken: session.tokens.access_token,
      expiresAt: session.expiresAt ?? null,
      refreshToken: session.tokens.refresh_token ?? null,
      tokenType: session.tokens.token_type ?? null,
    };
  },
  async getProviderAccountApiKey(accountId) {
    return SecureStore.getItemAsync(getProviderAccountApiKeyKey(accountId));
  },
  async getPluginSecret(pluginId, key) {
    return (await readPluginSecretMap(pluginId))[sanitizeSecretKey(key)] ?? null;
  },
  async listPluginSecretKeys(pluginId) {
    return Object.keys(await readPluginSecretMap(pluginId));
  },
  async getProviderApiKey(providerId) {
    const activeAccountId =
      await SecureStore.getItemAsync(getActiveProviderAccountKey(providerId));

    if (activeAccountId) {
      const accountKey = await SecureStore.getItemAsync(
        getProviderAccountApiKeyKey(activeAccountId),
      );

      if (accountKey) {
        return accountKey;
      }
    }

    return SecureStore.getItemAsync(getLegacyProviderApiKeyKey(providerId));
  },
  async hasProviderCredential(provider) {
    if (!provider.enabled) {
      return false;
    }

    if (provider.authType === "none") {
      return true;
    }

    if (provider.authType === "oauth") {
      const activeAccountId =
        await SecureStore.getItemAsync(getActiveProviderAccountKey(provider.id));

      if (activeAccountId) {
        const info = await getOpenAiTokenInfoForAccount(activeAccountId);

        return Boolean(info.accessToken || info.refreshToken);
      }

      const [accessToken, refreshToken] = await Promise.all([
        getOpenAiAccessToken(),
        getOpenAiRefreshToken(),
      ]);

      return Boolean(accessToken || refreshToken);
    }

    const activeAccountId =
      await SecureStore.getItemAsync(getActiveProviderAccountKey(provider.id));
    const apiKey = activeAccountId
      ? await SecureStore.getItemAsync(
          getProviderAccountApiKeyKey(activeAccountId),
        )
      : null;

    if (!apiKey && !activeAccountId) {
      const legacyApiKey = await SecureStore.getItemAsync(
        getLegacyProviderApiKeyKey(provider.id),
      );

      if (!legacyApiKey) {
        return false;
      }

      if (provider.family === "openai-compatible") {
        return Boolean(provider.baseUrl?.trim());
      }

      return true;
    }

    if (!apiKey) {
      return false;
    }

    if (provider.family === "openai-compatible") {
      return Boolean(provider.baseUrl?.trim());
    }

    return true;
  },
  async setActiveProviderAccount(providerId, accountId) {
    if (accountId === null) {
      await SecureStore.deleteItemAsync(
        getActiveProviderAccountKey(providerId),
      );
      return;
    }

    await SecureStore.setItemAsync(
      getActiveProviderAccountKey(providerId),
      accountId,
    );
  },
  async setMcpHeaderValues(serverId, headers) {
    await SecureStore.setItemAsync(
      getMcpHeaderValuesKey(serverId),
      JSON.stringify(headers),
    );
  },
  async setMcpOAuthSession(serverId, session) {
    await SecureStore.setItemAsync(
      getMcpOAuthTokensKey(serverId),
      JSON.stringify(session),
    );
  },
  async setMcpOAuthTokens(serverId, tokens) {
    const session = (await this.getMcpOAuthSession(serverId)) ?? {};

    await this.setMcpOAuthSession(serverId, {
      ...session,
      expiresAt: normalizeExpiresAt(tokens.expiresAt),
      tokens: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken ?? undefined,
        token_type: tokens.tokenType ?? "Bearer",
      },
    });
  },
  async setLegacyProviderApiKey(providerId, apiKey) {
    await SecureStore.setItemAsync(
      getLegacyProviderApiKeyKey(providerId),
      apiKey,
    );
  },
  async setProviderAccountApiKey(accountId, apiKey) {
    await SecureStore.setItemAsync(
      getProviderAccountApiKeyKey(accountId),
      apiKey,
    );
  },
  async setPluginSecret(pluginId, key, value) {
    const map = await readPluginSecretMap(pluginId);
    map[sanitizeSecretKey(key)] = value;
    await writePluginSecretMap(pluginId, map);
  },
  async syncActiveProviderAccounts(map) {
    await Promise.all(
      Object.entries(map).map(([providerId, accountId]) =>
        this.setActiveProviderAccount(providerId, accountId),
      ),
    );
  },
};