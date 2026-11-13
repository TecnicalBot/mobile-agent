import { memo, useMemo, type ReactNode } from "react";
import {
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
} from "react-native";
import Markdown, {
  type ASTNode,
  type MarkdownParser,
  type RenderRules,
} from "react-native-markdown-display";

import { useTheme } from "@/hooks/use-theme";
import type { ChatMarkdownStyles } from "@/modules/chat/markdown-styles";
import {
  buildSelectableMarkdown,
  type SelectableSegment,
  type SelectableSegmentStyle,
} from "@/modules/chat/selectable-markdown";

/**
 * Styles a nested `<Text>` span actually honours. Block-only props (margins,
 * flex, padding…) are dropped instead of handed to a span, where they are
 * ignored at best.
 */
const TEXT_STYLE_PROPS = [
  "backgroundColor",
  "borderBottomColor",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "borderBottomWidth",
  "borderColor",
  "borderLeftColor",
  "borderLeftWidth",
  "borderRadius",
  "borderRightColor",
  "borderRightWidth",
  "borderStyle",
  "borderTopColor",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderTopWidth",
  "borderWidth",
  "color",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textAlign",
  "textDecorationColor",
  "textDecorationLine",
  "textDecorationStyle",
  "textShadowColor",
  "textShadowOffset",
  "textShadowRadius",
  "textTransform",
  "writingDirection",
] as const;

function pickTextStyle(style: unknown): TextStyle | undefined {
  const flat = StyleSheet.flatten(
    style as StyleProp<TextStyle>,
  ) as Record<string, unknown> | undefined;

  if (!flat) {
    return undefined;
  }

  const picked: Record<string, unknown> = {};

  for (const name of TEXT_STYLE_PROPS) {
    if (flat[name] !== undefined) {
      picked[name] = flat[name];
    }
  }

  return picked as TextStyle;
}

function resolveStyles(styles: ChatMarkdownStyles) {
  return {
    body: undefined,
    code: pickTextStyle(styles.code_inline),
    codeBlock: pickTextStyle(styles.code_block),
    em: { fontStyle: "italic" },
    heading1: pickTextStyle(styles.heading1),
    heading2: pickTextStyle(styles.heading2),
    heading3: pickTextStyle(styles.heading3),
    heading4: pickTextStyle(styles.heading4),
    heading5: pickTextStyle(styles.heading5),
    heading6: pickTextStyle(styles.heading6),
    link: pickTextStyle(styles.link),
    muted: { color: pickTextStyle(styles.blockquote)?.color },
    quoteBar: { color: pickTextStyle(styles.blockquote)?.color },
    strike: { textDecorationLine: "line-through" },
    strong: pickTextStyle(styles.strong) ?? { fontWeight: "700" },
    table: { ...pickTextStyle(styles.td), fontFamily: "monospace" },
    tableHeader: {
      ...pickTextStyle(styles.th),
      fontFamily: "monospace",
      fontWeight: "700",
    },
  } satisfies Record<SelectableSegmentStyle, TextStyle | undefined>;
}

type ResolvedStyles = ReturnType<typeof resolveStyles>;

type CodeRenderer = (code: string, language: string) => ReactNode;

function renderSegments(
  segments: SelectableSegment[],
  styles: ResolvedStyles,
  onLinkPress: (url: string) => boolean,
  renderCode?: CodeRenderer,
): ReactNode[] {
  return segments.map((segment) => {
    const style = styles[segment.style];

    if (segment.href) {
      const href = segment.href;

      return (
        <Text
          key={segment.key}
          onPress={() => {
            onLinkPress(href);
          }}
          style={style}
        >
          {segment.text}
        </Text>
      );
    }

    // Code keeps its syntax colours as nested spans, so the fence stays part of
    // the same selectable Text instead of becoming a separate card.
    if (segment.style === "codeBlock") {
      return (
        <Text key={segment.key} style={style}>
          {renderCode
            ? renderCode(segment.text, segment.language ?? "")
            : segment.text}
        </Text>
      );
    }

    return style ? (
      <Text key={segment.key} style={style}>
        {segment.text}
      </Text>
    ) : (
      segment.text
    );
  });
}

/**
 * Blocks that keep their own view are re-rendered through the library so they
 * keep their copy buttons, scrolling and layout. Memoised on the AST node: the
 * library invents a fresh root key per render, which would remount (and for a
 * code block, re-highlight) the block on every parent render.
 */
const RichMarkdownBlock = memo(function RichMarkdownBlock({
  markdownit,
  node,
  onLinkPress,
  rules,
  styles,
}: {
  markdownit: MarkdownParser;
  node: ASTNode;
  onLinkPress: (url: string) => boolean;
  rules: RenderRules;
  styles: ChatMarkdownStyles;
}) {
  return (
    <Markdown
      markdownit={markdownit}
      mergeStyle={false}
      onLinkPress={onLinkPress}
      rules={rules}
      style={styles}
    >
      {/* AST arrays are supported by the runtime but omitted from its React types. */}
      {[node] as unknown as ReactNode}
    </Markdown>
  );
});

/**
 * Markdown body whose text is painted as one native `<Text>` per contiguous
 * run, so a selection can grow across paragraphs, headings, lists, code fences
 * and tables instead of stopping at the block the long-press started in.
 */
export const SelectableMarkdown = memo(function SelectableMarkdown({
  ast,
  markdownit,
  onLinkPress,
  renderCode,
  rules,
  styles,
}: {
  ast: ASTNode[];
  markdownit: MarkdownParser;
  onLinkPress: (url: string) => boolean;
  /** Paints a fence's tokens as nested spans; omitted → plain code text. */
  renderCode?: CodeRenderer;
  rules: RenderRules;
  styles: ChatMarkdownStyles;
}) {
  const theme = useTheme();
  const chunks = useMemo(() => buildSelectableMarkdown(ast), [ast]);
  const resolvedStyles = useMemo(() => resolveStyles(styles), [styles]);

  return (
    <>
      {chunks.map((chunk) =>
        chunk.kind === "rich" ? (
          <RichMarkdownBlock
            key={chunk.key}
            markdownit={markdownit}
            node={chunk.node}
            onLinkPress={onLinkPress}
            rules={rules}
            styles={styles}
          />
        ) : (
          <Text
            key={chunk.key}
            selectable
            selectionColor={theme.backgroundSelected}
            style={styles.body}
          >
            {renderSegments(
              chunk.segments,
              resolvedStyles,
              onLinkPress,
              renderCode,
            )}
          </Text>
        ),
      )}
    </>
  );
});
