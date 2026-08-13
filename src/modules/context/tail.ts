import type { ModelMessage } from "ai";

export type TailSelection = { tailStartIndex: number };

type Turn = { start: number; end: number };

function turnSize(
  messages: ModelMessage[],
  turn: Turn,
  estimate: (message: ModelMessage) => number,
): number {
  let total = 0;
  for (let i = turn.start; i < turn.end; i++) {
    total += estimate(messages[i]!);
  }
  return total;
}

function splitTurn(
  messages: ModelMessage[],
  turn: Turn,
  budget: number,
  estimate: (message: ModelMessage) => number,
): number | undefined {
  if (budget <= 0) return undefined;
  if (turn.end - turn.start <= 1) return undefined;
  for (let start = turn.start + 1; start < turn.end; start++) {
    let size = 0;
    for (let i = start; i < turn.end; i++) {
      size += estimate(messages[i]!);
    }
    if (size <= budget) return start;
  }
  return undefined;
}

export function selectTail(input: {
  messages: ModelMessage[];
  tailTurns?: number;
  preserveRecentTokens?: number;
  estimate: (message: ModelMessage) => number;
}): TailSelection | undefined {
  const { messages, estimate } = input;
  if (messages.length === 0) return undefined;

  const tailTurns = input.tailTurns ?? 2;
  if (tailTurns <= 0) return { tailStartIndex: 0 };

  const budget = input.preserveRecentTokens ?? 8_000;

  const turnStarts: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "user") turnStarts.push(i);
  }
  if (turnStarts.length === 0) return undefined;

  let total = 0;
  let tailStartIndex: number | undefined;

  for (let t = turnStarts.length - 1; t >= 0; t--) {
    const turn: Turn = {
      start: turnStarts[t]!,
      end: t + 1 < turnStarts.length ? turnStarts[t + 1]! : messages.length,
    };

    const size = turnSize(messages, turn, estimate);
    if (total + size <= budget) {
      total += size;
      tailStartIndex = turn.start;
      if (turnStarts.length - t >= tailTurns) break;
      continue;
    }

    const remaining = budget - total;
    const split = splitTurn(messages, turn, remaining, estimate);
    if (split !== undefined) {
      tailStartIndex = split;
    }
    break;
  }

  if (tailStartIndex === undefined || tailStartIndex === 0) return undefined;
  return { tailStartIndex };
}
