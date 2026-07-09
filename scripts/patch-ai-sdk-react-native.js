const fs = require("fs");
const path = require("path");

const root = process.cwd();

const files = [
  path.join(root, "node_modules", "ai", "dist", "index.js"),
  path.join(root, "node_modules", "ai", "dist", "internal", "index.js"),
];

const target = `diagnosticsChannelPromise = import(
      /* webpackIgnore: true */
      "diagnostics_channel"
    ).catch(() => void 0);`;

const replacement = `diagnosticsChannelPromise = Promise.resolve(void 0);`;

let patchedCount = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    continue;
  }

  const source = fs.readFileSync(file, "utf8");

  if (!source.includes(target)) {
    continue;
  }

  fs.writeFileSync(file, source.replace(target, replacement), "utf8");
  patchedCount += 1;
}

if (patchedCount > 0) {
  console.log(`Patched AI SDK React Native telemetry import in ${patchedCount} file(s).`);
} else {
  console.log("AI SDK React Native telemetry patch not needed.");
}
