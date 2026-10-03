/**
 * Core markdown-it rules for the chat renderer.
 *
 * Kept free of `react-native` and `markdown-it` imports so the token transform
 * can be exercised directly in unit tests; the parser instance is injected.
 */

export type MarkdownToken = {
  attrSet: (name: string, value: string) => void;
  block?: boolean;
  // `null` rather than `undefined` so a real markdown-it Token (whose children
  // are null when absent) is structurally assignable to this shape.
  children?: MarkdownToken[] | null;
  content: string;
  level: number;
  type: string;
};

type MarkdownItLike = {
  core: {
    ruler: {
      // Method shorthand on purpose: it opts into bivariant parameter checking,
      // so a real markdown-it instance satisfies this stand-in even though its
      // StateCore token type is structurally wider than MarkdownToken.
      after(
        afterName: string,
        ruleName: string,
        rule: (state: { tokens: MarkdownToken[] }) => void,
      ): void;
    };
  };
};

/** GFM task list checkboxes, which markdown-it does not support out of the box. */
function registerTaskLists(parser: MarkdownItLike) {
  parser.core.ruler.after("inline", "task_lists", (state) => {
    for (let index = 0; index < state.tokens.length; index += 1) {
      const listItem = state.tokens[index];

      if (listItem.type !== "list_item_open") {
        continue;
      }

      const list = state.tokens
        .slice(0, index)
        .reverse()
        .find(
          (token) =>
            token.level === listItem.level - 1 &&
            (token.type === "bullet_list_open" ||
              token.type === "ordered_list_open"),
        );

      if (list?.type !== "bullet_list_open") {
        continue;
      }

      const inline = state.tokens
        .slice(index + 1)
        .find(
          (token) =>
            token.type === "inline" ||
            (token.type === "list_item_close" &&
              token.level === listItem.level),
        );
      const firstText =
        inline?.type === "inline" ? inline.children?.[0] : undefined;
      const taskMarker = firstText?.content.match(/^\[([ xX])\]\s+/);

      if (!firstText || !taskMarker) {
        continue;
      }

      firstText.content = firstText.content.slice(taskMarker[0].length);
      listItem.attrSet("task", "true");
      listItem.attrSet("checked", String(taskMarker[1].toLowerCase() === "x"));
    }
  });
}

/** Generic in the input so the caller's concrete parser type is preserved. */
export function registerChatMarkdownRules<Parser extends MarkdownItLike>(
  parser: Parser,
): Parser {
  registerTaskLists(parser);

  return parser;
}