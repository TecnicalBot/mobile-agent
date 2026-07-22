import bundledCatalog from "../../../catalog/mcp-servers.json";

import type { McpServerAuthMode, McpServerTransport } from "@/types/app-state";

export const MCP_CATALOG_URL =
  "https://raw.githubusercontent.com/tecnicalbot/mobile-agent/refs/heads/main/catalog/mcp-servers.json";

const MAX_CATALOG_SERVERS = 100;

export type McpServerPreset = {
  authMode: McpServerAuthMode;
  description: string;
  headerTemplate: string | null;
  id: string;
  label: string;
  oauthAllowedAuthOrigin: string | null;
  oauthAuthorizationUrl: string | null;
  oauthClientId: string | null;
  oauthScopes: string | null;
  oauthTokenUrl: string | null;
  transport: McpServerTransport;
  url: string;
};

export type McpServerCatalogResult = {
  presets: McpServerPreset[];
  source: "bundled" | "github";
};

function getRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function getRequiredString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
) {
  const value = record[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MCP catalog field ${key} must be a non-empty string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`MCP catalog field ${key} is too long.`);
  }

  return trimmed;
}

function getOptionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`MCP catalog field ${key} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`MCP catalog field ${key} is too long.`);
  }

  return trimmed || null;
}

function getHttpsUrl(value: string, label: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }

  return parsed.href;
}

function parsePreset(value: unknown): McpServerPreset {
  const record = getRecord(value, "MCP catalog server");
  const authMode = record.authMode;
  const transport = record.transport;

  if (authMode !== "none" && authMode !== "headers" && authMode !== "oauth") {
    throw new Error("MCP catalog authMode is invalid.");
  }

  if (transport !== "http" && transport !== "sse") {
    throw new Error("MCP catalog transport is invalid.");
  }

  return {
    authMode,
    description: getRequiredString(record, "description", 240),
    headerTemplate: getOptionalString(record, "headerTemplate", 2048),
    id: getRequiredString(record, "id", 64),
    label: getRequiredString(record, "label", 80),
    oauthAllowedAuthOrigin: getOptionalString(
      record,
      "oauthAllowedAuthOrigin",
      2048,
    ),
    oauthAuthorizationUrl: getOptionalString(
      record,
      "oauthAuthorizationUrl",
      2048,
    ),
    oauthClientId: getOptionalString(record, "oauthClientId", 512),
    oauthScopes: getOptionalString(record, "oauthScopes", 1024),
    oauthTokenUrl: getOptionalString(record, "oauthTokenUrl", 2048),
    transport,
    url: getHttpsUrl(getRequiredString(record, "url", 2048), "MCP server URL"),
  };
}

export function parseMcpServerCatalog(value: unknown) {
  const catalog = getRecord(value, "MCP catalog");

  if (catalog.version !== 1) {
    throw new Error("Unsupported MCP catalog version.");
  }

  if (!Array.isArray(catalog.servers)) {
    throw new Error("MCP catalog servers must be an array.");
  }

  if (catalog.servers.length > MAX_CATALOG_SERVERS) {
    throw new Error("MCP catalog contains too many servers.");
  }

  const presets = catalog.servers.map(parsePreset);
  const ids = new Set<string>();

  for (const preset of presets) {
    if (ids.has(preset.id)) {
      throw new Error(`Duplicate MCP catalog id: ${preset.id}.`);
    }
    ids.add(preset.id);
  }

  return presets;
}

export async function fetchMcpServerCatalog(
  signal?: AbortSignal,
): Promise<McpServerCatalogResult> {
  try {
    const response = await fetch(MCP_CATALOG_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub catalog request failed (${response.status}).`);
    }

    return {
      presets: parseMcpServerCatalog(await response.json()),
      source: "github",
    };
  } catch (error) {
    if (signal?.aborted) throw error;

    return {
      presets: parseMcpServerCatalog(bundledCatalog),
      source: "bundled",
    };
  }
}
