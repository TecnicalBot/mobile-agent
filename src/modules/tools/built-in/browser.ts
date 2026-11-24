import { tool } from "ai";
import { z } from "zod";
import { File } from "expo-file-system";

import {
  createWorkspaceFileService,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { checkUrl } from "@/modules/tools/built-in/fetch-page";
import {
  BROWSER_MAX_SLICES,
  hasBrowserHost,
  requestBrowserCommand,
  type BrowserCommand,
  type BrowserCommandResult,
} from "@/modules/preview/browser-session";

type PersistedShot = {
  fileId: string;
  displayName: string;
  link: string;
  mimeType: "image/png";
  size: number;
  top: number;
  /** Local file URI, for the trace preview card. */
  uri: string;
};

/** The workspace reference the model gets, without the local preview path. */
function toShot(shot: PersistedShot) {
  const { uri: _uri, ...rest } = shot;
  return rest;
}

export function createBrowserTool({ onRecord, repository }: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);
  return tool({
    description:
      "Drive a built-in browser session against public web pages (http/https): navigate, go back, reload, scroll, click, fill text fields, read the rendered page text/links, and screenshot the viewport or the full page. The page stays open between calls — history, cookies and logins persist in the session, so you can click around a site like a person. Selectors accept CSS or 'text=visible label' (e.g. text=Sign in); click/type report the clicked element. Reading returns the JS-rendered text plus up to 60 links (use fetchPage for raw HTML text of a page without a browser). Full-page screenshots return a zoomed-out overview plus top-to-bottom slices (images persist to the workspace — view them with the returned links or embed them inline). Only public URLs: local/private hosts are blocked.",
    // Keep a single object schema with an `action` enum. Models such as
    // Anthropic require a top-level `type` on tool input schemas, which a
    // discriminated union (serialized as a bare `oneOf`) does not provide.
    inputSchema: z.object({
      action: z
        .enum([
          "navigate",
          "back",
          "reload",
          "read",
          "scroll",
          "click",
          "type",
          "screenshot",
        ])
        .describe(
          "navigate: open url. back/reload: session history. read: page text plus links. scroll: top/dy. click/type: selector (type also needs text). screenshot: fullPage/maxSlices.",
        ),
      url: z.string().min(1).optional().describe("navigate: http(s) URL to open."),
      selector: z
        .string()
        .min(1)
        .optional()
        .describe("click/type: CSS selector or text=visible-label."),
      text: z.string().optional().describe("type: text to fill in."),
      submit: z
        .boolean()
        .optional()
        .describe("type: also submit the field's form / press Enter."),
      top: z
        .number()
        .optional()
        .describe("scroll: absolute scroll position; omit to use dy."),
      dy: z
        .number()
        .optional()
        .describe("scroll: scroll by delta pixels; omit to page down one viewport."),
      fullPage: z
        .boolean()
        .optional()
        .describe(
          "screenshot: whole page overview + slices instead of just the viewport.",
        ),
      maxSlices: z
        .number()
        .optional()
        .describe(
          `screenshot: slice budget for a full page (max ${BROWSER_MAX_SLICES}).`,
        ),
    }),
    execute: async (
      input: { action: string; url?: string; selector?: string; text?: string; submit?: boolean; top?: number; dy?: number; fullPage?: boolean; maxSlices?: number },
      { abortSignal }: { abortSignal?: AbortSignal },
    ) => {
      const action = input.action;
      const inputSummary = summarizeValue(action === "navigate" ? { action, url: input.url } : input);
      try {
        if (!hasBrowserHost()) {
          throw new Error("The interactive browser is only available on Android builds.");
        }
        const command = buildCommand(action, input);
        const result = await requestBrowserCommand({ command, signal: abortSignal });
        const { output, preview } = await finishRecordOutput(action, result, workspaceService, input);

        onRecord?.(
          createRecord({
            toolName: "browser",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
            outputData: output,
            preview,
          }),
        );
        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "browser",
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

function buildCommand(
  action: string,
  input: { url?: string; selector?: string; text?: string; submit?: boolean; top?: number; dy?: number; fullPage?: boolean; maxSlices?: number },
): BrowserCommand {
  if (action === "navigate") {
    if (!input.url) throw new Error("navigate needs a url.");
    return { kind: "navigate", url: checkUrl(input.url).toString() };
  }
  if (action === "back") return { kind: "back" };
  if (action === "reload") return { kind: "reload" };
  if (action === "read") return { kind: "read" };
  if (action === "scroll") return { kind: "scroll", top: input.top, dy: input.dy };
  if (action === "click") {
    if (!input.selector) throw new Error("click needs a selector or text= label.");
    return { kind: "click", selector: input.selector };
  }
  if (action === "type") {
    if (!input.selector) throw new Error("type needs a selector or text= label.");
    if (input.text == null) throw new Error("type needs text to fill in.");
    return { kind: "type", selector: input.selector, text: input.text, submit: input.submit === true };
  }
  if (action === "screenshot") {
    return {
      kind: "screenshot",
      fullPage: input.fullPage === true,
      maxSlices: input.maxSlices,
    };
  }
  throw new Error(`Unknown browser action: ${action}`);
}

async function finishRecordOutput(
  action: string,
  result: BrowserCommandResult,
  workspaceService: ReturnType<typeof createWorkspaceFileService>,
  input: { maxSlices?: number },
) {
  const base = { action, url: result.url, title: result.title };
  switch (result.kind) {
    case "navigate":
    case "back":
    case "reload":
      return { output: base };
    case "scroll":
      return { output: { ...base, top: result.top } };
    case "click":
      return { output: { ...base, clickedInto: result.heading ?? result.title ?? null } };
    case "type":
      return { output: { ...base, submitted: result.submit, typedInto: result.heading ?? result.title ?? null } };
    case "read":
      return { output: { ...base, text: result.text, links: result.links } };
    case "screenshot": {
      const persist = async (uri: string, index: number, suffix: string): Promise<PersistedShot> => {
        const file = await workspaceService.createDocumentFileFromFile({
          source: new File(uri),
          mimeType: "image/png",
          name: `browse-${Date.now()}${suffix}`,
        });
        return {
          fileId: file.id,
          displayName: file.displayName,
          link: `workspace://${file.id}`,
          mimeType: "image/png",
          size: file.size ?? 0,
          top: index,
          uri: resolveWorkspaceFile(file.relativePath).uri,
        };
      };
      const shots = await Promise.all(
        result.shots.map((shot, i) =>
          persist(shot.uri, shot.top, `-${i + 1}.png`),
        ),
      );
      const overview = result.overview
        ? { ...(await persist(result.overview.uri, 0, "-overview.png")), truncated: result.overview.truncated }
        : null;
      // The host explains why a page is incomplete (slice cap, or the time
      // budget ran out mid-capture) — pass its wording through.
      const note =
        result.note ??
        (result.truncated
          ? `The page is taller than the slice budget (${result.pageHeight}px captured as top slices; pass a bigger maxSlices to go further).`
          : null);
      // The trace row shows the capture itself, so the run reads as "here is
      // the page" instead of a bare "no content preview".
      const preview = result.fullPage
        ? {
            title: result.title ?? "Page capture",
            images: [
              ...(overview
                ? [{ uri: overview.uri, title: "Whole page (zoomed out)" }]
                : []),
              ...shots.map((shot) => ({
                uri: shot.uri,
                title: `Slice at ${shot.top}px`,
              })),
            ],
          }
        : shots[0]
          ? {
              title: result.title ?? "Page capture",
              uri: shots[0].uri,
              mimeType: "image/png" as const,
            }
          : undefined;
      return {
        output: {
          ...base,
          pageHeight: result.pageHeight,
          truncated: result.truncated,
          viewport: result.fullPage ? undefined : shots[0] ? toShot(shots[0]) : undefined,
          slices: result.fullPage ? shots.map(toShot) : undefined,
          overview: overview ? { ...toShot(overview), truncated: overview.truncated } : null,
          note,
        },
        preview,
      };
    }
  }
}
