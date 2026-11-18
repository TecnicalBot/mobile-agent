import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";

/** Hard ceiling on extracted text returned to the model per call. */
const MAX_CHARS = 50_000;
const DEFAULT_MAX_CHARS = 12_000;
/** Never read more raw HTML than this (content-length gate + slice). */
const MAX_RAW_BYTES = 3_000_000;
const FETCH_TIMEOUT_MS = 20_000;

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host === "instance-data" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".internal.")
  ) {
    return true;
  }
  // Literal IPv4: block loopback, private, link-local, CGNAT, unspecified.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0) {
      return true;
    }
    return false;
  }
  // Literal IPv6: block loopback, unspecified, link-local, unique-local.
  if (host === "::1" || host === "::" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  return false;
}

export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Could not parse URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs can be fetched (got ${url.protocol}).`);
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error(
      `Blocked host (${url.hostname}): local and private network addresses cannot be fetched.`,
    );
  }
  return url;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => {
      const point = Number(code);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => {
      const point = parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}

/**
 * Dependency-free HTML → readable text. Strips scripts, styles, and markup,
 * keeps headings/paragraphs/list structure as line breaks. Not a full
 * Readability port — tuned for research/Q&A over fragile layout fidelity.
 */
export function extractPageText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]{0,500})<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/\s+/g, " ").trim()) : "";
  let body = html;
  body = body.replace(/<script[\s\S]*?<\/script\s*>/gi, " ");
  body = body.replace(/<style[\s\S]*?<\/style\s*>/gi, " ");
  body = body.replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, " ");
  body = body.replace(/<template[\s\S]*?<\/template\s*>/gi, " ");
  body = body.replace(/<svg[\s\S]*?<\/svg\s*>/gi, " ");
  body = body.replace(/<!--[\s\S]*?-->/g, " ");
  body = body.replace(/<\/(h[1-6]|p|div|section|article|li|tr|blockquote|pre)>/gi, "\n\n");
  body = body.replace(/<(br|li|tr|hr)[\s/][^>]*>/gi, "\n");
  body = body.replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body).replace(/[ \t\f\v]+/g, " ").replace(/\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

type FetchPageOutput = {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
};

/**
 * Fetches a public web page and returns its readable text. For research and
 * Q&A ("what does this page say") — not a browser: no login, no JS-rendered
 * apps, no interaction. SSRF-guarded to public http(s) hosts only (hostname
 * blocklist; residual DNS-rebinding risk documented — no DNS API exists in
 * this runtime to resolve-then-check).
 */
export function createFetchPageTool({
  onRecord,
}: WorkspaceToolFactoryParams) {
  return tool({
    description:
      "Fetch a public web page (http/https) and read its text content. Use for research questions about a URL the user gave or found — returns the page title plus readable text (scripts, styles, and markup stripped). Not a browser: pages behind login, JS-heavy apps, PDFs, and files are out of scope (ask for the content another way). Local/private URLs are blocked.",
    inputSchema: z.object({
      url: z.string().min(1),
      maxChars: z.number().int().min(500).max(MAX_CHARS).optional(),
    }),
    execute: async ({ url, maxChars }: { url: string; maxChars?: number }) => {
      const inputSummary = summarizeValue({ url });
      const limit = maxChars ?? DEFAULT_MAX_CHARS;

      try {
        const target = checkUrl(url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(target.toString(), {
            headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) MobileAgent/1.0" },
            signal: controller.signal,
          });
        } catch (error) {
          throw new Error(
            error instanceof Error && error.name === "AbortError"
              ? `Fetching ${target.hostname} timed out after ${FETCH_TIMEOUT_MS / 1000} s.`
              : `Could not reach ${target.hostname}: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          clearTimeout(timer);
        }

        // Re-validate after redirects (fetch follows them by default).
        try {
          checkUrl(response.url);
        } catch {
          throw new Error("Redirected to a blocked local/private address.");
        }

        if (!response.ok) {
          throw new Error(`The page returned HTTP ${response.status}.`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!/text\/(html|plain)/i.test(contentType) && !/application\/xhtml/i.test(contentType)) {
          throw new Error(
            `Not a readable page (content-type: ${contentType || "unknown"}). Text, HTML, and XHTML only.`,
          );
        }
        const declared = Number(response.headers.get("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > MAX_RAW_BYTES) {
          throw new Error(`The page is too large to read (${declared} bytes, max ${MAX_RAW_BYTES}).`);
        }
        const raw = await response.text();
        if (raw.length > MAX_RAW_BYTES) {
          throw new Error(`The page is too large to read (${raw.length} chars, max ${MAX_RAW_BYTES}).`);
        }

        const { title, text } = extractPageText(raw);
        const truncated = text.length > limit;
        const output: FetchPageOutput = {
          url: response.url,
          title,
          text: truncated ? `${text.slice(0, limit)}\n\n[…truncated]` : text,
          truncated,
        };

        onRecord?.(
          createRecord({
            toolName: "fetchPage",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue({
              url: output.url,
              title: output.title,
              chars: output.text.length,
              truncated: output.truncated,
            }),
            outputData: output,
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "fetchPage",
            status: "failed",
            inputSummary,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      }
    },
  });
}
