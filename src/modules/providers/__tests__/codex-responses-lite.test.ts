import { describe, expect, it } from "vitest";

import {
  CODEX_COMPATIBILITY_VERSION,
  CODEX_RESPONSES_LITE_HEADER,
  CODEX_SESSION_AFFINITY_HEADER,
  applyCodexResponsesLiteHeaders,
  isCodexResponsesLiteModel,
  prepareCodexResponsesLiteBody,
} from "@/modules/providers/codex-responses-lite";
import { prepareCodexRequestBody } from "@/modules/providers/codex-request";

const userInput = {
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: "hello" }],
};

const searchTool = {
  type: "function",
  name: "search",
  parameters: { type: "object", properties: {} },
};

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "gpt-5.6-luna",
    instructions: "You are a coding agent.",
    input: [userInput],
    tools: [searchTool],
    tool_choice: "required",
    parallel_tool_calls: true,
    reasoning: { effort: "high", summary: "auto" },
    store: false,
    ...overrides,
  };
}

describe("isCodexResponsesLiteModel", () => {
  it("matches the GPT-5.6 and GPT-6 families", () => {
    for (const model of [
      "gpt-5.6",
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna-fast",
      "gpt-6",
      "gpt-6-luna",
      "gpt-6-sol",
      "gpt-6.1-sol",
      "gpt-6.2-astra",
    ]) {
      expect(isCodexResponsesLiteModel(model)).toBe(true);
    }
  });

  it("leaves the standard Responses models alone", () => {
    for (const model of [
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
      "gpt-5.6x",
      "gpt-60",
      "o3",
    ]) {
      expect(isCodexResponsesLiteModel(model)).toBe(false);
    }
  });
});

describe("prepareCodexResponsesLiteBody", () => {
  it("moves tools and instructions into developer input items", () => {
    const lite = prepareCodexResponsesLiteBody(buildBody(), "run-1");

    expect(lite).not.toBeNull();
    expect(lite).not.toHaveProperty("tools");
    expect(lite).not.toHaveProperty("instructions");
    expect(lite?.input).toEqual([
      { type: "additional_tools", role: "developer", tools: [searchTool] },
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "You are a coding agent." }],
      },
      userInput,
    ]);
  });

  it("forces the Lite tool and reasoning defaults", () => {
    const lite = prepareCodexResponsesLiteBody(buildBody(), "run-1") ?? {};

    expect(lite.tool_choice).toBe("auto");
    expect(lite.parallel_tool_calls).toBe(false);
    expect(lite.reasoning).toEqual({
      effort: "high",
      summary: "auto",
      context: "all_turns",
    });
    expect(lite.prompt_cache_key).toBe("run-1");
    // Unrelated standard-Responses fields survive the rewrite.
    expect(lite.store).toBe(false);
    expect(lite.model).toBe("gpt-5.6-luna");
  });

  it("drops sampling knobs and stale cache keys", () => {
    const lite = prepareCodexResponsesLiteBody(
      buildBody({ temperature: 0.4, top_p: 0.9, prompt_cache_key: "stale" }),
      null,
    );

    expect(lite).not.toHaveProperty("temperature");
    expect(lite).not.toHaveProperty("top_p");
    expect(lite).not.toHaveProperty("prompt_cache_key");
  });

  it("keeps an empty additional_tools item when there are no tools", () => {
    const lite = prepareCodexResponsesLiteBody(
      buildBody({ tools: undefined, instructions: undefined }),
      "run-1",
    );

    expect(lite?.input).toEqual([
      { type: "additional_tools", role: "developer", tools: [] },
      userInput,
    ]);
  });

  it("rewrites system input items to developer items", () => {
    const lite = prepareCodexResponsesLiteBody(
      buildBody({
        instructions: undefined,
        input: [
          { type: "message", role: "system", content: "compacted summary" },
          userInput,
        ],
      }),
      "run-1",
    );

    expect(lite?.input).toEqual([
      { type: "additional_tools", role: "developer", tools: [searchTool] },
      { type: "message", role: "developer", content: "compacted summary" },
      userInput,
    ]);
  });

  it("strips image detail, which the Lite contract does not accept", () => {
    const lite = prepareCodexResponsesLiteBody(
      buildBody({
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_image",
                image_url: "https://example.com/a.png",
                detail: "high",
              },
            ],
          },
        ],
      }),
      "run-1",
    );

    const input = lite?.input as { content: unknown[] }[];

    expect(input.at(-1)?.content).toEqual([
      { type: "input_image", image_url: "https://example.com/a.png" },
    ]);
  });

  it("declines bodies it cannot reshape", () => {
    expect(prepareCodexResponsesLiteBody({ input: "hello" }, "run-1")).toBeNull();
  });
});

describe("prepareCodexRequestBody", () => {
  it("keeps standard Responses models on the top-level instructions path", () => {
    const { body, responsesLite } = prepareCodexRequestBody(
      {
        model: "gpt-5.5",
        instructions: "You are a coding agent.",
        max_output_tokens: 2048,
        input: [userInput],
        tools: [searchTool],
        store: true,
      },
      "run-1",
    );

    expect(responsesLite).toBe(false);
    expect(body.instructions).toBe("You are a coding agent.");
    expect(body.tools).toEqual([searchTool]);
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body.store).toBe(false);
  });

  it("routes GPT-5.6 and GPT-6 models through the Lite rewrite", () => {
    for (const model of ["gpt-5.6-luna", "gpt-6-luna", "gpt-6-sol"]) {
      const { body, responsesLite } = prepareCodexRequestBody(
        buildBody({ model }),
        "run-1",
      );

      expect(responsesLite).toBe(true);
      expect(body).not.toHaveProperty("instructions");
      expect(body).not.toHaveProperty("tools");
      expect(body.store).toBe(false);
    }
  });

  it("falls back to the standard shape for unshapeable Lite bodies", () => {
    const { body, responsesLite } = prepareCodexRequestBody(
      { model: "gpt-5.6-luna", instructions: "hi", input: "hi" },
      "run-1",
    );

    expect(responsesLite).toBe(false);
    expect(body.instructions).toBe("hi");
  });
});

describe("applyCodexResponsesLiteHeaders", () => {
  it("marks the request and pins the session", () => {
    const headers = new Headers({
      "content-length": "512",
      "session-id": "run-1",
    });

    applyCodexResponsesLiteHeaders(headers, "run-1");

    expect(headers.get(CODEX_RESPONSES_LITE_HEADER)).toBe("true");
    expect(headers.get("version")).toBe(CODEX_COMPATIBILITY_VERSION);
    expect(headers.get(CODEX_SESSION_AFFINITY_HEADER)).toBe("run-1");
    expect(headers.get("content-length")).toBeNull();
  });

  it("skips affinity headers when the run has no session id", () => {
    const headers = new Headers();

    applyCodexResponsesLiteHeaders(headers, null);

    expect(headers.get(CODEX_RESPONSES_LITE_HEADER)).toBe("true");
    expect(headers.get(CODEX_SESSION_AFFINITY_HEADER)).toBeNull();
  });
});
