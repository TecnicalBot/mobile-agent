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
  Bookmark,
  Pencil,
  Share2,
} from "lucide-react-native";
import {
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { refractor } from "refractor";
import jsx from "refractor/jsx";
import tsx from "refractor/tsx";
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
  MarkdownIt,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

refractor.register(jsx);
refractor.register(tsx);

const MARKDOWN_PARSER = MarkdownIt({ linkify: true, typographer: true });

type MarkdownToken = {
  attrSet: (name: string, value: string) => void;
  children?: MarkdownToken[];
  content: string;
  level: number;
  type: string;
};

MARKDOWN_PARSER.core.ruler.after(
  "inline",
  "task_lists",
  (state: { tokens: MarkdownToken[] }) => {
    for (let index = 0; index < state.tokens.length; index += 1) {
      const listItem = state.tokens[index];

      if (listItem.type !== "list_item_open") {
        continue;
      }

      const list = state.tokens
        .slice(0, index)
        .reverse()
        .find(
          (token) =>
            token.level === listItem.level - 1 &&
            (token.type === "bullet_list_open" ||
              token.type === "ordered_list_open"),
        );

      if (list?.type !== "bullet_list_open") {
        continue;
      }

      const inline = state.tokens.slice(index + 1).find(
        (token) =>
          token.type === "inline" ||
          (token.type === "list_item_close" && token.level === listItem.level),
      );
      const firstText =
        inline?.type === "inline" ? inline.children?.[0] : undefined;
      const taskMarker = firstText?.content.match(/^\[([ xX])\]\s+/);

      if (!firstText || !taskMarker) {
        continue;
      }

      firstText.content = firstText.content.slice(taskMarker[0].length);
      listItem.attrSet("task", "true");
      listItem.attrSet("checked", String(taskMarker[1].toLowerCase() === "x"));
    }
  },
);

type ChatMessageProps = {
  canEditAndResend?: boolean;
  message: StoredMessage;
  onEditMessage?: (content: string) => void;
  onSavePrompt?: (content: string) => void;
  workspaceFiles: WorkspaceFile[];
};

const MARKDOWN_RULES = {
  code_block: (node) => (
    <CopyableCodeBlock code={trimCodeBlock(node.content)} key={node.key} />
  ),
  fence: (node) => (
    <CopyableCodeBlock
      code={trimCodeBlock(node.content)}
      key={node.key}
      language={getCodeLanguage(node)}
    />
  ),
  image: (node) => (
    <MarkdownImage
      alt={String(node.attributes.alt ?? "")}
      key={node.key}
      uri={String(node.attributes.src ?? "")}
    />
  ),
  list_item: (node, children, parent, styles) => {
    const list = parent.find(
      (parentNode) =>
        parentNode.type === "bullet_list" ||
        parentNode.type === "ordered_list",
    );

    if (node.attributes.task === "true") {
      const checked = node.attributes.checked === "true";

      return (
        <View key={node.key} style={styles._VIEW_SAFE_list_item}>
          <View
            accessibilityLabel={checked ? "Completed" : "Not completed"}
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled: true }}
            style={[
              styles._VIEW_SAFE_task_list_icon,
              checked && styles._VIEW_SAFE_task_list_icon_checked,
            ]}
          >
            {checked ? (
              <Text accessible={false} style={styles.task_list_check}>
                ✓
              </Text>
            ) : null}
          </View>
          <View style={styles._VIEW_SAFE_bullet_list_content}>{children}</View>
        </View>
      );
    }

    if (list?.type === "ordered_list") {
      const start = Number(list.attributes.start) || 1;

      return (
        <View key={node.key} style={styles._VIEW_SAFE_list_item}>
          <Text accessible={false} style={styles.ordered_list_icon}>
            {`${start + node.index}${node.markup || "."}`}
          </Text>
          <View style={styles._VIEW_SAFE_ordered_list_content}>{children}</View>
        </View>
      );
    }

    return (
      <View key={node.key} style={styles._VIEW_SAFE_list_item}>
        <Text accessible={false} style={styles.bullet_list_icon}>
          {Platform.select({ android: "•", ios: "·", default: "•" })}
        </Text>
        <View style={styles._VIEW_SAFE_bullet_list_content}>{children}</View>
      </View>
    );
  },
  table: (node, children, _parent, styles) => {
    const columnCount = getTableColumnCount(node);

    return (
      <CopyableMarkdownBlock
        copyLabel="Copy table"
        copyValue={getTableText(node)}
        key={node.key}
        label="Table"
      >
        <ScrollView
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
      </CopyableMarkdownBlock>
    );
  },
} satisfies RenderRules;

function MarkdownImage({ alt, uri }: { alt: string; uri: string }) {
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return alt ? (
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {alt}
      </Text>
    ) : null;
  }

  return (
    <Image
      accessibilityLabel={alt || "Image"}
      accessible
      contentFit="contain"
      onError={() => {
        setFailed(true);
      }}
      onLoad={(event) => {
        const { height, width } = event.source;

        if (width > 0 && height > 0) {
          setAspectRatio(width / height);
        }
      }}
      source={{ uri }}
      style={{ aspectRatio, maxWidth: "100%", width: "100%" }}
    />
  );
}

type SyntaxNode =
  | { type: "text"; value: string }
  | {
      children: SyntaxNode[];
      properties?: { className?: unknown };
      type: "element";
    };

const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function trimCodeBlock(content: string) {
  return content.endsWith("\n") ? content.slice(0, -1) : content;
}

function getCodeLanguage(node: ASTNode) {
  return node.sourceType === "fence"
    ? String((node as ASTNode & { sourceInfo?: string }).sourceInfo ?? "")
        .trim()
        .split(/\s+/, 1)[0]
        .toLowerCase()
    : "";
}

function getNodeText(node: ASTNode): string {
  if (node.type === "hardbreak" || node.type === "softbreak") {
    return "\n";
  }

  if (node.children.length > 0) {
    return node.children.map(getNodeText).join("");
  }

  return node.content || String(node.attributes.alt ?? "");
}

function getTableRows(node: ASTNode): ASTNode[] {
  if (node.type === "tr") {
    return [node];
  }

  return node.children.flatMap(getTableRows);
}

function getTableText(node: ASTNode) {
  return getTableRows(node)
    .map((row) =>
      row.children
        .filter((cell) => cell.type === "th" || cell.type === "td")
        .map((cell) =>
          getNodeText(cell)
            .replace(/[\t\r\n]+/g, " ")
            .trim(),
        )
        .join("\t"),
    )
    .join("\n");
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

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

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="flex-row items-center gap-1 rounded-full px-sp-2 py-1"
      onPress={() => {
        Clipboard.setStringAsync(value)
          .then(() => {
            setCopied(true);
          })
          .catch(() => {
            Alert.alert("Copy failed", "The content could not be copied.");
          });
      }}
      style={({ pressed }) => (pressed ? { opacity: 0.65 } : null)}
    >
      {copied ? (
        <Check color={theme.textSecondary} size={13} />
      ) : (
        <Copy color={theme.textSecondary} size={13} />
      )}
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        {copied ? "Copied" : "Copy"}
      </Text>
    </Pressable>
  );
}

function CopyableMarkdownBlock({
  children,
  copyLabel,
  copyValue,
  label,
}: {
  children: ReactNode;
  copyLabel: string;
  copyValue: string;
  label: string;
}) {
  return (
    <View className="my-1.5 max-w-full overflow-hidden rounded-2xl border border-border bg-secondary dark:border-border-dark dark:bg-secondary-dark">
      <View className="h-10 flex-row items-center justify-between border-b border-border px-sp-3 dark:border-border-dark">
        <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {label}
        </Text>
        <CopyButton label={copyLabel} value={copyValue} />
      </View>
      {children}
    </View>
  );
}

function CopyableCodeBlock({
  code,
  language = "",
}: {
  code: string;
  language?: string;
}) {
  const theme = useTheme();
  const highlighted = useMemo(() => {
    if (!language || !refractor.registered(language)) {
      return null;
    }

    try {
      return refractor.highlight(code, language).children as SyntaxNode[];
    } catch {
      return null;
    }
  }, [code, language]);

  return (
    <CopyableMarkdownBlock
      copyLabel="Copy code"
      copyValue={code}
      label={language || "Code"}
    >
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={{ maxWidth: "100%" }}
      >
        <Text
          selectable
          style={{
            color: theme.text,
            fontFamily: "monospace",
            fontSize: 14,
            lineHeight: 22,
            padding: 12,
          }}
        >
          {highlighted
            ? renderSyntaxNodes(highlighted, theme.text, theme)
            : code}
        </Text>
      </ScrollView>
    </CopyableMarkdownBlock>
  );
}

function renderSyntaxNodes(
  nodes: SyntaxNode[],
  textColor: string,
  theme: ReturnType<typeof useTheme>,
  path = "token",
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${path}-${index}`;

    if (node.type === "text") {
      return node.value;
    }

    const classNames = Array.isArray(node.properties?.className)
      ? node.properties.className.filter(
          (className): className is string => typeof className === "string",
        )
      : [];

    return (
      <Text
        key={key}
        style={getSyntaxTokenStyle(classNames, textColor, theme)}
      >
        {renderSyntaxNodes(node.children, textColor, theme, key)}
      </Text>
    );
  });
}

function getSyntaxTokenStyle(
  classNames: string[],
  textColor: string,
  theme: ReturnType<typeof useTheme>,
) {
  if (
    classNames.some((name) =>
      ["comment", "prolog", "doctype", "cdata"].includes(name),
    )
  ) {
    return { color: theme.syntaxComment, fontStyle: "italic" as const };
  }

  if (
    classNames.some((name) =>
      ["property", "tag", "constant", "symbol", "deleted"].includes(name),
    )
  ) {
    return { color: theme.syntaxConstant };
  }

  if (classNames.some((name) => ["boolean", "number"].includes(name))) {
    return { color: theme.syntaxNumber };
  }

  if (
    classNames.some((name) =>
      [
        "selector",
        "attr-name",
        "string",
        "char",
        "builtin",
        "inserted",
      ].includes(name),
    )
  ) {
    return { color: theme.syntaxString };
  }

  if (
    classNames.some((name) =>
      ["operator", "entity", "url", "variable"].includes(name),
    )
  ) {
    return { color: theme.syntaxOperator };
  }

  if (
    classNames.some((name) =>
      ["atrule", "attr-value", "keyword", "control", "directive"].includes(
        name,
      ),
    )
  ) {
    return { color: theme.syntaxKeyword };
  }

  if (classNames.some((name) => ["function", "class-name"].includes(name))) {
    return { color: theme.syntaxFunction };
  }

  if (classNames.some((name) => ["regex", "important"].includes(name))) {
    return { color: theme.syntaxRegex };
  }

  return { color: textColor };
}

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
  canEditAndResend = false,
  message,
  onEditMessage,
  onSavePrompt,
  workspaceFiles,
}: ChatMessageProps) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [imageAction, setImageAction] = useState<"download" | "share" | null>(
    null,
  );
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [sharingFileId, setSharingFileId] = useState<string | null>(null);
  const [reasoningExpanded, setReasoningExpanded] = useState(
    message.status === "streaming",
  );
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

  const handleCopy = async () => {
    if (!message.content.trim()) {
      return;
    }

    await Clipboard.setStringAsync(message.content);
    setCopied(true);
  };
  const handleLinkPress = (url: string) => {
    openMarkdownLink(url).catch(console.error);
    return false;
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

  const handleShareFile = async (workspaceFile: WorkspaceFile) => {
    setSharingFileId(workspaceFile.id);

    try {
      const available = await Sharing.isAvailableAsync();

      if (!available) {
        Alert.alert(
          "Share unavailable",
          "Sharing is not available on this device.",
        );
        return;
      }

      const localFile = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!localFile.exists) {
        throw new Error("This file is no longer available in the workspace.");
      }

      const mimeType = isTextWorkspaceFile(workspaceFile)
        ? "text/plain"
        : workspaceFile.mimeType || localFile.type || "*/*";

      await Sharing.shareAsync(localFile.uri, {
        dialogTitle: `Share ${workspaceFile.displayName}`,
        mimeType,
        ...(isTextWorkspaceFile(workspaceFile)
          ? { UTI: "public.plain-text" as const }
          : {}),
      });
    } catch (error) {
      if (isUserCanceledShare(error)) {
        return;
      }

      Alert.alert(
        "Share failed",
        error instanceof Error ? error.message : "Failed to share the file.",
      );
    } finally {
      setSharingFileId(null);
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
              const sharing = sharingFileId === file.id;

              return (
                <View
                  key={file.id}
                  className={cn(
                    "w-full flex-row items-center gap-sp-1 px-sp-2 py-sp-2",
                    index > 0 &&
                      "border-t border-border dark:border-border-dark",
                  )}
                >
                  <Pressable
                    accessibilityHint="Opens the attached file"
                    accessibilityLabel={file.displayName}
                    accessibilityRole="button"
                    className="min-w-0 flex-1 flex-row items-center gap-sp-2"
                    disabled={opening}
                    onPress={() => {
                      handleOpenFile(file).catch(console.error);
                    }}
                    style={({ pressed }) =>
                      pressed ? { opacity: 0.72 } : null
                    }
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
                  <Pressable
                    accessibilityLabel={`Share ${file.displayName}`}
                    accessibilityRole="button"
                    disabled={sharing}
                    hitSlop={8}
                    onPress={() => {
                      handleShareFile(file).catch(console.error);
                    }}
                    style={({ pressed }) => ({
                      opacity: sharing ? 0.45 : pressed ? 0.7 : 1,
                    })}
                  >
                    <Share2 color={theme.textSecondary} size={16} />
                  </Pressable>
                </View>
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
                              markdownit={MARKDOWN_PARSER}
                              mergeStyle={false}
                              onLinkPress={handleLinkPress}
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
                      markdownit={MARKDOWN_PARSER}
                      mergeStyle={false}
                      onLinkPress={handleLinkPress}
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
                <DropdownMenu>
                  <DropdownMenuTrigger triggerOn="longPress">
                    <Pressable
                      accessibilityHint="Long press to open message actions"
                      accessibilityRole="button"
                      delayLongPress={220}
                      style={({ pressed }) =>
                        pressed ? { opacity: 0.9 } : null
                      }
                    >
                      <Text className="font-sans text-base text-background dark:text-background-dark">
                        {message.content}
                      </Text>
                    </Pressable>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    alignOffset={52}
                    sideOffset={16}
                    width={200}
                  >
                    <DropdownMenuItem
                      className="flex-row items-center gap-sp-3"
                      onPress={() => {
                        handleCopy().catch(console.error);
                      }}
                    >
                      <Copy color={theme.textSecondary} size={18} />
                      <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                        Copy
                      </Text>
                    </DropdownMenuItem>
                    {onSavePrompt ? (
                      <DropdownMenuItem
                        className="flex-row items-center gap-sp-3"
                        onPress={() => onSavePrompt(message.content)}
                      >
                        <Bookmark color={theme.textSecondary} size={18} />
                        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                          Save prompt
                        </Text>
                      </DropdownMenuItem>
                    ) : null}
                    {canEditAndResend && onEditMessage ? (
                      <DropdownMenuItem
                        className="flex-row items-center gap-sp-3"
                        onPress={() => {
                          setTimeout(() => {
                            onEditMessage(message.content);
                          }, 180);
                        }}
                      >
                        <Pencil color={theme.textSecondary} size={18} />
                        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                          Edit & resend
                        </Text>
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
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
            {message.content.trim() && onSavePrompt ? (
              <Button
                leftIcon={<Bookmark color={theme.textSecondary} size={14} />}
                onPress={() => onSavePrompt(message.content)}
                size="xs"
                textClassName="text-muted-foreground dark:text-muted-foreground-dark"
                variant="ghost"
              >
                Save prompt
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
      marginBottom: 12,
      marginTop: 2,
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
      marginBottom: 12,
      marginTop: 2,
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
    heading4: {
      color: input.text,
      fontSize: 17,
      fontWeight: "700",
      lineHeight: 24,
      marginBottom: 6,
      marginTop: 8,
    },
    heading5: {
      color: input.text,
      fontSize: 16,
      fontWeight: "700",
      lineHeight: 23,
      marginBottom: 4,
      marginTop: 8,
    },
    heading6: {
      color: input.mutedText,
      fontSize: 15,
      fontWeight: "700",
      lineHeight: 22,
      marginBottom: 4,
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
      alignItems: "flex-start",
      color: input.text,
      flexDirection: "row",
      justifyContent: "flex-start",
      marginBottom: 5,
      marginTop: 0,
    },
    ordered_list: {
      marginBottom: 12,
      marginTop: 2,
    },
    ordered_list_content: {
      flex: 1,
    },
    ordered_list_icon: {
      color: input.text,
      marginRight: 8,
      paddingTop: 1,
      textAlign: "right",
      width: 32,
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
    task_list_check: {
      color: input.codeBackground,
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 15,
    },
    task_list_icon: {
      alignItems: "center",
      borderColor: input.text,
      borderRadius: 4,
      borderWidth: 1.5,
      height: 18,
      justifyContent: "center",
      marginRight: 8,
      marginTop: 2,
      width: 18,
    },
    task_list_icon_checked: {
      backgroundColor: input.text,
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

async function openMarkdownLink(url: string) {
  const protocol = /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase();

  if (!protocol || !ALLOWED_LINK_PROTOCOLS.has(`${protocol}:`)) {
    Alert.alert("Unable to open link", "This link type is not supported.");
    return;
  }

  try {
    await Linking.openURL(url);
  } catch (error) {
    Alert.alert(
      "Unable to open link",
      error instanceof Error ? error.message : "No app could open this link.",
    );
  }
}
