import * as LegacyFileSystem from "expo-file-system/legacy";
import { FlashList } from "@shopify/flash-list";
import * as IntentLauncher from "expo-intent-launcher";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  ChevronLeft,
  File as FileIcon,
  Download,
  Trash2,
  FolderOpen,
  ChevronRight,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";

import { Container } from "@/components/shared/container";
import { SearchBox } from "@/components/shared/search-box";
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
import { loadLibraryCatalog } from "@/core/services/library-service";
import {
  isDocumentWorkspaceFile,
  isTextWorkspaceFile,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import type { WorkspaceFile } from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import { useHarness } from "@/providers/harness-state";
import { formatFileKindLabel } from "@/modules/files/file-type-label";
import {
  filterLibraryFiles,
  groupLibraryFiles,
  UNASSIGNED_LIBRARY_ID,
  type LibraryCatalog,
  type LibraryCategory,
  type LibraryFile,
} from "@/modules/files/library-catalog";

const CATEGORIES: { id: LibraryCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "videos", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "docs", label: "Docs" },
];

export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const sqlite = useSQLiteContext();
  const harness = useHarness();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const { deleteWorkspaceFile, refreshWorkspaceFiles, currentConversation, messages } =
    useChat();
  const [catalog, setCatalog] = useState<LibraryCatalog>({ files: [], conversations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"chats" | "files">("chats");
  const [conversationId, setConversationId] = useState<string | undefined>(params.conversationId);
  const [showIntermediate, setShowIntermediate] = useState(false);
  const loadGeneration = useRef(0);
  const live = useRef({ conversation: currentConversation, messages, linkedId: harness.linkedConversationId });
  live.current = { conversation: currentConversation, messages, linkedId: harness.linkedConversationId };
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

  useEffect(() => {
    setConversationId(params.conversationId);
    setQuery("");
  }, [params.conversationId]);

  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const current = live.current;
      const [next] = await Promise.all([
        loadLibraryCatalog(sqlite, current.conversation ? {
          conversation: { ...current.conversation, id: current.linkedId ?? current.conversation.id },
          messages: current.messages,
        } : undefined),
        refreshWorkspaceFiles(),
      ]);
      if (generation === loadGeneration.current) setCatalog(next);
    } catch (cause) {
      if (generation === loadGeneration.current) {
        setError(cause instanceof Error ? cause.message : "Could not load the library.");
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [refreshWorkspaceFiles, sqlite]);

  useFocusEffect(useCallback(() => {
    void reload();
    return () => { loadGeneration.current += 1; };
  }, [reload]));

  const filteredFiles = useMemo(() => filterLibraryFiles(catalog, {
    query, category, conversationId, showIntermediate,
  }), [catalog, category, conversationId, query, showIntermediate]);
  const groups = useMemo(() => groupLibraryFiles(catalog, filteredFiles), [catalog, filteredFiles]);
  const selectedTitle = conversationId === UNASSIGNED_LIBRARY_ID ? "Unassigned"
    : catalog.conversations.find((chat) => chat.id === conversationId)?.title;
  const showFolders = !conversationId && viewMode === "chats";

  const handleOpenFile = async (workspaceFile: LibraryFile) => {
    setOpeningFileId(workspaceFile.id);

    try {
      // Route to the same viewers the chat uses: videos open the player
      // drawer, images open the shared image drawer, everything else falls
      // through to the file dialog or the external handler.
      const localFile = workspaceFile.relativePath
        ? resolveWorkspaceFile(workspaceFile.relativePath)
        : null;
      const uri = workspaceFile.uri;

      if (isVideoFile(workspaceFile)) {
        setVideoPreview({
          displayName: workspaceFile.displayName,
          localUri: uri,
          mimeType: workspaceFile.mimeType ?? "video/mp4",
        });
        return;
      }

      if (getFilePreviewKind(workspaceFile) === "image") {
        setImagePreview({
          alt: workspaceFile.displayName,
          uri,
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

      if (!localFile?.exists) {
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

  const handleDownloadFile = async (workspaceFile: LibraryFile) => {
    setDownloadingFileId(workspaceFile.id);

    try {
      const mimeType = workspaceFile.mimeType || "application/octet-stream";
      const result = await downloadFile(workspaceFile.uri, workspaceFile.displayName, mimeType);
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

  const handleDeleteFile = (workspaceFile: LibraryFile) => {
    if (deletingFileId) {
      return;
    }

    Alert.alert(
      "Delete file?",
      `${workspaceFile.displayName} will be permanently deleted from every chat that uses it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeletingFileId(workspaceFile.id);
            deleteWorkspaceFile(workspaceFile.id)
              .then(reload)
              .catch((cause) => Alert.alert("Unable to delete file", cause instanceof Error ? cause.message : "Please try again."))
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
            if (conversationId && !params.conversationId) {
              setConversationId(undefined);
              setQuery("");
            } else if (router.canGoBack()) {
              router.back();
            } else {
              router.dismissTo("/");
            }
          }}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            {conversationId ? "Media & files" : "Library"}
          </Text>
          {conversationId ? (
            <Text numberOfLines={1} className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {selectedTitle ?? "Chat"}
            </Text>
          ) : null}
        </View>
      </View>

      <SearchBox
        accessibilityLabel={conversationId ? "Search this chat's media and files" : "Search library"}
        onChangeText={setQuery}
        placeholder={conversationId ? "Search this chat's files" : "Search files or chats"}
        value={query}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {!conversationId ? (
        <View className="flex-row gap-sp-2">
          {(["chats", "files"] as const).map((mode) => (
            <Button
              key={mode}
              accessibilityState={{ selected: viewMode === mode }}
              className="flex-1"
              onPress={() => setViewMode(mode)}
              variant={viewMode === mode ? "secondary" : "ghost"}
            >
              {mode === "chats" ? "By chat" : "All files"}
            </Button>
          ))}
        </View>
      ) : null}

      <View>
        <ScrollView
          contentContainerStyle={{ gap: 8 }}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {CATEGORIES.map((item) => {
            const active = category === item.id;

            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={cn(
                  "items-center rounded-ui border px-sp-3 py-sp-2",
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
        </ScrollView>
      </View>

      <View className="flex-row items-center justify-between gap-sp-2">
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {filteredFiles.length} {filteredFiles.length === 1 ? "file" : "files"}
        </Text>
        <View className="flex-row items-center gap-sp-2">
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">Include previews</Text>
          <Switch accessibilityLabel="Include previews and intermediate files" value={showIntermediate} onValueChange={setShowIntermediate} />
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={theme.textSecondary} /></View>
      ) : error ? (
        <View className="gap-sp-3">
          <Text accessibilityRole="alert" className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">{error}</Text>
          <Button onPress={() => { void reload(); }} variant="secondary">Retry</Button>
        </View>
      ) : showFolders && groups.length > 0 ? (
        <View className="min-h-0 flex-1">
          <FlashList
            data={groups}
            keyExtractor={(group) => group.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: group }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${group.title}, ${group.files.length} files`}
                className="mb-sp-3 flex-row items-center gap-sp-3 rounded-card border border-border bg-card p-sp-4 dark:border-border-dark dark:bg-card-dark"
                onPress={() => { setConversationId(group.id); }}
              >
                <FolderOpen color={theme.textSecondary} size={28} />
                <View className="min-w-0 flex-1 gap-1">
                  <Text numberOfLines={1} className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">{group.title}</Text>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {group.files.length} {group.files.length === 1 ? "file" : "files"}{group.size ? ` · ${formatBytes(group.size)}` : ""}
                  </Text>
                </View>
                <ChevronRight color={theme.textSecondary} size={18} />
              </Pressable>
            )}
          />
        </View>
      ) : filteredFiles.length > 0 ? (
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
            keyboardShouldPersistTaps="handled"
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
                onDelete={
                  file.generated
                    ? undefined
                    : () => {
                        handleDeleteFile(file);
                      }
                }
              />
            )}
          />
        </View>
        )
      ) : (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {query.trim()
            ? `No files or chats match “${query.trim()}”.`
            : conversationId ? "No matching media or files in this chat. Try another category or include previews."
            : "No matching files yet. Upload or create files in a chat, or include previews."}
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
  file: LibraryFile;
  onDelete?: () => void;
  onOpen: () => void;
  onDownload: () => void;
  opening: boolean;
  downloading: boolean;
}) {
  const theme = useTheme();
  const isImage = file.mimeType?.startsWith("image/");
  const uri = file.uri;
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
      {onDelete ? (
        <RowAction
          accessibilityLabel={`Delete ${file.displayName}`}
          busy={deleting}
          icon={<Trash2 color={theme.destructive} size={18} />}
          onPress={onDelete}
        />
      ) : null}
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
