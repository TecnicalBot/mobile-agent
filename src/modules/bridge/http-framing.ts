const MAX_HEADERS = 16_384;
const MAX_BODY = 2_500_000;

export type FramedRequest = {
  method: string;
  target: string;
  headers: Record<string, string>;
  body: Uint8Array;
};

/** Deliberately narrow HTTP/1.1: one Content-Length request per connection, no proxying. */
export function createHttpRequestDecoder() {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let headerEnd = -1;
  let bodyLength = 0;
  let head: Omit<FramedRequest, "body"> | null = null;
  let finished = false;
  let prefix = new Uint8Array();
  return (chunk: Uint8Array): FramedRequest | null => {
    if (finished)
      throw new Error("Only one request is accepted per connection.");
    bytes += chunk.length;
    if (bytes > MAX_BODY + MAX_HEADERS) throw new Error("Request too large.");
    chunks.push(chunk);
    if (headerEnd < 0) {
      const next = new Uint8Array(prefix.length + chunk.length);
      next.set(prefix);
      next.set(chunk, prefix.length);
      prefix = next;
      for (let index = 0; index <= prefix.length - 4; index++) {
        if (
          prefix[index] === 13 &&
          prefix[index + 1] === 10 &&
          prefix[index + 2] === 13 &&
          prefix[index + 3] === 10
        ) {
          headerEnd = index + 4;
          break;
        }
      }
      if (headerEnd < 0) {
        if (bytes > MAX_HEADERS) throw new Error("Headers too large.");
        return null;
      }
      if (headerEnd > MAX_HEADERS) throw new Error("Headers too large.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        prefix.slice(0, headerEnd - 4),
      );
      const [line, ...lines] = text.split("\r\n");
      const match = /^(POST|GET|DELETE) (\/[^ ]*) HTTP\/1\.1$/.exec(line);
      if (!match) throw new Error("Invalid request line.");
      const headers: Record<string, string> = {};
      for (const entry of lines) {
        const field = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(
          entry,
        );
        if (!field) throw new Error("Invalid header.");
        const name = field[1].toLowerCase();
        if (Object.hasOwn(headers, name)) throw new Error("Duplicate header.");
        headers[name] = field[2].trim();
      }
      if (!headers.host || headers["transfer-encoding"] || headers.expect)
        throw new Error("Unsupported framing.");
      if (match[1] === "POST" && !headers["content-length"])
        throw new Error("Content-Length required.");
      const length = headers["content-length"] ?? "0";
      if (!/^\d+$/.test(length)) throw new Error("Invalid Content-Length.");
      bodyLength = Number(length);
      if (!Number.isSafeInteger(bodyLength) || bodyLength > MAX_BODY)
        throw new Error("Body too large.");
      head = { method: match[1], target: match[2], headers };
      prefix = new Uint8Array();
    }
    if (bytes > headerEnd + bodyLength)
      throw new Error("Trailing data is not accepted.");
    if (bytes < headerEnd + bodyLength) return null;
    finished = true;
    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const part of chunks) {
      all.set(part, offset);
      offset += part.length;
    }
    return { ...head!, body: all.slice(headerEnd) };
  };
}
