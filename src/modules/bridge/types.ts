/** MCP content blocks the phone can return without JSON-stringifying binary data. */
export type BridgeContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string };

export type BridgeTool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; [key: string]: unknown };
  readOnly: boolean;
  parse: (input: unknown) => Promise<unknown>;
  execute: (input: unknown, signal: AbortSignal) => Promise<unknown>;
  /**
   * Converts a successful result into MCP content. Without this the server
   * JSON-stringifies the result, which turns Uint8Array media into a huge
   * object of numeric keys instead of an image the harness can actually see.
   */
  toContent?: (
    input: unknown,
    output: unknown,
  ) => Promise<BridgeContent[] | null> | BridgeContent[] | null;
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
  /** Hosts the endpoint answers to. Defaults to IP literals and localhost. */
  isAllowedHost?: (hostname: string) => boolean;
};
