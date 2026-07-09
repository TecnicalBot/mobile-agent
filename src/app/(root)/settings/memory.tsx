import { useRouter } from "expo-router";
import { ChevronLeft, Plus, Trash2 } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import type { MemoryEntry } from "@/types/app-state";

type Draft = {
  content: string;
  enabled: boolean;
};

const EMPTY_DRAFT: Draft = {
  content: "",
  enabled: true,
};

function draftFromMemory(memory: MemoryEntry): Draft {
  return {
    content: memory.content,
    enabled: memory.enabled,
  };
}

export default function SettingsMemoryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    createMemory,
    deleteMemory,
    memories,
    memoryEnabled,
    updateMemory,
    updateMemoryEnabled,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingMemory, setEditingMemory] = useState<MemoryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

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

  const openCreate = () => {
    setEditingMemory(null);
    setDraft(EMPTY_DRAFT);
    setOpen(true);
  };

  const openEdit = (memory: MemoryEntry) => {
    setEditingMemory(memory);
    setDraft(draftFromMemory(memory));
    setOpen(true);
  };

  const saveDraft = async () => {
    const content = draft.content.trim();

    if (!content) {
      throw new Error("Memory content is required.");
    }

    if (editingMemory) {
      await updateMemory(editingMemory.id, {
        content,
        enabled: draft.enabled,
      });
    } else {
      await createMemory({
        content,
        enabled: draft.enabled,
      });
    }

    setOpen(false);
  };

  const enabledMemoryCount = memories.filter((memory) => memory.enabled).length;

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => {
            router.push("/settings");
          }}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Memory
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {memoryEnabled ? `${enabledMemoryCount} enabled` : "Off"}
          </Text>
        </View>
        <Button
          leftIcon={<Plus color={theme.background} size={16} />}
          onPress={openCreate}
          size="sm"
        >
          Add
        </Button>
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

      {memories.length === 0 ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No saved memories.
          </Text>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {memories.map((memory, index) => (
            <View key={memory.id}>
              <MemoryRow
                busyKey={busyKey}
                memory={memory}
                onDelete={() =>
                  runAction(`delete:${memory.id}`, async () => {
                    await deleteMemory(memory.id);
                  })
                }
                onEdit={() => openEdit(memory)}
                onToggle={(enabled) =>
                  runAction(`toggle:${memory.id}`, async () => {
                    await updateMemory(memory.id, { enabled });
                  })
                }
              />
              {index < memories.length - 1 ? <Separator /> : null}
            </View>
          ))}
        </Card>
      )}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <Drawer onOpenChange={setOpen} open={open}>
        <DrawerContent showCloseButton>
          <DrawerHeader>
            <DrawerTitle>
              {editingMemory ? "Edit memory" : "Add memory"}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <View className="gap-sp-3">
              <Field label="Content">
                <Textarea
                  className="min-h-28"
                  onChangeText={(content) =>
                    setDraft((current) => ({ ...current, content }))
                  }
                  placeholder="The user prefers concise answers."
                  value={draft.content}
                />
              </Field>
              <SwitchRow
                checked={draft.enabled}
                label="Enabled"
                onCheckedChange={(enabled) =>
                  setDraft((current) => ({ ...current, enabled }))
                }
              />
            </View>
          </DrawerBody>
          <DrawerFooter>
            <Button
              loading={busyKey === "save"}
              onPress={() => {
                runAction("save", saveDraft).catch(console.error);
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

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <View className="gap-sp-2">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      {children}
    </View>
  );
}

function MemoryRow({
  busyKey,
  memory,
  onDelete,
  onEdit,
  onToggle,
}: {
  busyKey: string | null;
  memory: MemoryEntry;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const theme = useTheme();

  return (
    <View className="gap-sp-3 px-sp-4 py-sp-4">
      <Pressable
        accessibilityRole="button"
        className="flex-row items-start gap-sp-3"
        onPress={onEdit}
        style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
      >
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            {memory.content}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {memory.enabled ? "Enabled" : "Disabled"}
          </Text>
        </View>
        <View pointerEvents="none">
          <Checkbox checked={memory.enabled} onCheckedChange={() => {}} />
        </View>
      </Pressable>
      <View className="flex-row flex-wrap gap-sp-2">
        <Button
          disabled={busyKey === `toggle:${memory.id}`}
          onPress={() => onToggle(!memory.enabled)}
          size="sm"
          variant="outline"
        >
          {memory.enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          leftIcon={<Trash2 color={theme.destructive} size={14} />}
          loading={busyKey === `delete:${memory.id}`}
          onPress={onDelete}
          size="sm"
          variant="ghost"
        >
          Delete
        </Button>
      </View>
    </View>
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
