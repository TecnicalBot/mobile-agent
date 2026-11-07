import {
  AcpClient,
  makeAcpClient,
  normalizeAcpUrl,
  testAcpConnection,
  type AcpClientOptions,
  type AcpConnection,
  type AcpHealth,
  type AcpLogEvent,
} from "./acp-client";

export * from "./acp-client";

export type AntigravityConnection = AcpConnection;
export type AntigravityHealth = AcpHealth;
export type AntigravityClientOptions = AcpClientOptions;
export { AcpClient as AntigravityClient };
export type AntigravityLogEvent = AcpLogEvent;

export const normalizeAntigravityUrl = normalizeAcpUrl;

export function makeAntigravityClient(
  connection: AntigravityConnection,
  options?: AntigravityClientOptions,
): AcpClient {
  return makeAcpClient(connection, {
    agentLabel: "Antigravity",
    ...options,
  });
}

export function testAntigravityConnection(
  connection: AntigravityConnection,
  options?: {
    agentLabel?: string;
    transport?: typeof globalThis.fetch;
    signal?: AbortSignal;
  },
) {
  return testAcpConnection(connection, {
    agentLabel: "Antigravity",
    ...options,
  });
}
