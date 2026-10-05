export type FolderIntentMatch = {
  hintedFolderName: string | null;
  requiresFolderAccess: boolean;
};

const EXPLICIT_FOLDER_ACCESS_PATTERN =
  /\b(?:use|select|grant|open|pick|access|choose|set)\b[\s\S]{0,80}\b(?:external folder|device folder|folder session|documents? folder|downloads? folder)\b/i;
const PATH_FOLDER_PATTERN =
  /\b(?:\/storage\/|\/sdcard\/|\/mnt\/|content:\/\/)[\s\S]{0,120}\b(?:documents?|downloads?|folder)\b/i;
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

  const requiresFolderAccess =
    EXPLICIT_FOLDER_ACCESS_PATTERN.test(normalized) ||
    PATH_FOLDER_PATTERN.test(normalized);
  const commonMatch = normalized.match(COMMON_FOLDER_PATTERN);
  const namedMatch = normalized.match(NAMED_FOLDER_PATTERN);
  const hintedFolderName =
    commonMatch?.[0] ?? namedMatch?.[1]?.trim() ?? null;

  return {
    hintedFolderName,
    requiresFolderAccess,
  };
}
