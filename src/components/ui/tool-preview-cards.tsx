import { type ReactNode } from "react";
import { Text, View } from "react-native";
import {
  BellRing,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Combine,
  Download,
  FilePlus,
  FileText,
  FolderOpen,
  Globe,
  KeyRound,
  ListTodo,
  MessageCircleQuestionMark,
  Mic,
  Plug,
  Scissors,
  Search,
  Volume2,
  type LucideIcon,
} from "lucide-react-native";

import type { ToolExecutionRecord } from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";

/**
 * Purpose-built cards for the expanded tool trace. Each tool gets a layout
 * that matches its result (checklist, file list, schedule, …) instead of a
 * generic `key: value` dump. Cards read `record.outputData`, the full result
 * captured by `createRecord`, and fall back to nothing when there is no data.
 */

type Data = Record<string, unknown>;

function asData(value: unknown): Data | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pick(source: Data | null, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = str(source[key]);
    if (value) return value;
  }
  return null;
}

function formatBytes(value: number | null): string | null {
  if (value === null) return null;
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(amount >= 100 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(value: number | null): string | null {
  if (value === null) return null;
  const seconds = Math.round(value);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function formatTimestamp(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <View
      className={cn(
        "gap-sp-2 rounded-xl border border-border bg-card px-sp-3 py-sp-3 dark:border-border-dark dark:bg-card-dark",
        className,
      )}
    >
      {children}
    </View>
  );
}

function CardHeader({
  icon: Icon,
  title,
  meta,
}: {
  icon: LucideIcon;
  title: string;
  meta?: string | null;
}) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center gap-sp-2">
      <Icon color={theme.textSecondary} size={16} />
      <Text
        className="min-w-0 flex-1 font-sans text-sm font-medium text-muted-foreground dark:text-muted-foreground-dark"
        numberOfLines={1}
      >
        {title}
      </Text>
      {meta ? (
        <Text
          className="shrink-0 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
          numberOfLines={1}
        >
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

function Pill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning";
}) {
  const border =
    tone === "success"
      ? "border-green-500/40"
      : tone === "warning"
        ? "border-amber-500/40"
        : "border-border dark:border-border-dark";
  const text =
    tone === "success"
      ? "text-green-700 dark:text-green-400"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground dark:text-muted-foreground-dark";
  return (
    <View className={cn("shrink-0 rounded-pill border px-2 py-0.5", border)}>
      <Text className={cn("font-sans text-[10px]", text)}>{children}</Text>
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View className="flex-row items-start gap-sp-2">{children}</View>;
}

function Muted({ children, lines }: { children: ReactNode; lines?: number }) {
  return (
    <Text
      className="font-sans text-xs text-muted-foreground opacity-75 dark:text-muted-foreground-dark"
      numberOfLines={lines}
    >
      {children}
    </Text>
  );
}

function More({ count }: { count: number }) {
  return <Muted>{`+${count} more`}</Muted>;
}

function TodoCard({ record }: { record: ToolExecutionRecord }) {
  const theme = useTheme();
  const data = asData(record.outputData);
  const items = Array.isArray(data?.items)
    ? (data.items as { status?: unknown; title?: unknown }[])
    : [];
  if (items.length === 0) return null;

  const done = items.filter((item) => item.status === "completed").length;
  const visible = items.slice(0, 12);

  return (
    <Card>
      <CardHeader
        icon={ListTodo}
        title="Tasks"
        meta={`${done}/${items.length} done`}
      />
      <View className="gap-1.5">
        {visible.map((item, index) => {
          const title = str(item.title) ?? "";
          const completed = item.status === "completed";
          const active = item.status === "in_progress";
          return (
            <Row key={`${title}-${index}`}>
              {completed ? (
                <CheckCircle2 color="#16a34a" size={16} />
              ) : active ? (
                <Clock color="#d97706" size={16} />
              ) : (
                <Circle color={theme.textSecondary} size={16} />
              )}
              <Text
                className={cn(
                  "min-w-0 flex-1 font-sans text-sm",
                  completed
                    ? "text-muted-foreground line-through dark:text-muted-foreground-dark"
                    : "text-muted-foreground dark:text-muted-foreground-dark",
                )}
                numberOfLines={2}
              >
                {title}
              </Text>
            </Row>
          );
        })}
      </View>
      {items.length > visible.length ? (
        <More count={items.length - visible.length} />
      ) : null}
    </Card>
  );
}

function QuestionCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  const answers = Array.isArray(data?.answers)
    ? (data.answers as { id?: unknown; value?: unknown }[])
    : [];
  const items = Array.isArray(data?.items)
    ? (data.items as { id?: unknown; prompt?: unknown }[])
    : [];
  if (answers.length === 0 && items.length === 0) return null;

  const rows = items.length
    ? items.map((item) => ({
        prompt: str(item.prompt) ?? str(item.id) ?? "Question",
        answer:
          answers.find((answer) => str(answer.id) === str(item.id))?.value ??
          null,
      }))
    : answers.map((answer) => ({
        prompt: str(answer.id) ?? "Answer",
        answer: answer.value ?? null,
      }));

  return (
    <Card>
      <CardHeader
        icon={MessageCircleQuestionMark}
        title="Answers"
        meta={`${rows.length}`}
      />
      <View className="gap-sp-2">
        {rows.slice(0, 12).map((row, index) => {
          const answer = Array.isArray(row.answer)
            ? row.answer.map(String).join(", ")
            : str(row.answer);
          return (
            <View key={`${row.prompt}-${index}`} className="gap-1">
              <Muted lines={2}>{row.prompt}</Muted>
              <View className="rounded-lg bg-secondary px-sp-2 py-1.5 dark:bg-secondary-dark">
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  {answer || "No answer"}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      {rows.length > 12 ? <More count={rows.length - 12} /> : null}
    </Card>
  );
}

function PageCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  const url = pick(data, ["url"]);
  const title = pick(data, ["title"]);
  const text = pick(data, ["text"]);
  if (!url && !title) return null;

  return (
    <Card>
      <CardHeader icon={Globe} title={title ?? "Web page"} />
      {url ? (
        <Text
          className="font-sans text-xs text-blue-600 dark:text-blue-400"
          numberOfLines={2}
          selectable
        >
          {url}
        </Text>
      ) : null}
      {text ? (
        <Text
          className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
          numberOfLines={6}
          selectable
        >
          {text}
        </Text>
      ) : null}
      {data?.truncated === true ? (
        <Pill tone="warning">Snippet truncated</Pill>
      ) : null}
    </Card>
  );
}

function VoicesCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  const voices = Array.isArray(data?.voices) ? (data.voices as Data[]) : [];
  const languages = Array.isArray(data?.languages)
    ? (data.languages as unknown[]).map(String)
    : [];
  if (voices.length === 0) return null;

  return (
    <Card>
      <CardHeader
        icon={Mic}
        title="Available voices"
        meta={`${num(data?.count) ?? voices.length} total`}
      />
      {languages.length > 0 ? (
        <View className="flex-row flex-wrap gap-1">
          {languages.slice(0, 10).map((language) => (
            <Pill key={language}>{language}</Pill>
          ))}
          {languages.length > 10 ? <Pill>+{languages.length - 10}</Pill> : null}
        </View>
      ) : null}
      <View className="gap-1.5">
        {voices.slice(0, 8).map((voice, index) => (
          <Row key={`${str(voice.name) ?? index}-${index}`}>
            <Text
              className="min-w-0 flex-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
              numberOfLines={1}
            >
              {str(voice.name) ?? str(voice.locale) ?? "Voice"}
            </Text>
            {str(voice.locale) ? <Pill>{str(voice.locale)}</Pill> : null}
            {str(voice.quality) ? <Pill>{str(voice.quality)}</Pill> : null}
            {voice.networkRequired === true ? (
              <Pill tone="warning">online</Pill>
            ) : null}
          </Row>
        ))}
      </View>
      {voices.length > 8 ? <More count={voices.length - 8} /> : null}
    </Card>
  );
}

function SpeechCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  const parts = Array.isArray(data?.parts) ? (data.parts as Data[]) : [];
  const duration = formatDuration(num(data?.totalDuration));
  if (parts.length === 0 && !duration) return null;

  return (
    <Card>
      <CardHeader
        icon={Volume2}
        title="Narration"
        meta={duration ?? `${parts.length} parts`}
      />
      <View className="flex-row flex-wrap gap-1">
        <Pill>{`${num(data?.partCount) ?? parts.length} parts`}</Pill>
        {str(data?.language) ? <Pill>{str(data?.language)}</Pill> : null}
      </View>
      <View className="gap-1.5">
        {parts.slice(0, 6).map((part, index) => (
          <Row key={`${str(part.fileId) ?? index}-${index}`}>
            <Text
              className="min-w-0 flex-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
              numberOfLines={1}
            >
              {str(part.displayName) ?? `Part ${index + 1}`}
            </Text>
            {formatDuration(num(part.duration)) ? (
              <Muted>{formatDuration(num(part.duration))}</Muted>
            ) : null}
          </Row>
        ))}
      </View>
      {parts.length > 6 ? <More count={parts.length - 6} /> : null}
    </Card>
  );
}

const FILE_CARDS: Record<string, { icon: LucideIcon; title: string }> = {
  downloadFile: { icon: Download, title: "Downloaded file" },
  mergeDocuments: { icon: Combine, title: "Merged document" },
  mergePdfs: { icon: Combine, title: "Merged PDF" },
  splitDocument: { icon: Scissors, title: "Document parts" },
  splitPdf: { icon: Scissors, title: "PDF parts" },
  updateDocument: { icon: FileText, title: "Updated document" },
  createFile: { icon: FilePlus, title: "Created file" },
  write: { icon: FilePlus, title: "Wrote file" },
  deleteEntry: { icon: FileText, title: "Deleted entry" },
  createDirectory: { icon: FolderOpen, title: "Created folder" },
  moveEntry: { icon: FolderOpen, title: "Moved entry" },
  renameEntry: { icon: FileText, title: "Renamed entry" },
  exportWorkspaceFileToFolder: { icon: Download, title: "Exported file" },
  importFolderFileToWorkspace: { icon: FilePlus, title: "Imported file" },
};

function fileRows(data: Data): { name: string; meta: string | null }[] {
  const created = data.created;
  if (Array.isArray(created) && created.length > 0) {
    return created.map((item) => {
      const file = asData(item);
      return {
        name: pick(file, ["displayName", "path", "name", "title"]) ?? "Part",
        meta:
          [formatBytes(num(file?.size)), str(file?.format), str(file?.part)]
            .filter((value): value is string => Boolean(value))
            .join(" · ") || null,
      };
    });
  }

  const name = pick(data, [
    "displayName",
    "destinationPath",
    "relativePath",
    "toPath",
    "fromPath",
    "path",
    "name",
    "deleted",
    "created",
    "updated",
  ]);
  if (!name) return [];

  const meta = [
    formatBytes(num(data.size)),
    pick(data, [
      "format",
      "mimeType",
      "pageCount",
      "unitCount",
      "targetFolder",
    ]),
    str(data.section) ? `${str(data.section)} section` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return [{ name, meta: meta || null }];
}

function FileResultCard({ record }: { record: ToolExecutionRecord }) {
  const iconColor = useTheme().textSecondary;
  const data = asData(record.outputData);
  const rows = data ? fileRows(data) : [];
  if (rows.length === 0) return null;
  const config = FILE_CARDS[record.toolName] ?? {
    icon: FileText,
    title: "File",
  };

  return (
    <Card>
      <CardHeader
        icon={config.icon}
        title={config.title}
        meta={`${rows.length}`}
      />
      <View className="gap-1.5">
        {rows.slice(0, 10).map((row, index) => (
          <Row key={`${row.name}-${index}`}>
            <FileText color={iconColor} size={16} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text
                className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                numberOfLines={1}
              >
                {row.name}
              </Text>
              {row.meta ? <Muted lines={1}>{row.meta}</Muted> : null}
            </View>
          </Row>
        ))}
      </View>
      {rows.length > 10 ? <More count={rows.length - 10} /> : null}
    </Card>
  );
}

function ScheduleCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  const iconColor = useTheme().textSecondary;
  if (!data) return null;

  if (record.toolName === "cancel_schedule") {
    return (
      <Card>
        <CardHeader icon={CalendarClock} title="Schedule canceled" />
        <Muted>{pick(data, ["title", "id"]) ?? "Job removed"}</Muted>
      </Card>
    );
  }

  if (record.toolName === "list_schedules") {
    const schedules = Array.isArray(data.schedules)
      ? (data.schedules as Data[])
      : [];
    return (
      <Card>
        <CardHeader
          icon={CalendarClock}
          title="Scheduled jobs"
          meta={`${num(data.count) ?? schedules.length} total`}
        />
        {schedules.slice(0, 8).map((schedule, index) => (
          <Row key={`${str(schedule.id) ?? index}-${index}`}>
            <ChevronRight color={iconColor} size={14} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text
                className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                numberOfLines={1}
              >
                {str(schedule.title) ?? "Job"}
              </Text>
              <Muted lines={1}>
                {formatTimestamp(schedule.nextRunAt) ??
                  str(schedule.schedule) ??
                  "No next run"}
              </Muted>
            </View>
            {schedule.enabled === false ? (
              <Pill tone="warning">paused</Pill>
            ) : null}
          </Row>
        ))}
        {schedules.length === 0 ? <Muted>No jobs scheduled.</Muted> : null}
        {schedules.length > 8 ? <More count={schedules.length - 8} /> : null}
      </Card>
    );
  }

  const title = pick(data, ["title"]) ?? "Scheduled job";
  const nextRun = formatTimestamp(data.nextRunAt);
  return (
    <Card>
      <CardHeader
        icon={CalendarClock}
        title={title}
        meta={str(data.timezone) ?? undefined}
      />
      {str(data.schedule) ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {str(data.schedule)}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-1">
        {str(data.expression) ? <Pill>{str(data.expression)}</Pill> : null}
        {nextRun ? <Pill tone="success">Next {nextRun}</Pill> : null}
        {data.enabled === false ? <Pill tone="warning">paused</Pill> : null}
        {data.autoApprove === true ? <Pill>auto-approve</Pill> : null}
      </View>
      {str(data.prompt) ? <Muted lines={3}>{str(data.prompt)}</Muted> : null}
    </Card>
  );
}

const MANAGEMENT_CARDS: Record<
  string,
  { icon: LucideIcon; title: string; noun: string }
> = {
  manageAgent: { icon: Bot, title: "Agents", noun: "agent" },
  managePlugin: { icon: Plug, title: "Plugins", noun: "plugin" },
  manageSkill: { icon: BookOpen, title: "Skills", noun: "skill" },
  importSkillFromUrl: {
    icon: BookOpen,
    title: "Imported skill",
    noun: "skill",
  },
};

function ManagementCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  if (!data) return null;
  const config = MANAGEMENT_CARDS[record.toolName];
  if (!config) return null;

  const changed = pick(data, ["deleted", "created", "updated"]);
  const items =
    (Array.isArray(data.agents) ? data.agents : null) ??
    (Array.isArray(data.skills) ? data.skills : null) ??
    (Array.isArray(data.plugins) ? data.plugins : null);

  if (changed) {
    const action = str(data.deleted)
      ? "Deleted"
      : str(data.created)
        ? "Created"
        : "Updated";
    return (
      <Card>
        <CardHeader icon={config.icon} title={`${action} ${config.noun}`} />
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {changed}
        </Text>
        {str(data.name) && str(data.name) !== changed ? (
          <Muted>{str(data.name)}</Muted>
        ) : null}
        {str(data.version) ? <Pill>{`v${str(data.version)}`}</Pill> : null}
      </Card>
    );
  }

  if (str(data.name)) {
    return (
      <Card>
        <CardHeader
          icon={config.icon}
          title={config.title}
          meta={str(data.version) ? `v${str(data.version)}` : null}
        />
        <Muted>
          {data.wasUpdate === true ? "Updated plugin" : "Installed plugin"}
        </Muted>
        <View className="flex-row flex-wrap gap-1">
          {num(data.tools) !== null ? (
            <Pill>{`${num(data.tools)} tools`}</Pill>
          ) : null}
          {num(data.actions) !== null ? (
            <Pill>{`${num(data.actions)} actions`}</Pill>
          ) : null}
          {num(data.files) !== null ? (
            <Pill>{`${num(data.files)} files`}</Pill>
          ) : null}
          {data.secretsMissing === true ? (
            <Pill tone="warning">secrets missing</Pill>
          ) : null}
        </View>
      </Card>
    );
  }

  const list = Array.isArray(items) ? (items as Data[]) : [];
  if (list.length === 0) return null;
  return (
    <Card>
      <CardHeader
        icon={config.icon}
        title={config.title}
        meta={`${num(data.count) ?? list.length} total`}
      />
      {list.slice(0, 8).map((item, index) => (
        <Row key={`${pick(item, ["name", "title"]) ?? index}-${index}`}>
          <Text
            className="min-w-0 flex-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
            numberOfLines={1}
          >
            {pick(item, ["name", "title"]) ?? config.noun}
          </Text>
          {pick(item, ["description", "model", "mode"]) ? (
            <Muted lines={1}>
              {pick(item, ["description", "model", "mode"])}
            </Muted>
          ) : null}
        </Row>
      ))}
      {list.length > 8 ? <More count={list.length - 8} /> : null}
    </Card>
  );
}

function AnnouncementCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  const message = str(data?.message) ?? str(record.announcement?.message);
  return (
    <Card>
      <CardHeader icon={BellRing} title="Announcement armed" />
      <Muted>{message ?? "You will be notified when this run finishes."}</Muted>
    </Card>
  );
}

function SecretCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  if (!data) return null;
  return (
    <Card>
      <CardHeader
        icon={KeyRound}
        title="Secret request"
        meta={str(data.status)}
      />
      {str(data.key) ? <Muted>{`Key: ${str(data.key)}`}</Muted> : null}
    </Card>
  );
}

const BROWSER_ACTIONS: Record<string, string> = {
  open: "Opened page",
  navigate: "Opened page",
  search: "Searched the web",
  click: "Clicked a link",
  type: "Typed into page",
  scroll: "Scrolled page",
  read: "Read page",
};

function BrowserCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  if (!data) return null;
  const action = str(data.action) ?? "browser";
  const url = str(data.url);
  const title = str(data.title);

  return (
    <Card>
      <CardHeader
        icon={Globe}
        title={BROWSER_ACTIONS[action] ?? "Used the browser"}
        meta={title ?? undefined}
      />
      {url ? (
        <Text
          className="font-sans text-xs text-blue-600 dark:text-blue-400"
          numberOfLines={2}
          selectable
        >
          {url}
        </Text>
      ) : null}
      {action === "read" && str(data.text) ? (
        <Text
          className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
          numberOfLines={5}
          selectable
        >
          {str(data.text)}
        </Text>
      ) : null}
      {num(data.links) !== null ? (
        <Pill>{`${num(data.links)} links`}</Pill>
      ) : null}
    </Card>
  );
}

const SEARCH_TOOLS = new Set(["grep", "glob", "listFiles", "listDirectory"]);

function resultLine(item: unknown): string {
  if (typeof item === "string" || typeof item === "number") return String(item);
  const object = asData(item);
  if (!object) return String(item);
  const path = pick(object, ["path", "file", "displayName", "name"]);
  const line = num(object.line);
  const content = pick(object, ["content", "text", "lineText"]);
  return (
    [path ? (line !== null ? `${path}:${line}` : path) : null, content]
      .filter((value): value is string => Boolean(value))
      .join(" · ") || JSON.stringify(object).slice(0, 160)
  );
}

function SearchCard({ record }: { record: ToolExecutionRecord }) {
  const data = asData(record.outputData);
  const lines = Array.isArray(data?.matches)
    ? (data.matches as unknown[]).map(resultLine)
    : Array.isArray(data?.files)
      ? (data.files as unknown[]).map(resultLine)
      : [];
  const text = record.preview?.text ?? lines.join("\n");
  if (!text?.trim()) return null;
  const Icon = record.toolName === "listDirectory" ? FolderOpen : Search;
  const count = num(data?.count);
  const title =
    record.preview?.title ??
    (count !== null ? `${count} ${count === 1 ? "result" : "results"}` : "Results");
  return (
    <Card>
      <CardHeader
        icon={Icon}
        title={title}
        meta={record.preview?.truncated || data?.truncated === true ? "Truncated" : null}
      />
      <Text
        className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark"
        numberOfLines={12}
        selectable
      >
        {text}
      </Text>
    </Card>
  );
}

const MEDIA_TEXT_TOOLS = new Set([
  "renderVideo",
  "previewMix",
  "analyzeAudio",
  "transcribeAudio",
  "ocr",
]);

function MediaTextCard({ record }: { record: ToolExecutionRecord }) {
  const text = record.preview?.text;
  if (!text?.trim()) return null;
  const Icon = record.toolName === "ocr" ? Search : Volume2;
  return (
    <Card>
      <CardHeader
        icon={Icon}
        title={record.preview?.title ?? "Result"}
        meta={record.preview?.truncated ? "Truncated" : null}
      />
      <Text
        className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
        numberOfLines={12}
        selectable
      >
        {text}
      </Text>
    </Card>
  );
}

/**
 * Cards that already present the captured text themselves, so the renderer
 * should not also print the raw `preview.text` block underneath them.
 */
export function toolCardShowsText(toolName: string): boolean {
  return (
    SEARCH_TOOLS.has(toolName) ||
    MEDIA_TEXT_TOOLS.has(toolName) ||
    TEXT_CARD_TOOLS.has(toolName)
  );
}

const TEXT_CARD_TOOLS = new Set([
  "todos",
  "question",
  "fetchPage",
  "listVoices",
  "textToSpeech",
  "announceWhenDone",
  "requestSecret",
  "schedule_task",
  "list_schedules",
  "update_schedule",
  "cancel_schedule",
  "manageAgent",
  "managePlugin",
  "manageSkill",
  "importSkillFromUrl",
  "browser",
]);

/** Returns null when the tool has no dedicated card (plain text/image rows stay as-is). */
export function ToolTraceCard({ record }: { record: ToolExecutionRecord }) {
  switch (record.toolName) {
    case "todos":
      return <TodoCard record={record} />;
    case "question":
      return <QuestionCard record={record} />;
    case "fetchPage":
      return <PageCard record={record} />;
    case "listVoices":
      return <VoicesCard record={record} />;
    case "textToSpeech":
      return <SpeechCard record={record} />;
    case "announceWhenDone":
      return <AnnouncementCard record={record} />;
    case "requestSecret":
      return <SecretCard record={record} />;
    case "schedule_task":
    case "list_schedules":
    case "update_schedule":
    case "cancel_schedule":
      return <ScheduleCard record={record} />;
    case "manageAgent":
    case "managePlugin":
    case "manageSkill":
    case "importSkillFromUrl":
      return <ManagementCard record={record} />;
    case "browser":
      return <BrowserCard record={record} />;
    default:
      if (SEARCH_TOOLS.has(record.toolName))
        return <SearchCard record={record} />;
      if (MEDIA_TEXT_TOOLS.has(record.toolName))
        return <MediaTextCard record={record} />;
      return FILE_CARDS[record.toolName] ? (
        <FileResultCard record={record} />
      ) : null;
  }
}
