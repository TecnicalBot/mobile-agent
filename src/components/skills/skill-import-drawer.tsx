import * as DocumentPicker from "expo-document-picker";
import type { DocumentPickerAsset } from "expo-document-picker";
import { File } from "expo-file-system";
import { Archive, FileDown, FilePlus2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Markdown, { MarkdownIt } from "react-native-markdown-display";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  SKILL_FILE_MAX_COUNT,
  SKILL_FILE_MAX_TOTAL_BYTES,
  attachmentFromBytes,
  pickSkillFile,
  type SkillAttachment,
} from "@/modules/skills/skill-files";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import { findSkillImportConflict } from "@/modules/skills/skill-batch-import";
import {
  parseSkillArchive,
  SKILL_ARCHIVE_MAX_BYTES,
  type ArchivedSkill,
} from "@/modules/skills/skill-archive";
import { parseSkillMarkdown } from "@/modules/skills/skill-markdown";

const MARKDOWN_MAX_PREVIEW_LENGTH = 30_000;

const MARKDOWN_PICKER_TYPES = [
  "text/markdown",
  "text/x-markdown",
  "application/markdown",
  "public.markdown",
  "net.daringfireball.markdown",
  "public.plain-text",
];

const ZIP_PICKER_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
  "application/octet-stream",
  "public.zip-archive",
  "com.pkware.zip-archive",
];

const MARKDOWN_PARSER = MarkdownIt({
  breaks: true,
  linkify: true,
  typographer: true,
});

type BusyAction =
  | "file"
  | "files"
  | "url"
  | "import"
  | "archive"
  | "archiveImport";

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

export function SkillImportDrawer({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const theme = useTheme();
  const { importSkillBatch, importSkillMarkdown, skills } = useConfig();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [extraFilesText, setExtraFilesText] = useState("");
  const [localFiles, setLocalFiles] = useState<SkillAttachment[]>([]);
  const [skillDoc, setSkillDoc] = useState<SkillAttachment | null>(null);
  const [source, setSource] = useState<"file" | "url" | null>(null);
  const [archive, setArchive] = useState<{
    name: string;
    skills: ArchivedSkill[];
  } | null>(null);
  const [archiveSelected, setArchiveSelected] = useState<string[]>([]);
  const [archiveReplace, setArchiveReplace] = useState(false);
  const [archivePreview, setArchivePreview] = useState<string | null>(null);

  const markdownStyles = useMemo(
    () => createMarkdownStyles(theme),
    [theme],
  );

  const previewContent = useMemo(() => {
    if (!previewBody) {
      return null;
    }

    return previewBody.length > MARKDOWN_MAX_PREVIEW_LENGTH
      ? previewBody.slice(0, MARKDOWN_MAX_PREVIEW_LENGTH)
      : previewBody;
  }, [previewBody]);

  const archiveConflicts = useMemo(
    () =>
      (archive?.skills ?? []).filter(
        (skill) =>
          skill.parsed &&
          findSkillImportConflict(skills, skill.parsed.title) !== undefined,
      ),
    [archive, skills],
  );

  const selectedArchiveSkills = useMemo(
    () =>
      (archive?.skills ?? []).filter(
        (skill) =>
          !skill.error &&
          skill.markdown &&
          skill.parsed &&
          archiveSelected.includes(skill.path),
      ),
    [archive, archiveSelected],
  );

  const selectedArchiveConflicts = useMemo(
    () =>
      archiveConflicts.filter((skill) =>
        archiveSelected.includes(skill.path),
      ),
    [archiveConflicts, archiveSelected],
  );

  const archivePreviewSkill = useMemo(
    () =>
      archive?.skills.find((skill) => skill.path === archivePreview) ?? null,
    [archive, archivePreview],
  );

  const archivePreviewContent = useMemo(() => {
    if (!archivePreviewSkill?.parsed) {
      return null;
    }

    const body = [
      archivePreviewSkill.parsed.description ?? "",
      "",
      archivePreviewSkill.parsed.instructions.trim(),
    ].join("\n");

    return body.length > MARKDOWN_MAX_PREVIEW_LENGTH
      ? body.slice(0, MARKDOWN_MAX_PREVIEW_LENGTH)
      : body;
  }, [archivePreviewSkill]);

  const clearMarkdownState = () => {
    setContent(null);
    setPreviewBody(null);
    setTitle(null);
    setUrl("");
    setExtraFilesText("");
    setLocalFiles([]);
    setSkillDoc(null);
    setSource(null);
  };

  const clearArchiveState = () => {
    setArchive(null);
    setArchiveSelected([]);
    setArchiveReplace(false);
    setArchivePreview(null);
    setError(null);
  };

  const applyMarkdown = (markdown: string) => {
    const parsed = parseSkillMarkdown(markdown);

    setContent(markdown);
    setPreviewBody(
      [parsed.description ?? "", "", parsed.instructions.trim()].join("\n"),
    );
    setTitle(parsed.title);
    setError(null);
  };

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
        type: MARKDOWN_PICKER_TYPES,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0]!;
        const file = new File(asset.uri);
        applyMarkdown(await file.text());
        setSkillDoc(
          attachmentFromBytes({
            path: asset.name || "SKILL.md",
            bytes: new Uint8Array(await file.arrayBuffer()),
            mimeType: asset.mimeType ?? null,
          }),
        );
        setLocalFiles([]);
        setSource("file");
      }
    } catch (pickError) {
      setTitle(null);
      setContent(null);
      setPreviewBody(null);
      setSkillDoc(null);
      setSource(null);
      setError(
        pickError instanceof Error
          ? pickError.message
          : "Could not read the selected file.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handlePickFiles = async () => {
    if (busy) {
      return;
    }

    setBusy("files");
    setError(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: MARKDOWN_PICKER_TYPES,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const attachments: SkillAttachment[] = [];
      let totalBytes = 0;

      for (const asset of result.assets) {
        if (attachments.length >= SKILL_FILE_MAX_COUNT) {
          break;
        }

        const attachment = await readLocalAsset(asset);

        if (!attachment) {
          continue;
        }

        if (totalBytes + (attachment.size ?? 0) > SKILL_FILE_MAX_TOTAL_BYTES) {
          break;
        }

        attachments.push(attachment);
        totalBytes += attachment.size ?? 0;
      }

      const skillFileName = pickSkillFile(
        attachments.map((file) => ({
          name: file.path,
          content: file.content,
        })),
      );

      if (!skillFileName) {
        setTitle(null);
        setContent(null);
        setPreviewBody(null);
        setSource(null);
        setError(
          "Could not find a SKILL.md file in the selection. Pick a SKILL.md file plus any related files.",
        );
        return;
      }

      const skillAttachment = attachments.find(
        (file) => file.path === skillFileName,
      );

      applyMarkdown(skillAttachment?.content ?? "");
      setSkillDoc(skillAttachment ?? null);
      setSource("file");

      const sidecars: SkillAttachment[] = [];
      const seen = new Set<string>([skillFileName]);

      for (const file of attachments) {
        if (seen.has(file.path)) {
          continue;
        }
        seen.add(file.path);
        sidecars.push(file);
      }

      setLocalFiles(sidecars);
    } catch (pickError) {
      setTitle(null);
      setContent(null);
      setPreviewBody(null);
      setSkillDoc(null);
      setSource(null);
      setError(
        pickError instanceof Error
          ? pickError.message
          : "Could not read the selected files.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleFetchUrl = async () => {
    if (busy) {
      return;
    }

    setBusy("url");
    setError(null);

    try {
      const { content: markdown } = await fetchSkillMarkdownFromUrl(url);
      applyMarkdown(markdown);
      setLocalFiles([]);
      setSkillDoc(
        attachmentFromBytes({
          path: "SKILL.md",
          bytes: new Uint8Array(new TextEncoder().encode(markdown)),
          mimeType: "text/markdown",
        }),
      );
      setSource("url");
    } catch (fetchError) {
      setTitle(null);
      setContent(null);
      setPreviewBody(null);
      setSkillDoc(null);
      setSource(null);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Could not fetch the skill from that URL.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handlePickArchive = async () => {
    if (busy) {
      return;
    }

    setBusy("archive");
    setError(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ZIP_PICKER_TYPES,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0]!;

      if (asset.size && asset.size > SKILL_ARCHIVE_MAX_BYTES) {
        throw new Error(
          "The ZIP is too large. Choose an archive of at most 10 MB.",
        );
      }

      const file = new File(asset.uri);

      if (file.size > SKILL_ARCHIVE_MAX_BYTES) {
        throw new Error(
          "The ZIP is too large. Choose an archive of at most 10 MB.",
        );
      }

      const parsed = await parseSkillArchive(
        new Uint8Array(await file.arrayBuffer()),
      );
      const conflictPaths = new Set(
        parsed
          .filter(
            (skill) =>
              skill.parsed &&
              findSkillImportConflict(skills, skill.parsed.title) !== undefined,
          )
          .map((skill) => skill.path),
      );

      setArchive({ name: asset.name || "skills.zip", skills: parsed });
      setArchiveSelected(
        parsed
          .filter((skill) => !skill.error && !conflictPaths.has(skill.path))
          .map((skill) => skill.path),
      );
      setArchiveReplace(false);
      setArchivePreview(
        parsed.find((skill) => !skill.error)?.path ?? null,
      );
      clearMarkdownState();
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "Could not read the ZIP archive.",
      );
    } finally {
      setBusy(null);
    }
  };

  const toggleArchiveSkill = (path: string) => {
    setArchiveSelected((current) =>
      current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path],
    );
  };

  const handleArchiveReplaceChange = (checked: boolean) => {
    setArchiveReplace(checked);
    const conflictPaths = archiveConflicts.map((skill) => skill.path);

    setArchiveSelected((current) =>
      checked
        ? Array.from(new Set([...current, ...conflictPaths]))
        : current.filter((path) => !conflictPaths.includes(path)),
    );
  };

  const handleImportArchive = async () => {
    if (busy || !archive || selectedArchiveSkills.length === 0) {
      return;
    }

    if (selectedArchiveConflicts.length > 0 && !archiveReplace) {
      setError("Confirm replacement of existing skills before importing.");
      return;
    }

    setBusy("archiveImport");
    setError(null);

    try {
      const result = await importSkillBatch(
        selectedArchiveSkills.map((skill) => ({
          path: skill.path,
          markdown: skill.markdown as string,
          files: skill.files,
          replaceById: archiveReplace
            ? (findSkillImportConflict(skills, skill.parsed!.title)?.id ?? null)
            : null,
        })),
      );

      if (result.failed.length > 0) {
        setError(
          [
            `${result.imported.length} imported, ${result.failed.length} failed.`,
            ...result.failed.map(
              (failure) => `${failure.title}: ${failure.error}`,
            ),
          ].join("\n"),
        );
        setArchiveSelected(result.failed.map((failure) => failure.path));
        return;
      }

      clearArchiveState();
      onOpenChange(false);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import the skills.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      clearArchiveState();
    }

    onOpenChange(next);
  };

  const handleImport = async () => {
    if (busy || !content || !title) {
      return;
    }

    setBusy("import");
    setError(null);

    try {
      const existing = skills.find(
        (skill) => skill.title.toLowerCase() === title.toLowerCase(),
      );

      await importSkillMarkdown({
        markdown: content,
        replaceById: existing?.id ?? null,
        sourceUrl: url.trim() || null,
        extraFiles: extraFilesText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        localFiles: [
          ...(skillDoc ? [skillDoc] : []),
          ...localFiles.map((file) => ({
            path: file.path,
            content: file.content,
            mimeType: file.mimeType,
            size: file.size,
          })),
        ],
      });

      setUrl("");
      setExtraFilesText("");
      setLocalFiles([]);
      setSkillDoc(null);
      setContent(null);
      setPreviewBody(null);
      setTitle(null);
      setSource(null);
      onOpenChange(false);
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : "Import failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  const willReplace =
    title !== null &&
    skills.some(
      (skill) => skill.title.toLowerCase() === title.toLowerCase(),
    );

  return (
    <Drawer onOpenChange={handleOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Import skills</DrawerTitle>
          <DrawerDescription>
            Upload a ZIP bundle with one or more skills, or import a single
            SKILL.md.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          {archive ? (
            <>
              <View className="flex-row items-center gap-sp-2">
                <View className="min-w-0 flex-1 gap-1">
                  <Text
                    className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark"
                    numberOfLines={1}
                  >
                    {archive.name}
                  </Text>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {archive.skills.length}{" "}
                    {archive.skills.length === 1 ? "skill" : "skills"} found
                  </Text>
                </View>
                <Button
                  disabled={busy !== null}
                  onPress={handlePickArchive}
                  size="sm"
                  variant="ghost"
                >
                  Change
                </Button>
                <Button
                  disabled={busy !== null}
                  onPress={clearArchiveState}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </View>

              {archiveConflicts.length > 0 ? (
                <View className="gap-sp-2 rounded-ui border border-border bg-background px-sp-3 py-sp-3 dark:border-border-dark dark:bg-background-dark">
                  <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                    {archiveConflicts.length}{" "}
                    {archiveConflicts.length === 1
                      ? "skill already exists"
                      : "skills already exist"}{" "}
                    with the same name. Confirm before importing.
                  </Text>
                  <Checkbox
                    checked={archiveReplace}
                    labelClassName="text-sm"
                    onCheckedChange={handleArchiveReplaceChange}
                  >
                    Replace existing skills
                  </Checkbox>
                </View>
              ) : null}

              <View className="gap-sp-2">
                {archive.skills.map((skill) => {
                  const selected = archiveSelected.includes(skill.path);
                  const conflict = archiveConflicts.some(
                    (item) => item.path === skill.path,
                  );
                  const sidecarCount = skill.files.filter(
                    (file) => file.path !== "SKILL.md",
                  ).length;
                  const disabled =
                    Boolean(skill.error) || (conflict && !archiveReplace);

                  return (
                    <View
                      className="overflow-hidden rounded-ui border border-border bg-background dark:border-border-dark dark:bg-background-dark"
                      key={skill.path}
                    >
                      <View className="flex-row items-start gap-sp-3 px-sp-3 py-sp-3">
                        <Checkbox
                          checked={selected}
                          disabled={disabled}
                          onCheckedChange={() => toggleArchiveSkill(skill.path)}
                        />
                        <Pressable
                          accessibilityRole="button"
                          className="min-w-0 flex-1 gap-1"
                          onPress={() => setArchivePreview(skill.path)}
                          style={({ pressed }) =>
                            pressed ? { opacity: 0.84 } : null
                          }
                        >
                          <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                            {skill.parsed?.title ?? skill.path}
                          </Text>
                          {skill.parsed?.description ? (
                            <Text
                              className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                              numberOfLines={2}
                            >
                              {skill.parsed.description}
                            </Text>
                          ) : null}
                          <Text
                            className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                            numberOfLines={1}
                          >
                            {skill.path} · {sidecarCount}{" "}
                            {sidecarCount === 1 ? "file" : "files"}
                          </Text>
                          {skill.error ? (
                            <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
                              {skill.error}
                            </Text>
                          ) : conflict ? (
                            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                              {archiveReplace
                                ? "Replaces an existing skill."
                                : "Existing skill — confirm replacement to select."}
                            </Text>
                          ) : null}
                        </Pressable>
                      </View>
                      {archivePreview === skill.path && archivePreviewContent ? (
                        <View className="gap-sp-2 border-t border-border px-sp-3 py-sp-3 dark:border-border-dark">
                          <Markdown
                            markdownit={MARKDOWN_PARSER}
                            onLinkPress={(link) => {
                              Linking.openURL(link).catch(console.error);
                              return true;
                            }}
                            style={markdownStyles}
                          >
                            {archivePreviewContent}
                          </Markdown>
                          {archivePreviewSkill?.parsed &&
                          archivePreviewSkill.parsed.instructions.length >
                            MARKDOWN_MAX_PREVIEW_LENGTH ? (
                            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                              Preview truncated — the full skill will be
                              imported.
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </>
          ) : (
            <>
              <Button
                leftIcon={<Archive color={theme.text} size={16} />}
                loading={busy === "archive"}
                onPress={handlePickArchive}
                variant="outline"
              >
                Choose ZIP bundle
              </Button>
              <View className="flex-row items-center gap-sp-3 py-sp-1">
                <View className="h-px flex-1 bg-border dark:bg-border-dark" />
                <Text className="font-sans text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
                  OR
                </Text>
                <View className="h-px flex-1 bg-border dark:bg-border-dark" />
              </View>
              <Button
                leftIcon={<FileDown color={theme.text} size={16} />}
                loading={busy === "file"}
                onPress={handlePickFile}
                variant="outline"
              >
                Choose SKILL.md file
              </Button>
              {source === "file" ? (
                <View className="-mt-sp-3 flex-row justify-end">
                  <Button
                    leftIcon={
                      <FilePlus2 color={theme.textSecondary} size={14} />
                    }
                    loading={busy === "files"}
                    onPress={handlePickFiles}
                    size="sm"
                    variant="ghost"
                  >
                    Add related files
                  </Button>
                </View>
              ) : null}
              {localFiles.length > 0 ? (
                <View className="gap-sp-1 rounded-ui border border-border bg-background px-sp-3 py-sp-2 dark:border-border-dark dark:bg-background-dark">
                  <Text className="font-sans text-xs font-medium text-foreground dark:text-foreground-dark">
                    {localFiles.length}{" "}
                    {localFiles.length === 1
                      ? "related file"
                      : "related files"}{" "}
                    ready
                  </Text>
                  {localFiles.slice(0, 5).map((file) => (
                    <Text
                      className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                      key={file.path}
                      numberOfLines={1}
                    >
                      {file.path}
                    </Text>
                  ))}
                  {localFiles.length > 5 ? (
                    <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      +{localFiles.length - 5} more
                    </Text>
                  ) : null}
                </View>
              ) : null}
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
                  placeholder="SKILL.md URL"
                  value={url}
                />
                <Button
                  loading={busy === "url"}
                  onPress={handleFetchUrl}
                  variant="outline"
                >
                  Install
                </Button>
                {url.trim().length > 0 ? (
                  <Textarea
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="min-h-20"
                    onChangeText={(value) => {
                      setExtraFilesText(value);
                      setError(null);
                    }}
                    placeholder="Add related files, one URL per line (optional)"
                    value={extraFilesText}
                  />
                ) : null}
              </View>
              {previewContent ? (
                <View className="gap-sp-2 rounded-ui border border-border bg-background px-sp-3 py-sp-3 dark:border-border-dark dark:bg-background-dark">
                  {willReplace ? (
                    <Text className="font-sans text-xs font-medium text-foreground dark:text-foreground-dark">
                      A skill with this name already exists. Importing will
                      replace it.
                    </Text>
                  ) : null}
                  <Markdown
                    markdownit={MARKDOWN_PARSER}
                    onLinkPress={(link) => {
                      Linking.openURL(link).catch(console.error);
                      return true;
                    }}
                    style={markdownStyles}
                  >
                    {previewContent}
                  </Markdown>
                  {previewBody &&
                  previewBody.length > MARKDOWN_MAX_PREVIEW_LENGTH ? (
                    <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      Preview truncated — the full skill will be imported.
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
          {error ? (
            <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
              {error}
            </Text>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          {archive ? (
            <Button
              disabled={
                selectedArchiveSkills.length === 0 ||
                (selectedArchiveConflicts.length > 0 && !archiveReplace)
              }
              loading={busy === "archiveImport"}
              onPress={handleImportArchive}
            >
              {selectedArchiveSkills.length > 0
                ? `Import (${selectedArchiveSkills.length})`
                : "Import"}
            </Button>
          ) : (
            <Button
              disabled={!title}
              loading={busy === "import"}
              onPress={handleImport}
            >
              Import
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function createMarkdownStyles(theme: ReturnType<typeof useTheme>) {
  return {
    body: {
      color: theme.text,
      fontFamily: "System",
      fontSize: 15,
      lineHeight: 22,
      margin: 0,
    },
    bullet_list: {
      marginBottom: 10,
      marginTop: 2,
    },
    bullet_list_content: {
      flex: 1,
    },
    bullet_list_icon: {
      color: theme.text,
      marginRight: 8,
      width: 12,
    },
    ordered_list: {
      marginBottom: 10,
      marginTop: 2,
    },
    ordered_list_icon: {
      color: theme.text,
      marginRight: 8,
      width: 12,
    },
    code_block: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 12,
      color: theme.text,
      fontFamily: "monospace",
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 10,
      marginTop: 4,
      padding: 10,
    },
    code_inline: {
      backgroundColor: theme.backgroundSelected,
      borderRadius: 6,
      color: theme.text,
      fontFamily: "monospace",
      fontSize: 13,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    fence: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 12,
      color: theme.text,
      fontFamily: "monospace",
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 10,
      marginTop: 4,
      padding: 10,
    },
    blockquote: {
      borderColor: theme.border,
      borderLeftWidth: 3,
      color: theme.textSecondary,
      marginBottom: 10,
      marginTop: 2,
      paddingLeft: 10,
    },
    heading1: {
      color: theme.text,
      fontSize: 20,
      fontWeight: "700",
      lineHeight: 27,
      marginBottom: 6,
      marginTop: 8,
    },
    heading2: {
      color: theme.text,
      fontSize: 18,
      fontWeight: "700",
      lineHeight: 25,
      marginBottom: 6,
      marginTop: 8,
    },
    heading3: {
      color: theme.text,
      fontSize: 16,
      fontWeight: "700",
      lineHeight: 23,
      marginBottom: 4,
      marginTop: 6,
    },
    heading4: {
      color: theme.text,
      fontSize: 15,
      fontWeight: "700",
      lineHeight: 22,
      marginBottom: 4,
      marginTop: 6,
    },
    heading5: {
      color: theme.text,
      fontSize: 14,
      fontWeight: "700",
      lineHeight: 21,
      marginBottom: 4,
      marginTop: 6,
    },
    heading6: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 20,
      marginBottom: 4,
      marginTop: 6,
    },
    hr: {
      backgroundColor: theme.border,
      height: 1,
      marginBottom: 12,
      marginTop: 8,
    },
    link: {
      color: theme.text,
      textDecorationLine: "underline",
    },
    paragraph: {
      marginBottom: 10,
      marginTop: 0,
    },
    strong: {
      fontWeight: "700",
    },
    em: {
      fontStyle: "italic",
    },
  } satisfies StyleSheet.NamedStyles<any>;
}
