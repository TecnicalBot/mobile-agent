import { ChevronLeft, ChevronRight, FileText, Play, Plus, Trash2, Wrench } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import {
  PluginCapabilityForm,
  findInvalidJsonField,
  serializePluginArgs,
  splitFormSchema,
  type JsonSchema,
  type PluginRunArgs,
} from "@/components/plugins/plugin-capability-form";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { DrawerPager, DrawerPagerPage } from "@/components/ui/drawer-pager";
import { FilePreviewDialog } from "@/components/ui/file-preview-dialog";
import { Label } from "@/components/ui/label";
import type { WorkspaceFile } from "@/core/types/app-state";
import { useConfig } from "@/hooks/use-config";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import type { PluginProgressUpdate, PluginToolResult } from "@/modules/plugins/types";

export type CapabilityKind = "action" | "tool";

export type PluginCapability = {
  description?: string;
  inputSchema?: Record<string, unknown>;
  kind: CapabilityKind;
  mutating?: boolean;
  name: string;
  title: string;
};

type RunResult = {
  attachments?: { filename?: string; mime: string; uri: string }[];
  error?: string;
  output?: string;
  title?: string;
};

function isHtmlOutput(output: string): boolean {
  const trimmed = output.trimStart().toLowerCase();
  return (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    output.toLowerCase().includes("</html>")
  );
}

function isMissingValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function getMissingRequired(
  schema: Record<string, unknown> | undefined,
  args: PluginRunArgs,
): string[] {
  const input = (schema ?? {}) as {
    properties?: Record<string, unknown>;
    required?: unknown;
  };
  const properties = input.properties ?? {};
  const required = Array.isArray(input.required)
    ? input.required.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  return required.filter(
    (name) =>
      name in properties ? isMissingValue(args[name]) : false,
  );
}

export function PluginCapabilityRunner({
  capability,
  onRun,
}: {
  capability: PluginCapability;
  onRun: (
    args: PluginRunArgs,
    onProgress?: (update: PluginProgressUpdate) => void,
  ) => Promise<PluginToolResult>;
}) {
  const theme = useTheme();
  const { createWorkspaceFile } = useConfig();
  const { workspaceFiles } = useChat();
  const [inputOpen, setInputOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<WorkspaceFile[]>([]);
  const [args, setArgs] = useState<PluginRunArgs>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<RunResult | null>(null);

  const Icon = capability.kind === "action" ? Play : Wrench;

  const openInput = () => {
    setPreviewFile(null);
    setPage(0);
    setInputOpen(true);
  };

  const handleRun = async (): Promise<void> => {
    if (running) return;

    // Validate before leaving the inputs page: required errors surface as
    // an alert and the output page never opens.
    const missing = getMissingRequired(capability.inputSchema, args);
    if (missing.length > 0) {
      Alert.alert(
        "Missing required inputs",
        `Please fill in: ${missing.join(", ")}`,
      );
      return;
    }

    const badJson = findInvalidJsonField(capability.inputSchema, args);
    if (badJson) {
      Alert.alert(
        "Invalid JSON",
        `${badJson} is not valid JSON. Fix it before running.`,
      );
      return;
    }

    setPage(1);
    setRunning(true);
    setPreviewFile(null);
    setGeneratedFiles([]);
    setProgress(undefined);
    setResult(null);

    try {
      const serialized = serializePluginArgs(capability.inputSchema, args);
      const rawResult = await onRun(serialized, (update) =>
        setProgress(update.title),
      );

      const isString = typeof rawResult === "string";
      const output = isString ? rawResult : rawResult.output;
      const attachments = isString ? [] : [...(rawResult.attachments ?? [])];

      let savedHtml = false;

      if (output && isHtmlOutput(output)) {
        const saved = await createWorkspaceFile({
          content: output,
          name: `${capability.name}.html`,
        });
        setGeneratedFiles([saved]);
        savedHtml = true;
        attachments.push({
          filename: saved.displayName,
          mime: "text/html",
          uri: `workspace://${saved.id}`,
        });
      }

      setResult({
        attachments,
        output: savedHtml ? undefined : output,
        title: isString ? undefined : rawResult.title,
      });
    } catch (runError) {
      setResult({
        error:
          runError instanceof Error ? runError.message : String(runError),
      });
    } finally {
      setRunning(false);
      setProgress(undefined);
    }
  };

  const openAttachment = (uri: string) => {
    const id = uri.replace(/^workspace:\/\//, "");
    const file = [...generatedFiles, ...workspaceFiles].find((item) => item.id === id);
    if (file) setPreviewFile(file);
    else setResult((current) => ({ ...current, error: "This output file is no longer available." }));
  };

  const subtitle = capability.description
    ? capability.description
    : capability.kind === "action"
      ? "Manual action"
      : "Tool";

  return (
    <View className="bg-background dark:bg-background-dark">
      <Pressable
        accessibilityHint="Opens the tool inputs"
        accessibilityRole="button"
        className="flex-row items-center gap-sp-3 px-sp-3 py-sp-3"
        onPress={openInput}
        style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
      >
        <Icon color={theme.text} size={16} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text
            className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark"
            numberOfLines={1}
          >
            {capability.title}
          </Text>
          <Text
            className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        </View>
        <ChevronRight color={theme.textSecondary} size={18} />
      </Pressable>

      <Drawer
        onOpenChange={(open) => {
          setInputOpen(open);
          if (!open) setPage(0);
        }}
        open={inputOpen}
      >
        <DrawerContent
          contentClassName="overflow-hidden"
          showCloseButton
          showHandle
          size={720}
        >
          <DrawerPager onPageChange={setPage} page={page}>
            <DrawerPagerPage>
              <DrawerHeader>
                <DrawerTitle>{capability.title}</DrawerTitle>
              </DrawerHeader>
              <FormWizard
                disabled={running}
                mutating={capability.mutating}
                onChange={setArgs}
                onRun={handleRun}
                resultPresent={result !== null}
                running={running}
                schema={capability.inputSchema}
                value={args}
              />
            </DrawerPagerPage>
            <DrawerPagerPage>
              <DrawerHeader>
                <DrawerTitle>{result?.title || capability.title}</DrawerTitle>
                <DrawerDescription>Output</DrawerDescription>
              </DrawerHeader>
              <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
                {running ? (
                  <View className="flex-row items-center gap-sp-3 py-sp-3">
                    <ActivityIndicator color={theme.text} />
                    <Text className="flex-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                      {progress || "Running…"}
                    </Text>
                  </View>
                ) : null}
                {result ? (
                  <View className="gap-sp-3">
                    {result.error ? (
                      <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                        {result.error}
                      </Text>
                    ) : null}
                    {!result.error && result.title ? (
                      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                        {result.title}
                      </Text>
                    ) : null}
                    {!result.error && result.output ? (
                      <Text selectable className="font-sans text-sm text-foreground dark:text-foreground-dark">
                        {result.output}
                      </Text>
                    ) : null}
                    {!result.error &&
                    result.attachments &&
                    result.attachments.length > 0 ? (
                      <View className="gap-sp-1">
                        {result.attachments.map((attachment, index) => (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Preview ${attachment.filename || "output file"}`}
                            className="min-h-14 flex-row items-center gap-sp-3 rounded-ui border border-border px-sp-3 py-sp-3 dark:border-border-dark"
                            onPress={() => openAttachment(attachment.uri)}
                            style={({ pressed }) => pressed ? { opacity: 0.84 } : null}
                            key={`${attachment.uri}-${index}`}
                          >
                            <FileText color={theme.text} size={18} />
                            <View className="min-w-0 flex-1">
                              <Text numberOfLines={1} className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                                {attachment.filename || "Output file"}
                              </Text>
                              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                                {attachment.mime}
                              </Text>
                            </View>
                            <ChevronRight color={theme.textSecondary} size={18} />
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {!result.error && !result.output && !result.attachments?.length ? (
                      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">Completed with no output.</Text>
                    ) : null}
                  </View>
                ) : null}
              </DrawerBody>
              <DrawerFooter>
                <View className="flex-row gap-sp-2">
                  <Button
                    className="flex-1"
                    disabled={running}
                    onPress={() => setPage(0)}
                    variant="outline"
                  >
                    Back to inputs
                  </Button>
                  <Button
                    className="flex-1"
                    onPress={() => setInputOpen(false)}
                    variant="secondary"
                  >
                    Done
                  </Button>
                </View>
              </DrawerFooter>
            </DrawerPagerPage>
          </DrawerPager>
        </DrawerContent>
      </Drawer>
      {/* Stays mounted above the capability drawer instead of replacing it,
          so opening a file preview no longer flashes between two drawers. */}
      <FilePreviewDialog file={previewFile} onDismiss={() => setPreviewFile(null)} />
    </View>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldLabel(fieldSchema: JsonSchema, fallback: string): string {
  const title = (fieldSchema as { title?: unknown }).title;
  if (typeof title === "string" && title.trim()) return title;
  return fallback.replace(/[_-]+/g, " ").trim() || fallback;
}

function getAtPath(root: PluginRunArgs, path: (string | number)[]): PluginRunArgs {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      current = Array.isArray(current) ? current[segment] : undefined;
    } else {
      current = isRecord(current) ? current[segment] : undefined;
    }
    if (current === undefined) break;
  }
  return isRecord(current) ? (current as PluginRunArgs) : {};
}

function setAtPath(
  node: unknown,
  path: (string | number)[],
  next: unknown,
): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const list = Array.isArray(node) ? node.slice() : [];
    list[head] = setAtPath(list[head], rest, next);
    return list;
  }
  const obj: Record<string, unknown> = isRecord(node) ? { ...node } : {};
  obj[head] = setAtPath(isRecord(node) ? node[head] : undefined, rest, next);
  return obj;
}

function arrayItemsSchema(fieldSchema: JsonSchema): JsonSchema {
  const items = (fieldSchema as { items?: unknown }).items;
  return isRecord(items) ? (items as JsonSchema) : {};
}

type FormSection =
  | {
      depth: number;
      key: string;
      kind: "fields";
      label: string;
      path: (string | number)[];
      schema: JsonSchema;
    }
  | {
      depth: number;
      itemsSchema: JsonSchema;
      key: string;
      kind: "array";
      label: string;
      path: (string | number)[];
      required: boolean;
    };

function scalarCountOf(schema: JsonSchema): number {
  return Object.keys(
    (schema as { properties?: Record<string, unknown> }).properties ?? {},
  ).length;
}

function getRawAtPath(root: unknown, path: (string | number)[]): unknown {
  let current = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      current = Array.isArray(current) ? current[segment] : undefined;
    } else {
      current = isRecord(current) ? current[segment] : undefined;
    }
    if (current === undefined) break;
  }
  return current;
}

/**
 * Flattens the schema depth-first into wizard pages: the level's scalars
 * first, then one page per object/array section, then each array item's
 * own pages. Everything is reachable via footer Prev/Next.
 */
function flattenFormSections(
  schema: JsonSchema,
  label: string,
  path: (string | number)[],
  depth: number,
  value: PluginRunArgs,
  sections: FormSection[],
): void {
  const { drillFields, scalarSchema } = splitFormSchema(schema);
  if (scalarCountOf(scalarSchema) > 0 || sections.length === 0) {
    sections.push({
      depth,
      key: [...path.map(String), "#fields"].join("/"),
      kind: "fields",
      label,
      path,
      schema: scalarSchema,
    });
  }
  for (const field of drillFields) {
    const childLabel = fieldLabel(field.fieldSchema, field.name);
    const childPath = [...path, field.name];
    const isArray =
      (field.fieldSchema as { type?: unknown }).type === "array" ||
      "items" in (field.fieldSchema as Record<string, unknown>);
    if (isArray) {
      const itemsSchema = arrayItemsSchema(field.fieldSchema);
      sections.push({
        depth: depth + 1,
        itemsSchema,
        key: [...childPath.map(String), "#list"].join("/"),
        kind: "array",
        label: childLabel,
        path: childPath,
        required: field.required,
      });
      const raw = getRawAtPath(value, childPath);
      const list = Array.isArray(raw) ? raw : [];
      list.forEach((_, itemIndex) => {
        flattenFormSections(
          itemsSchema,
          `${childLabel} ${itemIndex + 1}`,
          [...childPath, itemIndex],
          depth + 2,
          value,
          sections,
        );
      });
    } else {
      flattenFormSections(
        field.fieldSchema,
        childLabel,
        childPath,
        depth + 1,
        value,
        sections,
      );
    }
  }
}

/** Linear multi-page form: scalars first, each section its own page. */
function FormWizard({
  disabled = false,
  mutating,
  onChange,
  onRun,
  resultPresent,
  running,
  schema,
  value,
}: {
  disabled?: boolean;
  mutating?: boolean;
  onChange: (value: PluginRunArgs) => void;
  onRun: () => void;
  resultPresent: boolean;
  running: boolean;
  schema: JsonSchema | undefined;
  value: PluginRunArgs;
}) {
  const theme = useTheme();
  const sections = useMemo(() => {
    const list: FormSection[] = [];
    flattenFormSections(schema ?? {}, "Inputs", [], 0, value, list);
    return list;
  }, [schema, value]);
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, sections.length - 1);

  useEffect(() => {
    if (index > sections.length - 1) {
      setIndex(Math.max(sections.length - 1, 0));
    }
  }, [index, sections.length]);

  const last = safeIndex === sections.length - 1;

  return (
    <>
      <DrawerPager
        onPageChange={(nextPage) => {
          setIndex(Math.min(Math.max(nextPage, 0), sections.length - 1));
        }}
        page={safeIndex}
      >
        {sections.map((item) => (
          <DrawerPagerPage key={item.key}>
            <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
              {item.depth === 0 && mutating ? (
                <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
                  Mutating — this runs a write, delete, or send operation.
                </Text>
              ) : null}
              {item.depth > 0 ? (
                <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                  {item.label}
                </Text>
              ) : null}
              {item.kind === "fields" ? (
                scalarCountOf(item.schema) > 0 ? (
                  <PluginCapabilityForm
                    disabled={disabled}
                    onChange={(next) =>
                      onChange(setAtPath(value, item.path, next) as PluginRunArgs)
                    }
                    schema={item.schema}
                    value={getAtPath(value, item.path)}
                  />
                ) : (
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    This takes no inputs.
                  </Text>
                )
              ) : (
                <ArraySection
                  disabled={disabled}
                  itemsSchema={item.itemsSchema}
                  label={item.label}
                  onRootChange={onChange}
                  path={item.path}
                  required={item.required}
                  rootValue={value}
                />
              )}
            </DrawerBody>
          </DrawerPagerPage>
        ))}
      </DrawerPager>
      <DrawerFooter>
        {sections.length > 1 ? (
          <View className="flex-row items-center gap-sp-2">
            <Text className="flex-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {`Page ${safeIndex + 1} of ${sections.length}`}
            </Text>
            {safeIndex > 0 ? (
              <Button
                accessibilityLabel="Previous page"
                onPress={() => setIndex(safeIndex - 1)}
                size="icon"
                variant="outline"
              >
                <ChevronLeft color={theme.text} size={20} />
              </Button>
            ) : null}
            {!last ? (
              <Button
                accessibilityLabel="Next page"
                onPress={() => setIndex(safeIndex + 1)}
                size="icon"
                variant="outline"
              >
                <ChevronRight color={theme.text} size={20} />
              </Button>
            ) : (
              <Button
                leftIcon={<Play color={theme.background} size={14} />}
                loading={running}
                onPress={onRun}
              >
                {running ? "Running…" : resultPresent ? "Run again" : "Run"}
              </Button>
            )}
          </View>
        ) : (
          <Button
            leftIcon={<Play color={theme.background} size={14} />}
            loading={running}
            onPress={onRun}
          >
            {running ? "Running…" : resultPresent ? "Run again" : "Run"}
          </Button>
        )}
      </DrawerFooter>
    </>
  );
}

function ArraySection({
  disabled,
  label,
  onRootChange,
  path,
  required,
  rootValue,
}: {
  disabled: boolean;
  itemsSchema: JsonSchema;
  label: string;
  onRootChange: (value: PluginRunArgs) => void;
  path: (string | number)[];
  required: boolean;
  rootValue: PluginRunArgs;
}) {
  const theme = useTheme();
  const raw = getRawAtPath(rootValue, path);
  const list = Array.isArray(raw) ? raw : [];
  const setList = (next: unknown[]) => {
    onRootChange(setAtPath(rootValue, path, next) as PluginRunArgs);
  };

  return (
    <View className="gap-sp-2">
      <Label required={required}>{label}</Label>
      {list.length === 0 ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          No items yet. Add one below — each item gets its own page.
        </Text>
      ) : null}
      {list.map((_, itemIndex) => (
        <View
          className="flex-row items-center gap-sp-2"
          key={`${path.map(String).join("/")}-${itemIndex}`}
        >
          <View className="min-h-12 min-w-0 flex-1 justify-center rounded-ui border border-border bg-input px-sp-3 dark:border-border-dark dark:bg-input-dark">
            <Text
              className="font-sans text-sm text-foreground dark:text-foreground-dark"
              numberOfLines={1}
            >
              {`${label} ${itemIndex + 1}`}
            </Text>
          </View>
          <Button
            accessibilityLabel={`Remove ${label} ${itemIndex + 1}`}
            disabled={disabled}
            onPress={() => {
              setList(list.filter((_, index) => index !== itemIndex));
            }}
            size="icon-xs"
            variant="ghost"
          >
            <Trash2 color={theme.destructive} size={14} />
          </Button>
        </View>
      ))}
      <View className="flex-row">
        <Button
          disabled={disabled}
          leftIcon={<Plus color={theme.text} size={14} />}
          onPress={() => {
            setList([...list, {}]);
          }}
          size="sm"
          variant="outline"
        >
          {`Add ${label}`}
        </Button>
      </View>
    </View>
  );
}
