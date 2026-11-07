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

export type ClaudeConnection = AcpConnection;
export type ClaudeHealth = AcpHealth;
export type ClaudeClientOptions = AcpClientOptions;
export { AcpClient as ClaudeClient };
export type ClaudeLogEvent = AcpLogEvent;

export const normalizeClaudeUrl = normalizeAcpUrl;

export function makeClaudeClient(
  connection: ClaudeConnection,
  options?: ClaudeClientOptions,
): AcpClient {
  return makeAcpClient(connection, {
    agentLabel: "Claude",
    ...options,
  });
}

export function testClaudeConnection(
  connection: ClaudeConnection,
  options?: {
    agentLabel?: string;
    transport?: typeof globalThis.fetch;
    signal?: AbortSignal;
  },
) {
  return testAcpConnection(connection, {
    agentLabel: "Claude",
    ...options,
  });
}
