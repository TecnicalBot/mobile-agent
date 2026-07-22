const { withAndroidManifest } = require("expo/config-plugins");

const REQUIRED_NATIVE_LIBRARIES = ["libvndksupport.so", "libOpenCL.so"];

module.exports = function withLiteRtLm(config) {
  return withAndroidManifest(config, (nextConfig) => {
    const application = nextConfig.modResults.manifest.application?.[0];

    if (!application) {
      return nextConfig;
    }

    const nativeLibraries = application["uses-native-library"] ?? [];
    const configuredNames = new Set(
      nativeLibraries.map((entry) => entry.$?.["android:name"]),
    );

    for (const libraryName of REQUIRED_NATIVE_LIBRARIES) {
      if (!configuredNames.has(libraryName)) {
        nativeLibraries.push({
          $: {
            "android:name": libraryName,
            "android:required": "false",
          },
        });
      }
    }

    application["uses-native-library"] = nativeLibraries;
    return nextConfig;
  });
};
