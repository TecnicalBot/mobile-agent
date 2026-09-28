const path = require("node:path");

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

/**
 * Web-only replacements for modules that have no browser implementation.
 *
 * The web bundle is only ever loaded by the Electron renderer, where none of
 * these have a working browser build:
 *
 *   expo-secure-store    its web build is `export default {}`, so any call throws
 *   expo-file-system     the browser build lacks the `File`/`Directory` API
 *   expo-sqlite          the web build imports a `wa-sqlite.wasm` binary that the
 *                        published package does not ship
 *   expo-notifications   browser build is a stub that still tries to register
 *                        with the Expo push server
 *   expo-splash-screen   native-only
 *   expo-blur            native view with no browser equivalent
 *   expo-media-library   the browser build still asks for the native media
 *                        module and throws "Cannot find native module"
 *   expo-intent-launcher no browser build at all; Android intents are forwarded
 *                        to the operating system instead
 *   expo-sharing         wraps Android's `ACTION_SEND`; there is no desktop
 *                        equivalent of the system share sheet
 *
 * The shims live in `desktop/src/renderer/shims` and talk to the Electron main
 * process over the `window.desktop` bridge, which keeps the app's own code
 * (`src/core/services/secrets.ts`, `workspace-file-service.ts`, the file memory
 * store, ...) completely unchanged. Android and iOS never see any of this.
 *
 * Keys are exact specifiers, which is what makes the subpath
 * `expo-file-system/legacy` expressible; `extraNodeModules` cannot do that.
 */
const desktopShims = {
  "expo-file-system": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-file-system.ts",
  ),
  "expo-file-system/legacy": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-file-system-legacy.ts",
  ),
  "expo-secure-store": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-secure-store.ts",
  ),
  "expo-sqlite": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-sqlite.ts",
  ),
  "expo-notifications": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-notifications.ts",
  ),
  "expo-splash-screen": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-splash-screen.ts",
  ),
  "expo-blur": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-blur.tsx",
  ),
  "expo-media-library": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-media-library.ts",
  ),
  "expo-intent-launcher": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-intent-launcher.ts",
  ),
  "expo-sharing": path.resolve(
    __dirname,
    "desktop/src/renderer/shims/expo-sharing.ts",
  ),
};

const withDesktopShims = {
  ...config,
  resolver: {
    ...config.resolver,
    /**
     * Metro's `redirectModulePath` looks like the right tool here but is not:
     * its documented signature takes only `(modulePath)`, so there is no
     * platform to gate on and the substitution would apply to Android too.
     * `resolveRequest` is the public hook and does receive the platform.
     *
     * The `platform === "web"` guard is load-bearing. Without it the real native
     * modules would be swapped out of the Android build.
     */
    resolveRequest: (context, moduleName, platform) => {
      const shim =
        platform === "web" ? desktopShims[moduleName] : undefined;

      // Re-enter resolution rather than returning a hand-built Resolution, so
      // the shim still gets platform extensions and source maps. The shim paths
      // are absolute, so they cannot match the map again and recurse.
      return context.resolveRequest(context, shim ?? moduleName, platform);
    },
  },
  // The shims live outside `src/`, so Metro has to watch them.
  watchFolders: [
    ...(config.watchFolders ?? []),
    path.resolve(__dirname, "desktop"),
  ],
};

module.exports = withNativeWind(withDesktopShims, {
  input: "./src/app/global.css",
});
