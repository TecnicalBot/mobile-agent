#!/usr/bin/env node
/**
 * Verifies the on-device model catalog against the files currently published
 * on Hugging Face.
 *
 * A stale `sizeBytes` or `sha256` makes a perfectly healthy download fail the
 * worker's size/integrity checks, so the app can appear to hang part-way
 * through (a wrong size shows up as an arbitrary percentage, usually ~85%).
 * Run this in CI whenever catalog/on-device-models.json changes.
 *
 *   node scripts/verify-model-catalog.mjs
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, "catalog", "on-device-models.json");
const REQUEST_TIMEOUT_MS = 20_000;

function parseDownloadUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new Error("downloadUrl must use HTTPS");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  // /<org>/<repo>/resolve/<revision>/<path/to/file>
  if (parts.length < 4 || parts[2] !== "resolve") {
    throw new Error("downloadUrl is not a Hugging Face resolve URL");
  }

  return {
    org: parts[0],
    repo: parts[1],
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

async function verifyModel(model, cache) {
  const { org, repo, file } = parseDownloadUrl(model.downloadUrl);
  const repoId = `${org}/${repo}`;

  if (!cache.has(repoId)) {
    cache.set(repoId, fetchJson(`https://huggingface.co/api/models/${repoId}/tree/main`));
  }

  const entries = await cache.get(repoId);
  const entry = entries.find((candidate) => candidate.path === file);

  if (!entry) {
    return [`${model.id}: ${file} is not present in ${repoId}`];
  }

  const actualSize = entry.lfs?.size ?? entry.size;
  const actualSha = entry.lfs?.oid ?? null;
  const problems = [];

  if (actualSize !== model.sizeBytes) {
    problems.push(
      `${model.id}: sizeBytes is ${model.sizeBytes}, upstream is ${actualSize}`,
    );
  }

  if (actualSha && actualSha !== model.sha256) {
    problems.push(
      `${model.id}: sha256 is ${model.sha256}, upstream is ${actualSha}`,
    );
  }

  return problems;
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

  if (!Array.isArray(catalog.models)) {
    throw new Error("catalog.models must be an array");
  }

  const cache = new Map();
  const results = await Promise.allSettled(
    catalog.models.map((model) => verifyModel(model, cache)),
  );

  const problems = [];

  for (const [index, result] of results.entries()) {
    const model = catalog.models[index];

    if (result.status === "rejected") {
      problems.push(
        `${model.id}: could not verify (${result.reason?.message ?? result.reason})`,
      );
      continue;
    }

    problems.push(...result.value);
  }

  if (problems.length > 0) {
    console.error("On-device model catalog is stale:\n");
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    console.error(
      "\nUpdate catalog/on-device-models.json from the upstream file metadata.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Verified ${catalog.models.length} on-device model entries.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
