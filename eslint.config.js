// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Global exclusions.
    //
    // This must be a config object containing *only* `ignores`. In flat config,
    // `ignores` alongside other keys narrows that one config block instead of
    // excluding the files from linting entirely.
    //
    // `**` rather than `*` because a single `*` does not cross directory
    // separators, so `dist/*` would not match `dist/web/assets/index.js`.
    ignores: [
      "dist/**",
      "desktop/out/**",
      "desktop/release/**",
      "oauth-proxy/**",
    ],
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Portability boundary.
    //
    // The database schema, migrations and the cron engine are imported directly
    // by the Electron main process, which runs them under plain Node. If a value
    // import of an Expo native module creeps into these files, the Node bundle
    // fails to build (or, worse, builds and throws at runtime).
    //
    // `allowTypeImports` keeps the legal type-only references working, e.g.
    // `import type { SQLiteDatabase } from "expo-sqlite"` in `migrations.ts`.
    files: ["src/core/db/**/*.ts", "src/modules/scheduler/**/*.ts"],
    ignores: [
      // Bind to Expo native drivers on purpose.
      "src/core/db/native.ts",
      // Android/iOS-only scheduler integrations.
      "src/modules/scheduler/alarm-sync.ts",
      "src/modules/scheduler/ios-calendar-sync.ts",
      "src/modules/scheduler/headless.ts",
      "src/modules/scheduler/headless-registration.ts",
      // Runs the agent, so it needs the filesystem service; executes in the
      // renderer on every host rather than in the Electron main process.
      "src/modules/scheduler/dispatch.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["expo-*", "react-native-*"],
              allowTypeImports: true,
              message:
                "This module must stay bundleable outside an Expo runtime (it is imported by the Electron main process). Inject an adapter instead of importing a native module. See src/core/db/native.ts for the Expo wiring.",
            },
          ],
        },
      ],
    },
  },
]);
