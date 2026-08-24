import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { FileDown } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";

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
import {
  fetchSkillMarkdownFromUrl,
} from "@/modules/skills/skill-github";
import { parseAgentMarkdown } from "@/modules/agents/agent-markdown";

type BusyAction = "file" | "url" | "import";

export function AgentImportDrawer({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const theme = useTheme();
  const { agents, importAgentMarkdown } = useConfig();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const applyMarkdown = (markdown: string) => {
    const parsed = parseAgentMarkdown(markdown);

    setContent(markdown);
    setName(parsed.name);
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
      setName(null);
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
      setName(null);
      setContent(null);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Could not fetch the agent from that URL.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async () => {
    if (busy || !content || !name) {
      return;
    }

    setBusy("import");
    setError(null);

    try {
      const existing = agents.find(
        (agent) =>
          agent.name.toLowerCase() === name.toLowerCase() &&
          agent.id !== "build" &&
          agent.id !== "plan",
      );

      await importAgentMarkdown({
        markdown: content,
        replaceById: existing?.id ?? null,
      });

      setUrl("");
      setContent(null);
      setName(null);
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
    name !== null &&
    agents.some((agent) => agent.name.toLowerCase() === name.toLowerCase());

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Import agent</DrawerTitle>
          <DrawerDescription>
            Pick an AGENT.md file or paste a URL to one.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <Button
            leftIcon={<FileDown color={theme.text} size={16} />}
            loading={busy === "file"}
            onPress={handlePickFile}
            variant="outline"
          >
            Choose AGENT.md file
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
              placeholder="AGENT.md URL"
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
          {name ? (
            <View className="gap-sp-1 rounded-ui border border-border bg-background px-sp-3 py-sp-3 dark:border-border-dark dark:bg-background-dark">
              <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                {name}
              </Text>
              {willReplace ? (
                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  An agent with this name already exists — importing will
                  replace it.
                </Text>
              ) : null}
            </View>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button
            disabled={!name}
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
