import { refractor } from "refractor";

type SyntaxNode = {
  type: string;
  value?: string;
  properties?: { className?: (string | number)[] };
  children?: SyntaxNode[];
};

export type CodeDocumentColors = {
  text: string;
  backgroundElement: string;
  syntaxComment: string;
  syntaxConstant: string;
  syntaxNumber: string;
  syntaxString: string;
  syntaxOperator: string;
  syntaxKeyword: string;
  syntaxFunction: string;
  syntaxRegex: string;
};

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderNodes(nodes: SyntaxNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return escapeHtml(node.value ?? "");
    const classes = (node.properties?.className ?? []).join(" ");
    return `<span class="${escapeHtml(classes)}">${renderNodes(node.children ?? [])}</span>`;
  }).join("");
}

/** Source is escaped even when highlighting fails; it never becomes page markup. */
export function buildCodeDocument(code: string, language: string, colors: CodeDocumentColors) {
  const grammar = ["htm", "html", "svg", "xml"].includes(language.toLowerCase())
    ? "markup" : language.toLowerCase();
  let source = escapeHtml(code);
  if (refractor.registered(grammar)) {
    try {
      source = renderNodes(refractor.highlight(code, grammar).children as SyntaxNode[]);
    } catch {
      // Retain readable plain source if the grammar cannot parse this input.
    }
  }
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{margin:0;background:${colors.backgroundElement};color:${colors.text}}
pre{box-sizing:border-box;margin:0;padding:12px;width:max-content;min-width:100%;font:14px/22px monospace;white-space:pre;tab-size:2}
.comment,.prolog,.doctype,.cdata{color:${colors.syntaxComment};font-style:italic}
.property,.tag,.constant,.symbol,.deleted{color:${colors.syntaxConstant}}
.boolean,.number{color:${colors.syntaxNumber}}
.selector,.attr-name,.string,.char,.builtin,.inserted{color:${colors.syntaxString}}
.operator,.entity,.url,.variable{color:${colors.syntaxOperator}}
.atrule,.attr-value,.keyword,.control,.directive{color:${colors.syntaxKeyword}}
.function,.class-name{color:${colors.syntaxFunction}}
.regex,.important{color:${colors.syntaxRegex}}
</style></head><body><pre><code>${source}</code></pre></body></html>`;
}
