import { describe, expect, it } from "vitest";

import {
  buildHtmlPreviewDocument,
  buildPreviewDocument,
  buildSvgPreviewDocument,
  withDesktopPreviewViewport,
} from "@/modules/preview/html-document";

describe("withDesktopPreviewViewport", () => {
  it("replaces wrapper and page viewport declarations without removing other metadata", () => {
    const document = withDesktopPreviewViewport(
      buildHtmlPreviewDocument(
        '<!DOCTYPE html><html><head><meta content="width=device-width" name="viewport"><meta name="description" content="viewport demo"></head><body>Page</body></html>',
      ),
      1280,
      0.25,
    );
    expect(document.match(/name="viewport"/g)).toHaveLength(1);
    expect(document).toContain('content="width=1280, initial-scale=0.25"');
    expect(document).toContain(
      '<meta name="description" content="viewport demo">',
    );
    expect(document).toContain('<body>Page</body>');
  });
});

describe("buildHtmlPreviewDocument", () => {
  it("wraps a fragment in a standalone document", () => {
    const document = buildHtmlPreviewDocument("<p>Hello</p>");

    expect(document).toContain("<!DOCTYPE html>");
    expect(document).toContain('<meta charset="utf-8">');
    expect(document).toContain("<body><p>Hello</p></body>");
    expect(document).toContain("<title>Preview</title>");
  });

  it("injects the head into an existing document instead of nesting it", () => {
    const document = buildHtmlPreviewDocument(
      "<!DOCTYPE html><html><head><title>Old</title></head><body>Hi</body></html>",
    );

    expect(document).toContain('<meta charset="utf-8">');
    expect(document).not.toContain("<head><!DOCTYPE");
    expect(document).toContain("<title>Preview</title>");
    expect(document).not.toContain("<title>Old</title>");
  });

  it("adds a base href so relative assets resolve", () => {
    const document = buildHtmlPreviewDocument(
      "<img src='a.png'>",
      { baseUrl: "https://example.com/dir/page.html" },
    );

    expect(document).toContain('<base href="https://example.com/dir/page.html">');
  });

  it("escapes a base url so it cannot break out of the attribute", () => {
    const document = buildHtmlPreviewDocument("<p>x</p>", {
      baseUrl: 'https://example.com/"><script>alert(1)</script>',
    });

    expect(document).not.toContain("<script>");
    expect(document).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("escapes a custom title", () => {
    const document = buildHtmlPreviewDocument("<p>x</p>", {
      title: "<img onerror=alert(1)>",
    });

    expect(document).toContain(
      "<title>&lt;img onerror=alert(1)&gt;</title>",
    );
  });
});

describe("buildSvgPreviewDocument", () => {
  it("wraps bare svg content so it does not collapse", () => {
    const document = buildSvgPreviewDocument("<circle cx='5' cy='5' r='4' />");

    expect(document).toContain("<svg xmlns=");
    expect(document).toContain('viewBox="0 0 100 100"');
    expect(document).toContain("<circle");
  });

  it("keeps an existing svg root untouched", () => {
    const document = buildSvgPreviewDocument(
      "<svg viewBox='0 0 10 10'><rect /></svg>",
    );

    expect(document).not.toContain("<svg xmlns=");
    expect(document.match(/<svg/g)).toHaveLength(1);
  });
});

describe("buildPreviewDocument", () => {
  it("uses the svg wrapper for svg and the html wrapper otherwise", () => {
    expect(buildPreviewDocument("<rect />", "svg")).toContain(
      "display:flex;align-items:center",
    );
    expect(buildPreviewDocument("<p>x</p>", "html")).not.toContain(
      "display:flex;align-items:center",
    );
  });

  it("matches the language case-insensitively", () => {
    expect(buildPreviewDocument("<rect />", "SVG")).toContain("<svg xmlns=");
  });
});
