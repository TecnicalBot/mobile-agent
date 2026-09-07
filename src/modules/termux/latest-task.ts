export type LatestTermuxTask = {
  id: string | null;
  command: string;
};

const latestTermuxTask: LatestTermuxTask = { id: null, command: "" };
const latestTaskListeners = new Set<
  (task: { id: string; command: string }) => void
>();

/**
 * Publishes the most recently launched termux task id so the read-only
 * terminal screen can resolve a task id even when it was opened before the
 * tool result round-trip. Written by the MCP runtime on each termux record.
 */
export function publishLatestTermuxTask(task: LatestTermuxTask) {
  latestTermuxTask.id = task.id ?? latestTermuxTask.id;
  if (task.command) latestTermuxTask.command = task.command;
  if (latestTermuxTask.id) {
    const resolved = {
      id: latestTermuxTask.id,
      command: latestTermuxTask.command,
    };
    latestTaskListeners.forEach((listener) => listener(resolved));
  }
}

/**
 * Subscribes to the latest known termux task. Returns an unsubscribe
 * function. The terminal screen closes over its running taskId so a
 * stale id never hijacks a screen for a different task.
 */
export function subscribeLatestTermuxTask(
  listener: (task: { id: string; command: string }) => void,
): () => void {
  latestTaskListeners.add(listener);
  return () => {
    latestTaskListeners.delete(listener);
  };
}