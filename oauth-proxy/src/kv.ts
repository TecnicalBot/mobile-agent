import type {
  AuthorizationServerMetadata,
  OAuthClientInformation,
} from "./discovery";

export type PendingAuth = {
  subject: string;
  provider: string;
  server?: string;
  codeVerifier: string;
  scope?: string;
  resourceUrl?: string;
  authServer?: AuthorizationServerMetadata;
  clientInfo?: OAuthClientInformation;
};

export type StoredTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
};

export type StoredSession = {
  subject: string;
  provider: string;
  server?: string;
  flowType: "proxy";
  resourceUrl?: string;
  authServer?: {
    authorizationServerUrl: string;
    tokenEndpoint: string;
  };
  clientInfo?: OAuthClientInformation;
  tokens: StoredTokens;
};

const PENDING_TTL_SECONDS = 10 * 60;

function pendingKey(state: string): string {
  return `pending:${state}`;
}

function ticketKey(ticket: string): string {
  return `ticket:${ticket}`;
}

export type BeginTicket = {
  subject: string;
  provider: string;
  server?: string;
};

const TICKET_TTL_SECONDS = 5 * 60;

export async function putBeginTicket(
  kv: KVNamespace,
  ticket: string,
  payload: BeginTicket,
): Promise<void> {
  await kv.put(ticketKey(ticket), JSON.stringify(payload), {
    expirationTtl: TICKET_TTL_SECONDS,
  });
}

export async function getBeginTicket(
  kv: KVNamespace,
  ticket: string,
): Promise<BeginTicket | null> {
  const raw = await kv.get(ticketKey(ticket));

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (
      typeof parsed.subject === "string" &&
      typeof parsed.provider === "string"
    ) {
      return parsed as unknown as BeginTicket;
    }
  } catch {
    // fall through to null
  }

  return null;
}

export async function deleteBeginTicket(
  kv: KVNamespace,
  ticket: string,
): Promise<void> {
  await kv.delete(ticketKey(ticket));
}

function sessionKey(proxyToken: string): string {
  return `session:${proxyToken}`;
}

export async function putPendingAuth(
  kv: KVNamespace,
  state: string,
  pending: PendingAuth,
): Promise<void> {
  await kv.put(pendingKey(state), JSON.stringify(pending), {
    expirationTtl: PENDING_TTL_SECONDS,
  });
}

export async function getPendingAuth(
  kv: KVNamespace,
  state: string,
): Promise<PendingAuth | null> {
  const raw = await kv.get(pendingKey(state));

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (
      typeof parsed.subject === "string" &&
      typeof parsed.provider === "string" &&
      typeof parsed.codeVerifier === "string"
    ) {
      return parsed as unknown as PendingAuth;
    }
  } catch {
    // fall through to null
  }

  return null;
}

export async function deletePendingAuth(
  kv: KVNamespace,
  state: string,
): Promise<void> {
  await kv.delete(pendingKey(state));
}

export async function putSession(
  kv: KVNamespace,
  proxyToken: string,
  session: StoredSession,
  options?: { ttlSeconds?: number },
): Promise<void> {
  const putOptions =
    options?.ttlSeconds && options.ttlSeconds > 0
      ? { expirationTtl: options.ttlSeconds }
      : undefined;
  await kv.put(sessionKey(proxyToken), JSON.stringify(session), putOptions);
}

export async function getSession(
  kv: KVNamespace,
  proxyToken: string,
): Promise<StoredSession | null> {
  const raw = await kv.get(sessionKey(proxyToken));

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (
      typeof parsed.subject === "string" &&
      typeof parsed.provider === "string"
    ) {
      return parsed as unknown as StoredSession;
    }
  } catch {
    // fall through to null
  }

  return null;
}

export async function deleteSession(
  kv: KVNamespace,
  proxyToken: string,
): Promise<void> {
  await kv.delete(sessionKey(proxyToken));
}

/** Deletes every session belonging to a subject (used by revoke-all later). */
export async function listSessions(
  kv: KVNamespace,
  subject: string,
  prefix: string,
): Promise<string[]> {
  const keys = await kv.list({ prefix: `${prefix}session:` });
  const ids: string[] = [];

  for (const key of keys.keys) {
    const raw = await kv.get(key.name);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { subject?: unknown };
        if (parsed.subject === subject) {
          ids.push(key.name);
        }
      } catch {
        // skip unparseable entries
      }
    }
  }

  return ids;
}