import type { ReasoningBlock } from "@/core/types/app-state";

/** Some providers omit reasoning-end before switching to text or tools. */
export function closeReasoningPhases(
  active: Map<string, ReasoningBlock>,
  now = new Date().toISOString(),
) {
  let changed = false;
  for (const block of active.values()) {
    if (block.completedAt === null) {
      block.completedAt = now;
      changed = true;
    }
  }
  return changed;
}

/** Providers may reuse a reasoning ID on every model/tool step. */
export function updateReasoningPhase(
  blocks: ReasoningBlock[],
  active: Map<string, ReasoningBlock>,
  event: { id: string; kind: string; text?: unknown; textOffset: number },
  nextOrder: () => number,
  now = new Date().toISOString(),
) {
  let block = active.get(event.id);
  if (!block || (block.completedAt !== null && event.kind !== "reasoning-end")) {
    const traceOrder = nextOrder();
    block = {
      id: blocks.some((item) => item.id === event.id) ? `${event.id}:${traceOrder}` : event.id,
      text: "",
      textOffset: event.textOffset,
      traceOrder,
      startedAt: now,
      completedAt: null,
    };
    blocks.push(block);
    active.set(event.id, block);
  }
  if (event.kind === "reasoning-delta" && typeof event.text === "string") block.text += event.text;
  if (event.kind === "reasoning-end") block.completedAt ??= now;
  return block;
}
