import { useRecyclingState } from "@shopify/flash-list";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as IntentLauncher from "expo-intent-launcher";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import * as Speech from "expo-speech";
import {
  Bookmark,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Database,
  Download,
  Eye,
  Loader,
  ListTodo,
  Pencil,
  Play,
  RefreshCw,
  Share2,
  Square,
  Trash2,
} from "lucide-react-native";
import {
  createContext,
  lazy,
  memo,
  type ReactNode,
  Component,
  Suspense,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  Text,
  type TextStyle,
  useWindowDimensions,
  type ViewStyle,
  View,
} from "react-native";
import Markdown, {
  type ASTNode,
  MarkdownIt,
  type RenderRules,
} from "react-native-markdown-display";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { refractor } from "refractor";
import jsx from "refractor/jsx";
import tsx from "refractor/tsx";
import { Svg, SvgXml, Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { ChatMediaCard } from "@/components/ui/chat-media-card";
import { CodePreviewDialog } from "@/components/ui/code-preview-dialog";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockLine,
} from "@/components/ui/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
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
import { FileAttachmentCard } from "@/components/ui/file-attachment-card";
import {
  FilePreviewDialog,
  getFilePreviewKind,
} from "@/components/ui/file-preview-dialog";
import {
  ImagePreviewDrawer,
  isUserCanceledShare,
  MEDIA_ASPECT_CACHE,
  rememberMediaAspectRatio,
} from "@/components/ui/image-preview-drawer";
import { Loading } from "@/components/ui/loading";
import { MathFallback } from "@/components/ui/math-fallback";
import { Message, MessageFooter } from "@/components/ui/message";
import {
  VideoPlayerDialog,
  type VideoPlayerTarget,
} from "@/components/ui/video-player-dialog";
import { CHAT_TEXT_STYLE } from "@/constants/chat-typography";
import { TraceResourceContent } from "@/components/ui/trace-resource-content";
import { hasLegacyToolResource } from "@/modules/chat/tool-resource";
import {
  formatSummaryLines,
  parseToolSummary,
} from "@/modules/chat/tool-summary";
import { buildAssistantParts } from "@/modules/chat/assistant-parts";
import { splitSpeechText } from "@/modules/chat/assistant-response";
import {
  isTextWorkspaceFile,
  isVideoWorkspaceFile,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import type {
  GeneratedImageAttachment,
  ReasoningBlock,
  StoredMessage,
  ToolExecutionRecord,
  WorkspaceFile,
} from "@/core/types/app-state";
import { downloadText } from "@/core/services/download-service";
import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";
import { registerChatMarkdownRules } from "@/modules/chat/markdown-rules";
import { parseStableMarkdown } from "@/modules/chat/stable-markdown";
import { openExternalLink } from "@/modules/chat/open-link";
import {
  DEFAULT_REGENERATE_PRESETS,
  loadCustomPresets,
  type RegeneratePreset,
  saveCustomPresets,
} from "@/modules/chat/regenerate-presets";
import { workspaceFileFromUrl } from "@/modules/files/workspace-link";
import { useSQLiteContext } from "expo-sqlite";
import { createDrizzleDb } from "@/core/db/repositories/shared";
import { createWorkspaceRepository } from "@/core/db/repositories/workspace-repository";
import { buildPreviewDocument } from "@/modules/preview/html-document";
import {
  getVideoRenderStatus,
  subscribeVideoRenderStatus,
} from "@/modules/preview/video-render";
import { getVideoPoster, toPlayableFileUri } from "@/modules/preview/video-poster";
import {
  formatToolName,
  toolObjectLabel,
  toolTraceIcon,
  toolTraceVerb,
} from "@/modules/runtime/tool-label";
import type { VideoThumbnail } from "expo-video";

refractor.register(jsx);
refractor.register(tsx);

// MathJax (via tex-to-svg) is the heaviest import in the chat path — load it
// only when a message actually renders a math fence. Until then the raw-TeX
// fallback paints, identical to the post-load error state.
const MathBlockLazy = lazy(() =>
  import("@/components/ui/math-block").then((module) => ({
    default: module.MathBlock,
  })),
);

const MARKDOWN_PARSER = registerChatMarkdownRules(
  MarkdownIt({
    breaks: true,
    linkify: true,
    typographer: true,
  }),
);

const MARKDOWN_MAX_RENDER_LENGTH = 30_000;

/** Inline <svg> markup longer than this falls back to a code block + preview. */
const MAX_INLINE_SVG_LENGTH = 50_000;

type ChatMessageProps = {
  canEditAndResend?: boolean;
  showFooter?: boolean;
  speechContent?: string;
  message: StoredMessage;
  onEditMessage?: (content: string) => void;
  onRegenerate?: (instruction: string) => void;
  onSavePrompt?: (content: string) => void;
  workspaceFiles: WorkspaceFile[];
};

/**
 * Selectable text block for markdown inline content. Matches the library's
 * default `textgroup` output exactly, plus `selectable` and a themed
 * `selectionColor` (Android only — iOS ignores it). Only mounted when the
 * message is in select mode (see `textSelectable`), so at most one message
 * pays the native selection cost at a time.
 */
function SelectableTextGroup({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();

  return (
    <Text selectable selectionColor={theme.backgroundSelected} style={style}>
      {children}
    </Text>
  );
}

const MARKDOWN_RULES = {
  // AstRenderer also invents a new root key on every render. A stable AST
  // alone is insufficient: that root would still remount every media card.
  body: (_node, children, _parent, styles) => (
    <View key="markdown-body" style={styles._VIEW_SAFE_body}>{children}</View>
  ),
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
  math_block: (node) => (
    <Suspense
      key={node.key}
      fallback={<MathFallback tex={node.content} />}
    >
      <MathBlockLazy tex={node.content} />
    </Suspense>
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
        parentNode.type === "bullet_list" || parentNode.type === "ordered_list",
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
  table: (node, children, _parent, styles) => (
    <CopyableMarkdownBlock
      copyLabel="Copy table"
      copyValue={getTableText(node)}
      key={node.key}
      label="Table"
    >
      <MarkdownTable
        columnCount={getTableColumnCount(node)}
        tableStyle={styles._VIEW_SAFE_table}
      >
        {children}
      </MarkdownTable>
    </CopyableMarkdownBlock>
  ),
  html_block: (node) => (
    <InlineSvgBlock key={node.key} markup={htmlNodeContent(node)} />
  ),
  html_inline: (node) => (
    <InlineSvgBlock key={node.key} markup={htmlNodeContent(node)} />
  ),
} satisfies RenderRules;

// Select-mode variant: every block's inline content (`textgroup`) becomes a
// native-selectable Text covering paragraphs, headings, list items, table
// cells and blockquotes including nested bold/italic/links. Only used for the
// single selected message; the default path stays non-selectable for list
// performance.
const MARKDOWN_RULES_SELECTABLE = {
  ...MARKDOWN_RULES,
  textgroup: (node, children, _parent, styles) => (
    <SelectableTextGroup key={node.key} style={styles.textgroup}>
      {children}
    </SelectableTextGroup>
  ),
} satisfies RenderRules;

export type ChatMediaPreviewTarget =
  | { kind: "generated"; image: GeneratedImageAttachment }
  | { kind: "uri"; alt: string; uri: string }
  | { kind: "svg"; alt: string; markup: string };

const ChatMediaContext = createContext<{
  onPreviewImage: (target: ChatMediaPreviewTarget) => void;
  onPreviewVideo: (video: {
    displayName: string;
    mimeType: string;
    uri: string;
  }) => void;
  workspaceFiles: WorkspaceFile[];
}>({ onPreviewImage: () => {}, onPreviewVideo: () => {}, workspaceFiles: [] });

/**
 * Measured inner width of the assistant bubble's content column, reported by
 * the element that renders every markdown block of a message. Tables read it
 * on the frame *after* the first layout instead of estimating from the
 * window, so they lay out at their final width immediately instead of
 * reshuffling when their own onLayout lands.
 */
const MarkdownContainerWidthContext = createContext(0);

/**
 * The trailing indicator for a streaming message. It renders the idle spinner
 * by default and swaps to a live "Rendering video…" label while the app-level
 * render host is recording — subscribed in isolation so progress ticks only
 * re-render this row, not the whole message.
 */
const StreamingIndicator = memo(function StreamingIndicator({
  idle,
}: {
  idle: ReactNode;
}) {
  const status = useSyncExternalStore(
    subscribeVideoRenderStatus,
    getVideoRenderStatus,
    getVideoRenderStatus,
  );

  if (!status) {
    return <>{idle}</>;
  }

  return (
    <Loading
      label={
        status.finishing
          ? "Finalizing video"
          : `Rendering video ${Math.round(status.progress * 100)}%`
      }
    />
  );
});

// Hoisted so the streaming row doesn't allocate a fresh element per token.
const STREAMING_IDLE_ELEMENT = <Loading />;

function MarkdownImage({ alt, uri }: { alt: string; uri: string }) {
  const { onPreviewImage, workspaceFiles } = useContext(ChatMediaContext);
  const resolvedUri = useMemo(() => {
    if (!uri) return uri;
    if (uri.startsWith("workspace://")) {
      const file = workspaceFileFromUrl(uri, workspaceFiles);
      if (file) return resolveWorkspaceFile(file.relativePath).uri;
    }
    return uri;
  }, [uri, workspaceFiles]);
  // Seed from the session cache when this uri was already decoded once, so a
  // recycled row starts at the real height instead of the 16:9 guess.
  const [aspectRatio, setAspectRatio] = useState(
    () => MEDIA_ASPECT_CACHE.get(resolvedUri) ?? 16 / 9,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setAspectRatio(MEDIA_ASPECT_CACHE.get(resolvedUri) ?? 16 / 9);
  }, [resolvedUri]);
  const videoAttachment = useMemo(() => {
    if (!uri.startsWith("workspace://")) return null;
    const file = workspaceFileFromUrl(uri, workspaceFiles);
    if (file && isVideoWorkspaceFile(file)) {
      return {
        displayName: file.displayName,
        mimeType: file.mimeType ?? "video/mp4",
        uri,
      };
    }
    return null;
  }, [uri, workspaceFiles]);

  if (videoAttachment) {
    return <VideoAttachmentView {...videoAttachment} />;
  }

  if (!resolvedUri || failed) {
    return alt ? (
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {alt}
      </Text>
    ) : null;
  }

  return (
    <ChatMediaCard
      accessibilityHint="Opens the image preview"
      accessibilityLabel={alt || "Open image preview"}
      className="mb-2.5 mt-1"
      onPress={() => {
        onPreviewImage({ alt: alt || "Image", kind: "uri", uri: resolvedUri });
      }}
    >
      <Image
        accessibilityLabel={alt || "Image"}
        accessible
        cachePolicy="memory-disk"
        contentFit="contain"
        onError={() => {
          setFailed(true);
        }}
        onLoad={(event) => {
          const { height, width } = event.source;

          if (width > 0 && height > 0) {
            rememberMediaAspectRatio(resolvedUri, width / height);
            setAspectRatio(width / height);
          }
        }}
        recyclingKey={resolvedUri}
        source={{ uri: resolvedUri }}
        style={{ aspectRatio, width: "100%" }}
      />
    </ChatMediaCard>
  );
}

/**
 * A video embedded in a message — either inline where the model placed a
 * `![name](workspace://fileId)` embed, or as the fallback card at the end of
 * the message. Shows the first frame as a poster with a play overlay; tapping
 * opens the video player dialog (play/save/share).
 */
function VideoAttachmentView({
  displayName,
  mimeType,
  uri,
}: {
  displayName: string;
  mimeType: string;
  uri: string;
}) {
  const { onPreviewVideo, workspaceFiles } = useContext(ChatMediaContext);
  const [poster, setPoster] = useState<VideoThumbnail | null>(null);

  const localUri = useMemo(() => {
    if (uri.startsWith("workspace://")) {
      const file = workspaceFileFromUrl(uri, workspaceFiles);
      if (file) {
        return toPlayableFileUri(resolveWorkspaceFile(file.relativePath).uri);
      }
      return null;
    }
    return toPlayableFileUri(uri);
  }, [uri, workspaceFiles]);

  useEffect(() => {
    if (!localUri) {
      setPoster(null);
      return;
    }

    let cancelled = false;
    getVideoPoster(localUri).then((thumbnail) => {
      if (!cancelled) setPoster(thumbnail);
    });

    return () => {
      cancelled = true;
    };
  }, [localUri]);

  return (
    <ChatMediaCard
      accessibilityHint="Plays the video"
      accessibilityLabel={`Play video ${displayName}`}
      onPress={() => {
        onPreviewVideo({ displayName, mimeType, uri });
      }}
    >
      {poster ? (
        <Image
          accessibilityLabel={displayName}
          accessible
          contentFit="cover"
          source={poster}
          style={{
            aspectRatio:
              poster.width > 0 && poster.height > 0
                ? poster.width / poster.height
                : 16 / 9,
            width: "100%",
          }}
        />
      ) : (
        <View
          className="items-center justify-center bg-black/90"
          style={{ aspectRatio: 16 / 9, width: "100%" }}
        />
      )}
      <View
        className="absolute inset-0 items-center justify-center"
        pointerEvents="none"
      >
        <View className="h-14 w-14 items-center justify-center rounded-full bg-black/60">
          <Play color="#ffffff" size={28} />
        </View>
      </View>
    </ChatMediaCard>
  );
}

function htmlNodeContent(node: ASTNode): string {
  return typeof node.content === "string" ? node.content : "";
}

function extractSvgMarkup(source: string): string | null {
  const start = source.search(/<svg[\s>]/i);
  if (start === -1) return null;
  const endTag = "</svg>";
  const end = source.toLowerCase().lastIndexOf(endTag);
  if (end === -1 || end < start) return null;
  return source.slice(start, end + endTag.length);
}

function svgAspectRatio(markup: string): number {
  const viewBox =
    /viewBox\s*=\s*["']?\s*-?[\d.]+\s+-?[\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']?/i.exec(
      markup,
    );
  if (viewBox) {
    const width = Number(viewBox[1]);
    const height = Number(viewBox[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height;
    }
  }
  const openTag = /<svg[^>]*>/i.exec(markup)?.[0] ?? "";
  const width = /\swidth\s*=\s*["']?([\d.]+)/i.exec(openTag)?.[1];
  const height = /\sheight\s*=\s*["']?([\d.]+)/i.exec(openTag)?.[1];
  const parsedWidth = width ? Number(width) : NaN;
  const parsedHeight = height ? Number(height) : NaN;
  if (
    Number.isFinite(parsedWidth) &&
    Number.isFinite(parsedHeight) &&
    parsedWidth > 0 &&
    parsedHeight > 0
  ) {
    return parsedWidth / parsedHeight;
  }
  return 1;
}

type SvgErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  markup: string;
};

/**
 * SvgXml throws while rendering malformed XML (e.g. a still-streaming
 * message). Without this, one bad block unmounts the whole chat list.
 */
class SvgErrorBoundary extends Component<
  SvgErrorBoundaryProps,
  { failed: boolean; lastMarkup: string }
> {
  state = { failed: false, lastMarkup: this.props.markup };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: SvgErrorBoundaryProps,
    state: { failed: boolean; lastMarkup: string },
  ) {
    if (props.markup !== state.lastMarkup) {
      return { failed: false, lastMarkup: props.markup };
    }
    return null;
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Renders raw inline <svg> markup like an image. Non-svg HTML stays dropped. */
function InlineSvgBlock({ markup }: { markup: string }) {
  const { onPreviewImage } = useContext(ChatMediaContext);
  const svg = extractSvgMarkup(markup);
  if (!svg) return null;
  if (svg.length > MAX_INLINE_SVG_LENGTH) {
    return <CopyableCodeBlock code={svg} language="svg" />;
  }
  const aspectRatio = svgAspectRatio(svg);
  return (
    <SvgErrorBoundary
      fallback={<CopyableCodeBlock code={svg} language="svg" />}
      markup={svg}
    >
      <Pressable
        accessibilityHint="Opens the SVG preview"
        accessibilityLabel="Open SVG preview"
        accessibilityRole="button"
        onPress={() => {
          onPreviewImage({ alt: "SVG image", kind: "svg", markup: svg });
        }}
        style={({ pressed }) => (pressed ? { opacity: 0.9 } : null)}
      >
        <View style={{ aspectRatio, width: "100%" }}>
          <SvgXml height="100%" width="100%" xml={svg} />
        </View>
      </Pressable>
    </SvgErrorBoundary>
  );
}

type SyntaxNode =
  | { type: "text"; value: string }
  | {
      children: SyntaxNode[];
      properties?: { className?: unknown };
      type: "element";
    };

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

/**
 * Narrowest a column gets before a table starts scrolling sideways instead of
 * squeezing its text into slivers.
 */
const TABLE_MIN_COLUMN_WIDTH = 116;

/**
 * A markdown table sized to the card it sits in.
 *
 * Columns share the available width evenly — so a two-column table fills the
 * bubble instead of leaving a dead strip on the right that reads like an empty
 * extra column — and only shrink to the minimum (scrolling sideways) when
 * there are too many columns to fit.
 */
function MarkdownTable({
  children,
  columnCount,
  tableStyle,
}: {
  children: ReactNode;
  columnCount: number;
  tableStyle: StyleProp<ViewStyle>;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const contextWidth = useContext(MarkdownContainerWidthContext);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const columns = Math.max(columnCount, 1);
  // On the very first frame no layout exists yet, so estimate from the window
  // (the card keeps a page margin on both sides). From the frame after that,
  // the message-level container measurement or our own onLayout wins, and the
  // table renders at its final width — no slide-in reshuffle.
  const availableWidth =
    measuredWidth > 0
      ? measuredWidth
      : contextWidth > 0
        ? contextWidth
        : Math.max(windowWidth - 72, 0);
  const tableWidth = Math.max(availableWidth, columns * TABLE_MIN_COLUMN_WIDTH);

  return (
    <View
      onLayout={(event) => {
        const width = Math.round(event.nativeEvent.layout.width);
        setMeasuredWidth((current) => (width === current ? current : width));
      }}
      style={{ maxWidth: "100%" }}
    >
      <ScrollView
        directionalLockEnabled
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={{ maxWidth: "100%" }}
      >
        <View style={[tableStyle, { width: tableWidth }]}>{children}</View>
      </ScrollView>
    </View>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useRecyclingState(false, [value]);

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
  }, [copied, setCopied]);

  return (
    <Pressable
      accessibilityLabel={copied ? `${label} — copied` : label}
      accessibilityRole="button"
      className="items-center justify-center rounded-full p-1"
      hitSlop={8}
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
        <Check color={theme.textSecondary} size={16} />
      ) : (
        <Copy color={theme.textSecondary} size={16} />
      )}
    </Pressable>
  );
}

function CopyableMarkdownBlock({
  children,
  copyLabel,
  copyValue,
  headerAccessory,
  label,
}: {
  children: ReactNode;
  copyLabel: string;
  copyValue: string;
  headerAccessory?: ReactNode;
  label: string;
}) {
  return (
    <View className="my-1.5 max-w-full overflow-hidden rounded-2xl border border-border bg-secondary dark:border-border-dark dark:bg-secondary-dark">
      <View className="h-10 flex-row items-center justify-between border-b border-border px-sp-3 dark:border-border-dark">
        <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {label}
        </Text>
        <View className="flex-row items-center gap-sp-2">
          {headerAccessory}
          <CopyButton label={copyLabel} value={copyValue} />
        </View>
      </View>
      {children}
    </View>
  );
}

const SYNC_HIGHLIGHT_LENGTH = 2000;
const HIGHLIGHT_CACHE_LIMIT = 64;
/** Taller blocks start collapsed so a long file can't swallow the message. */
const COLLAPSED_CODE_LINES = 18;

/**
 * Refractor is synchronous, so it can noticeably block the JS thread on large
 * files. Highlighting the rendered slice (usually the collapsed first lines)
 * and caching the AST keeps streaming smooth without dropping color to plain
 * text the way the old length cap did.
 */
const highlightNodeCache = new Map<string, SyntaxNode[] | null>();

function highlightCacheKey(code: string, language: string) {
  return `${language}\u0000${code}`;
}

function computeHighlightNodes(
  code: string,
  language: string,
): SyntaxNode[] | null {
  if (!language || !refractor.registered(language)) {
    return null;
  }

  const key = highlightCacheKey(code, language);
  const cached = highlightNodeCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  let nodes: SyntaxNode[] | null = null;

  try {
    nodes = refractor.highlight(code, language).children as SyntaxNode[];
  } catch {
    nodes = null;
  }

  if (highlightNodeCache.size >= HIGHLIGHT_CACHE_LIMIT) {
    const oldest = highlightNodeCache.keys().next().value;

    if (oldest !== undefined) {
      highlightNodeCache.delete(oldest);
    }
  }

  highlightNodeCache.set(key, nodes);

  return nodes;
}

/**
 * Code text with optional syntax highlighting. Small snippets highlight
 * synchronously; large ones render plain first and upgrade after paint so a
 * big fence never stalls the message list.
 */
function SyntaxCodeText({
  code,
  language,
  textColor,
}: {
  code: string;
  language: string;
  textColor: string;
}) {
  const theme = useTheme();
  const cacheKey = highlightCacheKey(code, language);
  const immediateNodes = useMemo(
    () =>
      code.length <= SYNC_HIGHLIGHT_LENGTH
        ? computeHighlightNodes(code, language)
        : null,
    [code, language],
  );
  const [deferred, setDeferred] = useState<{
    key: string;
    nodes: SyntaxNode[] | null;
  } | null>(null);

  useEffect(() => {
    if (code.length <= SYNC_HIGHLIGHT_LENGTH) {
      return;
    }

    if (highlightNodeCache.has(cacheKey)) {
      setDeferred({
        key: cacheKey,
        nodes: highlightNodeCache.get(cacheKey) ?? null,
      });
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setDeferred({
          key: cacheKey,
          nodes: computeHighlightNodes(code, language),
        });
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [code, language, cacheKey]);

  const nodes =
    code.length <= SYNC_HIGHLIGHT_LENGTH
      ? immediateNodes
      : deferred?.key === cacheKey
        ? deferred.nodes
        : null;

  return (
    <Text
      selectable
      style={{
        color: textColor,
        fontFamily: "monospace",
        fontSize: 14,
        lineHeight: 22,
        padding: 12,
      }}
    >
      {nodes ? renderSyntaxNodes(nodes, textColor, theme) : code}
    </Text>
  );
}

/** Soft fade over the last visible lines of a collapsed code block. */
function CodeFade({ color }: { color: string }) {
  return (
    <Svg height={28} width="100%">
      <Defs>
        <LinearGradient id="codeBlockFade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0} />
          <Stop offset="1" stopColor={color} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect fill="url(#codeBlockFade)" height={28} width="100%" />
    </Svg>
  );
}

/** Small round icon button used in code-block headers (e.g. full screen). */
function ViewerIconButton({
  accessibilityHint,
  accessibilityLabel,
  icon,
  onPress,
}: {
  accessibilityHint?: string;
  accessibilityLabel: string;
  icon: ReactNode;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          alignItems: "center",
          backgroundColor: theme.backgroundSelected,
          borderRadius: 999,
          height: 26,
          justifyContent: "center",
          width: 26,
        },
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      {icon}
    </Pressable>
  );
}

const PREVIEWABLE_LANGUAGES = new Set(["htm", "html", "svg", "xml"]);

function isPreviewableLanguage(language: string) {
  return PREVIEWABLE_LANGUAGES.has(language.toLowerCase());
}

/** Opens the markup preview in a dialog rather than inline in the message. */
function PreviewButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();

  return (
    <ViewerIconButton
      accessibilityHint="Opens the rendered output in a dialog"
      accessibilityLabel="Preview"
      icon={<Eye color={theme.text} size={14} />}
      onPress={onPress}
    />
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
  // Recycling, or a streaming delta that rewrites the fence, closes the viewer
  // so it can never outlive the code it was built from.
  const [viewer, setViewer] = useRecyclingState<null | "code" | "preview">(
    null,
    [code],
  );
  const previewable = isPreviewableLanguage(language);
  const previewDocument = useMemo(
    () => (previewable ? buildPreviewDocument(code, language) : null),
    [code, language, previewable],
  );
  const lines = useMemo(() => code.split("\n"), [code]);
  const collapsible = lines.length > COLLAPSED_CODE_LINES;
  // A long block never expands inline: the footer opens the full-screen
  // viewer instead, so a big file can't push the rest of the message away.
  const visibleCode = collapsible
    ? lines.slice(0, COLLAPSED_CODE_LINES).join("\n")
    : code;

  return (
    <CopyableMarkdownBlock
      copyLabel="Copy code"
      copyValue={code}
      headerAccessory={
        previewable ? (
          <PreviewButton
            onPress={() => {
              setViewer("preview");
            }}
          />
        ) : null
      }
      label={language || "Code"}
    >
      <View className="relative">
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={{ maxWidth: "100%" }}
        >
          <SyntaxCodeText
            code={visibleCode}
            language={language}
            textColor={theme.text}
          />
        </ScrollView>
        {collapsible ? (
          <View
            className="absolute bottom-0 left-0 right-0"
            pointerEvents="none"
          >
            <CodeFade color={theme.backgroundSelected} />
          </View>
        ) : null}
      </View>
      {collapsible ? (
        <Pressable
          accessibilityHint="Opens the whole file in a dialog"
          accessibilityLabel={`Show all ${lines.length} lines`}
          accessibilityRole="button"
          className="h-9 flex-row items-center justify-center gap-sp-1 border-t border-border dark:border-border-dark"
          onPress={() => {
            setViewer("code");
          }}
          style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
        >
          <Text className="font-sans text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
            {`Show all ${lines.length} lines`}
          </Text>
          <ChevronDown color={theme.textSecondary} size={14} />
        </Pressable>
      ) : null}
      {viewer ? (
        <CodePreviewDialog
          code={code}
          html={
            viewer === "preview" && previewDocument ? previewDocument : ""
          }
          initialMode={viewer}
          language={language}
          onDismiss={() => {
            setViewer(null);
          }}
        />
      ) : null}
    </CopyableMarkdownBlock>
  );
}

const MarkdownContent = memo(function MarkdownContent({
  content,
  onLinkPress,
  selectable = false,
  styles,
}: {
  content: string;
  onLinkPress: (url: string) => boolean;
  selectable?: boolean;
  styles: ReturnType<typeof createMarkdownStyles>;
}) {
  const ast = useMemo(
    () => content.length > MARKDOWN_MAX_RENDER_LENGTH
      ? null
      : parseStableMarkdown(content, MARKDOWN_PARSER),
    [content],
  );
  if (content.length > MARKDOWN_MAX_RENDER_LENGTH) {
    return (
      <Text selectable={selectable} style={styles.body}>
        {content}
      </Text>
    );
  }

  return (
    <Markdown
      markdownit={MARKDOWN_PARSER}
      mergeStyle={false}
      onLinkPress={onLinkPress}
      rules={selectable ? MARKDOWN_RULES_SELECTABLE : MARKDOWN_RULES}
      style={styles}
    >
      {/* AST arrays are supported by the runtime but omitted from its React types. */}
      {ast as unknown as ReactNode}
    </Markdown>
  );
});

function renderSyntaxNodes(
  nodes: SyntaxNode[],
  textColor: string,
  theme: ReturnType<typeof useTheme>,
  path = "token",
): ReactNode[] {
  const runs: { kind: SyntaxTokenKind; text: string }[] = [];
  flattenSyntaxNodes(nodes, "default", runs);

  const styleCache = new Map<SyntaxTokenKind, TextStyle>();
  const getStyle = (kind: SyntaxTokenKind) => {
    let style = styleCache.get(kind);
    if (!style) {
      style = getSyntaxTokenStyle(kind, textColor, theme);
      styleCache.set(kind, style);
    }
    return style;
  };

  const grouped: ReactNode[] = [];
  let pending: { kind: SyntaxTokenKind; key: string; text: string } | null =
    null;
  let groupIndex = 0;
  const flush = () => {
    if (pending) {
      grouped.push(
        <Text key={pending.key} style={getStyle(pending.kind)}>
          {pending.text}
        </Text>,
      );
      pending = null;
    }
  };

  for (const run of runs) {
    if (pending && pending.kind === run.kind) {
      pending.text += run.text;
    } else {
      flush();
      pending = {
        key: `${path}-run-${groupIndex++}`,
        kind: run.kind,
        text: run.text,
      };
    }
  }
  flush();

  return grouped;
}

function flattenSyntaxNodes(
  nodes: SyntaxNode[],
  parentKind: SyntaxTokenKind,
  runs: { kind: SyntaxTokenKind; text: string }[],
): void {
  for (const node of nodes) {
    if (node.type === "text") {
      runs.push({ kind: parentKind, text: node.value });
      continue;
    }

    const classNames = Array.isArray(node.properties?.className)
      ? node.properties.className.filter(
          (className): className is string => typeof className === "string",
        )
      : [];
    flattenSyntaxNodes(node.children, getSyntaxTokenKind(classNames), runs);
  }
}

type SyntaxTokenKind =
  | "comment"
  | "constant"
  | "number"
  | "string"
  | "operator"
  | "keyword"
  | "function"
  | "regex"
  | "default";

const SYNTAX_KIND_CLASSES: Record<SyntaxTokenKind, readonly string[]> = {
  comment: ["comment", "prolog", "doctype", "cdata"],
  constant: ["property", "tag", "constant", "symbol", "deleted"],
  number: ["boolean", "number"],
  string: ["selector", "attr-name", "string", "char", "builtin", "inserted"],
  operator: ["operator", "entity", "url", "variable"],
  keyword: ["atrule", "attr-value", "keyword", "control", "directive"],
  function: ["function", "class-name"],
  regex: ["regex", "important"],
  default: [],
};

function getSyntaxTokenKind(classNames: string[]): SyntaxTokenKind {
  for (const [kind, classes] of Object.entries(SYNTAX_KIND_CLASSES)) {
    if (
      kind !== "default" &&
      classNames.some((name) => classes.includes(name))
    ) {
      return kind as SyntaxTokenKind;
    }
  }
  return "default";
}

function getSyntaxTokenStyle(
  kind: SyntaxTokenKind,
  textColor: string,
  theme: ReturnType<typeof useTheme>,
): TextStyle {
  switch (kind) {
    case "comment":
      return { color: theme.syntaxComment, fontStyle: "italic" };
    case "constant":
      return { color: theme.syntaxConstant };
    case "number":
      return { color: theme.syntaxNumber };
    case "string":
      return { color: theme.syntaxString };
    case "operator":
      return { color: theme.syntaxOperator };
    case "keyword":
      return { color: theme.syntaxKeyword };
    case "function":
      return { color: theme.syntaxFunction };
    case "regex":
      return { color: theme.syntaxRegex };
    default:
      return { color: textColor };
  }
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

function SpinningLoader({ color, size }: { color: string; size: number }) {
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }

    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );

    return () => {
      cancelAnimation(rotation);
    };
  }, [rotation, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={[{ marginTop: 1 }, animatedStyle]}>
      <Loader color={color} size={size} />
    </Animated.View>
  );
}

export const ChatMessage = memo(function ChatMessage({
  canEditAndResend = false,
  showFooter = true,
  speechContent,
  message,
  onEditMessage,
  onRegenerate,
  onSavePrompt,
  workspaceFiles,
}: ChatMessageProps) {
  const theme = useTheme();
  // Assistant body text is always selectable (except while streaming, when
  // content rewrites every token would thrash native selection handles).
  // No select mode, no toggle — long-press goes straight to the system
  // selection menu (Copy + Ask agent on Android).
  const selectEnabled = message.status !== "streaming";
  const [speaking, setSpeaking] = useRecyclingState(false, [message.id]);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [customPresets, setCustomPresets] = useState<RegeneratePreset[]>([]);
  const [copied, setCopied] = useRecyclingState(false, [message.id]);
  const [imageAction, setImageAction] = useRecyclingState<
    "download" | "share" | null
  >(null, [message.id]);
  const [memoryExpanded, setMemoryExpanded] = useRecyclingState(false, [
    message.id,
  ]);
  const [openingFileId, setOpeningFileId] = useRecyclingState<string | null>(
    null,
    [message.id],
  );
  const [tasksExpanded, setTasksExpanded] = useRecyclingState<
    boolean | undefined
  >(() => (message.status === "streaming" ? true : undefined), [message.id]);
  const [doneTasksExpanded, setDoneTasksExpanded] = useRecyclingState(
    false,
    [message.id],
  );
  const [imagePreview, setImagePreview] =
    useRecyclingState<ChatMediaPreviewTarget | null>(null, [message.id]);
  const [videoPreview, setVideoPreview] =
    useRecyclingState<VideoPlayerTarget | null>(null, [message.id]);
  const [previewFile, setPreviewFile] = useRecyclingState<WorkspaceFile | null>(
    null,
    [message.id],
  );
  // Width of the assistant content column once laid out; tables consume it to
  // skip the window-sized estimate right after their first frame.
  const [markdownContainerWidth, setMarkdownContainerWidth] = useState(0);
  // Explicit reader choices override the default of opening running rows.
  const [expandedToolRunIds, setExpandedToolRunIds] = useRecyclingState(
    () => new Map<string, boolean>(),
    [message.id],
  );
  const isAssistant = message.role === "assistant";
  const isUser = message.role === "user";
  // While streaming, tokens arrive at 20-60/s and a full MarkdownIt +
  // refractor re-parse per token janks the JS thread. Deferring lets React
  // batch tokens and re-parse at a lower priority; stable messages render
  // the real content with zero behavior change.
  const deferredContent = useDeferredValue(message.content);
  const bodyContent =
    message.status === "streaming" ? deferredContent : message.content;
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
        tableHeaderBackground: theme.backgroundSelected,
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

  useEffect(() => {
    if (!regenerateOpen) {
      return;
    }

    let cancelled = false;

    loadCustomPresets()
      .then((presets) => {
        if (!cancelled) {
          setCustomPresets(presets);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [regenerateOpen]);

  const handleToggleSpeech = useCallback(async () => {
    if (speaking) {
      await Speech.stop().catch(() => {});
      setSpeaking(false);
      return;
    }

    const content = (speechContent ?? message.content).trim();

    if (!content) {
      return;
    }

    await Speech.stop().catch(() => {});
    const chunks = splitSpeechText(content, Speech.maxSpeechInputLength);
    setSpeaking(true);
    chunks.forEach((chunk, index) => {
      Speech.speak(chunk, {
        onDone: index === chunks.length - 1 ? () => setSpeaking(false) : undefined,
        onError: () => {
          Speech.stop().catch(() => {});
          setSpeaking(false);
        },
        onStopped: () => setSpeaking(false),
      });
    });
  }, [message.content, setSpeaking, speaking, speechContent]);

  const persistCustomPresets = useCallback((presets: RegeneratePreset[]) => {
    setCustomPresets(presets);
    saveCustomPresets(presets).catch(console.error);
  }, []);

  const handleDeleteCustomPreset = useCallback(
    (id: string) => {
      persistCustomPresets(customPresets.filter((preset) => preset.id !== id));
    },
    [customPresets, persistCustomPresets],
  );

  const handlePickPreset = useCallback(
    (preset: RegeneratePreset) => {
      setRegenerateOpen(false);
      onRegenerate?.(preset.instruction);
    },
    [onRegenerate],
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
  }, [copied, setCopied]);

  const handleCopy = async () => {
    if (!message.content.trim()) {
      return;
    }

    await Clipboard.setStringAsync(message.content);
    setCopied(true);
  };
  const sqlite = useSQLiteContext();
  const workspaceRepository = useMemo(
    () => createWorkspaceRepository(createDrizzleDb(sqlite)),
    [sqlite],
  );
  const openImagePreview = useCallback((target: ChatMediaPreviewTarget) => {
    setImagePreview(target);
  }, [setImagePreview]);
  // Ref mirror so press handlers stay referentially stable across
  // workspace refreshes — otherwise every file import busts the memo on
  // MarkdownContent and re-parses markdown in every visible row.
  const workspaceFilesRef = useRef(workspaceFiles);
  workspaceFilesRef.current = workspaceFiles;
  const openVideoFile = useCallback(
    async (video: { displayName: string; mimeType: string; uri: string }) => {
      let localUri = video.uri;
      const file = workspaceFileFromUrl(video.uri, workspaceFilesRef.current);

      if (file) {
        localUri = resolveWorkspaceFile(file.relativePath).uri;
      } else if (video.uri.startsWith("workspace://")) {
        const id = video.uri.slice("workspace://".length);
        const record = await workspaceRepository.getById(id).catch(() => null);

        if (record) {
          localUri = resolveWorkspaceFile(record.relativePath).uri;
        }
      }

      setVideoPreview({
        displayName: video.displayName,
        localUri,
        mimeType: video.mimeType,
      });
    },
    [setVideoPreview, workspaceRepository],
  );
  /**
   * One route for a workspace file, so tapping a link opens the same viewer
   * the inline preview card uses: images go to the image drawer, videos to
   * the player, everything else to the file preview dialog.
   */
  const openWorkspaceFile = useCallback(
    (file: WorkspaceFile) => {
      if (isVideoWorkspaceFile(file)) {
        void openVideoFile({
          displayName: file.displayName,
          mimeType: file.mimeType ?? "video/mp4",
          uri: `workspace://${file.id}`,
        }).catch(console.error);
        return;
      }

      if (getFilePreviewKind(file) === "image") {
        openImagePreview({
          kind: "uri",
          alt: file.displayName,
          uri: resolveWorkspaceFile(file.relativePath).uri,
        });
        return;
      }

      setPreviewFile(file);
    },
    [openImagePreview, openVideoFile, setPreviewFile],
  );
  const handleLinkPress = useCallback(
    (url: string) => {
      const workspaceFile = workspaceFileFromUrl(url, workspaceFilesRef.current);

      if (workspaceFile) {
        openWorkspaceFile(workspaceFile);
        return false;
      }

      if (url.startsWith("workspace://")) {
        const id = url.slice("workspace://".length);
        workspaceRepository.getById(id).then((file) => {
          if (!file) {
            Alert.alert("File unavailable", "This file is no longer in the workspace.");
            return;
          }

          openWorkspaceFile(file);
        }).catch((error) => Alert.alert("Could not open file", String(error)));
        return false;
      }
      openExternalLink(url).catch(console.error);

      return false;
    },
    [openWorkspaceFile, workspaceRepository],
  );
  const mediaContext = useMemo(
    () => ({
      onPreviewImage: openImagePreview,
      onPreviewVideo: (video: {
        displayName: string;
        mimeType: string;
        uri: string;
      }) => {
        openVideoFile(video).catch(console.error);
      },
      workspaceFiles,
    }),
    [openImagePreview, openVideoFile, workspaceFiles],
  );
  const closePreview = () => {
    setImageAction(null);
    setImagePreview(null);
  };

  const handleDownloadSvg = async (markup: string) => {
    setImageAction("download");

    try {
      const result = await downloadText(
        markup,
        `image-${Date.now()}.svg`,
        "image/svg+xml",
      );
      if (result) {
        Alert.alert("Image saved", `${result.name} has been saved to Downloads.`);
      }
    } catch (error) {
      Alert.alert(
        "Download failed",
        error instanceof Error ? error.message : "Failed to save the image.",
      );
    } finally {
      setImageAction(null);
    }
  };

  const handleShareSvg = async (markup: string) => {
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

      const localFile = new File(Paths.cache, `shared-image-${Date.now()}.svg`);
      localFile.create({ intermediates: true, overwrite: true });
      try {
        localFile.write(markup);

        await Sharing.shareAsync(localFile.uri, {
          dialogTitle: "Share SVG image",
          mimeType: "image/svg+xml",
          UTI: "public.svg-image",
        });
      } finally {
        try {
          localFile.delete();
        } catch {
          // Best-effort cache cleanup.
        }
      }
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
      if (isVideoWorkspaceFile(workspaceFile)) {
        await openVideoFile({
          displayName: workspaceFile.displayName,
          mimeType: workspaceFile.mimeType ?? "video/mp4",
          uri: `workspace://${workspaceFile.id}`,
        });
        return;
      }

      if (getFilePreviewKind(workspaceFile) === "image") {
        openImagePreview({
          kind: "uri",
          alt: workspaceFile.displayName,
          uri: resolveWorkspaceFile(workspaceFile.relativePath).uri,
        });
        return;
      }

      if (getFilePreviewKind(workspaceFile)) {
        setPreviewFile(workspaceFile);
        return;
      }

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

  const memoryEvents = message.metadata?.memoryEvents ?? [];
  const todoList = message.metadata?.todoList ?? [];
  const pendingTodoList = todoList.filter(
    (task) => task.status !== "completed",
  );
  const completedTodoList = todoList.filter(
    (task) => task.status === "completed",
  );
  const todoActive =
    message.status === "streaming" &&
    todoList.some((task) => task.status === "in_progress");
  const termuxRuns = (message.metadata?.toolExecutions ?? []).filter(
    (execution) => Boolean(execution.termux),
  );
  const hasRunningTermuxRun = termuxRuns.some(
    (run) => run.status === "running" && message.status === "streaming",
  );
  const pluginOutputs = message.metadata?.pluginOutputs ?? [];
  const toolExecutions = message.metadata?.toolExecutions ?? [];
  // Elapsed-time labels for the trace rows' `TraceDescription` — the number
  // the steps drawer used to show, computed from the records' own timestamps
  // so old chats show it too. The first step has no number (the drawer's
  // "Start" row).
  const stepGapLabels = new Map<string, string>();
  const recordsByStep = [...toolExecutions].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  recordsByStep.forEach((record, index) => {
    if (index === 0) {
      return;
    }
    const gap = formatStepGap(
      recordsByStep[index - 1].createdAt,
      record.createdAt,
    );
    if (gap) {
      stepGapLabels.set(record.id ?? record.createdAt, gap);
    }
  });
  const hasActivity = Boolean(message.metadata?.toolExecutions?.length || message.metadata?.reasoning?.length);
  const assistantParts = buildAssistantParts(hasActivity ? message.content : bodyContent, message.metadata);
  const generatedImages = message.metadata?.generatedImages ?? [];
  const generatedVideos = message.metadata?.generatedVideos ?? [];
  // Videos the model already embedded inline with `![name](workspace://id)`
  // render in place — only the rest get the fallback card at the end.
  const embeddedVideoUris = useMemo(
    () => collectEmbeddedVideoUris(message.content),
    [message.content],
  );
  const visibleGeneratedVideos = generatedVideos.filter(
    (video) => !embeddedVideoUris.has(video.uri),
  );
  const attachedFiles = (message.metadata?.selectedFileIds ?? [])
    .map((fileId) => workspaceFiles.find((file) => file.id === fileId))
    .filter((file): file is WorkspaceFile => file !== undefined);
  const hasUserAttachments = isUser && attachedFiles.length > 0;
  const memoryEventLabel =
    memoryEvents.length === 0
      ? null
      : memoryEvents.length === 1
        ? getMemoryEventLabel(memoryEvents[0].kind)
        : `${memoryEvents.length} memory updates`;

  return (
    <Message align={align}>
      <ChatMediaContext.Provider value={mediaContext}>
      <View
        className={cn(
          "w-full gap-1",
          align === "end" ? "items-end" : "items-start",
        )}
      >
        {hasUserAttachments ? (
          <FlatList
            contentContainerStyle={{ flexGrow: 1, gap: 8, justifyContent: "flex-end" }}
            data={attachedFiles}
            horizontal
            initialNumToRender={6}
            keyExtractor={(file) => file.id}
            maxToRenderPerBatch={6}
            renderItem={({ item: file }) => (
              <FileAttachmentCard
                file={file}
                opening={openingFileId === file.id}
                onPress={() => {
                  handleOpenFile(file).catch(console.error);
                }}
              />
            )}
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, width: "100%" }}
            windowSize={3}
          />
        ) : null}

        {isAssistant || message.content ? (
          <Bubble
            align={align}
            className={cn(
              "max-w-full",
              isAssistant ? "w-full" : "max-w-[80%]",
            )}
            variant={variant}
          >
            <BubbleContent
              className={cn(
                "!px-4",
                isAssistant ? "!py-0" : undefined,
                isUser && Boolean(message.metadata?.steeredIntoRunId) && "rounded-br-none",
              )}
            >
              {isAssistant ? (
              <MarkdownContainerWidthContext.Provider
                value={markdownContainerWidth}
              >
                <View
                  className="gap-sp-3"
                  onLayout={(event) => {
                    const width = Math.round(event.nativeEvent.layout.width);
                    setMarkdownContainerWidth((current) =>
                      width === current ? current : width,
                    );
                  }}
                >

                  {memoryEventLabel ? (
                    <Trace>
                      <TraceCollapsible
                        onOpenChange={setMemoryExpanded}
                        open={memoryExpanded}
                      >
                        <TraceCollapsibleTrigger>
                          <TraceLine>
                            <TraceIcon>
                              <Database
                                color={theme.textSecondary}
                                size={16}
                              />
                            </TraceIcon>
                            <TraceTitle>{memoryEventLabel}</TraceTitle>
                          </TraceLine>
                        </TraceCollapsibleTrigger>
                        <TraceCollapsibleContent>
                          <View className="gap-sp-2">
                            {memoryEvents.map((event) => (
                              <View key={event.id} className="gap-1">
                                {memoryEvents.length > 1 ? (
                                  <Text className="font-sans text-sm font-medium text-muted-foreground dark:text-muted-foreground-dark">
                                    {getMemoryEventLabel(event.kind)}
                                  </Text>
                                ) : null}
                                <Text
                                  selectable
                                  className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                                >
                                  {event.content}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </TraceCollapsibleContent>
                      </TraceCollapsible>
                    </Trace>
                  ) : null}

                  {todoList.length > 0 ? (
                    <Trace>
                      {pendingTodoList.length > 0 ? (
                        <TraceCollapsible
                          onOpenChange={setTasksExpanded}
                          open={tasksExpanded ?? todoActive}
                        >
                          <TraceCollapsibleTrigger>
                            <TraceLine status={todoActive ? "running" : undefined}>
                              <TraceIcon>
                                <ListTodo
                                  color={theme.textSecondary}
                                  size={16}
                                />
                              </TraceIcon>
                              <TraceTitle>
                                {pendingTodoList.length} to do
                              </TraceTitle>
                            </TraceLine>
                          </TraceCollapsibleTrigger>
                          <TraceCollapsibleContent>
                            <View className="ml-sp-2 gap-sp-1.5 border-l border-border pl-sp-3 dark:border-border-dark">
                              {pendingTodoList.map((task) => (
                                <View
                                  key={task.id}
                                  className="flex-row items-start gap-sp-2"
                                >
                                  {task.status === "in_progress" ? (
                                    <SpinningLoader
                                      color={theme.textSecondary}
                                      size={16}
                                    />
                                  ) : (
                                    <Circle
                                      color={theme.textSecondary}
                                      size={16}
                                      style={{ marginTop: 1 }}
                                    />
                                  )}
                                  <Text
                                    className={cn(
                                      "min-w-0 flex-1 font-sans text-sm",
                                      task.status === "in_progress"
                                        ? "text-foreground dark:text-foreground-dark"
                                        : "text-muted-foreground dark:text-muted-foreground-dark",
                                    )}
                                  >
                                    {task.title}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </TraceCollapsibleContent>
                        </TraceCollapsible>
                      ) : null}
                      {completedTodoList.length > 0 ? (
                        <TraceCollapsible
                          onOpenChange={setDoneTasksExpanded}
                          open={doneTasksExpanded}
                        >
                          <TraceCollapsibleTrigger>
                            <TraceLine>
                              <TraceIcon>
                                <CheckCircle2
                                  color={theme.textSecondary}
                                  size={16}
                                />
                              </TraceIcon>
                              <TraceTitle>
                                {completedTodoList.length} completed
                              </TraceTitle>
                            </TraceLine>
                          </TraceCollapsibleTrigger>
                          <TraceCollapsibleContent>
                            <View className="ml-sp-2 gap-sp-1.5 border-l border-border pl-sp-3 dark:border-border-dark">
                              {completedTodoList.map((task) => (
                                <View
                                  key={task.id}
                                  className="flex-row items-start gap-sp-2"
                                >
                                  <CheckCircle2
                                    color={theme.textSecondary}
                                    size={16}
                                    style={{ marginTop: 1 }}
                                  />
                                  <Text className="min-w-0 flex-1 font-sans text-sm text-muted-foreground line-through dark:text-muted-foreground-dark">
                                    {task.title}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </TraceCollapsibleContent>
                        </TraceCollapsible>
                      ) : null}
                    </Trace>
                  ) : null}

                  {assistantParts.map((part) => {
                    if (part.kind === "text") {
                      return part.text.trim() ? (
                        <MarkdownContent
                          key={part.key}
                          content={part.text}
                          onLinkPress={handleLinkPress}
                          selectable={selectEnabled}
                          styles={markdownStyles}
                        />
                      ) : null;
                    }
                    if (part.kind === "reasoning") {
                      return (
                        <ReasoningTraceRow
                          key={`${message.id}-${part.key}`}
                          block={part.block}
                          streaming={message.status === "streaming"}
                        />
                      );
                    }
                    const record = part.record;
                    const key = record.id ?? part.key;
                    return record.termux ? (
                      <TermuxRunCard
                        key={part.key}
                        command={record.termux.command}
                        output={record.termux.output}
                        taskId={record.termux.taskId}
                        running={record.status === "running" && message.status === "streaming"}
                      />
                    ) : (
                      <ToolTraceRow
                        key={part.key}
                        record={record}
                        streaming={message.status === "streaming"}
                        expanded={expandedToolRunIds.get(key)}
                        gapLabel={stepGapLabels.get(record.id ?? record.createdAt)}
                        onExpandedChange={(open) => {
                          setExpandedToolRunIds((current) => {
                            const next = new Map(current);
                            next.set(key, open);
                            return next;
                          });
                        }}
                      />
                    );
                  })}
                  {pluginOutputs.length > 0 ? (
                    <View className="gap-sp-2">
                      {pluginOutputs.map((entry, index) => (
                        <View key={`${entry.pluginId}-${entry.toolName}-${index}`}>
                          {entry.output ? <MarkdownContent
                            content={entry.output}
                            onLinkPress={handleLinkPress}
                            selectable={selectEnabled}
                            styles={markdownStyles}
                          /> : null}
                          {(entry.attachments ?? []).map((attachment, attachmentIndex) => {
                              const label = (attachment.filename ?? "Open file")
                                .replace(/\[/g, "\\[")
                                .replace(/\]/g, "\\]");
                              const file = workspaceFileFromUrl(attachment.uri, workspaceFiles);
                              const uri = file
                                  ? resolveWorkspaceFile(file.relativePath).uri
                                  : attachment.uri;
                              return (
                                <View key={`${attachment.uri}-${attachmentIndex}`}>
                                  {attachment.mime.startsWith("image/") ? (
                                    <Pressable onPress={() => handleLinkPress(attachment.uri)}>
                                      <MarkdownImage alt={attachment.filename ?? "Image"} uri={uri} />
                                    </Pressable>
                                  ) : (
                                    <MarkdownContent
                                      content={`[${label}](<${attachment.uri}>)`}
                                      onLinkPress={handleLinkPress}
                                      selectable={selectEnabled}
                                      styles={markdownStyles}
                                    />
                                  )}
                                </View>
                              );
                          })}
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {generatedImages.length > 0 ? (
                    <View className="gap-sp-2">
                      {generatedImages.map((image) => (
                        <ChatMediaCard
                          key={image.id}
                          accessibilityHint="Open the generated image preview"
                          accessibilityLabel="Generated image"
                          onPress={() => {
                            setImagePreview({ image, kind: "generated" });
                          }}
                        >
                          <Image
                            cachePolicy="memory-disk"
                            contentFit="cover"
                            recyclingKey={image.id}
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
                        </ChatMediaCard>
                      ))}
                    </View>
                  ) : null}
                  {visibleGeneratedVideos.length > 0 ? (
                    <View className="gap-sp-2">
                      {visibleGeneratedVideos.map((video) => (
                        <VideoAttachmentView
                          key={video.fileId}
                          displayName={video.displayName}
                          mimeType={video.mimeType}
                          uri={video.uri}
                        />
                      ))}
                    </View>
                  ) : null}
                  {message.status === "streaming" && !hasRunningTermuxRun ? (
                    <StreamingIndicator idle={STREAMING_IDLE_ELEMENT} />
                  ) : null}
                </View>
              </MarkdownContainerWidthContext.Provider>
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

        {isAssistant && showFooter &&
        message.status !== "streaming" &&
        ((speechContent ?? message.content).trim() ||
          memoryEvents.length > 0 ||
          generatedImages.length > 0) ? (
          <MessageFooter className="ml-2 -mt-2">
            <Button
              accessibilityLabel={copied ? "Copied" : "Copy"}
              leftIcon={
                copied ? (
                  <Check color={theme.textSecondary} size={18} />
                ) : (
                  <Copy color={theme.textSecondary} size={18} />
                )
              }
              onPress={() => {
                handleCopy().catch(console.error);
              }}
              size="icon-xs"
              className="h-9 w-9 px-0"
              variant="ghost"
            />
            {(speechContent ?? message.content).trim() ? (
              <Button
                accessibilityLabel={speaking ? "Stop" : "Play"}
                leftIcon={
                  speaking ? (
                    <Square color={theme.textSecondary} size={18} />
                  ) : (
                    <Play color={theme.textSecondary} size={18} />
                  )
                }
                onPress={handleToggleSpeech}
                size="icon-xs"
                className="h-9 w-9 px-0"
                variant="ghost"
              />
            ) : null}
            {message.content.trim() && onRegenerate ? (
              <Button
                accessibilityLabel="Regenerate response"
                leftIcon={<RefreshCw color={theme.textSecondary} size={18} />}
                onPress={() => setRegenerateOpen(true)}
                size="icon-xs"
                className="h-9 w-9 px-0"
                variant="ghost"
              />
            ) : null}
            {message.content.trim() && onSavePrompt ? (
              <Button
                accessibilityLabel="Save prompt"
                leftIcon={<Bookmark color={theme.textSecondary} size={18} />}
                onPress={() => onSavePrompt(message.content)}
                size="icon-xs"
                className="h-9 w-9 px-0"
                variant="ghost"
              />
            ) : null}
          </MessageFooter>
        ) : null}

        {isUser && copied ? (
          <Text className="px-sp-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Copied
          </Text>
        ) : null}
      </View>
      <ImagePreviewDrawer
        onDismiss={closePreview}
        target={
          imagePreview && imagePreview.kind !== "svg"
            ? {
                alt:
                  imagePreview.kind === "generated"
                    ? "Generated image"
                    : imagePreview.alt || "Image",
                uri:
                  imagePreview.kind === "generated"
                    ? imagePreview.image.uri
                    : imagePreview.uri,
              }
            : null
        }
      />
      {imagePreview?.kind === "svg" ? (
        <Drawer
          direction="bottom"
          onOpenChange={(open) => {
            if (!open) {
              closePreview();
            }
          }}
          open
        >
          <DrawerContent
            className="w-full max-w-full"
            contentClassName="max-w-full"
            showCloseButton
            showHandle
            size={720}
          >
            <DrawerHeader>
              <DrawerTitle>SVG image</DrawerTitle>
            </DrawerHeader>
            <DrawerBody className="gap-sp-3" contentContainerClassName="gap-sp-3">
              <SvgErrorBoundary
                fallback={
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    This SVG could not be rendered.
                  </Text>
                }
                markup={imagePreview.markup}
              >
                <View
                  style={{
                    aspectRatio: svgAspectRatio(imagePreview.markup),
                    maxHeight: 420,
                    width: "100%",
                  }}
                >
                  <SvgXml
                    height="100%"
                    width="100%"
                    xml={imagePreview.markup}
                  />
                </View>
              </SvgErrorBoundary>
            </DrawerBody>
            <DrawerFooter className="flex-row gap-sp-2">
              <Button
                className="flex-1"
                leftIcon={<Download color={theme.text} size={16} />}
                loading={imageAction === "download"}
                onPress={() => {
                  handleDownloadSvg(imagePreview.markup).catch(console.error);
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
                  handleShareSvg(imagePreview.markup).catch(console.error);
                }}
              >
                Share
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : null}
      <Drawer
        direction="bottom"
        onOpenChange={setRegenerateOpen}
        open={regenerateOpen}
      >
        <DrawerContent showCloseButton showHandle size={560}>
          <DrawerHeader>
            <DrawerTitle>Regenerate response</DrawerTitle>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
            {[...DEFAULT_REGENERATE_PRESETS, ...customPresets].map((preset) => (
              <View
                key={preset.id}
                className="flex-row items-center justify-between gap-sp-3 rounded-ui border border-border bg-card px-sp-3 py-sp-3 dark:border-border-dark dark:bg-card-dark"
              >
                <Pressable
                  accessibilityRole="button"
                  className="flex-1"
                  onPress={() => handlePickPreset(preset)}
                >
                  <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                    {preset.label}
                  </Text>
                </Pressable>
                {preset.custom ? (
                  <Pressable
                    accessibilityLabel={`Delete ${preset.label}`}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => handleDeleteCustomPreset(preset.id)}
                  >
                    <Trash2 color={theme.textSecondary} size={18} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
      <FilePreviewDialog
        file={previewFile}
        onDismiss={() => setPreviewFile(null)}
      />
      <VideoPlayerDialog
        onDismiss={() => setVideoPreview(null)}
        video={videoPreview}
      />
      </ChatMediaContext.Provider>
    </Message>
  );
});

/**
 * The `workspace://` URIs a message already embeds inline as
 * `![alt](workspace://id)` images — used to avoid showing the same video twice
 * (once inline, once as the end-of-message card). Plain `[text](uri)` links do
 * not count; those still get the fallback card.
 */
function collectEmbeddedVideoUris(content: string): Set<string> {
  const uris = new Set<string>();

  for (const match of content.matchAll(
    /!\[[^\]]*\]\(\s*<?(workspace:\/\/[^\s)>]+)>?\s*\)/g,
  )) {
    if (match[1]) {
      uris.add(match[1]);
    }
  }

  return uris;
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

/**
 * Elapsed time from one step to the next, the number the old steps drawer
 * showed per event ("2.4s since the previous step" — it includes the model's
 * own thinking between calls). Returns null for pairs it cannot measure.
 */
function formatStepGap(
  previousCreatedAt: string,
  createdAt: string | undefined,
): null | string {
  if (!createdAt) {
    return null;
  }

  const startedAt = new Date(previousCreatedAt).getTime();
  const completedAt = new Date(createdAt).getTime();

  if (
    Number.isNaN(startedAt) ||
    Number.isNaN(completedAt) ||
    completedAt < startedAt
  ) {
    return null;
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
  tableHeaderBackground: string;
  text: string;
}) {
  return {
    body: {
      color: input.text,
      flexShrink: 1,
      fontFamily: "System",
      ...CHAT_TEXT_STYLE,
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
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      minWidth: TABLE_MIN_COLUMN_WIDTH,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    th: {
      backgroundColor: input.tableHeaderBackground,
      borderColor: input.borderColor,
      borderRightWidth: 1,
      color: input.text,
      flex: 1,
      fontSize: 14,
      fontWeight: "700",
      lineHeight: 20,
      minWidth: TABLE_MIN_COLUMN_WIDTH,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    tr: {
      borderBottomWidth: 1,
      borderColor: input.borderColor,
      flexDirection: "row",
    },
  } satisfies StyleSheet.NamedStyles<any>;
}

function TermuxRunCard({
  command,
  running,
  output,
  taskId,
}: {
  command: string;
  running: boolean;
  output: string | null;
  taskId: string | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  const singleLine = command.replace(/\s+/g, " ").trim();

  useEffect(() => {
    if (!running || reduceMotion) {
      pulse.value = 1;
      return;
    }

    pulse.value = withRepeat(
      withTiming(0.55, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse, reduceMotion, running]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
  }));

  return (
    <Animated.View style={running ? pulseStyle : undefined}>
      <Pressable
        accessibilityHint="Opens a read-only view of the command output"
        accessibilityRole="button"
        className="flex-row items-center gap-sp-2 self-start rounded-full border border-border bg-card px-sp-3 py-sp-2 dark:border-border-dark dark:bg-card-dark"
        onPress={() => {
          router.push({
            pathname: "/terminal",
            params: {
              command: singleLine,
              ...(output !== null ? { output } : {}),
              ...(taskId ? { taskId } : {}),
              ...(!taskId ? { pending: "true" } : {}),
            },
          });
        }}
        style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
      >
        <Text className="font-mono text-sm text-muted-foreground dark:text-muted-foreground-dark">
          $
        </Text>
        <Text
          className="max-w-[75%] font-mono text-sm text-foreground dark:text-foreground-dark"
          numberOfLines={1}
        >
          {singleLine || "(command)"}
        </Text>
        {running ? (
          <Text className="w-5 font-mono text-sm text-muted-foreground dark:text-muted-foreground-dark">
            …
          </Text>
        ) : null}
        <ChevronRight color={theme.textSecondary} size={16} />
      </Pressable>
    </Animated.View>
  );
}

// —─── Tool trace rows (shadcn `Trace` pattern) ─────────────────────────────

function ReasoningTraceRow({ block, streaming }: { block: ReasoningBlock; streaming: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState<boolean>();
  const running = streaming && block.completedAt === null;
  return (
    <Trace>
      <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceIcon><Brain color={theme.textSecondary} size={16} /></TraceIcon>
            <TraceTitle>{running ? "Thinking…" : `Thought for ${formatReasoningDuration([block])}`}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Text selectable className="ml-sp-2 border-l border-border pl-sp-3 font-sans text-sm text-muted-foreground dark:border-border-dark dark:text-muted-foreground-dark">{block.text || (running ? "Thinking…" : "No reasoning text was recorded for this step.")}</Text>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/**
 * The expanded detail of a tool trace row: media/thumbnails first, then the
 * captured content, then whatever summary fields could be recovered.
 */
function ToolTraceDetail({ record }: { record: ToolExecutionRecord }) {
  const { workspaceFiles } = useContext(ChatMediaContext);
  const input = parseToolSummary(record.inputSummary);
  const output = parseToolSummary(record.outputSummary);
  const file = workspaceFiles.find((item) => item.id === (output.fileId ?? input.fileId));
  const preview = record.preview;
  const title = preview?.title ?? file?.displayName ?? toolObjectLabel(record.inputSummary);
  const uri = preview?.uri ?? (file ? resolveWorkspaceFile(file.relativePath).uri : undefined);
  const isImage = preview?.mimeType?.startsWith("image/") || (file && getFilePreviewKind(file) === "image");
  const text = preview?.text ?? (typeof output.content === "string" ? output.content : typeof output.contentPreview === "string" ? output.contentPreview : null);
  // Unknown/custom tools retain a readable result rather than losing diagnostics.
  // Summaries are truncated JSON, so recover scalars and list values instead of rendering nothing.
  const summary = formatSummaryLines(record.outputSummary).join("\n");
  const inputLines = formatSummaryLines(record.inputSummary);
  const plainOutput = record.outputSummary && !/^[\s]*[\[{]/.test(record.outputSummary) ? record.outputSummary : null;
  const images = preview?.images ?? [];
  const noPreviewDetail = record.status === "running"
    ? "Waiting for output…"
    : [inputLines.length > 0 ? `Input: ${inputLines.join(", ")}` : null, "No content preview was captured for this tool call."]
        .filter((line): line is string => line !== null)
        .join("\n");
  return (
    <View className="gap-sp-2">
      {uri && isImage ? <MarkdownImage key={uri} alt={title || "Viewed image"} uri={uri} /> : null}
      {images.map((image) => <MarkdownImage key={image.uri} alt={image.title} uri={image.uri} />)}
      {record.diff ? <TraceDiffBlock diff={record.diff} /> : hasLegacyToolResource(record) && !isImage ? (
        <TraceResourceContent key={record.id ?? record.createdAt} record={record} />
      ) : text ? (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 320 }}>
          <CodeBlock size="sm"><CodeBlockContent>{text}</CodeBlockContent></CodeBlock>
        </ScrollView>
      ) : summary || plainOutput ? <Text selectable className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">{summary || plainOutput}</Text> : !record.error && !(uri && isImage) && images.length === 0 ? (
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">{noPreviewDetail}</Text>
      ) : null}
      {preview?.truncated || (!preview && text) ? <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">Partial content captured for this step.</Text> : null}
    </View>
  );
}

function toolTraceTitle(record: ToolExecutionRecord, streaming: boolean) {
  if (record.status === "failed") {
    return `Failed to run ${formatToolName(record.toolName)}`;
  }

  if (record.status === "running") {
    return streaming
      ? `Running ${formatToolName(record.toolName)}`
      : formatToolName(record.toolName);
  }

  const object = record.preview?.title ?? toolObjectLabel(record.inputSummary) ?? toolObjectLabel(record.outputSummary);
  const verb = toolTraceVerb(record.toolName);

  if (verb === "Used") {
    return object ? `Used ${formatToolName(record.toolName)} on ${object}` : `Ran ${formatToolName(record.toolName)}`;
  }

  // No object to point at: the verb just repeats the tool name ("Read — Read").
  return object ? `${verb} ${object}` : formatToolName(record.toolName);
}

type ToolTraceRowProps = {
  expanded?: boolean;
  /** Elapsed time from the previous step, when known. */
  gapLabel?: string;
  onExpandedChange: (open: boolean) => void;
  record: ToolExecutionRecord;
  streaming: boolean;
};

/**
 * The captured diff of an `edit`, painted with the shared CodeBlock — its
 * per-line added/removed variants supply the `+`/`−` markers and tints for
 * code and prose alike.
 */
function TraceDiffBlock({ diff }: { diff: string }) {
  // Track the real starting line per `@@ line N @@` hunk so the gutter shows
  // true file line numbers; drop the `@@` header rows themselves.
  let lineNumber = 0;
  const rows = diff
    .split("\n")
    .map((line, index): { key: string; number: number | null; text: string; variant: "added" | "default" | "removed" } | null => {
      const header = /^@@ line (\d+) @@$/.exec(line);
      if (header) {
        lineNumber = Number(header[1]);
        return null;
      }

      const key = `diff-${index}`;
      if (line.startsWith("+")) {
        return { key, number: lineNumber++, text: line.slice(1), variant: "added" };
      }

      if (line.startsWith("-")) {
        return { key, number: lineNumber++, text: line.slice(1), variant: "removed" };
      }

      return {
        key,
        number: lineNumber++,
        text: line.startsWith(" ") ? line.slice(1) : line,
        variant: "default",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <CodeBlock size="sm">
      <CodeBlockContent wrap>
        {rows.map((row) => (
          <CodeBlockLine key={row.key} variant={row.variant}>
            <View className="flex-row">
              <Text
                accessible={false}
                className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark"
              >
                {`${row.number}`.padStart(3, " ")}
              </Text>
              <Text
                className={cn(
                  "flex-1 font-mono text-sm",
                  row.variant === "removed"
                    ? "text-destructive dark:text-destructive-dark"
                    : row.variant === "added"
                      ? "text-foreground dark:text-foreground-dark"
                      : "text-foreground dark:text-foreground-dark",
                )}
              >
                {row.text}
              </Text>
            </View>
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

/** One tool execution as an expandable trace row; detail = in/out summary. */
function ToolTraceRow({
  expanded,
  onExpandedChange,
  gapLabel,
  record,
  streaming,
}: ToolTraceRowProps) {
  const theme = useTheme();
  const running = record.status === "running" && streaming;
  const Icon = toolTraceIcon(record.toolName);
  const status =
    record.status === "failed"
      ? ("error" as const)
      : running
        ? ("running" as const)
        : record.status === "running"
          ? ("pending" as const)
          : undefined;

  return (
    <Trace>
      <TraceCollapsible onOpenChange={onExpandedChange} open={expanded ?? running}>
        <TraceCollapsibleTrigger>
          <TraceLine status={status}>
            <TraceIcon>
              {/* eslint-disable-next-line react-hooks/static-components -- stable module-level lucide icon, no internal hooks */}
              <Icon color={theme.textSecondary} size={16} />
            </TraceIcon>
            <TraceTitle>{toolTraceTitle(record, streaming)}</TraceTitle>
            {record.diffStat ? (
              <TraceDescription className="font-mono">
                {record.diffStat}
              </TraceDescription>
            ) : null}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <View className="ml-sp-2 gap-sp-1.5 border-l border-border pl-sp-3 dark:border-border-dark">
            <ToolTraceDetail record={record} />
            {record.error ? (
              <Text
                numberOfLines={8}
                selectable
                className="font-mono text-xs text-destructive dark:text-destructive-dark"
              >
                {record.error}
              </Text>
            ) : null}
            {gapLabel && record.status !== "running" ? (
              <Text className="mt-sp-1 font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {`Completed in ${gapLabel}`}
              </Text>
            ) : null}
          </View>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
