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

// AI SDK 7 creates a derived stream-completion promise for telemetry. The
// non-Node early return leaves that promise unobserved, so every canceled
// stream raises an unhandled rejection in Hermes even when the run is caught.
const tracingTarget = `  if (!isNodeRuntime()) {
    return void 0;
  }`;
const tracingReplacement = `  if (!isNodeRuntime()) {
    Promise.resolve(completion).catch(() => {});
    return void 0;
  }`;

let patchedCount = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    continue;
  }

  const original = fs.readFileSync(file, "utf8");
  let source = original.replace(target, replacement);
  const tracingStart = source.indexOf("function openTelemetryChannelSpanContext(");
  const tracingEnd = source.indexOf("\n}\n", tracingStart) + 2;

  if (tracingStart !== -1 && tracingEnd > tracingStart) {
    source =
      source.slice(0, tracingStart) +
      source.slice(tracingStart, tracingEnd).replace(tracingTarget, tracingReplacement) +
      source.slice(tracingEnd);
  }

  if (source === original) {
    continue;
  }

  fs.writeFileSync(file, source, "utf8");
  patchedCount += 1;
}

if (patchedCount > 0) {
  console.log(`Patched AI SDK React Native telemetry in ${patchedCount} file(s).`);
} else {
  console.log("AI SDK React Native telemetry patch not needed.");
}
