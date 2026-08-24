export const DEFAULT_AGENT_SYSTEM_PROMPT_PLACEHOLDER =
  "Empty uses the default system prompt. Describe how this agent should behave, its tone, and any workflow rules.";

export type GeneratedAgentDraft = {
  description: string | null;
  name: string | null;
  systemPrompt: string | null;
};

const RESERVED_NAMES = ["build", "plan", "general", "task", "title", "summary"];

export function buildAgentGeneratePrompt(input: {
  description: string;
  existingNames: string[];
  hasPrompt: boolean;
}) {
  return [
    `Create an agent configuration based on this request: "${input.description}".`,
    input.hasPrompt
      ? "Keep the existing name and description unless they clearly conflict with the request."
      : "",
    `IMPORTANT: The following identifiers already exist and must NOT be used: ${
      input.existingNames.length > 0
        ? input.existingNames.join(", ")
        : "(none)"
    }. Also avoid these reserved identifiers: ${RESERVED_NAMES.join(", ")}.`,
    'Return ONLY a JSON object with exactly these keys: {"name": kebab-case-identifier, "description": one sentence describing when to use the agent, "systemPrompt": full markdown system prompt for the agent}. No other text, do not wrap in backticks.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractJsonCandidate(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("The model returned an empty response.");
  }

  if (!trimmed.includes("{")) {
    throw new Error(
      "The model response did not contain JSON. Try generating again.",
    );
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (end <= start) {
    throw new Error("The model response contained incomplete JSON.");
  }

  return trimmed.slice(start, end + 1);
}

export function parseAgentJsonDraft(text: string): GeneratedAgentDraft {
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJsonCandidate(text));
  } catch {
    throw new Error("Could not parse the generated agent as JSON.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The generated agent was not a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const readString = (key: string) => {
    const value = record[key];

    return typeof value === "string" && value.trim()
      ? value.trim()
      : null;
  };

  return {
    description: readString("description"),
    name: readString("name") ?? readString("identifier"),
    systemPrompt: readString("systemPrompt"),
  };
}
