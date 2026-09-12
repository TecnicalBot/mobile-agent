import { describe, expect, it, vi } from "vitest";

import { createSecretRequestTools } from "../secret-request";

function makeRepositories(plugin: { id: string } | null) {
  return {
    pluginRepository: {
      getById: vi.fn(async () => plugin),
    },
  } as never;
}

describe("requestSecret tool", () => {
  it("passes stored answers through without leaking the value", async () => {
    const requestSecret = vi.fn(async () => ({ status: "stored" } as const));
    const { tools } = createSecretRequestTools({
      repositories: makeRepositories({ id: "weather" }),
      requestSecret,
    });

    const result = await tools.requestSecret.execute!(
      { pluginId: "weather", key: "OPENWEATHER_API_KEY" },
      {} as never,
    );

    expect(requestSecret).toHaveBeenCalledWith({
      id: expect.stringMatching(/^secret:/),
      scope: "plugin",
      pluginId: "weather",
      key: "OPENWEATHER_API_KEY",
      purpose: null,
    });
    expect(result).toEqual({ status: "stored", key: "OPENWEATHER_API_KEY" });
  });

  it("passes deferred answers through", async () => {
    const { tools } = createSecretRequestTools({
      repositories: makeRepositories({ id: "weather" }),
      requestSecret: async () => ({ status: "deferred" }),
    });

    const result = await tools.requestSecret.execute!(
      { pluginId: "weather", key: "OPENWEATHER_API_KEY" },
      {} as never,
    );

    expect(result).toEqual({
      status: "deferred",
      key: "OPENWEATHER_API_KEY",
    });
  });

  it("rejects unknown plugin ids without prompting the user", async () => {
    const requestSecret = vi.fn(async () => ({ status: "stored" } as const));
    const { tools } = createSecretRequestTools({
      repositories: makeRepositories(null),
      requestSecret,
    });

    const result = await tools.requestSecret.execute!(
      { pluginId: "missing", key: "SECRET_KEY" },
      {} as never,
    );

    expect(requestSecret).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error" });
    expect((result as { message: string }).message).toContain(
      "No plugin with id",
    );
  });

  it("records tool executions without exposing secret values", async () => {
    const onRecord = vi.fn();
    const { tools } = createSecretRequestTools({
      onRecord,
      repositories: makeRepositories({ id: "weather" }),
      requestSecret: async () => ({ status: "stored" }),
    });

    await tools.requestSecret.execute!(
      { pluginId: "weather", key: "OPENWEATHER_API_KEY" },
      {} as never,
    );

    const record = onRecord.mock.calls[0][0] as {
      inputSummary: string;
      outputSummary: string;
      toolName: string;
    };
    expect(record.toolName).toBe("requestSecret");
    expect(record.inputSummary).toContain("weather");
    expect(record.outputSummary).toContain("stored");
    expect(record.outputSummary).not.toContain("OPENWEATHER_API_KEY");
  });

  it("rejects invalid keys at the schema level", async () => {
    const { tools } = createSecretRequestTools({
      repositories: makeRepositories({ id: "weather" }),
      requestSecret: async () => ({ status: "stored" }),
    });

    const parsed = (
      tools.requestSecret.inputSchema as unknown as {
        safeParse: (input: unknown) => { success: boolean };
      }
    ).safeParse({
      pluginId: "weather",
      key: "bad key with spaces",
    });

    expect(parsed.success).toBe(false);
  });
});