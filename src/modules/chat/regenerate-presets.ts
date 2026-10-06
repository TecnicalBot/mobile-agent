import { Directory, File, Paths } from "expo-file-system";

export type RegeneratePreset = {
  id: string;
  label: string;
  instruction: string;
  custom?: boolean;
};

export const DEFAULT_REGENERATE_PRESETS: RegeneratePreset[] = [
  {
    id: "professional",
    label: "Write professionally",
    instruction:
      "Rewrite your previous response in a more professional tone.",
  },
  {
    id: "shorten",
    label: "Shorten",
    instruction:
      "Rewrite your previous response in a shorter, more concise form.",
  },
  {
    id: "shorter-bullets",
    label: "Convert to bullet points",
    instruction:
      "Rewrite your previous response as a concise bullet-point list.",
  },
  {
    id: "expand",
    label: "Expand",
    instruction:
      "Expand your previous response with more detail and examples.",
  },
  {
    id: "simplify",
    label: "Simplify",
    instruction:
      "Rewrite your previous response in simpler, easier-to-understand language.",
  },
  {
    id: "casual",
    label: "Make it casual",
    instruction: "Rewrite your previous response in a more casual, friendly tone.",
  },
  {
    id: "fix-grammar",
    label: "Fix grammar & clarity",
    instruction:
      "Rewrite your previous response with corrected grammar and improved clarity.",
  },
];

const PRESETS_FILE = "regenerate-presets.json";

function getDirectory() {
  return new Directory(Paths.document, "mobile-agent");
}

function getFile() {
  return new File(getDirectory(), PRESETS_FILE);
}

export async function loadCustomPresets(): Promise<RegeneratePreset[]> {
  try {
    const file = getFile();

    if (!file.exists) {
      return [];
    }

    const parsed = JSON.parse(await file.text());

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is { id?: unknown; label?: unknown; instruction?: unknown } =>
          typeof item === "object" && item !== null,
      )
      .filter(
        (item) =>
          typeof item.label === "string" &&
          item.label.trim().length > 0 &&
          typeof item.instruction === "string" &&
          item.instruction.trim().length > 0,
      )
      .map((item, index) => ({
        id:
          typeof item.id === "string" && item.id
            ? item.id
            : `custom-${index}`,
        label: item.label as string,
        instruction: item.instruction as string,
        custom: true,
      }));
  } catch {
    return [];
  }
}

export async function saveCustomPresets(
  presets: RegeneratePreset[],
): Promise<void> {
  const directory = getDirectory();

  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }

  const file = getFile();

  if (!file.exists) {
    file.create({ intermediates: true, overwrite: false });
  }

  file.write(JSON.stringify(presets, null, 2));
}
