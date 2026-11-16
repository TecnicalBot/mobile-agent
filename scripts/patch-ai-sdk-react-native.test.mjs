import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const script = fileURLToPath(new URL("./patch-ai-sdk-react-native.js", import.meta.url));
const directories = [];
const fixture = `
function openTelemetryChannelSpanContext({
  message,
  completion
}) {
  var _a22;
  if (!isNodeRuntime()) {
    return void 0;
  }
  return "node tracing";
}

function unrelatedNodeHelper() {
  if (!isNodeRuntime()) {
    return void 0;
  }
}
`;

function installFixture() {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ai-sdk-native-test-"));
  directories.push(root);
  const dist = join(root, "node_modules", "ai", "dist");
  mkdirSync(join(dist, "internal"), { recursive: true });
  const files = [join(dist, "index.js"), join(dist, "internal", "index.js")];
  for (const file of files) writeFileSync(file, fixture);
  return { root, files };
}

function patch(root) {
  execFileSync(process.execPath, [script], { cwd: root });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("AI SDK React Native telemetry patch", () => {
  it("handles the canceled telemetry promise in both package entry points", async () => {
    const { root, files } = installFixture();
    patch(root);

    for (const file of files) {
      const openSpan = runInNewContext(
        `${readFileSync(file, "utf8")}\nopenTelemetryChannelSpanContext;`,
        { Promise, isNodeRuntime: () => false },
      );
      const aborted = new Error("Request aborted.");
      const completion = Promise.reject(aborted);
      const catchSpy = vi.spyOn(completion, "catch");

      try {
        expect(openSpan({ message: {}, completion })).toBeUndefined();
        expect(catchSpy).toHaveBeenCalledTimes(1);
        expect(catchSpy.mock.calls[0][0](aborted)).toBeUndefined();
      } finally {
        // Keep the test clean even if the regression assertion above fails.
        await completion.catch(() => {});
      }
    }
  });

  it("is idempotent and leaves the Node tracing path alone", () => {
    const { root, files } = installFixture();
    patch(root);
    const once = files.map((file) => readFileSync(file, "utf8"));
    patch(root);
    expect(files.map((file) => readFileSync(file, "utf8"))).toEqual(once);
    expect(once[0].match(/Promise\.resolve\(completion\)/g)).toHaveLength(1);

    const openSpan = runInNewContext(`${once[0]}\nopenTelemetryChannelSpanContext;`, {
      Promise,
      isNodeRuntime: () => true,
    });
    expect(openSpan({ message: {}, completion: Promise.resolve() })).toBe("node tracing");
  });
});
