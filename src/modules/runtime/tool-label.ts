/**
 * "viewFile" → "View File", "fetch_page" → "Fetch Page". Shared by the tool
 * approval drawer and the chat trace rows so tools read the same everywhere.
 */
import {
  AudioLines,
  AudioWaveform,
  BellRing,
  BookOpen,
  BookOpenText,
  Bot,
  Braces,
  CalendarClock,
  Captions,
  Clapperboard,
  Combine,
  Download,
  Eye,
  FilePen,
  FilePlus,
  FileText,
  FolderInput,
  FolderOpen,
  FolderOutput,
  FolderPlus,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Link,
  ListTodo,
  MessageCircleQuestionMark,
  Mic,
  Pencil,
  Plug,
  ScanText,
  Scissors,
  Search,
  Settings2,
  Terminal,
  Trash2,
  type LucideIcon,
  Video,
  Volume2,
  Wrench,
} from "lucide-react-native";

export function formatToolName(toolName: string) {
  if (!toolName) {
    return "Tool";
  }

  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

/**
 * The sentence verb for a tool's trace row. Write it as what already
 * happened: "Viewed", "Searched", "Failed to run" handles status.
 */
const TOOL_TRACE_VERBS: Record<string, string> = {
  analyzeAudio: "Analyzed",
  announceWhenDone: "Armed an announcement for",
  browser: "Used the browser on",
  cancel_schedule: "Canceled the schedule for",
  createDirectory: "Created folder",
  createFile: "Created",
  deleteEntry: "Deleted",
  downloadFile: "Downloaded",
  edit: "Edited",
  exportWorkspaceFileToFolder: "Exported",
  fetchPage: "Fetched",
  getVideoFrame: "Grabbed a frame from",
  glob: "Searched",
  grep: "Searched",
  importFolderFileToWorkspace: "Imported",
  importSkillFromUrl: "Imported",
  listDirectory: "Listed",
  listFiles: "Listed",
  listVoices: "Listed voices with",
  list_schedules: "Listed schedules with",
  manageAgent: "Managed agents with",
  managePlugin: "Managed plugins with",
  manageSkill: "Managed skills with",
  mergeDocuments: "Merged",
  mergePdfs: "Merged",
  moveEntry: "Moved",
  ocr: "Read text from",
  previewMix: "Checked audio for",
  previewScene: "Previewed",
  question: "Asked",
  read: "Read",
  renderVideo: "Rendered",
  renameEntry: "Renamed",
  requestSecret: "Requested a secret for",
  schedule_task: "Scheduled",
  shell: "Ran",
  skill: "Loaded",
  skillReadFile: "Read",
  splitDocument: "Split",
  splitPdf: "Split",
  task: "Ran task with",
  textToSpeech: "Spoke with",
  todos: "Updated tasks with",
  transcribeAudio: "Transcribed",
  updateDocument: "Updated",
  update_schedule: "Updated the schedule for",
  viewFile: "Viewed",
  write: "Wrote",
};

export function toolTraceVerb(toolName: string) {
  return TOOL_TRACE_VERBS[toolName] ?? "Used";
}

// —─── Trace row helpers shared by chat rows and the approval drawer ────────

const TOOL_TRACE_ICONS: Record<string, LucideIcon> = {
  analyzeAudio: AudioWaveform,
  announceWhenDone: BellRing,
  browser: Globe,
  cancel_schedule: CalendarClock,
  createDirectory: FolderPlus,
  createFile: FilePlus,
  deleteEntry: Trash2,
  downloadFile: Download,
  edit: Pencil,
  exportWorkspaceFileToFolder: FolderOutput,
  fetchPage: Globe,
  getVideoFrame: Video,
  glob: Search,
  grep: Search,
  importFolderFileToWorkspace: FolderInput,
  importSkillFromUrl: Link,
  listDirectory: FolderOpen,
  listFiles: FolderOpen,
  listVoices: Mic,
  list_schedules: CalendarClock,
  manageAgent: Settings2,
  managePlugin: Settings2,
  manageSkill: Settings2,
  mergeDocuments: Combine,
  mergePdfs: Combine,
  moveEntry: FolderInput,
  ocr: ScanText,
  previewMix: AudioLines,
  previewScene: Clapperboard,
  question: MessageCircleQuestionMark,
  read: FileText,
  renderVideo: Video,
  renameEntry: FilePen,
  requestSecret: KeyRound,
  schedule_task: CalendarClock,
  shell: Terminal,
  skill: BookOpen,
  skillReadFile: BookOpenText,
  splitDocument: Scissors,
  splitPdf: Scissors,
  task: Bot,
  textToSpeech: Volume2,
  todos: ListTodo,
  transcribeAudio: Captions,
  updateDocument: FilePen,
  update_schedule: CalendarClock,
  viewFile: Eye,
  write: FilePen,
};

/**
 * Tool names come from built-ins, MCP servers, harnesses, and plugins, so the
 * exact-name table can never be complete. Match the operation's wording first
 * — a remote `bash` or `exec_command` should read as a terminal, not a wrench.
 * Order matters: more specific concepts (search, audio, video) win over the
 * generic file/agent buckets.
 */
const TOOL_TRACE_ICON_PATTERNS: readonly (readonly [RegExp, LucideIcon])[] = [
  [/search|grep|glob|find_|_find|lookup/i, Search],
  [/audio|voice|speech|transcri|mix|sound|volume/i, AudioLines],
  [/video|frame|scene|clapper|render|movie|film/i, Video],
  [/image|photo|ocr|screenshot|vision/i, ImageIcon],
  [/shell|command|terminal|bash|zsh|exec|process|pty|console/i, Terminal],
  [/schedule|calendar|cron|reminder|timer/i, CalendarClock],
  [/folder|director|directory|path/i, FolderOpen],
  [/todo|task_list|checklist|plan/i, ListTodo],
  [/secret|key|token|credential|password/i, KeyRound],
  [/browser|url|http|fetch|web|page/i, Globe],
  [/download|upload|export|import/i, Download],
  [/merge|combine|join/i, Combine],
  [/split|scissor|cut|trim/i, Scissors],
  [/agent|subagent|assistant/i, Bot],
  [/plugin|mcp|integration|extension|tool/i, Plug],
  [/json|schema|config|settings|manage/i, Braces],
  [/file|document|pdf|doc|text|read|write|edit|patch|code/i, FileText],
];

const DEFAULT_TOOL_TRACE_ICON = Wrench;

/** The icon that names the tool kind in trace and approval rows. */
export function toolTraceIcon(toolName: string): LucideIcon {
  const exact = TOOL_TRACE_ICONS[toolName];
  if (exact) {
    return exact;
  }

  for (const [pattern, icon] of TOOL_TRACE_ICON_PATTERNS) {
    if (pattern.test(toolName)) {
      return icon;
    }
  }

  return DEFAULT_TOOL_TRACE_ICON;
}

/**
 * A short human object for trace titles/approvals, picked from the recorded
 * input summary (`name`, `url`, `query`…). Returns null when the summary
 * holds nothing readable — algorithmic ids never make it into titles.
 */
export function toolObjectLabel(inputSummary: string | null | undefined) {
  if (!inputSummary) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputSummary);
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed instanceof Error
  ) {
    return null;
  }

  const candidateKeys = [
    "name",
    "path",
    "file",
    "displayName",
    "title",
    "label",
    "url",
    "query",
    "pattern",
    "command",
  ] as const;

  for (const key of candidateKeys) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || /^[a-z0-9_-]{16,}$/i.test(trimmed)) {
      continue;
    }
    return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
  }

  return null;
}
