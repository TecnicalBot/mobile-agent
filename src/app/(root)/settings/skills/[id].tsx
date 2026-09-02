import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import type { DocumentPickerAsset } from "expo-document-picker";
import { File } from "expo-file-system";
import { Binary, ChevronLeft, FilePlus2, FileText } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  attachmentFromBytes,
  isBinaryMimeType,
  type SkillAttachment,
} from "@/modules/skills/skill-files";

async function readLocalAsset(
  asset: DocumentPickerAsset,
): Promise<SkillAttachment | null> {
  try {
    const file = new File(asset.uri);
    const bytes = new Uint8Array(await file.arrayBuffer());

    return attachmentFromBytes({
      path: asset.name || "file",
      bytes,
      mimeType: asset.mimeType ?? null,
    });
  } catch {
    return null;
  }
}

export default function SkillDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { addSkillFiles, skills } = useConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skill = skills.find((item) => item.id === id);

  const handleAddFiles = async () => {
    if (!skill || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: "*/*",
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const attachments: SkillAttachment[] = [];

      for (const asset of result.assets) {
        const attachment = await readLocalAsset(asset);

        if (attachment) {
          attachments.push(attachment);
        }
      }

      await addSkillFiles(
        skill.id,
        attachments.map((file) => ({
          path: file.path,
          content: file.content,
          mimeType: file.mimeType,
          size: file.size,
        })),
      );
    } catch (addError) {
      setError(
        addError instanceof Error
          ? addError.message
          : "Could not add the selected files.",
      );
    } finally {
      setBusy(false);
    }
  };

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

  const files = [...skill.skillFiles].sort((a, b) =>
    a.path.localeCompare(b.path),
  );

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
        <Button
          className="ml-auto"
          leftIcon={<FilePlus2 color={theme.text} size={16} />}
          loading={busy}
          onPress={handleAddFiles}
          size="sm"
          variant="outline"
        >
          Add files
        </Button>
      </View>

      {files.length === 0 ? (
        <View className="rounded-ui border border-border bg-background px-sp-4 py-sp-4 dark:border-border-dark dark:bg-background-dark">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No files in this skill yet. Use Add files above to attach one.
          </Text>
        </View>
      ) : (
        <View className="gap-sp-2">
          <View className="overflow-hidden rounded-ui border border-border dark:border-border-dark">
            {files.map((file, index) => {
              const binary = isBinaryMimeType(file.mimeType);
              const Icon = binary ? Binary : FileText;

              return (
                <View key={file.path}>
                  <Pressable
                    accessibilityRole="button"
                    className="flex-row items-center gap-sp-3 bg-background px-sp-3 py-sp-3 dark:bg-background-dark"
                    onPress={() =>
                      router.push({
                        pathname: "/settings/skills/file",
                        params: { path: file.path, skillId: skill.id },
                      } as never)
                    }
                    style={({ pressed }) =>
                      pressed ? { opacity: 0.84 } : null
                    }
                  >
                    <Icon color={theme.text} size={16} />
                    <View className="min-w-0 flex-1">
                      <Text
                        className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark"
                        numberOfLines={1}
                      >
                        {file.path}
                      </Text>
                      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        {formatFileSize(file.size)} ·{" "}
                        {binary ? "binary" : "text"}
                      </Text>
                    </View>
                  </Pressable>
                  {index < files.length - 1 ? (
                    <View className="h-px bg-border dark:bg-border-dark" />
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      )}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}
    </Container>
  );
}

function formatFileSize(size: number | null) {
  if (size === null || size === undefined) {
    return "unknown size";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
