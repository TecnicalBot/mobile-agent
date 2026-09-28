import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Bundles the Electron main and preload entry points.
 *
 * The renderer is *not* built here. It is a react-native-web bundle produced by
 * `expo export --platform web`, which Metro handles. esbuild only has to
 * produce the two Node-side bundles.
 *
 * Everything under `src/core/db` that the main process touches is shared
 * verbatim with the app: the schema, the migrations and the Drizzle
 * repositories are imported across the boundary, which is what keeps Android
 * and Windows on one implementation.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const watch = process.argv.includes("--watch");

/**
 * Native modules have no meaning outside an Expo runtime, and `electron` is
 * provided by the runtime. Marking them external keeps esbuild from trying to
 * resolve them.
 */
const external = [
  "electron",
  "expo",
  "expo-*",
  "react-native",
  "react-native-*",
  "@expo/*",
];

/**
 * esbuild rewrites a specifier here before the external check, so these two
 * entries are what let the shared migration history run under plain Node.
 */
const alias = {
  "@": resolve(projectRoot, "src"),

  // `migrations.ts` reaches for `expo-file-system` to move plugin, skill and
  // agent blobs out of SQLite columns and onto disk. The desktop app runs the
  // same migrations, so the specifier has to resolve to an implementation that
  // works outside an Expo runtime.
  //
  // This is deliberately narrower than the renderer-side Metro aliases: only the
  // three members the migrations actually call are implemented.
  "expo-file-system": resolve(
    here,
    "src/main/shims/expo-file-system.ts",
  ),
};

const shared = {
  bundle: true,
  platform: "node",
  // Electron 44 ships Node 24.
  target: "node24",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  external,
  alias,
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV ?? "production",
    ),
  },
};

const targets = [
  {
    ...shared,
    entryPoints: [resolve(here, "src/main/index.ts")],
    outfile: resolve(here, "out/main/index.cjs"),
  },
  {
    ...shared,
    entryPoints: [resolve(here, "src/preload/index.ts")],
    outfile: resolve(here, "out/preload/index.cjs"),
  },
];

if (watch) {
  const contexts = await Promise.all(targets.map((options) => context(options)));

  await Promise.all(contexts.map((created) => created.watch()));
  console.log("[desktop] watching main and preload");
} else {
  await Promise.all(targets.map((options) => build(options)));
}
