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

const PLUGIN_PICKER_TYPES = [
  "application/javascript",
  "text/javascript",
  "text/plain",
];

type BusyAction = "file" | "url";

export function PluginImportDrawer({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const theme = useTheme();
  const { importPlugin } = useConfig();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const handlePickFile = async () => {
    if (busy) return;

    setBusy("file");
    setError(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: PLUGIN_PICKER_TYPES,
      });

      if (result.canceled || !result.assets[0]) return;

      const file = new File(result.assets[0].uri);
      const source = await file.text();
      await importPlugin(source);
      setUrl("");
      onOpenChange(false);
    } catch (pickError) {
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
    if (busy || !url.trim()) return;

    setBusy("url");
    setError(null);

    try {
      const { fetchPluginFromUrl } = await import(
        "@/modules/plugins/import"
      );
      const source = await fetchPluginFromUrl(url.trim());
      await importPlugin(source, url.trim());
      setUrl("");
      onOpenChange(false);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Could not fetch the plugin from that URL.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Import plugin</DrawerTitle>
          <DrawerDescription>
            Pick a .js file or paste a URL to one.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <Button
            leftIcon={<FileDown color={theme.text} size={16} />}
            loading={busy === "file"}
            onPress={handlePickFile}
            variant="outline"
          >
            Choose .js file
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
              placeholder="Plugin URL"
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
        </DrawerBody>
        <DrawerFooter>
          <Button disabled onPress={() => onOpenChange(false)}>
            Done
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
