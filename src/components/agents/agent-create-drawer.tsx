import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { FileDown, Rocket } from "lucide-react-native";
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
import { Textarea } from "@/components/ui/textarea";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import { parseAgentMarkdown } from "@/modules/agents/agent-markdown";
import type { AgentConfig } from "@/core/types/app-state";

type BusyAction =
  | "create"
  | "file"
  | "import"
  | "url";

export function AgentCreateDrawer({
  onCreated,
  onOpenChange,
  open,
}: {
  onCreated: (agent: AgentConfig) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const theme = useTheme();
  const { agents, createAgent, importAgentMarkdown } = useConfig();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setContent(null);
    setName(null);
    setUrl("");
    setError(null);
  };

  const handleCreate = async () => {
    if (busy || !title.trim()) {
      setError("Give the agent a title.");
      return;
    }

    setBusy("create");
    setError(null);

    try {
      const agent = await createAgent({
        description: description.trim() || null,
        name: title.trim(),
      });
      resetForm();
      onOpenChange(false);
      onCreated(agent);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Could not create.",
      );
    } finally {
      setBusy(null);
    }
  };

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

      const agent = await importAgentMarkdown({
        markdown: content,
        replaceById: existing?.id ?? null,
      });

      resetForm();
      onOpenChange(false);
      onCreated(agent);
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
          <DrawerTitle>Create agent</DrawerTitle>
          <DrawerDescription>
            Start with a title and description, then fine-tune it after it is
            created.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <View className="gap-sp-2">
            <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
              Title
            </Text>
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => {
                setTitle(value);
                setError(null);
              }}
              placeholder="code-reviewer"
              value={title}
            />
          </View>
          <View className="gap-sp-2">
            <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
              Description
            </Text>
            <Textarea
              className="min-h-24"
              onChangeText={(value) => {
                setDescription(value);
                setError(null);
              }}
              placeholder="When should this agent be used?"
              value={description}
            />
          </View>

          <View className="flex-row items-center gap-sp-3 py-sp-1">
            <View className="h-px flex-1 bg-border dark:bg-border-dark" />
            <Text className="font-sans text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
              OR
            </Text>
            <View className="h-px flex-1 bg-border dark:bg-border-dark" />
          </View>

          <Button
            leftIcon={<FileDown color={theme.text} size={16} />}
            loading={busy === "file"}
            onPress={handlePickFile}
            variant="outline"
          >
            Import an AGENT.md file
          </Button>

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
              Fetch from URL
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
            leftIcon={<Rocket color={theme.background} size={16} />}
            loading={busy === "create"}
            onPress={handleCreate}
          >
            Create agent
          </Button>
          {name ? (
            <Button
              loading={busy === "import"}
              onPress={handleImport}
              variant="outline"
            >
              Import
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
