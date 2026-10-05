// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "catalog/skills/**/scripts/**", "catalog/skills/**/eval-viewer/**"],
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // `#app-markdown-it` is a test-only alias declared in vitest.config.mts and
    // typed ambiently in src/types. Nothing on disk resolves it, so the import
    // resolver cannot see it.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "import/no-unresolved": "off",
    },
  }
]);
