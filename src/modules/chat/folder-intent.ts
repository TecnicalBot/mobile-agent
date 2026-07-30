export type FolderIntentMatch = {
  hintedFolderName: string | null;
  requiresFolderAccess: boolean;
};

const FOLDER_TARGET_PATTERN =
  /\b(?:go to|open|browse|list|show|put|save|write|create|generate|make)\b[\s\S]{0,120}\b(?:downloads?|documents?|folder)\b/i;
const NAMED_FOLDER_PATTERN =
  /\b(?:my\s+)?([a-z0-9][a-z0-9 _-]{0,40})\s+folder\b/i;
const COMMON_FOLDER_PATTERN = /\b(downloads?|documents?)\b/i;

export function detectFolderIntent(prompt: string): FolderIntentMatch {
  const normalized = prompt.trim();

  if (!normalized) {
    return {
      hintedFolderName: null,
      requiresFolderAccess: false,
    };
  }

  const requiresFolderAccess = FOLDER_TARGET_PATTERN.test(normalized);
  const commonMatch = normalized.match(COMMON_FOLDER_PATTERN);
  const namedMatch = normalized.match(NAMED_FOLDER_PATTERN);
  const hintedFolderName =
    commonMatch?.[0] ?? namedMatch?.[1]?.trim() ?? null;

  return {
    hintedFolderName,
    requiresFolderAccess,
  };
}
