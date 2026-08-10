import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import Markdown, { MarkdownIt } from "react-native-markdown-display";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";

const MARKDOWN_PARSER = MarkdownIt({
  breaks: true,
  linkify: true,
  typographer: true,
});

export default function SkillDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { skills } = useConfig();

  const skill = skills.find((item) => item.id === id);

  const markdown = useMemo(() => {
    if (!skill) {
      return null;
    }

    return [
      skill.description ?? "",
      "",
      skill.instructions.trim(),
    ].join("\n");
  }, [skill]);

  const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

  if (!skill) {
    return (
      <Container
        scroll
        contentClassName="gap-sp-4 py-sp-4"
        includeBottomTabInset={false}
      >
        <View className="flex-row items-center gap-sp-2">
          <Button
            leftIcon={<ChevronLeft color={theme.text} size={16} />}
            onPress={() => router.back()}
            size="icon-xs"
            variant="ghost"
          />
          <Text className="min-w-0 flex-1 font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Skill
          </Text>
        </View>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Skill not found.
        </Text>
      </Container>
    );
  }

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.back()}
          size="icon-xs"
          variant="ghost"
        />
        <Text
          className="min-w-0 flex-1 font-sans text-xl font-semibold text-foreground dark:text-foreground-dark"
          numberOfLines={1}
        >
          {skill.title}
        </Text>
      </View>

      {markdown ? (
        <Markdown
          markdownit={MARKDOWN_PARSER}
          onLinkPress={(link) => {
            Linking.openURL(link).catch(console.error);
            return true;
          }}
          style={markdownStyles}
        >
          {markdown}
        </Markdown>
      ) : null}

    </Container>
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
      color: theme.text,
      textDecorationLine: "underline",
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
