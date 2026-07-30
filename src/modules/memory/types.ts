import type { MemoryEntry } from "@/core/types/app-state";

export interface MemoryStore {
  clear(): Promise<void>;
  read(): Promise<MemoryEntry | null>;
  write(content: string): Promise<MemoryEntry>;
}
