import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    // `desktop/` is included because the desktop tests drive the main-process
    // database adapter against the same repositories `src/` uses. They live
    // outside `src/` so the app's `tsconfig` — which has no Node types — never
    // has to typecheck code importing `node:sqlite`.
    include: ["src/**/*.test.{ts,tsx}", "desktop/**/*.test.ts"],
  },
});
