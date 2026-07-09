import type { WorkspaceRepository } from "@/lib/db/database";
import { createFileSelectionPrompt } from "@/lib/tools/built-in/shared";
import { isTextWorkspaceFile, createWorkspaceFileService } from "@/lib/workspace/workspace-file-service";

export async function buildWorkspaceSystemPrompt(input: {
  repository: WorkspaceRepository;
  selectedFileIds: string[];
}) {
  const files = await input.repository.list();
  const selectedFiles = files.filter((file) =>
    input.selectedFileIds.includes(file.id),
  );

  return [
    "You are a mobile workspace assistant.",
    "Only operate on files using the provided tools.",
    "Do not invent file contents or pretend a file changed unless a tool confirmed it.",
    selectedFiles.length > 0
      ? `The user selected these files for the current turn: ${selectedFiles
          .map((file) => `${file.displayName} (${file.id})`)
          .join(", ")}.`
      : "The user did not preselect files for this turn.",
    createFileSelectionPrompt(files, input.selectedFileIds),
  ].join("\n\n");
}

export async function buildSelectedFilesInlineContext(input: {
  repository: WorkspaceRepository;
  selectedFileIds: string[];
}) {
  const workspaceService = createWorkspaceFileService(input.repository);
  const selectedFiles = await input.repository.getByIds(input.selectedFileIds);

  if (selectedFiles.length === 0) {
    return [
      "The user intended to share files, but no selected workspace files were found.",
      "Answer normally and mention that no file content was available.",
    ].join("\n\n");
  }

  const sections: string[] = [
    "The user selected workspace files for this turn.",
    "Use the following file contents as trusted context.",
    "If a file is binary or unreadable as text, do not invent its contents.",
  ];

  let remainingBudget = 12000;

  for (const file of selectedFiles) {
    if (remainingBudget <= 0) {
      sections.push(
        "Additional selected files were omitted because the inline context budget was reached.",
      );
      break;
    }

    if (!isTextWorkspaceFile(file)) {
      sections.push(
        `File: ${file.displayName} (${file.id})\nThis file is binary or non-text and could not be inlined.`,
      );
      continue;
    }

    try {
      const text = await workspaceService.readTextFile(file);
      const sliceLength = Math.min(remainingBudget, 6000);
      const excerpt = text.slice(0, sliceLength);
      remainingBudget -= excerpt.length;

      sections.push(
        [
          `File: ${file.displayName} (${file.id})`,
          "Content:",
          "```",
          excerpt,
          text.length > excerpt.length ? "\n[truncated]" : "",
          "```",
        ].join("\n"),
      );
    } catch (error) {
      sections.push(
        `File: ${file.displayName} (${file.id})\nThe file could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return sections.join("\n\n");
}
