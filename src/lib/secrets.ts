import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthTokens,
} from "@ai-sdk/mcp";
import * as SecureStore from "expo-secure-store";

import {
  getOpenAiAccessToken,
  getOpenAiRefreshToken,
} from "@/lib/openai-oauth";
import type { ProviderConfig } from "@/types/app-state";

function getProviderApiKeyKey(providerId: string) {
  return `provider_${providerId}_apiKey`;
}

function getMcpHeaderValuesKey(serverId: string) {
  return `mcp_${serverId}_headers`;
}

function getMcpOAuthTokensKey(serverId: string) {
  return `mcp_${serverId}_oauth_tokens`;
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
  flowType?: "compat" | "discovered" | "manual" | null;
  resourceUrl?: string | null;
  state?: string | null;
  tokens?: OAuthTokens | null;
};

export interface SecretStore {
  deleteProviderApiKey(providerId: string): Promise<void>;
  deleteMcpHeaderValues(serverId: string): Promise<void>;
  deleteMcpOAuthTokens(serverId: string): Promise<void>;
  getMcpHeaderValues(serverId: string): Promise<Record<string, string>>;
  getMcpOAuthSession(serverId: string): Promise<McpOAuthSession | null>;
  getMcpOAuthTokens(serverId: string): Promise<McpOAuthTokens | null>;
  getProviderApiKey(providerId: string): Promise<string | null>;
  hasProviderCredential(provider: ProviderConfig): Promise<boolean>;
  setMcpHeaderValues(
    serverId: string,
    headers: Record<string, string>,
  ): Promise<void>;
  setMcpOAuthSession(serverId: string, session: McpOAuthSession): Promise<void>;
  setMcpOAuthTokens(serverId: string, tokens: McpOAuthTokens): Promise<void>;
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>;
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
        parsed.flowType === "manual"
          ? parsed.flowType
          : null,
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
  async deleteProviderApiKey(providerId) {
    await SecureStore.deleteItemAsync(getProviderApiKeyKey(providerId));
  },
  async deleteMcpHeaderValues(serverId) {
    await SecureStore.deleteItemAsync(getMcpHeaderValuesKey(serverId));
  },
  async deleteMcpOAuthTokens(serverId) {
    await SecureStore.deleteItemAsync(getMcpOAuthTokensKey(serverId));
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
  async getProviderApiKey(providerId) {
    return SecureStore.getItemAsync(getProviderApiKeyKey(providerId));
  },
  async hasProviderCredential(provider) {
    if (provider.authType === "none") {
      return provider.enabled;
    }

    if (provider.authType === "oauth") {
      const [accessToken, refreshToken] = await Promise.all([
        getOpenAiAccessToken(),
        getOpenAiRefreshToken(),
      ]);

      return Boolean(accessToken || refreshToken);
    }

    const apiKey = await SecureStore.getItemAsync(
      getProviderApiKeyKey(provider.id),
    );

    if (!apiKey) {
      return false;
    }

    if (provider.family === "openai-compatible") {
      return Boolean(provider.baseUrl?.trim());
    }

    return true;
  },
  async setProviderApiKey(providerId, apiKey) {
    await SecureStore.setItemAsync(getProviderApiKeyKey(providerId), apiKey);
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
};
