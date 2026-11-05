import { describe, expect, it, vi } from "vitest";
import {
  openCodeHostUploadPath,
  uploadOpenCodeHostFile,
} from "./opencode-host-files";

const bytes = new TextEncoder().encode("attachment");

describe("OpenCode host uploads", () => {
  it("keeps upload paths inside the server's temporary directory", () => {
    expect(
      openCodeHostUploadPath({
        temporaryRoot: "/tmp/opencode/",
        uploadID: "../../session",
        fileName: "../My Report.pdf",
      }),
    ).toBe("/tmp/opencode/uploads/mobile-agent/session/My-Report.pdf");
  });

  it("streams the file to the host and returns the resolved path", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { path: "/tmp/opencode/uploads/a/report.pdf" } }),
    );
    const path = await uploadOpenCodeHostFile({
      connection: {
        url: "https://agent.example",
        username: "opencode",
        password: "secret",
        directory: "",
      },
      transport,
      directory: "/project",
      temporaryRoot: "/tmp/opencode",
      uploadID: "upload-1",
      fileName: "report.pdf",
      bytes,
    });

    expect(path).toBe("/tmp/opencode/uploads/a/report.pdf");
    const [input, options] = transport.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe("/api/experimental/fs/write");
    expect(url.searchParams.get("path")).toBe(
      "/tmp/opencode/uploads/mobile-agent/upload-1/report.pdf",
    );
    expect(url.searchParams.get("location[directory]")).toBe("/project");
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(bytes);
    expect(new Headers(options?.headers).get("authorization")).toBe(
      `Basic ${btoa("opencode:secret")}`,
    );
  });

  it("streams large files through the native upload handle", async () => {
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
        status: 200,
        body: JSON.stringify({
          data: { path: "/tmp/opencode/uploads/a/report.pdf" },
        }),
      }),
    );

    const path = await uploadOpenCodeHostFile({
      connection: {
        url: "https://agent.example",
        username: "opencode",
        password: "secret",
        directory: "",
      },
      transport,
      temporaryRoot: "/tmp/opencode",
      uploadID: "upload-1",
      fileName: "report.pdf",
      source: {
        exists: true,
        size: 50 * 1024 * 1024,
        bytes: async () => bytes,
        upload,
      },
    });

    expect(path).toBe("/tmp/opencode/uploads/a/report.pdf");
    expect(transport).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledOnce();
    const [url, options] = upload.mock.calls[0]!;
    expect(url).toContain("/api/experimental/fs/write");
    expect(options).toMatchObject({
      httpMethod: "POST",
      uploadType: 0,
    });
    expect(new Headers(options?.headers).get("authorization")).toBe(
      `Basic ${btoa("opencode:secret")}`,
    );
  });

  it("surfaces rejections instead of dropping the attachment", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      new Response("upload is unavailable", { status: 503 }),
    );

    await expect(
      uploadOpenCodeHostFile({
        connection: {
          url: "http://localhost:4096",
          username: "",
          password: "",
          directory: "",
        },
        transport,
        temporaryRoot: "/tmp/opencode",
        uploadID: "upload-1",
        fileName: "report.pdf",
        bytes,
      }),
    ).rejects.toThrow(
      "OpenCode could not receive report.pdf (HTTP 503): upload is unavailable",
    );
  });
});
