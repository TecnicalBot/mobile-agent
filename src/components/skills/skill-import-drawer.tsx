import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { FileDown } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import Markdown, { MarkdownIt } from "react-native-markdown-display";

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
import { Input } from "@/components/ui/input";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import { parseSkillMarkdown } from "@/modules/skills/skill-markdown";

const MARKDOWN_MAX_PREVIEW_LENGTH = 30_000;

const MARKDOWN_PARSER = MarkdownIt({
  breaks: true,
  linkify: true,
  typographer: true,
});

type BusyAction = "file" | "url" | "import";

export function SkillImportDrawer({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const theme = useTheme();
  const { importSkillMarkdown, skills } = useConfig();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const markdownStyles = useMemo(
    () => createMarkdownStyles(theme),
    [theme],
  );

  const previewContent = useMemo(() => {
    if (!content) {
      return null;
    }

    return content.length > MARKDOWN_MAX_PREVIEW_LENGTH
      ? content.slice(0, MARKDOWN_MAX_PREVIEW_LENGTH)
      : content;
  }, [content]);

  const applyMarkdown = (markdown: string) => {
    const parsed = parseSkillMarkdown(markdown);

    setContent(markdown);
    setTitle(parsed.title);
    setError(null);
  };

  const handlePickFile = async () => {
    if (busy) {
      return;
    }

    setBusy("file");
    setError(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: "*/*",
      });

      if (!result.canceled && result.assets.length > 0) {
        const file = new File(result.assets[0]!.uri);
        applyMarkdown(await file.text());
      }
    } catch (pickError) {
      setTitle(null);
      setContent(null);
      setError(
        pickError instanceof Error
          ? pickError.message
          : "Could not read the selected file.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleFetchUrl = async () => {
    if (busy) {
      return;
    }

    setBusy("url");
    setError(null);

    try {
      const { content: markdown } = await fetchSkillMarkdownFromUrl(url);
      applyMarkdown(markdown);
    } catch (fetchError) {
      setTitle(null);
      setContent(null);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Could not fetch the skill from that URL.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async () => {
    if (busy || !content || !title) {
      return;
    }

    setBusy("import");
    setError(null);

    try {
      const existing = skills.find(
        (skill) => skill.title.toLowerCase() === title.toLowerCase(),
      );

      await importSkillMarkdown({
        markdown: content,
        replaceById: existing?.id ?? null,
      });

      setUrl("");
      setContent(null);
      setTitle(null);
      onOpenChange(false);
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : "Import failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  const willReplace =
    title !== null &&
    skills.some(
      (skill) => skill.title.toLowerCase() === title.toLowerCase(),
    );

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Import skill</DrawerTitle>
          <DrawerDescription>
            Pick a SKILL.md file or paste a URL to one.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <Button
            leftIcon={<FileDown color={theme.text} size={16} />}
            loading={busy === "file"}
            onPress={handlePickFile}
            variant="outline"
          >
            Choose SKILL.md file
          </Button>
          <View className="flex-row items-center gap-sp-3 py-sp-1">
            <View className="h-px flex-1 bg-border dark:bg-border-dark" />
            <Text className="font-sans text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
              OR
            </Text>
            <View className="h-px flex-1 bg-border dark:bg-border-dark" />
          </View>
          <View className="gap-sp-2">
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => {
                setUrl(value);
                setError(null);
              }}
              placeholder="SKILL.md URL"
              value={url}
            />
            <Button
              loading={busy === "url"}
              onPress={handleFetchUrl}
              variant="outline"
            >
              Install
            </Button>
          </View>
          {error ? (
            <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
              {error}
            </Text>
          ) : null}
          {previewContent ? (
            <View className="gap-sp-2 rounded-ui border border-border bg-background px-sp-3 py-sp-3 dark:border-border-dark dark:bg-background-dark">
              {willReplace ? (
                <Text className="font-sans text-xs font-medium text-foreground dark:text-foreground-dark">
                  A skill with this name already exists. Importing will replace
                  it.
                </Text>
              ) : null}
              <Markdown
                markdownit={MARKDOWN_PARSER}
                onLinkPress={(link) => {
                  Linking.openURL(link).catch(console.error);
                  return true;
                }}
                style={markdownStyles}
              >
                {previewContent}
              </Markdown>
              {content && content.length > MARKDOWN_MAX_PREVIEW_LENGTH ? (
                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  Preview truncated — the full skill will be imported.
                </Text>
              ) : null}
            </View>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button
            disabled={!title}
            loading={busy === "import"}
            onPress={handleImport}
          >
            Import
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
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
      fontSize: 20,
      fontWeight: "700",
      lineHeight: 27,
      marginBottom: 6,
      marginTop: 8,
    },
    heading2: {
      color: theme.text,
      fontSize: 18,
      fontWeight: "700",
      lineHeight: 25,
      marginBottom: 6,
      marginTop: 8,
    },
    heading3: {
      color: theme.text,
      fontSize: 16,
      fontWeight: "700",
      lineHeight: 23,
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
