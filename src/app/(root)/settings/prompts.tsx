import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, ScrollView, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { SavedPrompt } from "@/core/types/app-state";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { consumePendingText } from "process-text";

type Draft = {
  content: string;
  title: string;
};

const EMPTY_DRAFT: Draft = { content: "", title: "" };

export default function SavedPromptsScreen() {
  const router = useRouter();
  const { capture, text } = useLocalSearchParams<{
    capture?: string;
    text?: string;
  }>();
  const theme = useTheme();
  const {
    createSavedPrompt,
    deleteSavedPrompt,
    savedPrompts,
    updateSavedPrompt,
  } = useConfig();
  const captureInFlight = useRef(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const openCreate = (content = "") => {
    setEditingPrompt(null);
    setDraft({ content, title: "" });
    setError(null);
    setOpen(true);
  };

  useEffect(() => {
    if (typeof text !== "string" || !text.trim()) return;
    openCreate(text.trim());
    router.setParams({ text: undefined });
  }, [router, text]);

  useEffect(() => {
    if (capture !== "1" || captureInFlight.current) return;
    captureInFlight.current = true;

    consumePendingText()
      .then((selectedText) => {
        if (selectedText?.trim()) {
          openCreate(selectedText.trim());
        }
      })
      .catch((captureError) => {
        setError(
          captureError instanceof Error
            ? captureError.message
            : "Could not read the selected text.",
        );
      })
      .finally(() => {
        captureInFlight.current = false;
        router.setParams({ capture: undefined });
      });
  }, [capture, router]);

  const openEdit = (savedPrompt: SavedPrompt) => {
    setEditingPrompt(savedPrompt);
    setDraft({ content: savedPrompt.content, title: savedPrompt.title });
    setError(null);
    setOpen(true);
  };

  const saveDraft = async () => {
    const content = draft.content.trim();
    const title = draft.title.trim();

    if (!title || !content) {
      setError("Title and prompt text are required.");
      return;
    }

    setBusyKey("save");
    setError(null);
    try {
      if (editingPrompt) {
        await updateSavedPrompt(editingPrompt.id, { content, title });
      } else {
        await createSavedPrompt({ content, title });
      }
      setOpen(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save prompt.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const confirmDelete = (savedPrompt: SavedPrompt) => {
    Alert.alert(
      "Delete saved prompt?",
      `"${savedPrompt.title}" will be removed permanently.`,
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete",
          onPress: () => {
            setBusyKey(`delete:${savedPrompt.id}`);
            deleteSavedPrompt(savedPrompt.id)
              .catch((deleteError) => {
                setError(
                  deleteError instanceof Error
                    ? deleteError.message
                    : "Could not delete prompt.",
                );
              })
              .finally(() => setBusyKey(null));
          },
        },
      ],
    );
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
          onPress={() => router.push("/settings")}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Saved prompts
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {savedPrompts.length} saved
          </Text>
        </View>
        <Button
          leftIcon={<Plus color={theme.background} size={16} />}
          onPress={() => openCreate()}
          size="sm"
        >
          Add
        </Button>
      </View>

      {savedPrompts.length === 0 ? (
        <Card className="gap-sp-2 px-sp-4 py-sp-4">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            No saved prompts yet
          </Text>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Add one here or select text in another Android app and choose Save
            prompt.
          </Text>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {savedPrompts.map((savedPrompt, index) => (
            <View key={savedPrompt.id}>
              <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-3">
                <View className="min-w-0 flex-1 gap-1">
                  <Text
                    className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark"
                    numberOfLines={1}
                  >
                    {savedPrompt.title}
                  </Text>
                  <Text
                    className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                    numberOfLines={2}
                  >
                    {savedPrompt.content}
                  </Text>
                </View>
                <Button
                  leftIcon={<Pencil color={theme.textSecondary} size={15} />}
                  onPress={() => openEdit(savedPrompt)}
                  size="icon-xs"
                  variant="ghost"
                />
                <Button
                  disabled={busyKey === `delete:${savedPrompt.id}`}
                  leftIcon={<Trash2 color={theme.destructive} size={15} />}
                  onPress={() => confirmDelete(savedPrompt)}
                  size="icon-xs"
                  variant="ghost"
                />
              </View>
              {index < savedPrompts.length - 1 ? <Separator /> : null}
            </View>
          ))}
        </Card>
      )}

      {error && !open ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <Drawer
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setError(null);
        }}
        open={open}
      >
        <DrawerContent showCloseButton>
          <DrawerHeader>
            <DrawerTitle>
              {editingPrompt ? "Edit saved prompt" : "Save prompt"}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <ScrollView
              className="gap-sp-3"
              keyboardShouldPersistTaps="handled"
            >
              <Field label="Title">
                <Input
                  autoFocus
                  onChangeText={(title) =>
                    setDraft((current) => ({ ...current, title }))
                  }
                  placeholder="Professional email"
                  value={draft.title}
                />
              </Field>
              <Field label="Prompt text">
                <Textarea
                  className="min-h-44 max-h-96"
                  onChangeText={(content) =>
                    setDraft((current) => ({ ...current, content }))
                  }
                  placeholder="Write the prompt you want to reuse."
                  value={draft.content}
                />
              </Field>
              {error ? (
                <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                  {error}
                </Text>
              ) : null}
            </ScrollView>
          </DrawerBody>
          <DrawerFooter>
            <Button loading={busyKey === "save"} onPress={saveDraft}>
              Save
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Container>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View className="gap-sp-2">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      {children}
    </View>
  );
}
