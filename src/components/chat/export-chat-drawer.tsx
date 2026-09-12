import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Download, Share2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";

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
import { CHAT_EXPORT_FORMAT } from "@/modules/content/chat-export";
import { sanitizeFileName } from "@/modules/content/paths";

type ExportStatus = "loading" | "ready" | "error";
type ExportAction = "share" | "save" | null;

export function ExportChatDrawer({
  conversationId,
  onOpenChange,
  open,
}: {
  conversationId: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const theme = useTheme();
  const { conversations, exportConversationJson } = useChat();
  const [status, setStatus] = useState<ExportStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [action, setAction] = useState<ExportAction>(null);

  const conversation = conversations.find(
    (item) => item.id === conversationId,
  );
  const title = conversation?.title ?? "chat";
  const fileName = `chat-${sanitizeFileName(title).toLowerCase()}.json`;

  useEffect(() => {
    if (!open) {
      setStatus("loading");
      setError(null);
      setJson(null);
      setAction(null);
      return;
    }

    let cancelled = false;

    setStatus("loading");
    setError(null);
    setJson(null);

    if (!conversationId) {
      setStatus("error");
      setError("No chat selected.");
      return;
    }

    exportConversationJson(conversationId)
      .then((exported) => {
        if (!cancelled) {
          setJson(exported);
          setStatus("ready");
        }
      })
      .catch((exportError) => {
        if (!cancelled) {
          setStatus("error");
          setError(
            exportError instanceof Error
              ? exportError.message
              : "Could not export this chat.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, exportConversationJson, open]);

  const writeTempFile = () => {
    const file = new File(Paths.cache, fileName);

    file.create({
      intermediates: true,
      overwrite: true,
    });

    if (json) {
      file.write(json);
    }

    return file;
  };

  const handleShare = async () => {
    if (action || !json) {
      return;
    }

    setAction("share");

    try {
      const available = await Sharing.isAvailableAsync();

      if (!available) {
        Alert.alert(
          "Share unavailable",
          "Sharing is not available on this device.",
        );
        return;
      }

      const file = writeTempFile();

      await Sharing.shareAsync(file.uri, {
        dialogTitle: `Export ${title}`,
        mimeType: "application/json",
        UTI: "public.json",
      });

      onOpenChange(false);
    } catch (shareError) {
      if (shareError instanceof Error && /cancel/i.test(shareError.message)) {
        return;
      }

      Alert.alert(
        "Share failed",
        shareError instanceof Error
          ? shareError.message
          : "Failed to share this chat.",
      );
    } finally {
      setAction(null);
    }
  };

  const handleSaveToFiles = async () => {
    if (action || !json) {
      return;
    }

    setAction("save");

    try {
      const directory = new Directory(
        Paths.document,
        "mobile-agent",
        "exports",
      );

      if (!directory.exists) {
        directory.create({
          idempotent: true,
          intermediates: true,
        });
      }

      const file = new File(directory, fileName);

      file.create({
        intermediates: true,
        overwrite: true,
      });
      file.write(json);

      Alert.alert("Chat exported", `Saved to Files as ${fileName}.`);
      onOpenChange(false);
    } catch (saveError) {
      Alert.alert(
        "Save failed",
        saveError instanceof Error
          ? saveError.message
          : "Failed to save this chat.",
      );
    } finally {
      setAction(null);
    }
  };

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Export chat</DrawerTitle>
          <DrawerDescription>
            {status === "loading"
              ? "Preparing the chat export…"
              : "Download or share this conversation as a chat file."}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          {status === "loading" ? (
            <View className="items-center justify-center gap-sp-2 rounded-ui border border-border bg-card px-sp-4 py-sp-6 dark:border-border-dark dark:bg-card-dark">
              <ActivityIndicator color={theme.textSecondary} size="small" />
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Building {fileName}…
              </Text>
            </View>
          ) : status === "error" ? (
            <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
              {error}
            </Text>
          ) : (
            <View className="gap-sp-2 rounded-ui border border-border bg-card px-sp-4 py-sp-3 dark:border-border-dark dark:bg-card-dark">
              <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                {title}
              </Text>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {fileName} · {CHAT_EXPORT_FORMAT}
              </Text>
            </View>
          )}
        </DrawerBody>
        {status === "ready" ? (
          <DrawerFooter>
            <Button
              leftIcon={<Share2 color={theme.background} size={16} />}
              loading={action === "share"}
              onPress={handleShare}
            >
              Share
            </Button>
            <Button
              leftIcon={<Download color={theme.text} size={16} />}
              loading={action === "save"}
              onPress={handleSaveToFiles}
              variant="outline"
            >
              Save to Files
            </Button>
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}