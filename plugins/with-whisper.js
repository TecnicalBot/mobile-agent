const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Preserve the JNI bridge when release builds use R8/ProGuard.
module.exports = function withWhisper(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const file = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro",
      );
      const rule = "-keep class com.rnwhisper.** { *; }";
      const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!content.includes(rule))
        fs.writeFileSync(
          file,
          `${content}\n# whisper.rn JNI bridge\n${rule}\n`,
        );
      return config;
    },
  ]);
};
