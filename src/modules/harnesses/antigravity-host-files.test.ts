import { describe, expect, it, vi } from "vitest";
import {
  antigravityHostUploadUrl,
  uploadAntigravityHostFile,
} from "./antigravity-host-files";

const bytes = new TextEncoder().encode("attachment");
const connection = {
  url: "http://192.168.1.20:7801",
  token: "bridge-token",
  cwd: "/project",
};

describe("Antigravity host uploads", () => {
  it("builds a sanitized upload URL for the session directory", () => {
    const url = new URL(
      antigravityHostUploadUrl({
        connection,
        directory: "/project",
        fileName: "../My Report.pdf",
      }),
    );

    expect(url.pathname).toBe("/files");
    expect(url.searchParams.get("name")).toBe("..-My-Report.pdf");
    expect(url.searchParams.get("directory")).toBe("/project");
  });

  it("streams the file to the bridge and returns the host path", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        path: "/project/.mobile-agent/uploads/id/report.pdf",
        size: bytes.byteLength,
      }),
    );
    const path = await uploadAntigravityHostFile({
      connection,
      transport,
      directory: "/project",
      fileName: "report.pdf",
      bytes,
    });

    expect(path).toBe("/project/.mobile-agent/uploads/id/report.pdf");
    const [input, options] = transport.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe("/files");
    expect(url.searchParams.get("name")).toBe("report.pdf");
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(bytes);
    expect(new Headers(options?.headers).get("authorization")).toBe(
      "Bearer bridge-token",
    );
  });

  it("uses the native upload handle for large files", async () => {
    const transport = vi.fn<typeof fetch>();
    const upload = vi.fn(
      async (
        _url: string,
        _options?: {
          httpMethod?: string;
          uploadType?: number;
          headers?: Record<string, string>;
          signal?: AbortSignal;
        },
      ) => ({
        status: 201,
        body: JSON.stringify({
          path: "/project/.mobile-agent/uploads/id/report.pdf",
          size: 50 * 1024 * 1024,
        }),
      }),
    );

    const path = await uploadAntigravityHostFile({
      connection,
      transport,
      directory: "/project",
      fileName: "report.pdf",
      source: {
        exists: true,
        size: 50 * 1024 * 1024,
        bytes: async () => bytes,
        upload,
      },
    });

    expect(path).toBe("/project/.mobile-agent/uploads/id/report.pdf");
    expect(transport).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledOnce();
    const [url, options] = upload.mock.calls[0]!;
    expect(url).toContain("/files");
    expect(options).toMatchObject({ httpMethod: "POST", uploadType: 0 });
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer bridge-token",
    });
  });

  it("surfaces bridge rejections instead of silently dropping the file", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      new Response("upload is unavailable", { status: 503 }),
    );

    await expect(
      uploadAntigravityHostFile({
        connection,
        transport,
        fileName: "report.pdf",
        bytes,
      }),
    ).rejects.toThrow(
      "The Antigravity bridge could not receive report.pdf (HTTP 503): upload is unavailable",
    );
  });
});
