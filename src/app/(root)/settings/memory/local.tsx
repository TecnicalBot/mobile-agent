import { useRouter } from "expo-router";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

const EMPTY_MEMORY = "# Memory\n";

export default function SettingsMemoryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    clearMemory,
    memory,
    memoryEnabled,
    updateMemoryEnabled,
    writeMemory,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [content, setContent] = useState(memory?.content ?? EMPTY_MEMORY);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    setContent(memory?.content ?? EMPTY_MEMORY);
  }, [memory?.content]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);

    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Memory action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const saveMemory = async () => {
    const nextContent = content.trim();

    if (!nextContent) {
      throw new Error("Memory content is required.");
    }

    await writeMemory(nextContent);
    setEditorOpen(false);
  };

  const openEditor = () => {
    setContent(memory?.content ?? EMPTY_MEMORY);
    setError(null);
    setEditorOpen(true);
  };

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.push("/settings/memory")}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Local memory
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {memoryEnabled ? "On" : "Off"}
          </Text>
        </View>
      </View>

      <Card className="overflow-hidden">
        <SwitchRow
          checked={memoryEnabled}
          disabled={busyKey === "memory-enabled"}
          label="Memory"
          onCheckedChange={(enabled) => {
            runAction("memory-enabled", async () => {
              await updateMemoryEnabled(enabled);
            }).catch(console.error);
          }}
        />
      </Card>

      <Card className="gap-sp-3 px-sp-4 py-sp-4">
        <Pressable
          accessibilityLabel="Edit memory"
          accessibilityRole="button"
          onPress={openEditor}
          style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
        >
          <Text
            className={cn(
              "font-sans text-sm leading-6",
              memory
                ? "text-foreground dark:text-foreground-dark"
                : "text-muted-foreground dark:text-muted-foreground-dark",
            )}
            selectable
          >
            {memory?.content.trim() || "No saved memory."}
          </Text>
        </Pressable>
        <View className="flex-row flex-wrap gap-sp-2">
          <Button
            leftIcon={<Pencil color={theme.text} size={14} />}
            onPress={openEditor}
            size="sm"
            variant="outline"
          >
            Edit
          </Button>
          {memory ? (
            <Button
              leftIcon={<Trash2 color={theme.destructive} size={14} />}
              loading={busyKey === "delete"}
              onPress={() => {
                runAction("delete", async () => {
                  await clearMemory();
                  setContent(EMPTY_MEMORY);
                }).catch(console.error);
              }}
              size="sm"
              variant="ghost"
            >
              Clear file
            </Button>
          ) : null}
        </View>
      </Card>

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <Drawer onOpenChange={setEditorOpen} open={editorOpen}>
        <DrawerContent showCloseButton>
          <DrawerHeader>
            <DrawerTitle>Edit memory</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <View className="gap-sp-3">
              <Textarea
                className="min-h-72"
                disabled={busyKey !== null}
                onChangeText={setContent}
                placeholder="# Memory\n\n- The user prefers concise answers."
                value={content}
              />
              {error ? (
                <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                  {error}
                </Text>
              ) : null}
            </View>
          </DrawerBody>
          <DrawerFooter>
            <Button
              loading={busyKey === "save"}
              onPress={() => {
                runAction("save", saveMemory).catch(console.error);
              }}
            >
              Save
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Container>
  );
}

function SwitchRow({
  checked,
  disabled = false,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      className={cn(
        "min-h-12 flex-row items-center justify-between gap-sp-3 px-sp-4 py-sp-3",
        disabled && "opacity-50",
      )}
      disabled={disabled}
      onPress={() => onCheckedChange(!checked)}
      style={({ pressed }) => (pressed && !disabled ? { opacity: 0.84 } : null)}
    >
      <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      <View pointerEvents="none">
        <Checkbox checked={checked} onCheckedChange={() => {}} />
      </View>
    </Pressable>
  );
}
