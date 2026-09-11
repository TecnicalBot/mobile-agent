import type { KVNamespace } from "@cloudflare/workers-types";

type Entry = { value: string; expiresAt?: number };

/**
 * In-memory KV that mirrors the subset of `KVNamespace` the worker uses, so the
 * flow controller can be tested in a plain Node vitest environment.
 */
export class MemoryKV {
  private store = new Map<string, Entry>();

  constructor(private now: () => number = () => Date.now()) {}

  /** Direct access for asserting on internals. */
  get size(): number {
    return this.store.size;
  }

  entries(): Map<string, Entry> {
    return this.store;
  }

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= this.now();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream | null,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    if (value === null) {
      this.store.delete(key);
      return;
    }

    const expiresAt = options?.expirationTtl
      ? this.now() + options.expirationTtl * 1000
      : undefined;

    this.store.set(key, {
      value: value instanceof ArrayBuffer
        ? new TextDecoder().decode(value)
        : String(value),
      expiresAt,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor: string;
  }> {
    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 1000;
    const keys: { name: string }[] = [];

    for (const [name, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(name);
        continue;
      }

      if (name.startsWith(prefix)) {
        keys.push({ name });
        if (keys.length >= limit) break;
      }
    }

    return { keys, list_complete: true, cursor: "" };
  }
}