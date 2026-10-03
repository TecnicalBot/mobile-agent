const DEFAULT_TITLE = "Preview";

const BASE_STYLES = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;padding:12px;background:#ffffff;color:#111111;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:15px;line-height:1.5;overflow-wrap:break-word;word-break:break-word;
}
img,video,canvas,svg,iframe{max-width:100%;height:auto;border:0}
pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
pre{white-space:pre-wrap;background:#f4f4f5;padding:10px;border-radius:8px;overflow-x:auto}
code{font-size:0.92em}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}
th,td{border:1px solid #d4d4d8;padding:6px 10px;text-align:left}
a{color:#2563eb}
@media (prefers-color-scheme:dark){
  body{background:#0b0b0c;color:#ededed}
  pre{background:#1c1c1e}
  th,td{border-color:#3a3a3c}
  a{color:#7aa2f7}
}
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type PreviewDocumentOptions = {
  baseUrl?: string | null;
  title?: string | null;
};

function buildHead(options: PreviewDocumentOptions): string {
  const base = options.baseUrl
    ? `<base href="${escapeHtml(options.baseUrl)}">`
    : "";

  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="referrer" content="no-referrer">',
    base,
    `<style>${BASE_STYLES}</style>`,
  ]
    .filter(Boolean)
    .join("");
}

/**
 * Wraps a markup fragment in a standalone document, injecting the base styles
 * and an optional `<base href>` so relative images and stylesheets resolve.
 *
 * When the source is already a full document the head content is injected into
 * the existing `<head>` rather than nested, which would produce invalid markup.
 */
export function buildHtmlPreviewDocument(
  source: string,
  options: PreviewDocumentOptions = {},
): string {
  const head = buildHead(options);
  const title = escapeHtml(options.title ?? DEFAULT_TITLE);
  const isDocument = /<!doctype html|<html[\s>]/i.test(source);

  if (isDocument) {
    const withBase = options.baseUrl
      ? source.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${head}`)
      : `${head}${source}`;

    return /<head(\s[^>]*)?>/i.test(withBase)
      ? withBase.replace(
          /<title(\s[^>]*)?>[\s\S]*?<\/title>/i,
          `<title>${title}</title>`,
        )
      : withBase;
  }

  return `<!DOCTYPE html><html><head>${head}<title>${title}</title></head><body>${source}</body></html>`;
}

/**
 * SVG needs its own wrapper so intrinsic sizing behaves: a bare `<svg>` without
 * width/height would otherwise collapse to zero inside the WebView.
 */
export function buildSvgPreviewDocument(
  source: string,
  options: PreviewDocumentOptions = {},
): string {
  const head = buildHead(options);
  const title = escapeHtml(options.title ?? DEFAULT_TITLE);
  const normalized = /<svg[\s>]/i.test(source)
    ? source
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">${source}</svg>`;

  return `<!DOCTYPE html><html><head>${head}<title>${title}</title></head><body style="display:flex;align-items:center;justify-content:center;min-height:100vh">${normalized}</body></html>`;
}

/** Picks the right wrapper for a fenced code block's language. */
export function buildPreviewDocument(
  source: string,
  language: string,
  options: PreviewDocumentOptions = {},
): string {
  return language.toLowerCase() === "svg"
    ? buildSvgPreviewDocument(source, options)
    : buildHtmlPreviewDocument(source, options);
}
