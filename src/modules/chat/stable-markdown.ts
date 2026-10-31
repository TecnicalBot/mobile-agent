import {
  parser,
  type ASTNode,
  type MarkdownParser,
} from "react-native-markdown-display";

// The library's runtime passes the complete AST array to this callback; its
// published declaration incorrectly describes a single node and a View result.
const parseAst = parser as unknown as (
  source: string,
  render: (nodes: ASTNode[]) => ASTNode[],
  markdown: MarkdownParser,
) => ASTNode[];

/** Keep existing blocks mounted when another token is appended to a reply. */
export function parseStableMarkdown(
  source: string,
  markdown: MarkdownParser,
): ASTNode[] {
  return parseAst(
    source,
    (nodes) => {
      const visit = (children: ASTNode[], parent: string) => {
        children.forEach((node, index) => {
          node.key = `${parent}/${node.type}:${index}`;
          visit(node.children, node.key);
        });
      };
      visit(nodes, "markdown");
      return nodes;
    },
    markdown,
  );
}
