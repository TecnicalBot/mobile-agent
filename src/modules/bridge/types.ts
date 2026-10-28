export type BridgeTool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; [key: string]: unknown };
  readOnly: boolean;
  parse: (input: unknown) => Promise<unknown>;
  execute: (input: unknown, signal: AbortSignal) => Promise<unknown>;
};

export type BridgeApproval = {
  toolName: string;
  arguments: unknown;
  signal: AbortSignal;
};

export type BridgeOptions = {
  token: string;
  tools: readonly BridgeTool[];
  randomId: () => string;
  approve: (request: BridgeApproval) => Promise<boolean>;
  isAvailable: () => boolean;
};
