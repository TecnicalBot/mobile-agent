import * as Clipboard from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as IntentLauncher from "expo-intent-launcher";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Share2,
} from "lucide-react-native";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Markdown, {
  type ASTNode,
  type RenderRules,
} from "react-native-markdown-display";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Loading } from "@/components/ui/loading";
import { Message, MessageFooter } from "@/components/ui/message";
import {
  isTextWorkspaceFile,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/core/utils";
import type {
  ExecutionTimelineEvent,
  GeneratedImageAttachment,
  ReasoningBlock,
  StoredMessage,
  WorkspaceFile,
} from "@/core/types/app-state";
import { Asset } from "expo-media-library";

type ChatMessageProps = {
  message: StoredMessage;
  workspaceFiles: WorkspaceFile[];
};

const MARKDOWN_RULES = {
  table: (node, children, _parent, styles) => {
    const columnCount = getTableColumnCount(node);

    return (
      <ScrollView
        key={node.key}
        directionalLockEnabled
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={{ maxWidth: "100%" }}
      >
        <View
          style={[
            styles._VIEW_SAFE_table,
            { width: Math.max(columnCount, 1) * 144 },
          ]}
        >
          {children}
        </View>
      </ScrollView>
    );
  },
} satisfies RenderRules;

function getTableColumnCount(node: ASTNode): number {
  if (node.type === "tr") {
    return node.children.length;
  }

  for (const child of node.children) {
    const columnCount = getTableColumnCount(child);

    if (columnCount > 0) {
      return columnCount;
    }
  }

  return 0;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  workspaceFiles,
}: ChatMessageProps) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [imageAction, setImageAction] = useState<"download" | "share" | null>(
    null,
  );
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [reasoningExpanded, setReasoningExpanded] = useState(
    message.status === "streaming",
  );
  const previousMessageStatusRef = useRef(message.status);
  const [previewImage, setPreviewImage] =
    useState<GeneratedImageAttachment | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const isAssistant = message.role === "assistant";
  const isUser = message.role === "user";
  const align = isUser ? "end" : "start";
  const variant = isUser ? "default" : "ghost";

  const markdownStyles = useMemo(
    () =>
      createMarkdownStyles({
        borderColor: theme.border,
        codeBackground: theme.backgroundElement,
        inlineCodeBackground: theme.backgroundSelected,
        linkColor: theme.text,
        mutedText: theme.textSecondary,
        text: theme.text,
      }),
    [
      theme.border,
      theme.backgroundElement,
      theme.backgroundSelected,
      theme.text,
      theme.textSecondary,
    ],
  );
  const reasoningMarkdownStyles = useMemo(
    () =>
      createMarkdownStyles({
        borderColor: theme.border,
        codeBackground: theme.backgroundElement,
        inlineCodeBackground: theme.backgroundSelected,
        linkColor: theme.textSecondary,
        mutedText: theme.textSecondary,
        text: theme.textSecondary,
      }),
    [
      theme.border,
      theme.backgroundElement,
      theme.backgroundSelected,
      theme.textSecondary,
    ],
  );

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = setTimeout(() => {
      setCopied(false);
    }, 1500);

    return () => {
      clearTimeout(timeout);
    };
  }, [copied]);

  useEffect(() => {
    if (
      previousMessageStatusRef.current === "streaming" &&
      message.status !== "streaming"
    ) {
      setReasoningExpanded(false);
    }

    previousMessageStatusRef.current = message.status;
  }, [message.status]);

  const handleCopy = async () => {
    if (!message.content.trim()) {
      return;
    }

    await Clipboard.setStringAsync(message.content);
    setCopied(true);
  };
  const closePreview = () => {
    setImageAction(null);
    setPreviewImage(null);
  };

  const handleDownloadImage = async (image: GeneratedImageAttachment) => {
    setImageAction("download");

    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);

      if (!permission.granted) {
        Alert.alert(
          "Permission required",
          "Please allow photo access to save this image.",
        );
        return;
      }

      const localFile = await getLocalImageFile(image);

      await Asset.create(localFile.uri);

      Alert.alert("Image saved", "Image has been saved to your gallery.");
    } catch (error) {
      Alert.alert(
        "Download failed",
        error instanceof Error ? error.message : "Failed to save the image.",
      );
    } finally {
      setImageAction(null);
    }
  };

  const handleShareImage = async (image: GeneratedImageAttachment) => {
    setImageAction("share");

    try {
      const available = await Sharing.isAvailableAsync();

      if (!available) {
        Alert.alert(
          "Share unavailable",
          "Sharing is not available on this device.",
        );
        return;
      }

      const localFile = await getLocalImageFile(image);

      await Sharing.shareAsync(localFile.uri, {
        dialogTitle: "Share generated image",
        mimeType: getImageMimeType(localFile.uri),
        UTI: "public.image",
      });
    } catch (error) {
      if (isUserCanceledShare(error)) {
        return;
      }

      Alert.alert(
        "Share failed",
        error instanceof Error ? error.message : "Failed to share the image.",
      );
    } finally {
      setImageAction(null);
    }
  };

  const handleOpenFile = async (workspaceFile: WorkspaceFile) => {
    setOpeningFileId(workspaceFile.id);

    try {
      const localFile = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!localFile.exists) {
        throw new Error("This file is no longer available in the workspace.");
      }

      const mimeType = isTextWorkspaceFile(workspaceFile)
        ? "text/plain"
        : workspaceFile.mimeType || localFile.type || "*/*";

      if (Platform.OS === "android") {
        const contentUri = await LegacyFileSystem.getContentUriAsync(
          localFile.uri,
        );

        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: contentUri,
          flags: 1,
          type: mimeType,
        });
        return;
      }

      if (!(await Linking.canOpenURL(localFile.uri))) {
        throw new Error("No compatible app is available to open this file.");
      }

      await Linking.openURL(localFile.uri);
    } catch (error) {
      Alert.alert(
        "Unable to open file",
        error instanceof Error
          ? error.message
          : "The file could not be opened.",
      );
    } finally {
      setOpeningFileId(null);
    }
  };

  const getImageMimeType = (uri: string) => {
    const cleanUri = uri.split("?")[0].toLowerCase();

    if (cleanUri.endsWith(".jpg") || cleanUri.endsWith(".jpeg")) {
      return "image/jpeg";
    }

    if (cleanUri.endsWith(".webp")) {
      return "image/webp";
    }

    return "image/png";
  };
  const memoryEvents = message.metadata?.memoryEvents ?? [];
  const executionTimeline = (message.metadata?.executionTimeline ?? []).filter(
    (event) =>
      event.kind !== "prompt" &&
      !(event.kind === "run" && event.status === "pending"),
  );
  const generatedImages = message.metadata?.generatedImages ?? [];
  const attachedFiles = (message.metadata?.selectedFileIds ?? [])
    .map((fileId) => workspaceFiles.find((file) => file.id === fileId))
    .filter((file): file is WorkspaceFile => file !== undefined);
  const hasUserAttachments = isUser && attachedFiles.length > 0;
  const fileHeaderConnected = hasUserAttachments && Boolean(message.content);
  const reasoningBlocks = message.metadata?.reasoning ?? [];
  const reasoningText = reasoningBlocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const reasoningInProgress = reasoningBlocks.some(
    (block) => block.completedAt === null,
  );
  const reasoningLabel = reasoningText
    ? message.status === "streaming" && reasoningInProgress
      ? "Thinking…"
      : `Thought for ${formatReasoningDuration(reasoningBlocks)}`
    : null;
  const memoryEventLabel =
    memoryEvents.length === 0
      ? null
      : memoryEvents.length === 1
        ? getMemoryEventLabel(memoryEvents[0].kind)
        : `${memoryEvents.length} memory updates`;
  const timelineLabel =
    executionTimeline.length === 0
      ? null
      : executionTimeline.length === 1
        ? "1 step"
        : `${executionTimeline.length} steps`;

  return (
    <Message align={align}>
      <View
        className={cn("gap-1", align === "end" ? "items-end" : "items-start", {
          "w-full": isAssistant,
          "max-w-[80%]": !isAssistant,
        })}
      >
        {hasUserAttachments ? (
          <View
            className={cn(
              "overflow-hidden border border-border bg-card dark:border-border-dark dark:bg-card-dark",
              fileHeaderConnected
                ? "max-w-full rounded-ui rounded-br-none"
                : "max-w-full rounded-ui",
            )}
          >
            {attachedFiles.map((file, index) => {
              const opening = openingFileId === file.id;

              return (
                <Pressable
                  key={file.id}
                  accessibilityHint="Opens the attached file"
                  accessibilityLabel={file.displayName}
                  accessibilityRole="button"
                  className={cn(
                    "w-full flex-row items-center gap-sp-2 px-sp-3 py-sp-2",
                    index > 0 &&
                      "border-t border-border dark:border-border-dark",
                  )}
                  disabled={opening}
                  onPress={() => {
                    handleOpenFile(file).catch(console.error);
                  }}
                  style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
                >
                  <Text
                    className="min-w-0 shrink font-sans text-sm font-medium text-foreground dark:text-foreground-dark"
                    numberOfLines={1}
                  >
                    {file.displayName}
                  </Text>
                  {opening ? (
                    <ActivityIndicator
                      color={theme.textSecondary}
                      size="small"
                    />
                  ) : (
                    <ChevronRight color={theme.textSecondary} size={16} />
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {isAssistant || message.content ? (
          <Bubble
            align={align}
            className={cn("max-w-full", isAssistant && "w-full")}
            variant={variant}
          >
            <BubbleContent
              className={fileHeaderConnected ? "rounded-tr-none" : undefined}
            >
              {isAssistant ? (
                <View className="gap-sp-3">
                  {reasoningLabel ? (
                    <View className="gap-sp-2">
                      <Pressable
                        accessibilityRole="button"
                        className="self-start flex-row items-center gap-sp-2"
                        onPress={() => {
                          setReasoningExpanded((current) => !current);
                        }}
                        style={({ pressed }) =>
                          pressed ? { opacity: 0.72 } : null
                        }
                      >
                        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                          {reasoningLabel}
                        </Text>
                        <ChevronDown
                          color={theme.textSecondary}
                          size={14}
                          style={{
                            transform: [
                              { rotate: reasoningExpanded ? "180deg" : "0deg" },
                            ],
                          }}
                        />
                      </Pressable>

                      {reasoningExpanded ? (
                        <View className="flex-row gap-sp-2">
                          <View className="w-5 items-center">
                            <Clock3 color={theme.textSecondary} size={16} />
                            <View className="my-1 min-h-6 w-px flex-1 bg-border dark:bg-border-dark" />
                            <Check color={theme.textSecondary} size={16} />
                          </View>
                          <View className="min-w-0 flex-1 gap-sp-3 pb-0.5">
                            <Markdown
                              mergeStyle={false}
                              rules={MARKDOWN_RULES}
                              style={reasoningMarkdownStyles}
                            >
                              {reasoningText}
                            </Markdown>
                            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                              {reasoningInProgress ? "Working" : "Done"}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {message.content.trim() ? (
                    <Markdown
                      mergeStyle={false}
                      rules={MARKDOWN_RULES}
                      style={markdownStyles}
                    >
                      {message.content}
                    </Markdown>
                  ) : memoryEventLabel ? (
                    <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                      {memoryEventLabel}
                    </Text>
                  ) : null}
                  {generatedImages.length > 0 ? (
                    <View className="gap-sp-2">
                      {generatedImages.map((image) => (
                        <Pressable
                          key={image.id}
                          accessibilityHint="Open the generated image preview"
                          accessibilityRole="button"
                          className="overflow-hidden rounded-card border border-border dark:border-border-dark"
                          onPress={() => {
                            setPreviewImage(image);
                          }}
                        >
                          <Image
                            contentFit="cover"
                            source={{ uri: image.uri }}
                            style={{
                              aspectRatio: 1,
                              minHeight: 220,
                              width: "100%",
                            }}
                          />
                          <View className="absolute inset-x-0 bottom-0 bg-black/45 px-sp-3 py-sp-2">
                            <Text className="font-sans text-xs font-medium text-white">
                              Tap to view, save, or share
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {message.status === "streaming" ? <Loading /> : null}
                </View>
              ) : (
                <Pressable
                  accessibilityHint="Long press to copy message"
                  accessibilityRole="button"
                  delayLongPress={220}
                  onLongPress={() => {
                    handleCopy().catch(console.error);
                  }}
                  style={({ pressed }) => (pressed ? { opacity: 0.9 } : null)}
                >
                  <Text className="font-sans text-base text-background dark:text-background-dark">
                    {message.content}
                  </Text>
                </Pressable>
              )}
            </BubbleContent>
          </Bubble>
        ) : null}

        {isAssistant &&
        (message.content.trim() ||
          memoryEvents.length > 0 ||
          executionTimeline.length > 0 ||
          generatedImages.length > 0) ? (
          <MessageFooter>
            <Button
              leftIcon={
                copied ? (
                  <Check color={theme.textSecondary} size={14} />
                ) : (
                  <Copy color={theme.textSecondary} size={14} />
                )
              }
              onPress={() => {
                handleCopy().catch(console.error);
              }}
              size="xs"
              textClassName="text-muted-foreground dark:text-muted-foreground-dark"
              variant="ghost"
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            {memoryEventLabel ? (
              <Button
                leftIcon={<Brain color={theme.textSecondary} size={14} />}
                onPress={() => {
                  setMemoryExpanded((current) => !current);
                }}
                rightIcon={
                  <ChevronDown color={theme.textSecondary} size={14} />
                }
                size="xs"
                textClassName="text-muted-foreground dark:text-muted-foreground-dark"
                variant="ghost"
              >
                {memoryEventLabel}
              </Button>
            ) : null}
            {timelineLabel ? (
              <Button
                leftIcon={<Clock3 color={theme.textSecondary} size={14} />}
                onPress={() => {
                  setTimelineExpanded(true);
                }}
                size="xs"
                textClassName="text-muted-foreground dark:text-muted-foreground-dark"
                variant="ghost"
              >
                {timelineLabel}
              </Button>
            ) : null}
          </MessageFooter>
        ) : null}

        {isAssistant && memoryExpanded && memoryEvents.length > 0 ? (
          <View className="max-w-full gap-sp-2 rounded-ui border border-border bg-card px-sp-3 py-sp-2 dark:border-border-dark dark:bg-card-dark">
            {memoryEvents.map((event) => (
              <View key={event.id} className="gap-1">
                <Text className="font-sans text-xs font-medium text-foreground dark:text-foreground-dark">
                  {getMemoryEventLabel(event.kind)}
                </Text>
                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  {event.content}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {isUser && copied ? (
          <Text className="px-sp-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Copied
          </Text>
        ) : null}
      </View>
      <Drawer
        direction="bottom"
        onOpenChange={setTimelineExpanded}
        open={timelineExpanded}
      >
        <DrawerContent showCloseButton showHandle size={560}>
          <DrawerHeader>
            <DrawerTitle>{timelineLabel ?? "Steps"}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-4 pb-sp-4">
            {executionTimeline.map((event, eventIndex) => {
              const previousEvent = executionTimeline[eventIndex - 1];

              return (
                <View
                  key={event.id}
                  className="gap-1 rounded-ui border border-border bg-card px-sp-3 py-sp-3 dark:border-border-dark dark:bg-card-dark"
                >
                  <View className="flex-row items-center justify-between gap-sp-3">
                    <Text className="flex-1 font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                      {formatTimelineTitle(event)}
                    </Text>
                    <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      {formatTimelineDuration(previousEvent, event)}
                    </Text>
                  </View>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {formatTimelineStatus(event.status)}
                  </Text>
                  {event.detail ? (
                    <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                      {event.detail}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
      <Drawer
        direction="bottom"
        onOpenChange={(open) => {
          if (!open) {
            closePreview();
          }
        }}
        open={previewImage !== null}
      >
        <DrawerContent
          className="w-full max-w-full"
          contentClassName="max-w-full"
          showCloseButton
          showHandle
          size={560}
        >
          <DrawerHeader>
            <DrawerTitle>Generated image</DrawerTitle>
          </DrawerHeader>
          <DrawerBody className="gap-sp-3" contentContainerClassName="gap-sp-3">
            {previewImage ? (
              <Image
                contentFit="contain"
                source={{ uri: previewImage.uri }}
                style={{
                  aspectRatio: 1,
                  borderRadius: 16,
                  maxHeight: 420,
                  width: "100%",
                }}
              />
            ) : null}
          </DrawerBody>
          <DrawerFooter className="flex-row gap-sp-2">
            <Button
              className="flex-1"
              leftIcon={<Download color={theme.text} size={16} />}
              loading={imageAction === "download"}
              onPress={() => {
                if (previewImage) {
                  handleDownloadImage(previewImage).catch(console.error);
                }
              }}
              variant="outline"
            >
              Save
            </Button>
            <Button
              className="flex-1"
              leftIcon={<Share2 color={theme.background} size={16} />}
              loading={imageAction === "share"}
              onPress={() => {
                if (previewImage) {
                  handleShareImage(previewImage).catch(console.error);
                }
              }}
            >
              Share
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Message>
  );
});

function buildGeneratedImageFileName(image: GeneratedImageAttachment) {
  return `mobile-agent-${image.id}.${getImageExtension(image.mimeType)}`;
}

function buildAvailableGeneratedImageFile(
  directory: Directory,
  image: GeneratedImageAttachment,
) {
  const extension = getImageExtension(image.mimeType);
  const baseName = `mobile-agent-${image.id}`;
  const existingNames = new Set(directory.list().map((entry) => entry.name));

  if (!existingNames.has(`${baseName}.${extension}`)) {
    return new File(directory, `${baseName}.${extension}`);
  }

  let suffix = 2;

  while (existingNames.has(`${baseName}-${suffix}.${extension}`)) {
    suffix += 1;
  }

  return new File(directory, `${baseName}-${suffix}.${extension}`);
}

function getImageExtension(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

function isUserCanceledFileAction(error: unknown) {
  return error instanceof Error && /cancel/i.test(error.message);
}

function isUserCanceledShare(error: unknown) {
  return error instanceof Error && /cancel/i.test(error.message);
}

function getMemoryEventLabel(kind: "created" | "deleted" | "updated") {
  if (kind === "created") {
    return "Memory saved";
  }

  if (kind === "updated") {
    return "Memory updated";
  }

  return "Memory removed";
}

function formatTimelineStatus(
  status: "completed" | "failed" | "info" | "pending",
) {
  if (status === "completed") {
    return "Completed";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "pending") {
    return "Waiting";
  }

  return "Info";
}

function formatReasoningDuration(blocks: ReasoningBlock[]) {
  const durationMs = blocks.reduce((total, block) => {
    const startedAt = new Date(block.startedAt).getTime();
    const completedAt = block.completedAt
      ? new Date(block.completedAt).getTime()
      : Date.now();

    if (
      Number.isNaN(startedAt) ||
      Number.isNaN(completedAt) ||
      completedAt < startedAt
    ) {
      return total;
    }

    return total + completedAt - startedAt;
  }, 0);

  if (durationMs < 1000) {
    return "<1s";
  }

  if (durationMs < 60_000) {
    return `${Math.max(1, Math.round(durationMs / 1000))}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatTimelineTitle(event: ExecutionTimelineEvent) {
  if (event.kind === "run") {
    if (event.status === "failed") {
      return "Failed";
    }

    if (event.status === "completed") {
      return "Finished";
    }

    return "Thinking";
  }

  if (event.kind === "image") {
    return "Generated image";
  }

  if (event.kind === "tool") {
    if (event.title.startsWith("Approval requested for ")) {
      return `Waiting for approval: ${event.title.slice(
        "Approval requested for ".length,
      )}`;
    }

    if (event.status === "failed") {
      return `${event.title.replace(/\sfailed$/i, "")} failed`;
    }

    return `Calling ${event.title.replace(/\scompleted$/i, "")}`;
  }

  return event.title;
}

function formatTimelineDuration(
  previousEvent: ExecutionTimelineEvent | undefined,
  event: ExecutionTimelineEvent,
) {
  if (!previousEvent) {
    return "Start";
  }

  const startedAt = new Date(previousEvent.createdAt).getTime();
  const completedAt = new Date(event.createdAt).getTime();

  if (
    Number.isNaN(startedAt) ||
    Number.isNaN(completedAt) ||
    completedAt < startedAt
  ) {
    return "—";
  }

  const durationMs = completedAt - startedAt;

  if (durationMs < 100) {
    return "< 0.1s";
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function createMarkdownStyles(input: {
  borderColor: string;
  codeBackground: string;
  inlineCodeBackground: string;
  linkColor: string;
  mutedText: string;
  text: string;
}) {
  return {
    body: {
      color: input.text,
      flexShrink: 1,
      fontFamily: "System",
      fontSize: 16,
      lineHeight: 24,
      marginBottom: 0,
      marginTop: 0,
      maxWidth: "100%",
      width: "100%",
    },
    bullet_list: {
      marginBottom: 10,
      marginTop: 4,
    },
    bullet_list_content: {
      flex: 1,
    },
    bullet_list_icon: {
      color: input.text,
      marginRight: 8,
      width: 12,
    },
    code_block: {
      backgroundColor: input.codeBackground,
      borderRadius: 16,
      color: input.text,
      fontFamily: "monospace",
      fontSize: 14,
      lineHeight: 22,
      marginBottom: 12,
      marginTop: 6,
      padding: 12,
    },
    code_inline: {
      backgroundColor: input.inlineCodeBackground,
      borderRadius: 8,
      color: input.text,
      fontFamily: "monospace",
      fontSize: 14,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    fence: {
      backgroundColor: input.codeBackground,
      borderRadius: 16,
      color: input.text,
      fontFamily: "monospace",
      fontSize: 14,
      lineHeight: 22,
      marginBottom: 12,
      marginTop: 6,
      padding: 12,
    },
    blockquote: {
      borderColor: input.borderColor,
      borderLeftWidth: 3,
      color: input.mutedText,
      marginBottom: 10,
      marginTop: 4,
      paddingLeft: 12,
    },
    heading1: {
      color: input.text,
      fontSize: 24,
      fontWeight: "700",
      lineHeight: 32,
      marginBottom: 8,
      marginTop: 10,
    },
    heading2: {
      color: input.text,
      fontSize: 21,
      fontWeight: "700",
      lineHeight: 28,
      marginBottom: 8,
      marginTop: 10,
    },
    heading3: {
      color: input.text,
      fontSize: 18,
      fontWeight: "700",
      lineHeight: 25,
      marginBottom: 6,
      marginTop: 8,
    },
    hr: {
      backgroundColor: input.borderColor,
      height: 1,
      marginBottom: 16,
      marginTop: 16,
    },
    image: {
      borderRadius: 16,
      marginBottom: 10,
      marginTop: 4,
    },
    link: {
      color: input.linkColor,
      textDecorationLine: "underline",
    },
    list_item: {
      color: input.text,
      flexDirection: "row",
      justifyContent: "flex-start",
      marginBottom: 4,
      marginTop: 0,
    },
    ordered_list: {
      marginBottom: 10,
      marginTop: 4,
    },
    ordered_list_content: {
      flex: 1,
    },
    ordered_list_icon: {
      color: input.text,
      marginRight: 8,
      minWidth: 20,
    },
    paragraph: {
      color: input.text,
      fontSize: 16,
      lineHeight: 24,
      marginBottom: 10,
      marginTop: 0,
    },
    strong: {
      color: input.text,
      fontWeight: "700",
    },
    table: {
      borderColor: input.borderColor,
      borderLeftWidth: 1,
      borderTopWidth: 1,
    },
    td: {
      borderColor: input.borderColor,
      borderRightWidth: 1,
      color: input.text,
      flexShrink: 0,
      padding: 8,
      width: 144,
    },
    th: {
      borderColor: input.borderColor,
      borderRightWidth: 1,
      color: input.text,
      flexShrink: 0,
      fontWeight: "700",
      padding: 8,
      width: 144,
    },
    tr: {
      borderBottomWidth: 1,
      borderColor: input.borderColor,
      flexDirection: "row",
    },
  } satisfies StyleSheet.NamedStyles<any>;
}

const getLocalImageFile = async (image: GeneratedImageAttachment) => {
  const extension = getImageExtension(image.uri);
  const fileName = `generated-image-${Date.now()}.${extension}`;
  const localFile = new File(Paths.cache, fileName);

  if (image.uri.startsWith("file://")) {
    return new File(image.uri);
  }

  if (image.uri.startsWith("content://")) {
    const sourceFile = new File(image.uri);
    sourceFile.copy(localFile, {
      overwrite: true,
    });

    return localFile;
  }

  const response = await fetch(image.uri);
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  localFile.create({
    overwrite: true,
    intermediates: true,
  });

  localFile.write(bytes);

  return localFile;
};
