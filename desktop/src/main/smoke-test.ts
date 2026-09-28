import { writeFile } from "node:fs/promises";

import { app, type BrowserWindow } from "electron";

/**
 * End-to-end check of the main/preload/renderer split.
 *
 * The riskiest part of this architecture is not that any single file is wrong,
 * it is that a channel was wired up with the wrong shape and nothing notices
 * until a screen the user happens to open misbehaves. This walks every channel
 * the app depends on, from the renderer outward, and reports what answered.
 *
 * Enabled with `--smoke-test` or `MOBILE_AGENT_SMOKE_TEST=1`. Prints a JSON
 * report and exits with a non-zero code if any check fails, so it is usable from
 * a script or CI rather than only by reading a window.
 *
 * The checks run in the renderer's main world because that is the only place
 * `window.desktop` exists, and they deliberately go through the public bridge
 * rather than reaching into the main process, so a mismatch between the preload
 * and the contract is caught.
 */

/** How long to wait for the bundle to boot before giving up. */
const BOOT_TIMEOUT_MS = 60_000;

/** How long to wait for React to mount something into `#root`. */
const MOUNT_TIMEOUT_MS = 45_000;

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Injected as a string rather than imported, because it has to execute inside
 * the renderer's isolated-free main world where the bridge is exposed.
 */
const RENDERER_CHECKS = `
(async () => {
  const results = [];

  const check = async (name, run) => {
    try {
      const detail = await run();
      results.push({ name, ok: true, detail: String(detail) });
    } catch (error) {
      results.push({
        name,
        ok: false,
        detail: (error && error.message) || String(error),
      });
    }
  };

  await check("bridge present", () => {
    if (!window.desktop) {
      throw new Error("window.desktop is undefined; the preload did not run");
    }
    return ["app", "fs", "fsSync", "secrets", "db"].filter(
      (key) => !window.desktop[key],
    ).length === 0
      ? "all five namespaces exposed"
      : "MISSING: " + ["app", "fs", "fsSync", "secrets", "db"].filter((k) => !window.desktop[k]).join(", ");
  });

  await check("app info", () => {
    const info = window.desktop.app;
    if (!info.databasePath) throw new Error("databasePath is empty");
    if (!info.documentsPath) throw new Error("documentsPath is empty");
    return info.platform + " / electron " + info.electronVersion + " / db " + info.databasePath;
  });

  await check("db: rows are positional arrays", async () => {
    // This is the single most load-bearing thing the bridge does and it is easy
    // to get backwards. drizzle-orm/sqlite-proxy maps results with
    // row[columnIndex], so a name-keyed row does not fail the query -- it hands
    // the repositories a row of undefineds, which surfaces much later as an
    // unrelated TypeError somewhere in the UI. Asserting only "a value came
    // back" is not enough: Object.values(row)[0] reads the same either way.
    //
    // (No backticks in these comments: this whole block is a template literal.)
    const result = await window.desktop.db.query("SELECT 1 AS one, 'two' AS two", []);

    if (result.rows.length !== 1) throw new Error("expected 1 row, got " + result.rows.length);
    if (!Array.isArray(result.rows[0])) {
      throw new Error("row is not an array: " + JSON.stringify(result.rows[0]));
    }
    if (result.rows[0].length !== 2) {
      throw new Error("expected 2 columns, got " + result.rows[0].length);
    }
    if (result.rows[0][0] !== 1 || result.rows[0][1] !== "two") {
      throw new Error("column order not preserved: " + JSON.stringify(result.rows[0]));
    }
    return "SELECT 1 AS one, 'two' AS two -> " + JSON.stringify(result.rows[0]);
  });

  await check("db: bound parameters", async () => {
    const result = await window.desktop.db.query("SELECT ? AS echo", ["hello"]);
    const value = (result.rows[0] || [])[0];
    if (value !== "hello") throw new Error("expected 'hello', got " + JSON.stringify(value));
    return "bound parameter round-tripped";
  });

  await check("db: migrated schema is readable", async () => {
    const result = await window.desktop.db.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ["conversations"],
    );
    if (result.rows.length !== 1) throw new Error("conversations table not found");

    // Spot-check a column the migration chain added late, so a chain that
    // silently stopped applying is caught here rather than as a broken column
    // much later in the app.
    const columns = await window.desktop.db.query("PRAGMA table_info(conversations)", []);
    const names = columns.rows.map((row) => (row || [])[1]);

    for (const column of ["agent_id", "pinned_at", "selected_mcp_server_ids_json"]) {
      if (names.indexOf(column) === -1) throw new Error("missing column " + column);
    }

    const version = await window.desktop.db.query("PRAGMA user_version", []);
    return "user_version = " + JSON.stringify((version.rows[0] || [])[0]);
  });

  await check("fsSync: write then read back", () => {
    const path = window.desktop.app.tempPath + "\\\\mobile-agent-smoke.txt";
    const fsSync = window.desktop.fsSync;

    fsSync.createFile(path, { intermediates: true, overwrite: true });
    fsSync.writeFile(path, "smoke");

    const read = fsSync.readTextFile(path);
    if (read !== "smoke") throw new Error("read back " + JSON.stringify(read));

    const info = fsSync.stat(path);
    if (!info.exists) throw new Error("stat reported missing");
    if (info.type !== "file") throw new Error("type is " + JSON.stringify(info.type));
    if (info.size !== 5) throw new Error("size is " + info.size);

    const bytes = fsSync.readBytesFile(path);
    if (bytes.length !== 5) throw new Error("readBytesFile returned " + bytes.length);

    fsSync.deleteEntry(path);

    if (fsSync.stat(path).exists) throw new Error("file survived deletion");

    return "stat / create / write / readText / readBytes / delete over sendSync";
  });

  await check("fsSync: directory create and list", () => {
    const root = window.desktop.app.tempPath + "\\\\mobile-agent-smoke-dir";
    const fsSync = window.desktop.fsSync;

    fsSync.createDirectory(root, { intermediates: true, idempotent: true });
    fsSync.createFile(root + "\\\\a.txt", { intermediates: true, overwrite: true });

    const entries = fsSync.list(root);
    const names = entries.map((entry) => entry.path.split(/[\\\\/]/).pop());

    if (!names.includes("a.txt")) {
      throw new Error("list returned " + JSON.stringify(names));
    }

    fsSync.deleteEntry(root);

    return "created and listed " + entries.length + " entry/entries";
  });

  await check("fsSync: refuses a path outside the allow-list", () => {
    const fsSync = window.desktop.fsSync;

    try {
      fsSync.readTextFile("C:\\\\Windows\\\\System32\\\\drivers\\\\etc\\\\hosts");
    } catch {
      return "rejected as expected";
    }

    throw new Error("read a file outside every allowed root");
  });

  await check("fsSync: refuses traversal out of an allowed root", () => {
    const fsSync = window.desktop.fsSync;

    try {
      fsSync.readTextFile(
        window.desktop.app.tempPath + "\\\\..\\\\..\\\\Windows\\\\System32\\\\drivers\\\\etc\\\\hosts",
      );
    } catch {
      return "rejected as expected";
    }

    throw new Error("escaped an allowed root with ..\\\\ segments");
  });

  await check("fs: async stat of the documents root", async () => {
    const info = await window.desktop.fs.stat(window.desktop.app.documentsPath);

    if (!info.exists) throw new Error("documents root reported missing");
    if (info.type !== "directory") throw new Error("type is " + JSON.stringify(info.type));

    return "directory";
  });

  await check("shell: refuses a scheme outside the allow-list", async () => {
    // Only the rejection path is exercised. Actually launching a URL would open
    // the user's browser, which a test has no business doing; what matters is
    // that the main process refuses to be a general-purpose launcher on behalf
    // of a page.
    const rejected = [];

    for (const target of [
      "javascript:alert(1)",
      "file:///C:/Windows/System32/drivers/etc/hosts",
      "ms-msdt:/id",
      "not-a-scheme",
    ]) {
      try {
        await window.desktop.shell.openExternal(target);
        rejected.push(target + " was ALLOWED");
      } catch {
        // Expected.
      }
    }

    if (rejected.length > 0) {
      throw new Error("allowed: " + rejected.join(", "));
    }

    return "javascript:, file: outside the allow-list, ms-msdt: and a bare string all rejected";
  });

  await check("secrets: set, get, delete", async () => {
    const key = "smoke-test:" + Date.now();
    await window.desktop.secrets.set(key, "s3cret");
    const read = await window.desktop.secrets.get(key);
    if (read !== "s3cret") throw new Error("read back " + JSON.stringify(read));
    await window.desktop.secrets.delete(key);
    const after = await window.desktop.secrets.get(key);
    if (after !== null) throw new Error("value survived deletion");
    return "encrypted at rest via safeStorage, round-tripped";
  });

  // A JSON string, not the array itself. \`executeJavaScript\` structured-clones
  // its result, and a plain array of plain objects is cloneable in principle but
  // any non-plain value that leaks in turns into an opaque "An object could not
  // be cloned" that hides every other result.
  return JSON.stringify(results);
})()
`;

async function waitForBoot(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoading()) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      window.webContents.off("did-finish-load", onLoad);
      resolve();
    }, BOOT_TIMEOUT_MS);

    function onLoad() {
      clearTimeout(timer);
      resolve();
    }

    window.webContents.once("did-finish-load", onLoad);
  });
}

/**
 * Buffer of renderer console errors.
 *
 * The listener has to be attached before the page starts loading, otherwise the
 * errors that matter most, the ones thrown while React mounts, are already gone
 * by the time the test runs.
 */
const consoleErrors: string[] = [];

export function captureRendererErrors(window: BrowserWindow): void {
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") {
      consoleErrors.push(event.message);
    }
  });
}

function takeConsoleErrors(): string[] {
  return [...consoleErrors];
}

/** Records a check that runs in the main process rather than the renderer. */
function check(
  name: string,
  run: () => string | Promise<string>,
): Promise<CheckResult> {
  return Promise.resolve()
    .then(run)
    .then(
      (detail) => ({ name, ok: true, detail: String(detail) }),
      (error: unknown) => ({
        name,
        ok: false,
        detail: (error as Error)?.message ?? String(error),
      }),
    );
}

export async function runSmokeTest(window: BrowserWindow): Promise<number> {
  const report: { checks: CheckResult[]; rendererUrl: string } = {
    checks: [],
    rendererUrl: window.webContents.getURL(),
  };

  await waitForBoot(window);

  report.checks.push(
    ...(await Promise.all([
      check("renderer url", () => window.webContents.getURL()),
      check("dom has content", async () => {
        // Poll rather than sampling once: the bundle is a few megabytes and
        // React mounts after hydration, so a single early read sees an empty
        // root even on a perfectly healthy app.
        const deadline = Date.now() + MOUNT_TIMEOUT_MS;
        let last = "";

        for (;;) {
          last = (await window.webContents.executeJavaScript(
            "(() => { const root = document.getElementById('root'); return JSON.stringify({ found: !!root, children: root ? root.childElementCount : -1, bodyLength: document.body ? document.body.innerHTML.length : -1, sample: (document.body ? document.body.innerHTML : '').slice(0, 160) }); })()",
          )) as string;

          const state = JSON.parse(last) as {
            found: boolean;
            children: number;
            bodyLength: number;
            sample: string;
          };

          if (state.children > 0) {
            const text = (await window.webContents.executeJavaScript(
              "(() => { const t = document.body.innerText.replace(/\\s+/g, ' ').trim(); return JSON.stringify({ text: t.slice(0, 300), length: t.length }); })()",
            )) as string;
            const rendered = JSON.parse(text) as { text: string; length: number };

            return (
              `${state.children} mounted child node(s); ` +
              `${rendered.length} chars of visible text: "${rendered.text}"`
            );
          }

          if (Date.now() > deadline) {
            throw new Error(
              `root ${state.found ? "found but empty" : "missing"} ` +
                `after ${MOUNT_TIMEOUT_MS / 1000}s; body has ${state.bodyLength} chars: ${state.sample}`,
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }),
    ])),
  );

  try {
    const raw = (await window.webContents.executeJavaScript(
      RENDERER_CHECKS,
    )) as string;

    report.checks.push(...(JSON.parse(raw) as CheckResult[]));
  } catch (error) {
    report.checks.push({
      name: "renderer checks",
      ok: false,
      detail: `could not run: ${(error as Error).message}`,
    });
  }

  const consoleErrors = takeConsoleErrors();

  if (consoleErrors.length > 0) {
    report.checks.push({
      name: "renderer console",
      ok: false,
      detail: consoleErrors.slice(0, 10).join(" | "),
    });
  }

  // A passing DOM check still leaves layout questions open, so optionally write
  // a PNG. Cheap to add and the fastest way to see what actually rendered.
  const screenshotPath = process.env.MOBILE_AGENT_SCREENSHOT;

  if (screenshotPath) {
    report.checks.push(
      await check("screenshot", async () => {
        const image = await window.webContents.capturePage();
        await writeFile(screenshotPath, image.toPNG());

        return `${screenshotPath} (${image.getSize().width}x${image.getSize().height})`;
      }),
    );
  }

  const failed = report.checks.filter((result) => !result.ok);

  for (const result of report.checks) {
    console.log(`${result.ok ? "ok  " : "FAIL"}  ${result.name}: ${result.detail}`);
  }

  console.log(
    `\n${report.checks.length - failed.length}/${report.checks.length} checks passed`,
  );
  console.log(`userData: ${app.getPath("userData")}`);

  return failed.length === 0 ? 0 : 1;
}
