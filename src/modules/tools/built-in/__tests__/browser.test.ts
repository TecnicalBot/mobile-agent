import { beforeEach, describe, expect, it, vi } from "vitest";
import { asSchema, type JSONSchema7 } from "ai";

const mocks = vi.hoisted(() => ({
  createDocumentFileFromFile: vi.fn(),
  requestBrowserCommand: vi.fn(),
  hasBrowserHost: vi.fn(),
  onRecord: vi.fn(),
}));

vi.mock("@/core/services/workspace-file-service", () => ({
  createWorkspaceFileService: () => ({
    createDocumentFileFromFile: mocks.createDocumentFileFromFile,
  }),
  resolveWorkspaceFile: (relativePath: string) => ({
    uri: `file:///workspace/${relativePath}`,
  }),
}));

vi.mock("@/modules/preview/browser-session", () => ({
  hasBrowserHost: mocks.hasBrowserHost,
  requestBrowserCommand: mocks.requestBrowserCommand,
  BROWSER_MAX_SLICES: 8,
}));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
  },
}));

const { createBrowserTool } = await import("@/modules/tools/built-in/browser");

function makeTool() {
  return createBrowserTool({
    repository: {} as never,
    onRecord: mocks.onRecord,
  });
}

async function execute(tool: ReturnType<typeof makeTool>, input: object) {
  const def = tool as unknown as {
    execute: (input: object, opts: object) => Promise<unknown>;
  };
  return def.execute(input, {});
}

describe("browser tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasBrowserHost.mockReturnValue(true);
    mocks.createDocumentFileFromFile.mockImplementation(async ({ name }) => ({
      id: `shot-${name.replace(/[^a-z0-9]/gi, "-")}`,
      displayName: name,
      size: 4321,
      relativePath: `shots/${name}`,
    }));
  });

  it("exposes an object input schema with a top-level type", () => {
    const schema = asSchema(makeTool().inputSchema).jsonSchema as JSONSchema7;

    expect(schema).toMatchObject({ type: "object" });
    expect(schema.oneOf).toBeUndefined();
    expect(
      (schema.properties as Record<string, { enum?: string[] }>).action.enum,
    ).toEqual([
      "navigate",
      "back",
      "reload",
      "read",
      "scroll",
      "click",
      "type",
      "screenshot",
    ]);
  });

  it("navigates and reports the landed URL and title", async () => {
    mocks.requestBrowserCommand.mockResolvedValue({
      kind: "navigate",
      url: "https://example.com/",
      title: "Example",
    });

    const out = (await execute(makeTool(), { action: "navigate", url: "https://example.com" })) as Record<string, unknown>;

    expect(mocks.requestBrowserCommand).toHaveBeenCalledWith({
      command: { kind: "navigate", url: "https://example.com/" },
      signal: undefined,
    });
    expect(out).toMatchObject({
      action: "navigate",
      url: "https://example.com/",
      title: "Example",
    });
  });

  it("persists a viewport screenshot and returns a workspace link", async () => {
    mocks.requestBrowserCommand.mockResolvedValue({
      kind: "screenshot",
      fullPage: false,
      pageHeight: 800,
      truncated: false,
      shots: [{ uri: "file:///cache/shot.png", top: 0 }],
      overview: null,
    });

    const out = (await execute(makeTool(), { action: "screenshot" })) as Record<string, unknown>;

    expect(mocks.createDocumentFileFromFile).toHaveBeenCalledWith({
      source: expect.objectContaining({ uri: "file:///cache/shot.png" }),
      mimeType: "image/png",
      name: expect.stringMatching(/^browse-\d+-1\.png$/),
    });
    expect((out.viewport as Record<string, unknown>).link).toMatch(/^workspace:\/\/shot-browse-\d+-1-png$/);    expect(out.slices).toBeUndefined();
  });

  it("full-page screenshots persist the overview and every slice", async () => {
    mocks.requestBrowserCommand.mockResolvedValue({
      kind: "screenshot",
      fullPage: true,
      pageHeight: 3200,
      truncated: false,
      shots: [
        { uri: "file:///cache/s1.png", top: 0 },
        { uri: "file:///cache/s2.png", top: 800 },
      ],
      overview: { uri: "file:///cache/ov.png", truncated: false },
    });

    const out = (await execute(makeTool(), { action: "screenshot", fullPage: true })) as Record<string, unknown>;

    const overloaded = mocks.createDocumentFileFromFile.mock.calls.length;
    expect(overloaded).toBe(3);
    expect((out.overview as Record<string, unknown>).link).toBeTypeOf("string");
    expect((out as { slices: unknown[] }).slices).toHaveLength(2);
    expect(out.viewport).toBeUndefined();
  });

  it("passes the host's truncation note through to the agent", async () => {    mocks.requestBrowserCommand.mockResolvedValue({
      kind: "screenshot",
      fullPage: true,
      pageHeight: 6400,
      truncated: true,
      shots: [{ uri: "file:///cache/s1.png", top: 0 }],
      overview: { uri: "file:///cache/ov.png", truncated: false },
      note: "Captured 1 of 8 slices before the time budget ran out.",
    });

    const out = (await execute(makeTool(), { action: "screenshot", fullPage: true })) as Record<string, unknown>;

    expect(out.note).toBe("Captured 1 of 8 slices before the time budget ran out.");
  });

  it("records the capture as the tool's preview", async () => {
    mocks.requestBrowserCommand.mockResolvedValue({
      kind: "screenshot",
      fullPage: false,
      pageHeight: 800,
      truncated: false,
      shots: [{ uri: "file:///cache/shot.png", top: 0 }],
      overview: null,
    });

    await execute(makeTool(), { action: "screenshot" });

    const record = mocks.onRecord.mock.calls.at(-1)?.[0] as {
      preview?: { uri?: string; mimeType?: string; title?: string };
    };
    expect(record.preview?.uri).toMatch(
      /^file:\/\/\/workspace\/shots\/browse-\d+-1\.png$/,
    );
    expect(record.preview?.mimeType).toBe("image/png");
  });

  it.each([
    { action: "navigate", url: "http://localhost:3000/" },
    { action: "navigate", url: "http://127.0.0.1/" },
    { action: "navigate", url: "ftp://example.com/x" },
  ])("blocks private and non-http URLs: %j", async (input) => {
    await expect(execute(makeTool(), input)).rejects.toThrow();
    expect(mocks.requestBrowserCommand).not.toHaveBeenCalled();
  });

  it("reaches read for JS-rendered page text", async () => {
    mocks.requestBrowserCommand.mockResolvedValue({
      kind: "read",
      url: "https://example.com/",
      title: "Example",
      text: "hello",
      links: [{ href: "https://example.com/a", text: "A" }],
    });

    const out = (await execute(makeTool(), { action: "read" })) as Record<string, unknown>;

    expect(mocks.requestBrowserCommand).toHaveBeenCalledWith({
      command: { kind: "read" },
      signal: undefined,
    });
    expect(out).toMatchObject({ text: "hello", links: [{ href: "https://example.com/a", text: "A" }] });
  });

  it("routes click and type through the session", async () => {
    mocks.requestBrowserCommand.mockResolvedValue({
      kind: "click",
      url: "https://example.com/",
      title: "Example",
      heading: null,
    });

    await execute(makeTool(), { action: "click", selector: "text=Sign in" });

    expect(mocks.requestBrowserCommand).toHaveBeenCalledWith({
      command: { kind: "click", selector: "text=Sign in" },
      signal: undefined,
    });

    await execute(makeTool(), { action: "type", selector: "input#q", text: "hi", submit: true });

    expect(mocks.requestBrowserCommand).toHaveBeenLastCalledWith({
      command: { kind: "type", selector: "input#q", text: "hi", submit: true },
      signal: undefined,
    });
  });

  it("fails fast with no host", async () => {
    mocks.hasBrowserHost.mockReturnValue(false);
    await expect(execute(makeTool(), { action: "navigate", url: "https://example.com" })).rejects.toThrow(
      /Android/,
    );
    expect(mocks.requestBrowserCommand).not.toHaveBeenCalled();
  });

  it("guards command inputs before reaching the session", async () => {
    await expect(execute(makeTool(), { action: "click" })).rejects.toThrow(/needs a selector/);
    expect(mocks.requestBrowserCommand).not.toHaveBeenCalled();

    await expect(execute(makeTool(), { action: "type", selector: "#q" })).rejects.toThrow(
      /needs text/,
    );
    expect(mocks.requestBrowserCommand).not.toHaveBeenCalled();
  });
});
