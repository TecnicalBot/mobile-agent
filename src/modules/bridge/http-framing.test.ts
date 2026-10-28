import { describe, expect, it } from "vitest";
import { createHttpRequestDecoder } from "./http-framing";

describe("bridge HTTP framing", () => {
  it("handles fragmented headers, bodies and multi-byte UTF-8 characters", () => {
    const body = new TextEncoder().encode('{"text":"世界"}');
    const header = new TextEncoder().encode(
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${body.length}\r\n\r\n`,
    );
    const all = new Uint8Array(header.length + body.length);
    all.set(header);
    all.set(body, header.length);
    const decode = createHttpRequestDecoder();
    expect(decode(all.slice(0, 15))).toBeNull();
    expect(decode(all.slice(15, all.length - 2))).toBeNull();
    expect(new TextDecoder().decode(decode(all.slice(-2))!.body)).toBe(
      '{"text":"世界"}',
    );
  });

  it.each([
    "POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n",
    "POST /mcp HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n",
    "POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Length: 99999999\r\n\r\n",
    "POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Length: -1\r\n\r\n",
    "POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\ntrailing",
    "POST https://evil.example/mcp HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n",
  ])("rejects unsupported or ambiguous request framing", (request) => {
    expect(() =>
      createHttpRequestDecoder()(new TextEncoder().encode(request)),
    ).toThrow();
  });
});
