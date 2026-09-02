import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import Markdown, { MarkdownIt } from "react-native-markdown-display";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { isBinaryMimeType } from "@/modules/skills/skill-files";

const MAX_TEXT_PREVIEW = 50_000;

const MARKDOWN_PARSER = MarkdownIt({
  breaks: true,
  linkify: true,
  typographer: true,
});

export default function SkillFileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { path, skillId } = useLocalSearchParams<{
    path: string;
    skillId: string;
  }>();
  const { skills } = useConfig();

  const skill = skills.find((item) => item.id === skillId);
  const file = skill?.skillFiles.find((item) => item.path === path);
  const binary = file ? isBinaryMimeType(file.mimeType) : false;
  const isMarkdown = Boolean(file?.path.toLowerCase().endsWith(".md"));

  const markdownStyles = useMemo(
    () => createMarkdownStyles(theme),
    [theme],
  );

  if (!skill || !file) {
    return (
      <Container
        scroll
        contentClassName="gap-sp-4 py-sp-4"
        includeBottomTabInset={false}
      >
        <Header title="Skill file" onBack={() => router.back()} theme={theme.text} />
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          File not found.
        </Text>
      </Container>
    );
  }

  const preview = file.content.length > MAX_TEXT_PREVIEW
    ? `${file.content.slice(0, MAX_TEXT_PREVIEW)}\n… [truncated]`
    : file.content;
  const renderedPreview = isMarkdown ? stripYamlFrontmatter(preview) : preview;

  return (
    <Container includeBottomTabInset={false} scroll contentClassName="gap-sp-4 py-sp-4">
      <Header
        title={file.path.split("/").pop() ?? file.path}
        onBack={() => router.back()}
        theme={theme.text}
      />

      {binary ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          This is a binary file, so its contents are not shown here. The
          assistant can still read it when using this skill.
        </Text>
      ) : isMarkdown ? (
        <>
          <Markdown
            markdownit={MARKDOWN_PARSER}
            onLinkPress={(link) => {
              Linking.openURL(link).catch(console.error);
              return true;
            }}
            style={markdownStyles}
          >
            {renderedPreview}
          </Markdown>
          {file.content.length > MAX_TEXT_PREVIEW ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              … [truncated]
            </Text>
          ) : null}
        </>
      ) : (
        <Text selectable style={{ color: theme.text, fontFamily: "monospace", fontSize: 13, lineHeight: 20 }}>
          {preview}
        </Text>
      )}
    </Container>
  );
}

function stripYamlFrontmatter(markdown: string) {
  return markdown.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
}

function Header({
  onBack,
  theme,
  title,
}: {
  onBack: () => void;
  theme: string;
  title: string;
}) {
  return (
    <View className="flex-row items-center gap-sp-2">
      <Button
        leftIcon={<ChevronLeft color={theme} size={16} />}
        onPress={onBack}
        size="icon-xs"
        variant="ghost"
      />
      <Text className="min-w-0 flex-1 font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
        {title}
      </Text>
    </View>
  );
}
function createMarkdownStyles(theme: ReturnType<typeof useTheme>) {
  return {
    body: {
      color: theme.text,
      fontFamily: "System",
      fontSize: 15,
      lineHeight: 22,
      margin: 0,
    },
    bullet_list: {
      marginBottom: 10,
      marginTop: 2,
    },
    bullet_list_content: {
      flex: 1,
    },
    bullet_list_icon: {
      color: theme.text,
      marginRight: 8,
      width: 12,
    },
    ordered_list: {
      marginBottom: 10,
      marginTop: 2,
    },
    ordered_list_icon: {
      color: theme.text,
      marginRight: 8,
      width: 12,
    },
    code_block: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 12,
      color: theme.text,
      fontFamily: "monospace",
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 10,
      marginTop: 4,
      padding: 10,
    },
    code_inline: {
      backgroundColor: theme.backgroundSelected,
      borderRadius: 6,
      color: theme.text,
      fontFamily: "monospace",
      fontSize: 13,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    fence: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 12,
      color: theme.text,
      fontFamily: "monospace",
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 10,
      marginTop: 4,
      padding: 10,
    },
    blockquote: {
      borderColor: theme.border,
      borderLeftWidth: 3,
      color: theme.textSecondary,
      marginBottom: 10,
      marginTop: 2,
      paddingLeft: 10,
    },
    heading1: {
      color: theme.text,
      fontSize: 24,
      fontWeight: "700",
      lineHeight: 31,
      marginBottom: 8,
      marginTop: 0,
    },
    heading2: {
      color: theme.text,
      fontSize: 20,
      fontWeight: "700",
      lineHeight: 27,
      marginBottom: 6,
      marginTop: 8,
    },
    heading3: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "700",
      lineHeight: 24,
      marginBottom: 4,
      marginTop: 6,
    },
    heading4: {
      color: theme.text,
      fontSize: 15,
      fontWeight: "700",
      lineHeight: 22,
      marginBottom: 4,
      marginTop: 6,
    },
    heading5: {
      color: theme.text,
      fontSize: 14,
      fontWeight: "700",
      lineHeight: 21,
      marginBottom: 4,
      marginTop: 6,
    },
    heading6: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 20,
      marginBottom: 4,
      marginTop: 6,
    },
    hr: {
      backgroundColor: theme.border,
      height: 1,
      marginBottom: 12,
      marginTop: 8,
    },
    link: {
      color: theme.textSecondary,
    },
    paragraph: {
      marginBottom: 10,
      marginTop: 0,
    },
    strong: {
      fontWeight: "700",
    },
    em: {
      fontStyle: "italic",
    },
  } satisfies StyleSheet.NamedStyles<any>;
}
