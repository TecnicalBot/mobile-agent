import { describe, expect, it } from "vitest";

import { mergeReleaseNotes } from "./merge-release-notes.mjs";

describe("mergeReleaseNotes", () => {
  it("appends new items under matching sections and adds new sections", () => {
    const existing = `## What's new

- Old feature

## Fixes

- Old fix
`;
    const incoming = `## What's new

- New feature

## Improvements

- Faster

## Fixes

- New fix
- Old fix
`;

    expect(mergeReleaseNotes(existing, incoming)).toBe(
      `## What's new

- Old feature
- New feature

## Fixes

- Old fix
- New fix

## Improvements

- Faster
`,
    );
  });

  it("is idempotent when the same notes are published twice", () => {
    const existing = `## What's new

- Old feature
`;
    const incoming = `## What's new

- New feature

## Fixes

- New fix
`;
    const first = mergeReleaseNotes(existing, incoming);

    expect(mergeReleaseNotes(first, incoming)).toBe(first);
  });

  it("uses the incoming notes when there is no existing release body", () => {
    const incoming = `## What's new

- New feature

## Fixes

- New fix
`;

    expect(mergeReleaseNotes("", incoming)).toBe(incoming);
  });

  it("matches headings case-insensitively and ignores curly apostrophes", () => {
    const existing = `## What’s new

- Old feature
`;
    const incoming = `## What's new

- New feature
`;

    expect(mergeReleaseNotes(existing, incoming)).toBe(
      `## What’s new

- Old feature
- New feature
`,
    );
  });
});
