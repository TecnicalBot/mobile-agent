import { describe, expect, it } from "vitest";

import { Colors } from "../../../constants/theme-tokens";
import { buildCodeDocument } from "../code-document";

describe("buildCodeDocument", () => {
  it("displays markup as highlighted source instead of executing it", () => {
    const html = buildCodeDocument('<script>alert("hello")</script>', "html", Colors.light);
    const source = html.split("<pre><code>")[1].split("</code></pre>")[0];
    expect(source).toContain('class="token tag"');
    expect(source).toContain("&lt;");
    expect(source).not.toContain("<script>");
    expect(source).not.toContain("</script>");
  });

  it("highlights long SVG source without the chat bubble length cutoff", () => {
    const html = buildCodeDocument(`<svg>${'<path d="M0 0"/>\n'.repeat(500)}</svg>`, "svg", Colors.dark);
    expect(html).toContain('class="token attr-name"');
    expect(html).toContain("white-space:pre");
    expect(html).toContain("width:max-content");
  });

  it("escapes unknown-language source and keeps whitespace intact", () => {
    const html = buildCodeDocument('  <b>& "text"</b>\n\tend', "unknown", Colors.light);
    expect(html).toContain('  &lt;b&gt;&amp; &quot;text&quot;&lt;/b&gt;\n\tend');
  });
});
