/* eslint-disable import/no-unresolved -- The SDK's wildcard .js exports resolve in Metro and Node, but not Expo's ESLint resolver. */
import { Server } from "@modelcontextprotocol/sdk/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { BridgeOptions } from "./types";

const MAX_SESSIONS = 4;
const MAX_BODY = 2_500_000;

function matchesToken(received: string, expected: string) {
  if (received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++)
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

/** Harness-independent MCP endpoint. No tool names or grants come from the network. */
export function createBridgeMcpServer(options: BridgeOptions) {
  if (options.token.length < 32)
    throw new Error("Bridge tokens must have at least 32 characters.");
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const sessions = new Map<
    string,
    { server: Server; transport: WebStandardStreamableHTTPServerTransport }
  >();
  let stopped = false;
  let executing = false;
  let initializing = 0;

  function createSession() {
    const server = new Server(
      { name: "mobile-agent-phone-tools", version: "0.1.0" },
      {
        capabilities: { tools: {} },
        instructions:
          "These tools run on the user's phone, not on your host. Only the explicitly shared phone folder is accessible through folder tools. workspace:// references point to files on the phone, not local host paths. Ask for approval when required; never bypass a denied request.",
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: options.randomId,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_BODY,
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: !tool.readOnly,
          openWorldHint: false,
        },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const fail = (text: string) => ({
        isError: true,
        content: [{ type: "text" as const, text }],
      });
      const tool = tools.get(request.params.name);
      if (!tool) return fail("This tool is not shared with this connection.");
      if (stopped || !options.isAvailable())
        return fail(
          "Phone tools are unavailable. Open Mobile Agent and enable sharing.",
        );
      if (executing) return fail("Another phone tool request is in progress.");
      executing = true;
      try {
        const input = await tool.parse(request.params.arguments ?? {});
        extra.signal.throwIfAborted();
        // Every call is approved locally, including reads that can disclose private files.
        if (
          !(await options.approve({
            toolName: tool.name,
            arguments: input,
            signal: extra.signal,
          }))
        )
          return fail("The user denied this phone tool request.");
        extra.signal.throwIfAborted();
        if (stopped || !options.isAvailable())
          return fail("Phone tool access was revoked.");
        const output = await tool.execute(input, extra.signal);
        extra.signal.throwIfAborted();
        const text =
          typeof output === "string" ? output : JSON.stringify(output ?? null);
        if (text.length > 1_000_000)
          return fail("Result is too large. Read a smaller range instead.");
        return { content: [{ type: "text" as const, text }] };
      } catch {
        // Native exceptions can contain filesystem paths, credentials, or internal state.
        return fail(
          extra.signal.aborted
            ? "Phone tool request cancelled."
            : "Phone tool failed. Check the input and Mobile Agent.",
        );
      } finally {
        executing = false;
      }
    });
    return { server, transport };
  }

  return {
    async handle(request: Request): Promise<Response> {
      if (stopped) return new Response(null, { status: 503 });
      // Browser access is intentionally unsupported; reject Origin rather than permitting DNS rebinding.
      if (request.headers.has("origin"))
        return new Response(null, { status: 403 });
      const host = new URL(request.url).hostname;
      if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
        return new Response(null, { status: 403 });
      if (
        !matchesToken(
          request.headers.get("authorization") ?? "",
          `Bearer ${options.token}`,
        )
      )
        return new Response(null, { status: 401 });
      if (new URL(request.url).pathname !== "/mcp")
        return new Response(null, { status: 404 });
      if (request.method === "GET")
        return new Response(null, {
          status: 405,
          headers: { Allow: "POST, DELETE" },
        });
      if (!["POST", "DELETE"].includes(request.method))
        return new Response(null, { status: 405 });
      const sessionID = request.headers.get("mcp-session-id");
      if (sessionID) {
        const session = sessions.get(sessionID);
        if (!session) return new Response(null, { status: 404 });
        return session.transport.handleRequest(request);
      }
      if (request.method !== "POST") return new Response(null, { status: 400 });
      if (sessions.size + initializing >= MAX_SESSIONS)
        return new Response(null, { status: 429 });
      // Each transport validates initialize before allocating its secure session ID.
      const session = createSession();
      initializing++;
      try {
        await session.server.connect(session.transport);
        const response = await session.transport.handleRequest(request);
        const id = session.transport.sessionId;
        if (id && !stopped) sessions.set(id, session);
        else await session.server.close();
        return response;
      } catch (cause) {
        await session.server.close();
        throw cause;
      } finally {
        initializing--;
      }
    },
    async close() {
      stopped = true;
      await Promise.allSettled(
        [...sessions.values()].map((session) => session.server.close()),
      );
      sessions.clear();
    },
  };
}
