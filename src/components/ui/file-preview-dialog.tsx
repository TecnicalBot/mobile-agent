import { Image } from "expo-image";
import { Download, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { CodePreviewContent } from "@/components/ui/code-preview-dialog";

import { CsvTable, CsvTableLoading } from "@/components/ui/csv-table";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  isTextWorkspaceFile,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import { downloadFile } from "@/core/services/download-service";
import type { WorkspaceFile } from "@/core/types/app-state";
import { useTheme } from "@/hooks/use-theme";
import { parseSpreadsheetText } from "@/modules/files/csv-table";
import { buildPreviewDocument } from "@/modules/preview/html-document";

/** Largest text slice rendered in the preview; bigger files are truncated. */
const MAX_PREVIEW_CHARS = 200_000;

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".heic",
  ".heif",
];

const MARKUP_EXTENSIONS = [".html", ".htm", ".svg", ".xml"];

export type FilePreviewKind = "image" | "markup" | "csv" | "text";

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");

  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

/**
 * Decides which in-app preview to use for a workspace file. Returns null for
 * kinds we still have to hand to an external app (PDF, archives, media, ...).
 */
export function getFilePreviewKind(
  file: Pick<WorkspaceFile, "displayName" | "mimeType">,
): FilePreviewKind | null {
  const mimeType = file.mimeType?.toLowerCase() ?? "";
  const extension = extensionOf(file.displayName);

  if (extension === ".svg" || mimeType === "image/svg+xml") {
    return "markup";
  }

  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.includes(extension)) {
    return "image";
  }

  if (extension === ".csv" || extension === ".tsv" || mimeType === "text/csv") {
    return "csv";
  }

  if (
    MARKUP_EXTENSIONS.includes(extension) ||
    mimeType === "text/html" ||
    mimeType === "application/xhtml+xml"
  ) {
    return "markup";
  }

  if (isTextWorkspaceFile(file)) {
    return "text";
  }

  return null;
}

export function FilePreviewDialog({
  file,
  onDismiss,
}: {
  file: WorkspaceFile | null;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!file || downloading) return;
    setDownloading(true);
    try {
      const local = resolveWorkspaceFile(file.relativePath);
      if (!local.exists) throw new Error("This file is no longer available locally.");
      const result = await downloadFile(local.uri, file.displayName, file.mimeType || local.type || "application/octet-stream");
      Alert.alert("Downloaded", `${result.name} has been saved to Downloads.`);
    } catch (error) {
      Alert.alert("Download failed", error instanceof Error ? error.message : "Unable to download file.");
    } finally {
      setDownloading(false);
    }
  };

  const isMarkup = !!file && getFilePreviewKind(file) === "markup";

  return (
    <Drawer
      dismissible
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
      open={file !== null}
    >
      <DrawerContent contentClassName="max-w-full" showHandle>
        {file ? (
          isMarkup ? (
            // Same drawer stays mounted while the markup loads and when the
            // preview swaps in, so drawer-to-drawer blinks are gone.
            <MarkupPreviewBody key={file.id} file={file} onDismiss={onDismiss} />
          ) : (
            <>
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1 gap-1">
                  <DrawerTitle numberOfLines={1}>{file.displayName}</DrawerTitle>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {file.mimeType ?? "File"}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Download file"
                  accessibilityRole="button"
                  className="h-11 w-11 items-center justify-center rounded-full bg-card dark:bg-card-dark"
                  disabled={downloading}
                  onPress={handleDownload}
                >
                  {downloading ? <ActivityIndicator color={theme.text} /> : <Download color={theme.text} size={20} />}
                </Pressable>
                <DrawerClose asChild>
                  <Pressable
                    accessibilityLabel="Close file preview"
                    className="h-11 w-11 items-center justify-center rounded-full bg-card dark:bg-card-dark"
                  >
                    <X color={theme.text} size={20} />
                  </Pressable>
                </DrawerClose>
              </View>
              <FilePreviewBody key={`${file.id}:${file.updatedAt}`} file={file} />
            </>
          )
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function MarkupPreviewBody({ file, onDismiss }: { file: WorkspaceFile; onDismiss: () => void }) {
  const theme = useTheme();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const language = extensionOf(file.displayName).slice(1) || "html";
  useEffect(() => {
    let cancelled = false;
    resolveWorkspaceFile(file.relativePath).text().then((content) => {
      if (!cancelled) setCode(content);
    }).catch((error) => {
      if (!cancelled) setError(error instanceof Error ? error.message : "Unable to read file.");
    });
    return () => { cancelled = true; };
  }, [file.relativePath]);
  const html = useMemo(() => code === null ? null : buildPreviewDocument(code, language, { title: file.displayName }), [code, language, file.displayName]);
  if (code !== null && html) {
    return <CodePreviewContent code={code} html={html} language={language} onDismiss={onDismiss} />;
  }
  return (
    <View className="flex-1 items-center justify-center">
      {error ? <Text style={{ color: theme.text }}>{error}</Text> : <ActivityIndicator color={theme.text} />}
    </View>
  );
}

function FilePreviewBody({ file }: { file: WorkspaceFile }) {
  const theme = useTheme();
  const kind = getFilePreviewKind(file);
  const localFile = useMemo(
    () => resolveWorkspaceFile(file.relativePath),
    [file.relativePath],
  );
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(kind !== "image");

  useEffect(() => {
    if (kind === "image") {
      setText(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (!localFile.exists) {
          throw new Error(
            `${file.displayName} is no longer available locally.`,
          );
        }

        const content = await localFile.text();

        if (!cancelled) {
          setText(content.slice(0, MAX_PREVIEW_CHARS));
          setLoading(false);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The file could not be read.",
          );
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [file, kind, localFile]);

  const csvRows = useMemo(() => {
    if (kind !== "csv" || text === null) {
      return null;
    }

    return parseSpreadsheetText(text, file.displayName);
  }, [file.displayName, kind, text]);

  if (!kind) {
    return (
      <View className="min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-card p-sp-5 dark:border-border-dark dark:bg-card-dark">
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          No preview available for this file type.
        </Text>
      </View>
    );
  }

  // Images render bare — no framed card or border around them.
  if (kind === "image") {
    return (
      <View className="min-h-0 flex-1">
        <Image
          contentFit="contain"
          source={{ uri: localFile.uri }}
          style={{ flex: 1 }}
        />
      </View>
    );
  }

  return (
    <View className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card dark:border-border-dark dark:bg-card-dark">
      {loading ? kind === "csv" ? <CsvTableLoading /> : (
        <View className="items-center justify-center gap-3 py-16">
          <ActivityIndicator color={theme.text} size="small" />
          <Text className="font-sans text-sm" style={{ color: theme.textSecondary }}>Loading file…</Text>
        </View>
      ) : null}
      {error ? (
        <View className="flex-1 items-center justify-center p-sp-5">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {error}
          </Text>
        </View>
      ) : null}
      {!loading && !error && kind === "csv" && csvRows ? (
        <CsvTable rows={csvRows} />
      ) : null}
      {!loading && !error && kind === "text" && text !== null ? (
        <ScrollView className="flex-1">
          <Text
            selectable
            style={{
              color: theme.text,
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: 20,
              padding: 12,
            }}
          >
            {text}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}
