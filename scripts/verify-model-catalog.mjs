#!/usr/bin/env node
/**
 * Verifies the downloadable model catalogs against the files currently
 * published on Hugging Face.
 *
 * A stale `sizeBytes` or `sha256` makes a perfectly healthy download fail the
 * worker's size/integrity checks, so the app can appear to hang part-way
 * through (a wrong size shows up as an arbitrary percentage, usually ~85%).
 * Run this in CI whenever either catalog changes.
 *
 *   node scripts/verify-model-catalog.mjs
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogs = [
  {
    name: "on-device",
    path: path.join(root, "catalog", "on-device-models.json"),
    toEntry: (model) => ({
      id: model.id,
      sha256: model.sha256,
      sizeBytes: model.sizeBytes,
      url: model.downloadUrl,
    }),
  },
  {
    name: "voice",
    path: path.join(root, "catalog", "voice-models.json"),
    toEntry: (model) => ({
      id: model.id,
      sizeBytes: model.sizeBytes,
      url: model.url,
    }),
  },
];
const REQUEST_TIMEOUT_MS = 20_000;

function parseDownloadUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new Error("download URL must use HTTPS");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  // /<org>/<repo>/resolve/<revision>/<path/to/file>
  if (parts.length < 4 || parts[2] !== "resolve") {
    throw new Error("download URL is not a Hugging Face resolve URL");
  }

  return {
    org: parts[0],
    repo: parts[1],
    // A pinned revision (commit sha, tag or branch) must be verified against
    // that same revision: upstream can re-upload a file on `main` with new
    // weights, while our URL keeps serving the pinned copy.
    revision: parts[3] || "main",
    file: parts.slice(4).join("/"),
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyEntry(entry, cache) {
  const { org, repo, revision, file } = parseDownloadUrl(entry.url);
  const repoId = `${org}/${repo}`;
  const cacheKey = `${repoId}@${revision}`;

  if (!cache.has(cacheKey)) {
    cache.set(
      cacheKey,
      fetchJson(
        `https://huggingface.co/api/models/${repoId}/tree/${encodeURIComponent(revision)}`,
      ),
    );
  }

  const entries = await cache.get(cacheKey);
  const upstream = entries.find((candidate) => candidate.path === file);

  if (!upstream) {
    return [`${entry.id}: ${file} is not present in ${repoId}@${revision}`];
  }

  const actualSize = upstream.lfs?.size ?? upstream.size;
  const actualSha = upstream.lfs?.oid ?? null;
  const problems = [];

  if (actualSize !== entry.sizeBytes) {
    problems.push(
      `${entry.id}: sizeBytes is ${entry.sizeBytes}, upstream is ${actualSize}`,
    );
  }

  if (entry.sha256 && actualSha && actualSha !== entry.sha256) {
    problems.push(
      `${entry.id}: sha256 is ${entry.sha256}, upstream is ${actualSha}`,
    );
  }

  return problems;
}

async function main() {
  const cache = new Map();
  const checks = [];

  for (const catalog of catalogs) {
    const parsed = JSON.parse(await readFile(catalog.path, "utf8"));

    if (!Array.isArray(parsed.models)) {
      throw new Error(`${catalog.name}: catalog.models must be an array`);
    }

    for (const model of parsed.models) {
      checks.push({ catalog: catalog.name, entry: catalog.toEntry(model) });
    }
  }

  const results = await Promise.allSettled(
    checks.map(({ entry }) => verifyEntry(entry, cache)),
  );

  const problems = [];

  for (const [index, result] of results.entries()) {
    const { catalog, entry } = checks[index];

    if (result.status === "rejected") {
      problems.push(
        `${catalog}/${entry.id}: could not verify (${result.reason?.message ?? result.reason})`,
      );
      continue;
    }

    problems.push(...result.value.map((problem) => `${catalog}/${problem}`));
  }

  if (problems.length > 0) {
    console.error("Downloadable model catalogs are stale:\n");
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    console.error(
      "\nUpdate catalog/on-device-models.json or catalog/voice-models.json from the upstream file metadata.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Verified ${checks.length} downloadable model entries.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
