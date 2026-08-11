const DEFAULT_MAX_LINE_LENGTH = 500;

export type GrepLineMatch = {
  content: string | null;
  line: number;
};

export type GrepMatch = GrepLineMatch & {
  path: string;
};

export function matchTextLines(input: {
  content: string;
  includeContent?: boolean;
  maxLineLength?: number;
  query: string;
}): GrepLineMatch[] {
  const query = input.query.trim().toLowerCase();

  if (!query) {
    return [];
  }

  const maxLineLength = input.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  const lines = input.content.split("\n");
  const matches: GrepLineMatch[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].toLowerCase().includes(query)) {
      continue;
    }

    matches.push({
      content: input.includeContent
        ? lines[index].trim().slice(0, maxLineLength)
        : null,
      line: index + 1,
    });
  }

  return matches;
}

export function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/__DOUBLE_STAR__/g, ".*");

  return new RegExp(`^${source}$`, "i");
}

export function matchesGlob(relativePath: string, patterns?: string[]) {
  if (!patterns || patterns.length === 0) {
    return true;
  }

  const normalized = relativePath.replace(/^\/+/, "");

  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function scanFilesForQuery(input: {
  files: { fileId?: string; path: string }[];
  includeContent?: boolean;
  limit: number;
  maxCharsPerFile?: number;
  maxLineLength?: number;
  query: string;
  readTextFile: (path: string) => Promise<string>;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const query = input.query.trim().toLowerCase();

  if (!query) {
    return Promise.resolve({ matches: [], truncated: false });
  }

  const maxCharsPerFile = input.maxCharsPerFile ?? 20_000;
  const matches: GrepMatch[] = [];

  return (async () => {
    for (const file of input.files) {
      if (matches.length >= input.limit) {
        break;
      }

      let text: string;

      try {
        text = await input.readTextFile(file.path);
      } catch {
        continue;
      }

      const lineMatches = matchTextLines({
        content: text.slice(0, maxCharsPerFile),
        includeContent: input.includeContent,
        maxLineLength: input.maxLineLength,
        query,
      });

      for (const lineMatch of lineMatches) {
        matches.push({
          content: lineMatch.content,
          line: lineMatch.line,
          path: file.path,
        });

        if (input.limit > 0 && matches.length >= input.limit) {
          break;
        }
      }
    }

    return {
      matches,
      truncated: matches.length >= input.limit,
    };
  })();
}

export function formatGrepMatches(
  matches: GrepMatch[],
  includeContent?: boolean,
) {
  if (matches.length === 0) {
    return "No matches found.";
  }

  const lines = matches.map((match) => {
    const location = `${match.path}:${match.line}`;

    if (!includeContent || match.content === null) {
      return location;
    }

    return `${location}: ${match.content}`;
  });

  return lines.join("\n");
}

export function formatGlobFiles(paths: string[]) {
  if (paths.length === 0) {
    return "No files found";
  }

  return paths.join("\n");
}
