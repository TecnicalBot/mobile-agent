import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

/**
 * The chat renderer builds its parser with the `MarkdownIt` re-exported by
 * `react-native-markdown-display`, which resolves to *that package's* own
 * markdown-it rather than the repo-root copy. The two are different majors and
 * their core-rule chains are ordered differently — `linkify` in particular runs
 * as a separate core rule in v10 but inside the inline pass in v13+ — so a rule
 * anchored relative to `inline` can pass in tests and match nothing at runtime.
 *
 * Tests must therefore parse with the same copy the app ships. Resolve it the
 * same way Metro does instead of hard-coding a version, and expose it to tests
 * as `#app-markdown-it`.
 */
const libraryEntry = require.resolve("react-native-markdown-display");
const appMarkdownIt = require.resolve("markdown-it", {
  paths: [dirname(libraryEntry)],
});

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "#app-markdown-it": appMarkdownIt,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});