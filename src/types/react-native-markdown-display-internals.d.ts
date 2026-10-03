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