/**
 * Type declarations for `react-native-markdown-display` internals the tests use.
 */

/**
 * Alias for the exact markdown-it copy the app parses with, resolved in
 * vitest.config.mts from inside `react-native-markdown-display`. Test-only.
 *
 * Typed structurally rather than as `typeof import("markdown-it")`: that would
 * describe the repo-root copy, while this specifier resolves to the older major
 * nested under the markdown library, whose published types differ.
 */
declare module "#app-markdown-it" {
  type AppToken = {
    attrSet: (name: string, value: string) => void;
    attrs: [string, string][] | null;
    children: AppToken[] | null;
    content: string;
    level: number;
    type: string;
  };

  type AppParser = {
    block: {
      ruler: {
        before: (
          beforeName: string,
          ruleName: string,
          rule: (
            state: {
              bMarks: number[];
              eMarks: number[];
              line: number;
              push: (type: string, tag: string, nesting: number) => AppToken;
              src: string;
              tShift: number[];
            },
            startLine: number,
            endLine: number,
            silent: boolean,
          ) => boolean,
          options?: { alt?: string[] },
        ) => void;
      };
    };
    core: {
      ruler: {
        after: (
          afterName: string,
          ruleName: string,
          rule: (state: { tokens: AppToken[] }) => void,
        ) => void;
      };
    };
    options: Record<string, unknown>;
    parse: (src: string, env: object) => AppToken[];
  };

  const MarkdownIt: (options?: {
    breaks?: boolean;
    linkify?: boolean;
    typographer?: boolean;
  }) => AppParser;

  export default MarkdownIt;
}

/**
 * The token helpers `react-native-markdown-display` runs between markdown-it
 * and its AST. Tests replay that pipeline so fixtures match what the chat
 * renderer actually receives.
 */
declare module "react-native-markdown-display/src/lib/util/stringToTokens" {
  export function stringToTokens(source: string, markdown: unknown): unknown[];
}

declare module "react-native-markdown-display/src/lib/util/cleanupTokens" {
  export function cleanupTokens(tokens: unknown[]): unknown[];
}

declare module "react-native-markdown-display/src/lib/util/groupTextTokens" {
  const groupTextTokens: (tokens: unknown[]) => unknown[];
  export default groupTextTokens;
}

declare module "react-native-markdown-display/src/lib/util/omitListItemParagraph" {
  const omitListItemParagraph: (tokens: unknown[]) => unknown[];
  export default omitListItemParagraph;
}

declare module "react-native-markdown-display/src/lib/util/tokensToAST" {
  const tokensToAST: (tokens: unknown[]) => unknown[];
  export default tokensToAST;
}