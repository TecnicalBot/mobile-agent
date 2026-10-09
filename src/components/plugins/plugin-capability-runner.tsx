import { ChevronDown, ChevronRight, FileText, Play, Wrench } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
  PluginCapabilityForm,
  serializePluginArgs,
  type PluginRunArgs,
} from "@/components/plugins/plugin-capability-form";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { FilePreviewDialog } from "@/components/ui/file-preview-dialog";
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
  const [outputOpen, setOutputOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<WorkspaceFile[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [args, setArgs] = useState<PluginRunArgs>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<RunResult | null>(null);

  const properties =
    (capability.inputSchema as { properties?: Record<string, unknown> } | undefined)
      ?.properties ?? {};
  const hasInputs = Object.keys(properties).length > 0;
  const Icon = capability.kind === "action" ? Play : Wrench;

  const handleRun = async (): Promise<void> => {
    if (running) return;

    setRunning(true);
    setOutputOpen(true);
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
        accessibilityRole="button"
        className="flex-row items-center gap-sp-3 px-sp-3 py-sp-3"
        onPress={() => setExpanded((current) => !current)}
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
          {!expanded ? <Text
            className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
            numberOfLines={2}
          >
            {subtitle}
          </Text> : null}
        </View>
        <ChevronDown
          color={theme.textSecondary}
          size={18}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded ? (
        <View className="gap-sp-3 px-sp-3 pb-sp-3">
          {capability.description ? (
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {capability.description}
            </Text>
          ) : null}
          {capability.mutating ? (
            <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
              Mutating — this runs a write, delete, or send operation.
            </Text>
          ) : null}

          {hasInputs ? (
            <PluginCapabilityForm
              disabled={running}
              onChange={setArgs}
              schema={capability.inputSchema}
              value={args}
            />
          ) : (
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              This takes no inputs.
            </Text>
          )}

          <View className="flex-row flex-wrap gap-sp-2">
            <Button
              disabled={running}
              leftIcon={<Play color={theme.background} size={14} />}
              loading={running}
              onPress={handleRun}
              size="sm"
            >
              {running ? "Running…" : result ? "Run again" : "Run"}
            </Button>
          </View>

        </View>
      ) : null}

      <Drawer open={outputOpen && !previewFile} onOpenChange={setOutputOpen}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>{result?.title || capability.title}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-3">
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
        </DrawerContent>
      </Drawer>
      <FilePreviewDialog file={previewFile} onDismiss={() => setPreviewFile(null)} />
    </View>
  );
}
