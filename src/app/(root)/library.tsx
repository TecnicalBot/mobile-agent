import * as LegacyFileSystem from "expo-file-system/legacy";
import { FlashList } from "@shopify/flash-list";
import * as IntentLauncher from "expo-intent-launcher";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ChevronLeft,
  File as FileIcon,
  Download,
  Trash2,
} from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { WorkspaceThumbnail } from "@/components/ui/workspace-thumbnail";
import { LibraryImageGrid } from "@/components/ui/library-image-grid";
import { FileRowIcon } from "@/components/ui/file-row-icon";
import {
  FilePreviewDialog,
  getFilePreviewKind,
} from "@/components/ui/file-preview-dialog";
import {
  ImagePreviewDrawer,
  type MediaPreviewTarget,
} from "@/components/ui/image-preview-drawer";
import {
  VideoPlayerDialog,
  type VideoPlayerTarget,
} from "@/components/ui/video-player-dialog";
import { Separator } from "@/components/ui/separator";
import { downloadFile } from "@/core/services/download-service";
import {
  isDocumentWorkspaceFile,
  isTextWorkspaceFile,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import type { WorkspaceFile } from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import { formatFileKindLabel } from "@/modules/files/file-type-label";

type LibraryCategory = "all" | "images" | "docs";

const CATEGORIES: { id: LibraryCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "docs", label: "Docs" },
];

export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { deleteWorkspaceFile, refreshWorkspaceFiles, workspaceFiles } =
    useChat();
  const [category, setCategory] = useState<LibraryCategory>("all");
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const [imagePreview, setImagePreview] = useState<MediaPreviewTarget | null>(
    null,
  );
  const [videoPreview, setVideoPreview] = useState<VideoPlayerTarget | null>(
    null,
  );

  const isVideoFile = (file: WorkspaceFile) => {
    if (file.mimeType?.startsWith("video/")) {
      return true;
    }
    const extension = file.displayName.split(".").pop()?.toLowerCase();
    return extension
      ? ["mp4", "mov", "m4v", "webm", "mkv"].includes(extension)
      : false;
  };

  useFocusEffect(useCallback(() => {
    refreshWorkspaceFiles().catch(console.error);
  }, [refreshWorkspaceFiles]));

  const filteredFiles = useMemo(() => {
    if (category === "images") {
      return workspaceFiles.filter((file) => file.mimeType?.startsWith("image/"));
    }

    if (category === "docs") {
      return workspaceFiles.filter(
        (file) => isTextWorkspaceFile(file) || isDocumentWorkspaceFile(file),
      );
    }

    return workspaceFiles;
  }, [category, workspaceFiles]);

  const handleOpenFile = async (workspaceFile: WorkspaceFile) => {
    setOpeningFileId(workspaceFile.id);

    try {
      // Route to the same viewers the chat uses: videos open the player
      // drawer, images open the shared image drawer, everything else falls
      // through to the file dialog or the external handler.
      const localFile = resolveWorkspaceFile(workspaceFile.relativePath);

      if (isVideoFile(workspaceFile)) {
        setVideoPreview({
          displayName: workspaceFile.displayName,
          localUri: localFile.uri,
          mimeType: workspaceFile.mimeType ?? "video/mp4",
        });
        return;
      }

      if (getFilePreviewKind(workspaceFile) === "image") {
        setImagePreview({
          alt: workspaceFile.displayName,
          uri: localFile.uri,
        });
        return;
      }

      // Previewable kinds (html, csv, text) open in the in-app dialog; pdf/
      // docx/xlsx/pptx and everything else go to the external handler so they
      // render faithfully in their real apps.
      if (getFilePreviewKind(workspaceFile)) {
        setPreviewFile(workspaceFile);
        return;
      }

      if (!localFile.exists) {
        throw new Error("This file is no longer available in the workspace.");
      }

      const mimeType = isTextWorkspaceFile(workspaceFile)
        ? "text/plain"
        : workspaceFile.mimeType || localFile.type || "*/*";

      if (Platform.OS === "android") {
        const contentUri = await LegacyFileSystem.getContentUriAsync(
          localFile.uri,
        );

        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: contentUri,
          flags: 1,
          type: mimeType,
        });
        return;
      }

      if (!(await Linking.canOpenURL(localFile.uri))) {
        throw new Error("No compatible app is available to open this file.");
      }

      await Linking.openURL(localFile.uri);
    } catch (error) {
      Alert.alert(
        "Unable to open file",
        error instanceof Error
          ? error.message
          : "The file could not be opened.",
      );
    } finally {
      setOpeningFileId(null);
    }
  };

  const handleDownloadFile = async (workspaceFile: WorkspaceFile) => {
    setDownloadingFileId(workspaceFile.id);

    try {
      const localFile = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!localFile.exists) {
        throw new Error("This file is no longer available in the workspace.");
      }

      const mimeType = workspaceFile.mimeType || localFile.type || "application/octet-stream";
      const result = await downloadFile(localFile.uri, workspaceFile.displayName, mimeType);
      if (result) Alert.alert("Downloaded", `${result.name} has been saved to Downloads.`);
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) {
        return;
      }

      Alert.alert(
        "Download failed",
        error instanceof Error ? error.message : "Failed to download the file.",
      );
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handleDeleteFile = (workspaceFile: WorkspaceFile) => {
    if (deletingFileId) {
      return;
    }

    Alert.alert(
      "Delete file?",
      `${workspaceFile.displayName} will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeletingFileId(workspaceFile.id);
            deleteWorkspaceFile(workspaceFile.id)
              .catch(console.error)
              .finally(() => {
                setDeletingFileId(null);
              });
          },
        },
      ],
    );
  };

  return (
    <Container
      scroll={false}
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => {
            router.dismissTo("/");
          }}
          size="icon-xs"
          variant="ghost"
        />
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Library
        </Text>
      </View>

      <View className="flex-row gap-sp-2">
        {CATEGORIES.map((item) => {
          const active = category === item.id;

          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className={cn(
                "flex-1 items-center rounded-ui border px-sp-3 py-sp-2",
                active
                  ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
                  : "border-border bg-card dark:border-border-dark dark:bg-card-dark",
              )}
              onPress={() => {
                setCategory(item.id);
              }}
              style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
            >
              <Text
                className={cn(
                  "font-sans text-sm font-medium",
                  active
                    ? "text-foreground dark:text-foreground-dark"
                    : "text-muted-foreground dark:text-muted-foreground-dark",
                )}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {filteredFiles.length > 0 ? (
        category === "images" ? (
          <View className="min-h-0 flex-1 -mx-1">
            <LibraryImageGrid
              files={filteredFiles}
              onOpen={(file) => { void handleOpenFile(file); }}
            />
          </View>
        ) : (
        <View className="min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-card dark:border-border-dark dark:bg-card-dark">
          <FlashList
            key={category}
            data={filteredFiles}
            keyExtractor={(file) => file.id}
            drawDistance={200}
            extraData={{ openingFileId, downloadingFileId, deletingFileId }}
            ItemSeparatorComponent={Separator}
            renderItem={({ item: file }) => (
              <LibraryFileRow
                file={file}
                opening={openingFileId === file.id}
                downloading={downloadingFileId === file.id}
                deleting={deletingFileId === file.id}
                onOpen={() => {
                  handleOpenFile(file).catch(console.error);
                }}
                onDownload={() => {
                  handleDownloadFile(file).catch(console.error);
                }}
                onDelete={() => {
                  handleDeleteFile(file);
                }}
              />
            )}
          />
        </View>
        )
      ) : (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {category === "all"
            ? "No files in the workspace yet. Ask the agent to create files or upload one from the chat screen."
            : `No ${category} in the workspace yet.`}
        </Text>
      )}
      <FilePreviewDialog
        file={previewFile}
        onDismiss={() => setPreviewFile(null)}
      />
      <ImagePreviewDrawer
        target={imagePreview}
        onDismiss={() => setImagePreview(null)}
      />
      <VideoPlayerDialog
        video={videoPreview}
        onDismiss={() => setVideoPreview(null)}
      />
    </Container>
  );
}

function LibraryFileRow({
  deleting,
  file,
  onDelete,
  onOpen,
  onDownload,
  opening,
  downloading,
}: {
  deleting: boolean;
  file: WorkspaceFile;
  onDelete: () => void;
  onOpen: () => void;
  onDownload: () => void;
  opening: boolean;
  downloading: boolean;
}) {
  const theme = useTheme();
  const isImage = file.mimeType?.startsWith("image/");
  const uri = resolveWorkspaceFile(file.relativePath).uri;
  const subtitle = [
    formatFileKindLabel(file),
    typeof file.size === "number" ? formatBytes(file.size) : null,
    formatDate(file.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-3">
      <Pressable
        accessibilityHint="Opens the file"
        accessibilityLabel={file.displayName}
        accessibilityRole="button"
        className="min-w-0 flex-1 flex-row items-center gap-sp-3"
        disabled={opening}
        onPress={onOpen}
        style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
      >
        <View className="h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-card bg-secondary dark:bg-secondary-dark">
          {isImage ? (
            <WorkspaceThumbnail
              size={48}
              uri={uri}
              style={{ height: 48, width: 48 }}
            />
          ) : isTextWorkspaceFile(file) || isDocumentWorkspaceFile(file) ? (
            <FileRowIcon file={file} color={theme.text} size={20} />
          ) : (
            <FileIcon color={theme.text} size={20} />
          )}
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text
            className="font-sans text-base text-foreground dark:text-foreground-dark"
            numberOfLines={1}
          >
            {file.displayName}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {subtitle}
          </Text>
        </View>
        {opening ? (
          <ActivityIndicator color={theme.textSecondary} size="small" />
        ) : null}
      </Pressable>
      <RowAction
        accessibilityLabel={`Download ${file.displayName}`}
        busy={downloading}
        icon={<Download color={theme.textSecondary} size={18} />}
        onPress={onDownload}
      />
      <RowAction
        accessibilityLabel={`Delete ${file.displayName}`}
        busy={deleting}
        icon={<Trash2 color={theme.destructive} size={18} />}
        onPress={onDelete}
      />
    </View>
  );
}

function RowAction({
  accessibilityLabel,
  busy,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  busy: boolean;
  icon: ReactNode;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={busy}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: busy ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={theme.textSecondary} size="small" />
      ) : (
        icon
      )}
    </Pressable>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString();
}
