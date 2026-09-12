import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
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
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import { parseConversationExport } from "@/modules/content/chat-export";

type BusyAction = "file" | "import";

export function ChatImportDrawer({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { importConversationJson, selectConversation } = useChat();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const json = await file.text();
        const parsed = parseConversationExport(json);

        setContent(json);
        setPreviewTitle(parsed.conversation.title);
        setPreviewCount(parsed.messages.length);
      }
    } catch (pickError) {
      setPreviewTitle(null);
      setPreviewCount(null);
      setContent(null);
      setError(
        pickError instanceof Error
          ? pickError.message
          : "Could not read the selected chat export.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async () => {
    if (busy || !content) {
      return;
    }

    setBusy("import");
    setError(null);

    try {
      const conversation = await importConversationJson(content);

      await selectConversation(conversation.id);
      router.push("/");

      setContent(null);
      setPreviewTitle(null);
      setPreviewCount(null);
      onOpenChange(false);
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : "Import failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Import chat</DrawerTitle>
          <DrawerDescription>
            Pick a chat export file to restore it as a new conversation.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <Button
            leftIcon={<FileDown color={theme.text} size={16} />}
            loading={busy === "file"}
            onPress={handlePickFile}
            variant="outline"
          >
            Choose chat file
          </Button>
          {error ? (
            <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
              {error}
            </Text>
          ) : null}
          {previewTitle ? (
            <View className="gap-sp-1 rounded-ui border border-border bg-background px-sp-3 py-sp-3 dark:border-border-dark dark:bg-background-dark">
              <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                {previewTitle}
              </Text>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {previewCount} message{previewCount === 1 ? "" : "s"} will be
                imported as a new chat.
              </Text>
            </View>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button
            disabled={!content}
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