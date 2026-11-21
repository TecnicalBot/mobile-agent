import { formatToolName } from "@/modules/runtime/tool-name";
import type { AssistantPart } from "./assistant-parts";

export type ToolAssistantPart = Extract<AssistantPart, { kind: "tool" }>;
export type ToolTraceGroup = {
  kind: "tool-group";
  key: string;
  parts: ToolAssistantPart[];
};
export type GroupedAssistantPart = AssistantPart | ToolTraceGroup;

const GROUP_LABELS: Record<string, readonly [verb: string, object: string]> = {
  shell: ["Ran", "commands"],
  bash: ["Ran", "commands"],
  zsh: ["Ran", "commands"],
  exec_command: ["Ran", "commands"],
  run_command: ["Ran", "commands"],
  execute_command: ["Ran", "commands"],
  run_shell_command: ["Ran", "commands"],
  read: ["Read", "files"],
  read_file: ["Read", "files"],
  skill_read_file: ["Read", "files"],
  edit: ["Made", "edits"],
  edit_file: ["Made", "edits"],
  apply_patch: ["Applied", "patches"],
  write: ["Wrote", "files"],
  write_file: ["Wrote", "files"],
  create_file: ["Created", "files"],
  view_file: ["Viewed", "files"],
  grep: ["Ran", "searches"],
  glob: ["Ran", "file searches"],
  search: ["Ran", "searches"],
  websearch: ["Ran", "web searches"],
  web_search: ["Ran", "web searches"],
  fetch_page: ["Fetched", "pages"],
  webfetch: ["Fetched", "pages"],
  web_fetch: ["Fetched", "pages"],
  list_directory: ["Listed", "directories"],
  list_files: ["Listed", "file collections"],
  create_directory: ["Created", "folders"],
  download_file: ["Downloaded", "files"],
  task: ["Ran", "tasks"],
};

export function toolTraceGroupTitle(parts: ToolAssistantPart[]): string {
  const { toolName, termux } = parts[0].record;
  const name = toolName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const label = termux ? GROUP_LABELS.shell : GROUP_LABELS[name];
  return label
    ? `${label[0]} ${parts.length} ${label[1]}`
    : `Used ${formatToolName(toolName)} ${parts.length} times`;
}

/** Only fold adjacent successes; never hide a running call, error or stream boundary. */
export function groupAssistantParts(parts: AssistantPart[]): GroupedAssistantPart[] {
  const grouped: GroupedAssistantPart[] = [];
  let pending: ToolAssistantPart[] = [];
  const flush = () => {
    if (pending.length === 1) grouped.push(pending[0]);
    else if (pending.length > 1) {
      grouped.push({ kind: "tool-group", key: `group-${pending[0].key}`, parts: pending });
    }
    pending = [];
  };

  for (const part of parts) {
    if (part.kind === "tool" && part.record.status === "completed" && !part.record.error) {
      if (pending.length && pending[0].record.toolName !== part.record.toolName) flush();
      pending.push(part);
    } else {
      flush();
      grouped.push(part);
    }
  }
  flush();
  return grouped;
}
