#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/**
 * Release notes are grouped by `## Heading` sections. When an OTA or a manual
 * re-publish updates an existing GitHub release, new bullets are appended under
 * the matching heading instead of replacing the whole body. New headings are
 * added at the end, and bullets that are already present are ignored so the
 * workflow can run repeatedly without duplicating notes.
 */

/** @typedef {{ level: number; heading: string; lines: string[] }} Section */

function normalizeHeading(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;

  return lines.slice(start, end);
}

function collapseBlankLines(lines) {
  const output = [];

  for (const line of lines) {
    if (line.trim() === "") {
      if (output.length > 0 && output[output.length - 1] !== "") {
        output.push("");
      }
      continue;
    }

    output.push(line);
  }

  while (output.length > 0 && output[output.length - 1] === "") {
    output.pop();
  }

  return output;
}

export function parseReleaseNotes(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const preamble = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);

    if (match) {
      current = {
        heading: match[2].trim(),
        level: match[1].length,
        lines: [],
      };
      sections.push(current);
      continue;
    }

    (current ? current.lines : preamble).push(line);
  }

  return {
    preamble: trimBlankLines(preamble),
    sections: sections.map((section) => ({
      ...section,
      lines: trimBlankLines(section.lines),
    })),
  };
}

function appendUniqueLines(target, incoming) {
  const seen = new Set(
    target.filter((line) => line.trim() !== "").map((line) => line.trim()),
  );

  for (const line of incoming) {
    const key = line.trim();
    if (key === "" || seen.has(key)) continue;

    seen.add(key);
    target.push(line);
  }
}

function renderReleaseNotes({ preamble, sections }) {
  const blocks = [];
  const cleanedPreamble = collapseBlankLines(preamble);

  if (cleanedPreamble.length > 0) {
    blocks.push(cleanedPreamble.join("\n"));
  }

  for (const section of sections) {
    const lines = collapseBlankLines(section.lines);
    const heading = `${"#".repeat(section.level)} ${section.heading}`;

    blocks.push(lines.length > 0 ? `${heading}\n\n${lines.join("\n")}` : heading);
  }

  return `${blocks.join("\n\n").trim()}\n`;
}

export function mergeReleaseNotes(existingMarkdown, incomingMarkdown) {
  const existing = parseReleaseNotes(existingMarkdown);
  const incoming = parseReleaseNotes(incomingMarkdown);

  if (existing.sections.length === 0) {
    return renderReleaseNotes(incoming);
  }

  const sections = existing.sections.map((section) => ({
    ...section,
    lines: [...section.lines],
  }));
  const sectionsByHeading = new Map();

  for (const section of sections) {
    const key = normalizeHeading(section.heading);
    if (!sectionsByHeading.has(key)) {
      sectionsByHeading.set(key, section);
    }
  }

  for (const incomingSection of incoming.sections) {
    const key = normalizeHeading(incomingSection.heading);
    let target = sectionsByHeading.get(key);

    if (!target) {
      target = {
        heading: incomingSection.heading,
        level: incomingSection.level,
        lines: [],
      };
      sections.push(target);
      sectionsByHeading.set(key, target);
    }

    appendUniqueLines(target.lines, incomingSection.lines);
    target.lines = collapseBlankLines(target.lines);
  }

  return renderReleaseNotes({
    preamble:
      existing.preamble.length > 0 ? existing.preamble : incoming.preamble,
    sections,
  });
}

async function main() {
  const [incomingPath, existingPath, outputPath] = process.argv.slice(2);

  if (!incomingPath || !outputPath) {
    console.error(
      "Usage: node scripts/merge-release-notes.mjs <incoming> [existing] <output>",
    );
    process.exitCode = 1;
    return;
  }

  const incoming = await readFile(incomingPath, "utf8");
  const existing = existingPath
    ? await readFile(existingPath, "utf8")
    : "";

  await writeFile(outputPath, mergeReleaseNotes(existing, incoming), "utf8");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
