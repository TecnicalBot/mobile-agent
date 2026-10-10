/**
 * Shared filename helpers. This module imports nothing from the app so it
 * can be used by both workspace-file-service and external-folder-service
 * without creating a require cycle.
 */

export function sanitizeFileName(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    return "untitled.txt";
  }

  const normalized = trimmed
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "untitled.txt";
}

export function inferFileNameFromUrl(url: string) {
  const withoutQuery = url.split(/[?#]/)[0] ?? url;
  const lastSegment = withoutQuery.split("/").filter(Boolean).pop() ?? "";

  if (!lastSegment) {
    return "";
  }

  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

export function inferMimeType(fileName: string) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".json")) {
    return "application/json";
  }

  if (
    lowerName.endsWith(".js") ||
    lowerName.endsWith(".mjs") ||
    lowerName.endsWith(".cjs")
  ) {
    return "application/javascript";
  }

  if (
    lowerName.endsWith(".ts") ||
    lowerName.endsWith(".mts") ||
    lowerName.endsWith(".cts") ||
    lowerName.endsWith(".tsx") ||
    lowerName.endsWith(".jsx")
  ) {
    return "application/typescript";
  }

  if (
    lowerName.endsWith(".css") ||
    lowerName.endsWith(".scss") ||
    lowerName.endsWith(".sass") ||
    lowerName.endsWith(".less")
  ) {
    return "text/css";
  }

  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    return "text/html";
  }

  if (lowerName.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (lowerName.endsWith(".xml")) {
    return "application/xml";
  }

  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
    return "text/markdown";
  }

  if (lowerName.endsWith(".yml") || lowerName.endsWith(".yaml")) {
    return "application/x-yaml";
  }

  if (lowerName.endsWith(".toml")) {
    return "application/toml";
  }

  if (lowerName.endsWith(".sql")) {
    return "application/sql";
  }

  if (lowerName.endsWith(".csv") || lowerName.endsWith(".tsv")) {
    return "text/csv";
  }

  if (
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".log") ||
    lowerName.endsWith(".env") ||
    lowerName.endsWith(".sh") ||
    lowerName.endsWith(".py") ||
    lowerName.endsWith(".ini") ||
    lowerName.endsWith(".conf")
  ) {
    return "text/plain";
  }

  return "application/octet-stream";
}
