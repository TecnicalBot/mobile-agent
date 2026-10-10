import { useRecyclingState } from "@shopify/flash-list";
import * as Clipboard from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as IntentLauncher from "expo-intent-launcher";
import * as MediaLibrary from "expo-media-library";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import * as Speech from "expo-speech";
import {
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  Download,
  FileArchive,
  FileAudio,
  FileCode,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Loader,
  Pencil,
  Play,
  RefreshCw,
  Share2,
  Square,
  Trash2,
} from "lucide-react-native";
import {
  createContext,
  memo,
  type ReactNode,
  Component,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
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
import { SvgXml } from "react-native-svg";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { CodePreviewDialog } from "@/components/ui/code-preview-dialog";
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
import {
  FilePreviewDialog,
  getFilePreviewKind,
} from "@/components/ui/file-preview-dialog";
import { Loading } from "@/components/ui/loading";
import { Message, MessageFooter } from "@/components/ui/message";
import { CHAT_TEXT_STYLE } from "@/constants/chat-typography";
import {
  isTextWorkspaceFile,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import type {
  ExecutionTimelineEvent,
  GeneratedImageAttachment,
  ReasoningBlock,
  StoredMessage,
  WorkspaceFile,
} from "@/core/types/app-state";
import { downloadText } from "@/core/services/download-service";
import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";
import { registerChatMarkdownRules } from "@/modules/chat/markdown-rules";
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
import { Asset } from "expo-media-library";

refractor.register(jsx);
refractor.register(tsx);

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
  message: StoredMessage;
  onEditMessage?: (content: string) => void;
  onRegenerate?: (instruction: string) => void;
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
  html_block: (node) => (
    <InlineSvgBlock key={node.key} markup={htmlNodeContent(node)} />
  ),
  html_inline: (node) => (
    <InlineSvgBlock key={node.key} markup={htmlNodeContent(node)} />
  ),
} satisfies RenderRules;

export type ChatMediaPreviewTarget =
  | { kind: "generated"; image: GeneratedImageAttachment }
  | { kind: "uri"; alt: string; uri: string }
  | { kind: "svg"; alt: string; markup: string };

const ChatMediaContext = createContext<{
  onPreviewImage: (target: ChatMediaPreviewTarget) => void;
  workspaceFiles: WorkspaceFile[];
}>({ onPreviewImage: () => {}, workspaceFiles: [] });

function PreviewUriImage({ uri }: { uri: string }) {
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  return (
    <Image
      contentFit="contain"
      onLoad={(event) => {
        const { height, width } = event.source;
        if (width > 0 && height > 0) {
          setAspectRatio(width / height);
        }
      }}
      source={{ uri }}
      style={{
        aspectRatio,
        borderRadius: 16,
        maxHeight: 420,
        width: "100%",
      }}
    />
  );
}

function MarkdownImage({ alt, uri }: { alt: string; uri: string }) {
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [failed, setFailed] = useState(false);
  const { onPreviewImage, workspaceFiles } = useContext(ChatMediaContext);
  const resolvedUri = useMemo(() => {
    if (!uri) return uri;
    if (uri.startsWith("workspace://")) {
      const file = workspaceFileFromUrl(uri, workspaceFiles);
      if (file) return resolveWorkspaceFile(file.relativePath).uri;
    }
    return uri;
  }, [uri, workspaceFiles]);

  if (!resolvedUri || failed) {
    return alt ? (
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {alt}
      </Text>
    ) : null;
  }

  return (
    <Pressable
      accessibilityHint="Opens the image preview"
      accessibilityLabel={alt || "Open image preview"}
      accessibilityRole="button"
      onPress={() => {
        onPreviewImage({ alt: alt || "Image", kind: "uri", uri: resolvedUri });
      }}
      style={({ pressed }) => (pressed ? { opacity: 0.9 } : null)}
    >
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
        source={{ uri: resolvedUri }}
        style={{ aspectRatio, maxWidth: "100%", width: "100%" }}
      />
    </Pressable>
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
        <View className="flex-row items-center gap-sp-1">
          {headerAccessory}
          <CopyButton label={copyLabel} value={copyValue} />
        </View>
      </View>
      {children}
    </View>
  );
}

const MAX_HIGHLIGHT_LENGTH = 4000;

const PREVIEWABLE_LANGUAGES = new Set(["htm", "html", "svg", "xml"]);

function isPreviewableLanguage(language: string) {
  return PREVIEWABLE_LANGUAGES.has(language.toLowerCase());
}

/** Opens the markup preview in a dialog rather than inline in the message. */
function PreviewButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityHint="Opens the rendered output in a dialog"
      accessibilityLabel="Preview"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: theme.backgroundSelected,
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 4,
        },
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Text style={{ color: theme.text, fontSize: 11, fontWeight: "600" }}>
        Preview
      </Text>
    </Pressable>
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
  // Recycling, or a streaming delta that rewrites the fence, closes the dialog
  // so a preview can never outlive the markup it was built from.
  const [previewOpen, setPreviewOpen] = useRecyclingState(false, [code]);
  const previewable = isPreviewableLanguage(language);
  const previewDocument = useMemo(
    () => (previewable ? buildPreviewDocument(code, language) : null),
    [code, language, previewable],
  );
  const highlighted = useMemo(() => {
    if (
      !language ||
      !refractor.registered(language) ||
      code.length > MAX_HIGHLIGHT_LENGTH
    ) {
      return null;
    }

    try {
      const nodes = refractor.highlight(code, language)
        .children as SyntaxNode[];
      return nodes;
    } catch {
      return null;
    }
  }, [code, language]);

  return (
    <CopyableMarkdownBlock
      copyLabel="Copy code"
      copyValue={code}
      headerAccessory={
        previewable ? (
          <PreviewButton
            onPress={() => {
              setPreviewOpen(true);
            }}
          />
        ) : null
      }
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
      {previewOpen && previewDocument ? (
        <CodePreviewDialog
          code={code}
          html={previewDocument}
          language={language}
          onDismiss={() => {
            setPreviewOpen(false);
          }}
        />
      ) : null}
    </CopyableMarkdownBlock>
  );
}

const MarkdownContent = memo(function MarkdownContent({
  content,
  onLinkPress,
  styles,
}: {
  content: string;
  onLinkPress: (url: string) => boolean;
  styles: ReturnType<typeof createMarkdownStyles>;
}) {
  if (content.length > MARKDOWN_MAX_RENDER_LENGTH) {
    return (
      <Text selectable style={styles.body}>
        {content}
      </Text>
    );
  }

  return (
    <Markdown
      markdownit={MARKDOWN_PARSER}
      mergeStyle={false}
      onLinkPress={onLinkPress}
      rules={MARKDOWN_RULES}
      style={styles}
    >
      {content}
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

const ARCHIVE_MIME_TYPES = new Set([
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
]);
const CODE_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-typescript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-yaml",
]);
const CODE_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".xml",
  ".html",
  ".css",
  ".yml",
  ".yaml",
  ".sh",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".swift",
  ".kt",
  ".php",
  ".rb",
];
const SPREADSHEET_EXTENSIONS = [".csv", ".xls", ".xlsx", ".ods"];

function getFileTypeIcon(file: WorkspaceFile) {
  const mimeType = file.mimeType?.toLowerCase() ?? "";
  const fileName = file.displayName.toLowerCase();

  if (mimeType.startsWith("image/")) {
    return FileImage;
  }

  if (mimeType.startsWith("audio/")) {
    return FileAudio;
  }

  if (mimeType.startsWith("video/")) {
    return FileVideo;
  }

  if (ARCHIVE_MIME_TYPES.has(mimeType)) {
    return FileArchive;
  }

  if (mimeType === "application/pdf") {
    return FileText;
  }

  if (CODE_MIME_TYPES.has(mimeType)) {
    return FileCode;
  }

  if (CODE_EXTENSIONS.some((extension) => fileName.endsWith(extension))) {
    return FileCode;
  }

  if (
    SPREADSHEET_EXTENSIONS.some((extension) => fileName.endsWith(extension))
  ) {
    return FileSpreadsheet;
  }

  if (mimeType.startsWith("text/")) {
    return FileText;
  }

  return FileIcon;
}

function ExpandChevron({
  color,
  expanded,
}: {
  color: string;
  expanded: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(expanded ? 180 : 0);

  useEffect(() => {
    rotation.value = withTiming(expanded ? 180 : 0, {
      duration: reduceMotion ? 0 : 180,
      easing: Easing.inOut(Easing.quad),
    });

    return () => cancelAnimation(rotation);
  }, [expanded, reduceMotion, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View
      className="h-3.5 w-3.5 shrink-0 items-center justify-center"
      style={animatedStyle}
    >
      <ChevronDown color={color} size={14} />
    </Animated.View>
  );
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
  message,
  onEditMessage,
  onRegenerate,
  onSavePrompt,
  workspaceFiles,
}: ChatMessageProps) {
  const theme = useTheme();
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
  const [reasoningExpanded, setReasoningExpanded] = useRecyclingState(
    () => message.status === "streaming",
    [message.id],
  );
  const [tasksExpanded, setTasksExpanded] = useRecyclingState(
    () => message.status === "streaming",
    [message.id],
  );
  const [imagePreview, setImagePreview] =
    useRecyclingState<ChatMediaPreviewTarget | null>(null, [message.id]);
  const [previewFile, setPreviewFile] = useRecyclingState<WorkspaceFile | null>(
    null,
    [message.id],
  );
  const [timelineExpanded, setTimelineExpanded] = useRecyclingState(false, [
    message.id,
  ]);
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

  const handleToggleSpeech = useCallback(() => {
    if (speaking) {
      Speech.stop().catch(() => {});
      setSpeaking(false);
      return;
    }

    const content = message.content.trim();

    if (!content) {
      return;
    }

    Speech.stop().catch(() => {});
    Speech.speak(content, {
      onDone: () => setSpeaking(false),
      onError: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
    });
    setSpeaking(true);
  }, [message.content, setSpeaking, speaking]);

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
  const handleLinkPress = useCallback(
    (url: string) => {
      const workspaceFile = workspaceFileFromUrl(url, workspaceFiles);

      if (workspaceFile) {
        setPreviewFile(workspaceFile);
        return false;
      }

      if (url.startsWith("workspace://")) {
        const id = url.slice("workspace://".length);
        workspaceRepository.getById(id).then((file) => {
          if (file) setPreviewFile(file);
          else Alert.alert("File unavailable", "This file is no longer in the workspace.");
        }).catch((error) => Alert.alert("Could not open file", String(error)));
        return false;
      }
      openExternalLink(url).catch(console.error);

      return false;
    },
    [setPreviewFile, workspaceFiles, workspaceRepository],
  );
  const openImagePreview = useCallback((target: ChatMediaPreviewTarget) => {
    setImagePreview(target);
  }, [setImagePreview]);
  const mediaContext = useMemo(
    () => ({ onPreviewImage: openImagePreview, workspaceFiles }),
    [openImagePreview, workspaceFiles],
  );
  const closePreview = () => {
    setImageAction(null);
    setImagePreview(null);
  };

  const handleDownloadImage = async (image: { uri: string }) => {
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

  const handleShareImage = async (image: { uri: string }) => {
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
      localFile.write(markup);

      await Sharing.shareAsync(localFile.uri, {
        dialogTitle: "Share SVG image",
        mimeType: "image/svg+xml",
        UTI: "public.svg-image",
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
  const todoList = message.metadata?.todoList ?? [];
  const completedTaskCount = todoList.filter(
    (task) => task.status === "completed",
  ).length;
  const taskLabel =
    todoList.length === 0
      ? null
      : completedTaskCount === todoList.length
        ? `${todoList.length} tasks done`
        : `${completedTaskCount}/${todoList.length} tasks`;
  const executionTimeline = (message.metadata?.executionTimeline ?? []).filter(
    (event) =>
      event.kind !== "prompt" &&
      !(event.kind === "run" && event.status === "pending"),
  );
  const termuxRuns = (message.metadata?.toolExecutions ?? []).filter(
    (execution) => Boolean(execution.termux),
  );
  const hasRunningTermuxRun = termuxRuns.some(
    (run) => run.status === "running" && message.status === "streaming",
  );
  const pluginOutputs = message.metadata?.pluginOutputs ?? [];
  const termuxRunsById = new Map(
    termuxRuns.flatMap((run) => (run.id ? ([[run.id, run]] as const) : [])),
  );
  const anchoredTermuxRuns = (message.metadata?.termuxRunAnchors ?? [])
    .map((anchor) => ({ anchor, run: termuxRunsById.get(anchor.executionId) }))
    .filter(
      (
        entry,
      ): entry is {
        anchor: (typeof entry)["anchor"];
        run: NonNullable<(typeof entry)["run"]>;
      } =>
        Boolean(entry.run) &&
        Number.isInteger(entry.anchor.textOffset) &&
        entry.anchor.textOffset >= 0 &&
        entry.anchor.textOffset <= message.content.length,
    )
    .sort((a, b) => a.anchor.textOffset - b.anchor.textOffset);
  const anchoredTermuxRunIds = new Set(
    anchoredTermuxRuns.map(({ anchor }) => anchor.executionId),
  );
  const unanchoredTermuxRuns = termuxRuns.filter(
    (run) => !run.id || !anchoredTermuxRunIds.has(run.id),
  );
  const inlineTermuxContent: ReactNode[] = [];
  let contentOffset = 0;
  for (const { anchor, run } of anchoredTermuxRuns) {
    const text = message.content.slice(contentOffset, anchor.textOffset);
    if (text.trim()) {
      inlineTermuxContent.push(
        <MarkdownContent
          content={text}
          key={`text-${anchor.executionId}`}
          onLinkPress={handleLinkPress}
          styles={markdownStyles}
        />,
      );
    }
    inlineTermuxContent.push(
      <TermuxRunCard
        command={run.termux!.command}
        key={`termux-${anchor.executionId}`}
        output={run.termux!.output}
        running={run.status === "running" && message.status === "streaming"}
        taskId={run.termux!.taskId}
      />,
    );
    contentOffset = anchor.textOffset;
  }
  const trailingContent = message.content.slice(contentOffset);
  if (anchoredTermuxRuns.length > 0 && trailingContent.trim()) {
    inlineTermuxContent.push(
      <MarkdownContent
        content={trailingContent}
        key="text-trailing"
        onLinkPress={handleLinkPress}
        styles={markdownStyles}
      />,
    );
  }
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
      ? hasRunningTermuxRun
        ? null
        : "Thinking…"
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
      <ChatMediaContext.Provider value={mediaContext}>
      <View
        className={cn("gap-1", align === "end" ? "items-end" : "items-start", {
          "w-full": isAssistant,
          "max-w-[80%]": !isAssistant,
        })}
      >
        {hasUserAttachments ? (
          <View
            className={cn(
              "w-64 max-w-full overflow-hidden border border-border bg-card dark:border-border-dark dark:bg-card-dark",
              fileHeaderConnected
                ? "max-w-full rounded-ui rounded-br-none"
                : "max-w-full rounded-ui",
            )}
          >
            {attachedFiles.map((file, index) => {
              const opening = openingFileId === file.id;
              const FileTypeIcon = getFileTypeIcon(file);

              return (
                <Pressable
                  accessibilityHint="Opens the attached file"
                  accessibilityLabel={file.displayName}
                  accessibilityRole="button"
                  disabled={opening}
                  key={file.id}
                  className={cn(
                    "w-full flex-row items-center gap-sp-2 px-sp-2 py-sp-2",
                    index > 0 &&
                      "border-t border-border dark:border-border-dark",
                  )}
                  onPress={() => {
                    handleOpenFile(file).catch(console.error);
                  }}
                  style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
                >
                  <View className="h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary dark:bg-secondary-dark">
                    <FileTypeIcon color={theme.textSecondary} size={16} />
                  </View>
                  <Text
                    className="min-w-0 flex-1 font-sans text-sm font-medium text-foreground dark:text-foreground-dark"
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
              className={cn(
                "!px-4",
                isAssistant ? "!py-0" : undefined,
                fileHeaderConnected ? "rounded-tr-none" : undefined,
              )}
            >
              {isAssistant ? (
                <View className="gap-sp-3">
                  {reasoningLabel ? (
                    <View className="gap-sp-2">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: reasoningExpanded }}
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
                        <ExpandChevron
                          color={theme.textSecondary}
                          expanded={reasoningExpanded}
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
                            <Text
                              selectable
                              style={reasoningMarkdownStyles.body}
                            >
                              {reasoningText}
                            </Text>
                            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                              {reasoningInProgress ? "Working" : "Done"}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {memoryEventLabel ? (
                    <View className="gap-sp-2">
                      <Pressable
                        accessibilityLabel={memoryEventLabel}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: memoryExpanded }}
                        className="self-start flex-row items-center gap-sp-2"
                        onPress={() => {
                          setMemoryExpanded((current) => !current);
                        }}
                        style={({ pressed }) =>
                          pressed ? { opacity: 0.72 } : null
                        }
                      >
                        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                          {memoryEventLabel}
                        </Text>
                        <ExpandChevron
                          color={theme.textSecondary}
                          expanded={memoryExpanded}
                        />
                      </Pressable>
                      {memoryExpanded ? (
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
                      ) : null}
                    </View>
                  ) : null}

                  {taskLabel ? (
                    <View className="gap-sp-2">
                      <Pressable
                        accessibilityRole="button"
                        className="self-start flex-row items-center gap-sp-2"
                        onPress={() => {
                          setTasksExpanded((current) => !current);
                        }}
                        style={({ pressed }) =>
                          pressed ? { opacity: 0.72 } : null
                        }
                      >
                        {/* <ListChecks color={theme.textSecondary} size={16} /> */}
                        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                          {taskLabel}
                        </Text>
                        <ChevronDown
                          color={theme.textSecondary}
                          size={14}
                          style={{
                            transform: [
                              { rotate: tasksExpanded ? "180deg" : "0deg" },
                            ],
                          }}
                        />
                      </Pressable>

                      {tasksExpanded ? (
                        <View className="gap-sp-1.5 border-l border-border pl-sp-3 dark:border-border-dark">
                          {todoList.map((task) => (
                            <View
                              key={task.id}
                              className="flex-row items-start gap-sp-2"
                            >
                              {task.status === "completed" ? (
                                <CheckCircle2
                                  color={theme.textSecondary}
                                  size={16}
                                  style={{ marginTop: 1 }}
                                />
                              ) : task.status === "in_progress" ? (
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
                                  task.status === "completed"
                                    ? "text-muted-foreground line-through dark:text-muted-foreground-dark"
                                    : "text-foreground dark:text-foreground-dark",
                                )}
                              >
                                {task.title}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {anchoredTermuxRuns.length > 0 ? (
                    <View className="gap-sp-3">{inlineTermuxContent}</View>
                  ) : message.content.trim() ? (
                    <MarkdownContent
                      content={message.content}
                      onLinkPress={handleLinkPress}
                      styles={markdownStyles}
                    />
                  ) : null}
                  {unanchoredTermuxRuns.length > 0 ? (
                    <View className="gap-sp-2">
                      {unanchoredTermuxRuns.map((run) => (
                        <TermuxRunCard
                          command={run.termux!.command}
                          running={
                            run.status === "running" &&
                            message.status === "streaming"
                          }
                          key={run.createdAt + (run.termux!.taskId ?? "sync")}
                          output={run.termux!.output}
                          taskId={run.termux!.taskId}
                        />
                      ))}
                    </View>
                  ) : null}
                  {pluginOutputs.length > 0 ? (
                    <View className="gap-sp-2">
                      {pluginOutputs.map((entry, index) => (
                        <View key={`${entry.pluginId}-${entry.toolName}-${index}`}>
                          {entry.output ? <MarkdownContent
                            content={entry.output}
                            onLinkPress={handleLinkPress}
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
                        <Pressable
                          key={image.id}
                          accessibilityHint="Open the generated image preview"
                          accessibilityRole="button"
                          className="overflow-hidden rounded-card border border-border dark:border-border-dark"
                          onPress={() => {
                            setImagePreview({ image, kind: "generated" });
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
                  {message.status === "streaming" && !hasRunningTermuxRun ? (
                    <Loading />
                  ) : null}
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
        message.status !== "streaming" &&
        (message.content.trim() ||
          memoryEvents.length > 0 ||
          executionTimeline.length > 0 ||
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
            {message.content.trim() ? (
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
            {timelineLabel ? (
              <Button
                accessibilityLabel={timelineLabel}
                leftIcon={<Clock3 color={theme.textSecondary} size={18} />}
                onPress={() => {
                  setTimelineExpanded(true);
                }}
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
        open={imagePreview !== null}
      >
        <DrawerContent
          className="w-full max-w-full"
          contentClassName="max-w-full"
          showCloseButton
          showHandle
          size={720}
        >
          <DrawerHeader>
            <DrawerTitle>
              {imagePreview?.kind === "generated"
                ? "Generated image"
                : imagePreview?.kind === "svg"
                  ? "SVG image"
                  : "Image"}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody className="gap-sp-3" contentContainerClassName="gap-sp-3">
            {imagePreview?.kind === "generated" ? (
              <Image
                contentFit="contain"
                source={{ uri: imagePreview.image.uri }}
                style={{
                  aspectRatio: 1,
                  borderRadius: 16,
                  maxHeight: 420,
                  width: "100%",
                }}
              />
            ) : null}
            {imagePreview?.kind === "uri" ? (
              <PreviewUriImage uri={imagePreview.uri} />
            ) : null}
            {imagePreview?.kind === "svg" ? (
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
            ) : null}
          </DrawerBody>
          <DrawerFooter className="flex-row gap-sp-2">
            <Button
              className="flex-1"
              leftIcon={<Download color={theme.text} size={16} />}
              loading={imageAction === "download"}
              onPress={() => {
                if (!imagePreview) return;
                if (imagePreview.kind === "generated") {
                  handleDownloadImage(imagePreview.image).catch(console.error);
                } else if (imagePreview.kind === "uri") {
                  handleDownloadImage({ uri: imagePreview.uri }).catch(
                    console.error,
                  );
                } else {
                  handleDownloadSvg(imagePreview.markup).catch(console.error);
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
                if (!imagePreview) return;
                if (imagePreview.kind === "generated") {
                  handleShareImage(imagePreview.image).catch(console.error);
                } else if (imagePreview.kind === "uri") {
                  handleShareImage({ uri: imagePreview.uri }).catch(
                    console.error,
                  );
                } else {
                  handleShareSvg(imagePreview.markup).catch(console.error);
                }
              }}
            >
              Share
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
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
      </ChatMediaContext.Provider>
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

    if (event.title === "Questions for the user") {
      return "Waiting for your answers";
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

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const getLocalImageFile = async (image: { uri: string }) => {
  const extension = getImageExtension(image.uri);
  const fileName = `generated-image-${Date.now()}.${extension}`;
  const localFile = new File(Paths.cache, fileName);

  if (image.uri.startsWith("data:")) {
    const comma = image.uri.indexOf(",");
    const meta = image.uri.slice(5, comma < 0 ? 5 : comma);
    const data = comma < 0 ? "" : image.uri.slice(comma + 1);
    const bytes = meta.includes(";base64")
      ? base64ToBytes(data)
      : new TextEncoder().encode(decodeURIComponent(data));
    localFile.create({ intermediates: true, overwrite: true });
    localFile.write(bytes);
    return localFile;
  }

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
  const [dotCount, setDotCount] = useState(1);
  const singleLine = command.replace(/\s+/g, " ").trim();

  useEffect(() => {
    if (!running) {
      setDotCount(1);
      pulse.value = 1;
      return;
    }

    const interval = setInterval(() => {
      setDotCount((current) => (current % 3) + 1);
    }, 420);
    if (!reduceMotion) {
      pulse.value = withRepeat(
        withTiming(0.55, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    }

    return () => {
      clearInterval(interval);
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
            {".".repeat(dotCount)}
          </Text>
        ) : null}
        <ChevronRight color={theme.textSecondary} size={16} />
      </Pressable>
    </Animated.View>
  );
}
