import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { TextInputWrapper, type PasteEventPayload } from "expo-paste-input";
import { useRouter } from "expo-router";
import {
  ArrowDown,
  Bookmark,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  Edit,
  FolderOpen,
  Info,
  Paperclip,
  Send,
  Server,
  StopCircle,
  Trash2,
  Upload,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { Container } from "@/components/shared/container";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { ChatErrorBoundary } from "@/components/ui/chat-error-boundary";
import { ChatMessage } from "@/components/ui/chat-message";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerList,
  MessageScrollerProvider,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import type {
  ExternalFolderSession,
  McpServerConfig,
  ModelRef,
  ReasoningEffort,
  SavedPrompt,
  SkillConfig,
  WorkspaceFile,
} from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useAppState } from "@/hooks/use-app-state";
import { useChat } from "@/hooks/use-chat";
import { useChatInfo } from "@/hooks/use-chat-info";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { detectFolderIntent } from "@/modules/chat/folder-intent";
import { partitionSelectedFiles } from "@/modules/runtime/message-conversion";

const REASONING_EFFORT_OPTIONS: {
  value: ReasoningEffort;
  label: string;
  description: string;
}[] = [
  {
    value: "none",
    label: "Off",
    description: "Do not request model reasoning",
  },
  {
    value: "minimal",
    label: "Minimal",
    description: "Use the lowest available reasoning level",
  },
  { value: "low", label: "Low", description: "Use light reasoning" },
  {
    value: "medium",
    label: "Medium",
    description: "Balance reasoning quality and speed (default)",
  },
  { value: "high", label: "High", description: "Use deeper reasoning" },
  {
    value: "xhigh",
    label: "Extra high",
    description: "Use the highest available reasoning level",
  },
];

function getReasoningEffortLabel(effort: ReasoningEffort) {
  return (
    REASONING_EFFORT_OPTIONS.find((option) => option.value === effort)?.label ??
    "Medium"
  );
}

function getComposerTrigger(prompt: string) {
  const match = /(^|\s)([@/])([^\s@/]*)$/.exec(prompt);

  if (!match) {
    return null;
  }

  return {
    kind: match[2] === "@" ? "mention" : "slash",
    query: match[3].toLowerCase(),
  } as const;
}

function clearComposerTrigger(prompt: string) {
  return prompt.replace(/(^|\s)[@/][^\s@/]*$/, "$1").replace(/\s+$/, "");
}

function matchesMenuQuery(
  query: string,
  label: string,
  subtitle?: string,
  keywords: string[] = [],
) {
  if (!query) {
    return true;
  }

  const haystack = [label, subtitle ?? "", ...keywords].join(" ").toLowerCase();
  return haystack.includes(query);
}

const STARTER_PROMPTS = [
  "Design a landing page",
  "Draft a professional email",
  "Brainstorm ideas for a side project",
  "Remember that I prefer concise answers",
];

function logComposerDebug(label: string, data: Record<string, unknown>) {
  if (!__DEV__) {
    return;
  }
  console.log(`[Composer:${label}]`, JSON.stringify(data));
}

export default function Screen() {
  const router = useRouter();
  const theme = useTheme();
  const { error, ready } = useAppState();
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);
  const {
    activeModels,
    currentModel,
    currentModelSupportsImageGeneration,
    currentModelSupportsImageInput,
    currentModelSupportsTools,
    currentSelectedMcpServerIds,
    mcpServers,
    selectModel,
    setCurrentSelectedMcpServerIds,
    toolApprovalMode,
    updateToolApprovalMode,
  } = useConfig();
  const chatInfo = useChatInfo();
  const {
    approvePendingToolApproval,
    denyPendingToolApproval,
    clearConversationFolder,
    clearWorkspaceFiles,
    deleteWorkspaceFile,
    currentConversation,
    currentConversationRunStatus,
    currentExternalFolderSession,
    currentSelectedFileIds,
    currentSelectedSkillIds,
    messages,
    pendingToolApproval,
    pickConversationFolder,
    sendMessage,
    stopSending,
    createConversation,
    setCurrentSelectedFileIds,
    setCurrentSelectedSkillIds,
    skills,
    workspaceFiles,
    importFiles,
    refreshWorkspaceFiles,
    reasoningEffort,
    savedPrompts,
    setReasoningEffort,
  } = useChat();
  const currentConversationBusy =
    currentConversationRunStatus === "queued" ||
    currentConversationRunStatus === "running" ||
    currentConversationRunStatus === "waiting_for_approval" ||
    currentConversationRunStatus === "resumable" ||
    currentConversationRunStatus === "retrying";

  return (
    <ChatErrorBoundary>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <Container
          contentClassName="flex-1 gap-sp-4 !px-4"
          includeBottomTabInset={false}
        >
          <View className="flex-row items-center justify-between gap-sp-3">
            <View className="flex flex-row gap-2">
              <SidebarTrigger />
              <Button onPress={createConversation} size="icon" variant="ghost">
                <Edit color={theme.text} />
              </Button>
            </View>
            <Button
              onPress={() => {
                setInfoDrawerOpen(true);
              }}
              size="icon"
              variant="ghost"
            >
              <Info color={theme.text} size={18} />
            </Button>
          </View>

          <MessageScrollerProvider
            key={currentConversation?.id ?? "new-chat"}
            initialScrollToEnd
          >
            <MessageScroller className="flex-1 rounded-none border-0">
              {!ready ? (
                <View
                  accessibilityLiveRegion="polite"
                  className="flex-1 items-center justify-center gap-sp-3"
                >
                  <ActivityIndicator color={theme.textSecondary} size="small" />
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    Loading chat…
                  </Text>
                </View>
              ) : (
                <>
                  <MessageScrollerList
                    contentContainerClassName="py-sp-3 pb-12"
                    data={messages}
                    keyExtractor={(message) => message.id}
                    renderItem={({ item: message }) => (
                      <ChatMessage
                        message={message}
                        onSavePrompt={(content) => {
                          router.push({
                            pathname: "/settings/prompts",
                            params: { text: content },
                          } as never);
                        }}
                        workspaceFiles={workspaceFiles}
                      />
                    )}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                      currentModel ? (
                        <View className="gap-sp-3 py-sp-5">
                          <View>
                            {STARTER_PROMPTS.map((prompt) => (
                              <Button
                                key={prompt}
                                className="justify-start"
                                onPress={() =>
                                  sendMessage({
                                    content: prompt,
                                  }).catch(console.error)
                                }
                                variant="ghost"
                              >
                                {prompt}
                              </Button>
                            ))}
                          </View>
                        </View>
                      ) : (
                        <View className="items-center gap-sp-3 px-sp-3 py-sp-8">
                          <Text className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
                            Connect your first model
                          </Text>
                          <Text className="font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
                            Choose a provider to start chatting.
                          </Text>
                          <Button
                            onPress={() => router.push("/settings")}
                            variant="ghost"
                          >
                            Manage providers
                          </Button>
                        </View>
                      )
                    }
                    ListFooterComponent={<View className="h-sp-1" />}
                  />
                  {messages.length > 0 ? (
                    <MessageScrollerButton
                      accessibilityLabel="Jump to latest"
                      className="h-10 w-10 rounded-full px-0"
                    >
                      <ArrowDown color={theme.text} size={18} />
                    </MessageScrollerButton>
                  ) : null}
                </>
              )}
            </MessageScroller>

            {error ? (
              <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                {error}
              </Text>
            ) : null}

            <ChatInput
              canSend={ready && currentModel !== null}
              currentModelLabel={
                currentModel
                  ? `${currentModel.providerLabel} · ${currentModel.label}`
                  : null
              }
              activeModels={activeModels.map((model) => ({
                label: model.label,
                providerLabel: model.providerLabel,
                ref: model.ref,
              }))}
              currentModelRef={currentModel?.ref ?? null}
              importFiles={importFiles}
              loading={currentConversationBusy}
              onCreateConversation={createConversation}
              onOpenSettings={() => {
                router.push("/settings");
              }}
              currentExternalFolderSession={currentExternalFolderSession}
              onSend={sendMessage}
              onStop={stopSending}
              pickConversationFolder={pickConversationFolder}
              clearConversationFolder={clearConversationFolder}
              clearWorkspaceFiles={clearWorkspaceFiles}
              deleteWorkspaceFile={deleteWorkspaceFile}
              refreshWorkspaceFiles={refreshWorkspaceFiles}
              selectModel={selectModel}
              selectedFileIds={currentSelectedFileIds}
              setSelectedFileIds={setCurrentSelectedFileIds}
              selectedSkillIds={currentSelectedSkillIds}
              setSelectedSkillIds={setCurrentSelectedSkillIds}
              skills={skills}
              supportsImageGeneration={currentModelSupportsImageGeneration}
              supportsImageInput={currentModelSupportsImageInput}
              supportsTools={currentModelSupportsTools}
              mcpServers={mcpServers}
              selectedMcpServerIds={currentSelectedMcpServerIds}
              setSelectedMcpServerIds={setCurrentSelectedMcpServerIds}
              onOpenMcpSettings={() => {
                router.push("/settings/mcp" as never);
              }}
              reasoningEffort={reasoningEffort}
              savedPrompts={savedPrompts}
              setReasoningEffort={setReasoningEffort}
              toolApprovalMode={toolApprovalMode}
              updateToolApprovalMode={updateToolApprovalMode}
              workspaceFiles={workspaceFiles}
            />
          </MessageScrollerProvider>

          <Drawer dismissible={false} open={pendingToolApproval !== null}>
            <DrawerContent
              closeOnOverlayPress={false}
              showCloseButton={false}
              showHandle={false}
            >
              <DrawerHeader>
                <DrawerTitle>Tool approval</DrawerTitle>
                <DrawerDescription>
                  Paused in {pendingToolApproval?.chatTitle ?? "this chat"}{" "}
                  until you decide.
                </DrawerDescription>
              </DrawerHeader>
              <DrawerBody
                className="flex-0"
                contentContainerClassName="gap-sp-3"
              >
                <View className="gap-sp-2 rounded-ui border border-border bg-card px-sp-4 py-sp-3 dark:border-border-dark dark:bg-card-dark">
                  <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                    {formatToolName(pendingToolApproval?.toolName ?? "")}
                  </Text>
                  {pendingToolApproval?.inputSummary ? (
                    <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      {pendingToolApproval.inputSummary}
                    </Text>
                  ) : null}
                </View>
              </DrawerBody>
              <DrawerFooter>
                <View className="flex-row gap-sp-2">
                  <Button
                    className="flex-1"
                    onPress={denyPendingToolApproval}
                    variant="outline"
                  >
                    Deny
                  </Button>
                  <Button
                    className="flex-1"
                    onPress={approvePendingToolApproval}
                  >
                    Allow once
                  </Button>
                </View>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          <Drawer onOpenChange={setInfoDrawerOpen} open={infoDrawerOpen}>
            <DrawerContent showCloseButton showHandle>
              <DrawerHeader>
                <DrawerTitle>Chat info</DrawerTitle>
                <DrawerDescription>
                  Model, usage, context, and cost for this conversation.
                </DrawerDescription>
              </DrawerHeader>
              <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
                <InfoSection title="Model">
                  <InfoRow
                    label="Provider"
                    value={
                      chatInfo.currentModel?.providerLabel ?? "Unavailable"
                    }
                  />
                  <InfoRow
                    label="Selected model"
                    value={chatInfo.currentModel?.modelLabel ?? "Unavailable"}
                  />
                  <InfoRow
                    label="Reasoning"
                    value={getReasoningEffortLabel(reasoningEffort)}
                  />
                </InfoSection>

                <InfoSection title="Latest turn">
                  <InfoRow
                    label="Input tokens"
                    value={formatTokenCount(
                      chatInfo.latestTurn?.inputTokens ?? null,
                    )}
                  />
                  <InfoRow
                    label="Output tokens"
                    value={formatTokenCount(
                      chatInfo.latestTurn?.outputTokens ?? null,
                    )}
                  />
                  <InfoRow
                    label="Total tokens"
                    value={formatTokenCount(
                      chatInfo.latestTurn?.totalTokens ?? null,
                    )}
                  />
                  <InfoRow
                    label="Cost"
                    value={formatCurrency(
                      chatInfo.latestTurn?.costTotal ?? null,
                    )}
                  />
                </InfoSection>

                <InfoSection
                  subtitle={
                    chatInfo.conversationTotals?.isPartial
                      ? "Partial data"
                      : undefined
                  }
                  title="Conversation totals"
                >
                  <InfoRow
                    label="Input tokens"
                    value={formatTokenCount(
                      chatInfo.conversationTotals?.inputTokens ?? null,
                    )}
                  />
                  <InfoRow
                    label="Output tokens"
                    value={formatTokenCount(
                      chatInfo.conversationTotals?.outputTokens ?? null,
                    )}
                  />
                  <InfoRow
                    label="Total tokens"
                    value={formatTokenCount(
                      chatInfo.conversationTotals?.totalTokens ?? null,
                    )}
                  />
                  <InfoRow
                    label="Cost"
                    value={formatCurrency(
                      chatInfo.conversationTotals?.costTotal ?? null,
                    )}
                  />
                </InfoSection>

                <InfoSection title="Context">
                  <InfoRow
                    label="Context window"
                    value={formatTokenCount(
                      chatInfo.latestTurn?.contextWindow ??
                        chatInfo.currentModel?.contextWindow ??
                        null,
                    )}
                  />
                  <InfoRow
                    label="Used"
                    value={formatTokenCount(
                      chatInfo.latestTurn?.totalTokens ?? null,
                    )}
                  />
                  <InfoRow
                    label="Remaining"
                    value={formatTokenCount(
                      chatInfo.latestTurn?.remainingContext ?? null,
                    )}
                  />
                  <InfoRow
                    label="Usage"
                    value={formatPercent(
                      chatInfo.latestTurn?.contextUsagePercent ?? null,
                    )}
                  />
                </InfoSection>
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        </Container>
      </KeyboardAvoidingView>
    </ChatErrorBoundary>
  );
}

function formatTokenCount(value: number | null) {
  if (value === null) {
    return "Unavailable";
  }

  return Math.round(value).toLocaleString();
}

function formatCurrency(value: number | null) {
  if (value === null) {
    return "Unavailable";
  }

  if (value > 0 && value < 0.000001) {
    return "< $0.000001";
  }

  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "Unavailable";
  }

  return `${value.toFixed(1)}%`;
}

function formatToolName(toolName: string) {
  if (!toolName) {
    return "Tool";
  }

  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function InfoSection({
  children,
  subtitle,
  title,
}: {
  children: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <View className="gap-sp-2 rounded-ui border border-border bg-card px-sp-4 py-sp-3 dark:border-border-dark dark:bg-card-dark">
      <View className="gap-1">
        <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
          {title}
        </Text>
        {subtitle ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-sp-3">
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {label}
      </Text>
      <Text className="max-w-44 text-right font-sans text-sm text-foreground dark:text-foreground-dark">
        {value}
      </Text>
    </View>
  );
}

function ChatInput({
  activeModels,
  canSend,
  currentExternalFolderSession,
  currentModelLabel,
  currentModelRef,
  importFiles,
  loading,
  mcpServers,
  onCreateConversation,
  onOpenMcpSettings,
  onOpenSettings,
  onSend,
  onStop,
  pickConversationFolder,
  clearConversationFolder,
  clearWorkspaceFiles,
  deleteWorkspaceFile,
  refreshWorkspaceFiles,
  selectModel,
  selectedFileIds,
  selectedMcpServerIds,
  setSelectedMcpServerIds,
  selectedSkillIds,
  setSelectedFileIds,
  setSelectedSkillIds,
  skills,
  supportsImageGeneration,
  supportsImageInput,
  supportsTools,
  reasoningEffort,
  savedPrompts,
  setReasoningEffort,
  toolApprovalMode,
  updateToolApprovalMode,
  workspaceFiles,
}: {
  activeModels: Array<{
    label: string;
    providerLabel: string;
    ref: ModelRef;
  }>;
  canSend: boolean;
  clearConversationFolder: () => Promise<void>;
  clearWorkspaceFiles: () => Promise<void>;
  deleteWorkspaceFile: (fileId: string) => Promise<void>;
  currentExternalFolderSession: ExternalFolderSession | null;
  currentModelLabel: string | null;
  currentModelRef: ModelRef | null;
  importFiles: typeof useChat extends () => infer T
    ? T extends { importFiles: infer F }
      ? F
      : never
    : never;
  loading: boolean;
  mcpServers: McpServerConfig[];
  onCreateConversation: () => Promise<void>;
  onOpenMcpSettings: () => void;
  onOpenSettings: () => void;
  onSend: (input: {
    content: string;
    fileContextSource?: "external-folder" | "workspace";
    selectedFileIds?: string[];
  }) => Promise<void>;
  onStop: () => Promise<void>;
  pickConversationFolder: () => Promise<ExternalFolderSession>;
  refreshWorkspaceFiles: () => Promise<void>;
  selectModel: (modelRef: ModelRef) => Promise<void>;
  selectedFileIds: string[];
  selectedMcpServerIds: string[] | null;
  setSelectedMcpServerIds: (
    selectedMcpServerIds: string[] | null,
  ) => Promise<void>;
  selectedSkillIds: string[];
  setSelectedFileIds: (selectedFileIds: string[]) => Promise<void>;
  setSelectedSkillIds: (selectedSkillIds: string[]) => Promise<void>;
  skills: SkillConfig[];
  supportsImageGeneration: boolean;
  supportsImageInput: boolean;
  supportsTools: boolean;
  reasoningEffort: ReasoningEffort;
  savedPrompts: SavedPrompt[];
  setReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
  toolApprovalMode: "ask" | "auto";
  updateToolApprovalMode: (mode: "ask" | "auto") => Promise<void>;
  workspaceFiles: WorkspaceFile[];
}) {
  const theme = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const { scrollToEnd } = useMessageScroller();
  const sendingRef = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [composerContentHeight, setComposerContentHeight] = useState(0);
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);
  const [modelsDrawerOpen, setModelsDrawerOpen] = useState(false);
  const [reasoningDrawerOpen, setReasoningDrawerOpen] = useState(false);
  const [skillsDrawerOpen, setSkillsDrawerOpen] = useState(false);
  const [mcpServersDrawerOpen, setMcpServersDrawerOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<
    null | "clear" | "import" | "folder" | "paste"
  >(null);
  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  const [approvalModeDrawerOpen, setApprovalModeDrawerOpen] = useState(false);
  const [slashMenuView, setSlashMenuView] = useState<
    "commands" | "saved-prompts"
  >("commands");
  const [localWorkspaceFiles, setLocalWorkspaceFiles] = useState<
    WorkspaceFile[]
  >([]);
  const [pendingFolderSend, setPendingFolderSend] = useState<null | {
    content: string;
    selectedFileIds: string[];
  }>(null);

  const maxComposerInputHeight = Math.min(320, screenHeight * 0.35);
  const composerInputHeight = Math.min(
    maxComposerInputHeight,
    Math.max(76, composerContentHeight),
  );
  const composerScrollEnabled = composerContentHeight > maxComposerInputHeight;

  const composerTrigger = useMemo(() => getComposerTrigger(prompt), [prompt]);
  const modelGroups = useMemo(() => {
    const groups = new Map<string, typeof activeModels>();

    for (const model of activeModels) {
      const providerModels = groups.get(model.providerLabel) ?? [];
      providerModels.push(model);
      groups.set(model.providerLabel, providerModels);
    }

    return [...groups.entries()];
  }, [activeModels]);
  const mergedWorkspaceFiles = useMemo(() => {
    const map = new Map(workspaceFiles.map((file) => [file.id, file]));

    for (const file of localWorkspaceFiles) {
      map.set(file.id, file);
    }

    return [...map.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [localWorkspaceFiles, workspaceFiles]);
  const filesDrawerSize = Math.min(
    Math.floor(screenHeight * 0.9),
    Math.max(420, 380 + mergedWorkspaceFiles.length * 52),
  );

  useEffect(() => {
    setLocalWorkspaceFiles((current) =>
      current.filter(
        (file) => !workspaceFiles.some((item) => item.id === file.id),
      ),
    );
  }, [workspaceFiles]);

  useEffect(() => {
    if (composerTrigger?.kind !== "slash") {
      setSlashMenuView("commands");
    }
  }, [composerTrigger?.kind]);

  useEffect(() => {
    if (!filesDrawerOpen) {
      return;
    }

    refreshWorkspaceFiles().catch(console.error);
  }, [filesDrawerOpen, refreshWorkspaceFiles]);

  const selectedFiles = mergedWorkspaceFiles
    .filter((file) => selectedFileIds.includes(file.id))
    .sort(
      (left, right) =>
        selectedFileIds.indexOf(left.id) - selectedFileIds.indexOf(right.id),
    );
  const selectedAttachmentBuckets = useMemo(
    () => partitionSelectedFiles(selectedFiles),
    [selectedFiles],
  );
  const activeFolderLabel = currentExternalFolderSession?.displayName ?? null;
  const enabledSkills = skills.filter((skill) => skill.enabled);
  const selectedSkills = enabledSkills.filter((skill) =>
    selectedSkillIds.includes(skill.id),
  );
  const enabledMcpServers = mcpServers.filter((server) => server.enabled);
  const activeMcpServerIds = new Set(
    selectedMcpServerIds === null
      ? enabledMcpServers.map((server) => server.id)
      : selectedMcpServerIds.filter((serverId) =>
          enabledMcpServers.some((server) => server.id === serverId),
        ),
  );

  const toggleMcpServer = async (serverId: string) => {
    if (selectedMcpServerIds === null) {
      await setSelectedMcpServerIds(
        activeMcpServerIds.has(serverId)
          ? enabledMcpServers
              .map((server) => server.id)
              .filter((id) => id !== serverId)
          : [
              ...new Set([
                ...enabledMcpServers.map((server) => server.id),
                serverId,
              ]),
            ],
      );
      return;
    }

    await setSelectedMcpServerIds(
      activeMcpServerIds.has(serverId)
        ? selectedMcpServerIds.filter((id) => id !== serverId)
        : [...new Set([...selectedMcpServerIds, serverId])],
    );
  };

  const canAttachSelectedFiles =
    !(selectedAttachmentBuckets.imageFiles.length > 0 && !supportsImageInput) &&
    !(selectedAttachmentBuckets.binaryFiles.length > 0 && !supportsTools);

  const handleGenerate = async () => {
    if (sendingRef.current) {
      logComposerDebug("handle-generate-duplicate", {});
      return;
    }

    const cleanPrompt = prompt.trim();
    const folderIntent = detectFolderIntent(cleanPrompt);
    const nextFileContextSource =
      selectedFileIds.length > 0
        ? "workspace"
        : currentExternalFolderSession
          ? "external-folder"
          : folderIntent.requiresFolderAccess
            ? "external-folder"
            : "workspace";

    if (
      loading ||
      !canSend ||
      (!cleanPrompt && selectedFileIds.length === 0) ||
      !canAttachSelectedFiles
    ) {
      const reason = loading
        ? "loading"
        : !canSend
          ? "canSend"
          : !canAttachSelectedFiles
            ? "canAttachSelectedFiles"
            : "empty";
      logComposerDebug("handle-generate-blocked", {
        canAttachSelectedFiles,
        canSend,
        cleanPromptLength: cleanPrompt.length,
        hasSelectedFiles: selectedFileIds.length > 0,
        loading,
        promptLength: prompt.length,
        reason,
        selectedFileIds,
      });
      if (__DEV__) {
        Alert.alert(
          "Send blocked",
          `Reason: ${reason}\nloading: ${loading}\ncanSend: ${canSend}\ncanAttach: ${canAttachSelectedFiles}`,
        );
      }
      return;
    }

    const previousPrompt = prompt;
    const previousSelectedFileIds = selectedFileIds;

    if (folderIntent.requiresFolderAccess) {
      if (!supportsTools) {
        setFolderNotice(
          "Folder actions need an API-key-backed model. Switch models in Settings first.",
        );
        return;
      }

      if (Platform.OS !== "android") {
        setFolderNotice(
          "Picked-folder agent access is Android-only right now. Use @ file actions to work in the app workspace on this platform.",
        );
        return;
      }

      if (!currentExternalFolderSession) {
        setPendingFolderSend({
          content: cleanPrompt,
          selectedFileIds: previousSelectedFileIds,
        });
        setFolderDrawerOpen(true);
        setFolderNotice(null);
        return;
      }
    }

    sendingRef.current = true;
    setPrompt("");

    try {
      await setSelectedFileIds([]);
      scrollToEnd();

      await onSend({
        content: cleanPrompt,
        fileContextSource: nextFileContextSource,
        selectedFileIds: previousSelectedFileIds,
      });
      requestAnimationFrame(() => {
        scrollToEnd();
      });
      setFolderNotice(null);
    } catch (sendError) {
      const errorMessage =
        sendError instanceof Error ? sendError.message : String(sendError);
      logComposerDebug("handle-generate-send-error", {
        message: errorMessage,
      });
      if (__DEV__) {
        Alert.alert("Send failed", errorMessage);
      }
      setPrompt(previousPrompt);
      await setSelectedFileIds(previousSelectedFileIds);
    } finally {
      sendingRef.current = false;
    }
  };

  const handleGrantFolderAccess = async () => {
    if (!pendingFolderSend) {
      return;
    }

    setBusyAction("folder");

    try {
      const session = await pickConversationFolder();

      setFolderDrawerOpen(false);
      setPendingFolderSend(null);
      setFolderNotice(`Using ${session.displayName} for this chat.`);
      setPrompt("");
      await setSelectedFileIds([]);
      scrollToEnd();
      await onSend({
        content: pendingFolderSend.content,
        fileContextSource: "external-folder",
        selectedFileIds: pendingFolderSend.selectedFileIds,
      });
      requestAnimationFrame(() => {
        scrollToEnd();
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportFiles = async () => {
    if (busyAction) {
      return;
    }

    setBusyAction("import");

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: "*/*",
      });

      if (!result.canceled && result.assets.length > 0) {
        const imported = await importFiles(result.assets);

        setLocalWorkspaceFiles((current) => {
          const map = new Map(current.map((file) => [file.id, file]));

          for (const file of imported) {
            map.set(file.id, file);
          }

          return [...map.values()];
        });
        await setSelectedFileIds([
          ...selectedFileIds,
          ...imported
            .map((file) => file.id)
            .filter((id) => !selectedFileIds.includes(id)),
        ]);
        setPrompt((current) => clearComposerTrigger(current));
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handlePaste = async (payload: PasteEventPayload) => {
    if (payload.type !== "images" || payload.uris.length === 0) return;

    if (busyAction || loading) return;

    if (!supportsImageInput) {
      Alert.alert(
        "Image input unavailable",
        "The selected model does not support image attachments.",
      );
      return;
    }

    setBusyAction("paste");

    try {
      const imported = await importFiles(
        payload.uris.map((uri, index) => {
          const file = new File(uri);

          return {
            lastModified: Date.now(),
            mimeType: file.type || "image/png",
            name: file.name || `pasted-image-${Date.now()}-${index + 1}.png`,
            size: file.size,
            uri,
          };
        }),
      );

      setLocalWorkspaceFiles((current) => {
        const map = new Map(current.map((file) => [file.id, file]));
        for (const file of imported) map.set(file.id, file);
        return [...map.values()];
      });
      await setSelectedFileIds([
        ...selectedFileIds,
        ...imported
          .map((file) => file.id)
          .filter((id) => !selectedFileIds.includes(id)),
      ]);
    } catch (error) {
      Alert.alert(
        "Could not paste image",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearWorkspaceFiles = () => {
    if (mergedWorkspaceFiles.length === 0 || busyAction || loading) {
      return;
    }

    Alert.alert(
      "Clear workspace files?",
      "This permanently deletes all uploaded, created, and generated workspace files.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear all",
          style: "destructive",
          onPress: () => {
            setBusyAction("clear");
            clearWorkspaceFiles()
              .then(() => {
                setLocalWorkspaceFiles([]);
                setFilesDrawerOpen(false);
              })
              .catch(console.error)
              .finally(() => {
                setBusyAction(null);
              });
          },
        },
      ],
    );
  };

  const handleDeleteUploadedFile = (file: WorkspaceFile) => {
    if (deletingFileId || loading) {
      return;
    }

    Alert.alert(
      "Delete uploaded file?",
      `${file.displayName} will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeletingFileId(file.id);
            deleteWorkspaceFile(file.id)
              .then(() => {
                setLocalWorkspaceFiles((current) =>
                  current.filter((item) => item.id !== file.id),
                );
              })
              .catch(console.error)
              .finally(() => {
                setDeletingFileId(null);
              });
          },
        },
      ],
    );
  };

  const sendDisabled =
    !loading &&
    ((!prompt.trim() && selectedFileIds.length === 0) ||
      !canSend ||
      !canAttachSelectedFiles);
  const clearTriggerText = () => {
    setPrompt((current) => clearComposerTrigger(current));
  };
  const mentionMenuItems = useMemo(
    () =>
      [
        {
          id: "select-file",
          icon: <FolderOpen color={theme.text} size={16} />,
          label: "Select file",
          onPress: () => {
            clearTriggerText();
            setFilesDrawerOpen(true);
          },
          subtitle: "Choose an uploaded file or upload a new one",
          visible: true,
        },
        {
          disabled: !supportsTools,
          id: "select-folder",
          icon: <FolderOpen color={theme.text} size={16} />,
          label: activeFolderLabel ? "Switch folder" : "Select folder",
          onPress: () => {
            clearTriggerText();
            if (Platform.OS !== "android") {
              setFolderNotice(
                "Picked-folder access is Android-only right now.",
              );
              return;
            }

            setBusyAction("folder");
            pickConversationFolder()
              .then((session) => {
                setFolderNotice(`Using ${session.displayName} for this chat.`);
              })
              .catch(console.error)
              .finally(() => {
                setBusyAction(null);
              });
          },
          subtitle: supportsTools
            ? (activeFolderLabel ?? "Use an external folder for this chat")
            : "Requires a tool-capable model",
          visible: Platform.OS === "android",
        },
        {
          id: "use-workspace",
          icon: <X color={theme.text} size={16} />,
          label: "Use workspace",
          onPress: () => {
            clearTriggerText();
            clearConversationFolder()
              .then(() => {
                setFolderNotice("Switched back to the workspace.");
              })
              .catch(console.error);
          },
          subtitle: "Stop using the external folder",
          visible: currentExternalFolderSession !== null,
        },
      ]
        .filter((item) => item.visible)
        .map(({ visible: _visible, ...item }) => item),
    [
      activeFolderLabel,
      clearConversationFolder,
      currentExternalFolderSession,
      pickConversationFolder,
      supportsTools,
      theme.text,
    ],
  );
  const slashMenuItems = useMemo(
    () => [
      {
        disabled: savedPrompts.length === 0,
        id: "saved-prompts",
        icon: <Bookmark color={theme.text} size={16} />,
        label: "Saved prompts",
        onPress: () => {
          setPrompt((current) => {
            const withoutTrigger = clearComposerTrigger(current);
            return withoutTrigger ? `${withoutTrigger} /` : "/";
          });
          setSlashMenuView("saved-prompts");
        },
        subtitle:
          savedPrompts.length > 0
            ? `${savedPrompts.length} saved prompt${savedPrompts.length === 1 ? "" : "s"}`
            : "No saved prompts",
      },
      {
        id: "reasoning-level",
        icon: <Brain color={theme.text} size={16} />,
        label: "Reasoning level",
        onPress: () => {
          clearTriggerText();
          setReasoningDrawerOpen(true);
        },
        subtitle: getReasoningEffortLabel(reasoningEffort) + " for this chat",
      },
      {
        id: "select-skills",
        icon: <Brain color={theme.text} size={16} />,
        label: "Select skills",
        onPress: () => {
          clearTriggerText();
          setSkillsDrawerOpen(true);
        },
        subtitle:
          selectedSkills.length > 0
            ? `${selectedSkills.length} selected`
            : "Choose chat skills",
      },
      {
        id: "select-mcp-servers",
        icon: <Server color={theme.text} size={16} />,
        label: "Select MCP servers",
        onPress: () => {
          clearTriggerText();
          setMcpServersDrawerOpen(true);
        },
        subtitle:
          enabledMcpServers.length > 0
            ? `${activeMcpServerIds.size} of ${enabledMcpServers.length} servers for this chat`
            : "No enabled MCP servers",
      },
      {
        id: "select-model",
        icon: <Check color={theme.text} size={16} />,
        label: "Select model",
        onPress: () => {
          clearTriggerText();
          setModelsDrawerOpen(true);
        },
        subtitle: currentModelLabel ?? "Choose the current chat model",
      },
    ],
    [
      activeMcpServerIds.size,
      currentModelLabel,
      enabledMcpServers.length,
      reasoningEffort,
      savedPrompts.length,
      selectedSkills.length,
      theme.text,
    ],
  );
  const savedPromptMenuItems = useMemo(
    () => [
      {
        id: "saved-prompts-back",
        icon: <ChevronLeft color={theme.text} size={16} />,
        label: "Back",
        onPress: () => {
          setPrompt((current) => {
            const withoutTrigger = clearComposerTrigger(current);
            return withoutTrigger ? `${withoutTrigger} /` : "/";
          });
          setSlashMenuView("commands");
        },
        subtitle: "All commands",
      },
      ...savedPrompts.map((savedPrompt) => ({
        id: `saved-prompt:${savedPrompt.id}`,
        icon: <Bookmark color={theme.text} size={16} />,
        label: savedPrompt.title,
        onPress: () => {
          setPrompt((current) => {
            const withoutTrigger = clearComposerTrigger(current);
            return withoutTrigger
              ? `${withoutTrigger} ${savedPrompt.content}`
              : savedPrompt.content;
          });
        },
        subtitle: savedPrompt.content.replace(/\s+/g, " ").trim(),
      })),
    ],
    [savedPrompts, theme.text],
  );
  const triggerMenuItems = useMemo(() => {
    if (!composerTrigger) {
      return [];
    }

    const source =
      composerTrigger.kind === "mention"
        ? mentionMenuItems
        : slashMenuView === "saved-prompts"
          ? savedPromptMenuItems
          : slashMenuItems;

    return source.filter(
      (item) =>
        item.id === "saved-prompts-back" ||
        matchesMenuQuery(composerTrigger.query, item.label, item.subtitle, [
          item.id,
        ]),
    );
  }, [
    composerTrigger,
    mentionMenuItems,
    savedPromptMenuItems,
    slashMenuItems,
    slashMenuView,
  ]);

  return (
    <View className="relative">
      <View className="gap-sp-3">
        {activeFolderLabel ? (
          <View className="self-start rounded-full border border-border bg-card px-sp-3 py-2 dark:border-border-dark dark:bg-card-dark">
            <View className="flex-row items-center gap-sp-2">
              <FolderOpen color={theme.textSecondary} size={14} />
              <Text className="font-sans text-xs text-foreground dark:text-foreground-dark">
                {activeFolderLabel}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  clearConversationFolder()
                    .then(() => {
                      setFolderNotice("Switched back to the workspace.");
                    })
                    .catch(console.error);
                }}
              >
                <X color={theme.textSecondary} size={14} />
              </Pressable>
            </View>
          </View>
        ) : null}

        {folderNotice ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {folderNotice}
          </Text>
        ) : null}

        {selectedFiles.length > 0 ? (
          <View className="gap-sp-2">
            {selectedFiles.map((file) => (
              <Attachment key={file.id} size="xs">
                <AttachmentMedia className="overflow-hidden bg-secondary dark:bg-secondary-dark">
                  {file.mimeType?.startsWith("image/") ? (
                    <Image
                      contentFit="cover"
                      source={{
                        uri: resolveWorkspaceFile(file.relativePath).uri,
                      }}
                      style={{ height: 48, width: 48 }}
                    />
                  ) : (
                    <Paperclip color={theme.text} size={18} />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{file.displayName}</AttachmentTitle>
                  <AttachmentDescription>
                    {file.mimeType ?? "Unknown type"}
                    {typeof file.size === "number"
                      ? ` · ${file.size} bytes`
                      : ""}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    onPress={() => {
                      setSelectedFileIds(
                        selectedFileIds.filter((id) => id !== file.id),
                      ).catch(console.error);
                    }}
                  >
                    <X color={theme.text} size={14} />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </View>
        ) : null}

        {composerTrigger ? (
          <View className="overflow-hidden rounded-card border border-border bg-card dark:border-border-dark dark:bg-card-dark">
            {triggerMenuItems.length > 0 ? (
              triggerMenuItems.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Separator /> : null}
                  <ComposerMenuRow
                    icon={item.icon}
                    disabled={"disabled" in item && item.disabled === true}
                    label={item.label}
                    onPress={item.onPress}
                    subtitle={item.subtitle}
                  />
                </View>
              ))
            ) : (
              <View className="px-sp-4 py-sp-3">
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  No matches
                </Text>
              </View>
            )}
          </View>
        ) : null}

        <View className="relative rounded-3xl border border-border bg-input dark:border-border-dark dark:bg-input-dark">
          <TextInputWrapper
            style={{ height: composerInputHeight, width: "100%" }}
            onPaste={(payload) => {
              handlePaste(payload).catch(console.error);
            }}
          >
            <Textarea
              className="min-h-0 rounded-full border-0 bg-transparent px-0 py-0 dark:bg-transparent"
              onChangeText={setPrompt}
              onContentSizeChange={(event) => {
                setComposerContentHeight(event.nativeEvent.contentSize.height);
              }}
              placeholder="Type a message..."
              returnKeyType="send"
              scrollEnabled={composerScrollEnabled}
              submitBehavior="submit"
              style={{ height: composerInputHeight }}
              value={prompt}
              onSubmitEditing={() => {
                handleGenerate().catch(console.error);
              }}
            />
          </TextInputWrapper>

          <View className="h-[52px] flex-row items-center gap-2 px-2 pb-2">
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 dark:border-border-dark dark:bg-card-dark"
              onPress={() => {
                setApprovalModeDrawerOpen(true);
              }}
              style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
            >
              <Text className="font-sans text-xs font-medium text-foreground dark:text-foreground-dark">
                {toolApprovalMode === "ask" ? "Ask" : "Allow"}
              </Text>
              <ChevronDown color={theme.textSecondary} size={14} />
            </Pressable>

            <Pressable
              accessibilityLabel="Select reasoning level"
              accessibilityRole="button"
              className="flex-row items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 dark:border-border-dark dark:bg-card-dark"
              onPress={() => {
                setReasoningDrawerOpen(true);
              }}
              style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
            >
              <Brain color={theme.textSecondary} size={14} />
              <Text className="font-sans text-xs font-medium text-foreground dark:text-foreground-dark">
                {getReasoningEffortLabel(reasoningEffort)}
              </Text>
              <ChevronDown color={theme.textSecondary} size={14} />
            </Pressable>

            <View className="flex-1" />
            <Pressable
              accessibilityLabel={loading ? "Stop generating" : "Send message"}
              accessibilityRole="button"
              accessibilityState={{ disabled: sendDisabled }}
              className="h-12 w-12 items-center justify-center rounded-full bg-foreground dark:bg-foreground-dark"
              disabled={sendDisabled}
              hitSlop={8}
              onPress={() => {
                if (sendDisabled) return;
                if (loading) {
                  onStop().catch(console.error);
                  return;
                }
                handleGenerate().catch(console.error);
              }}
              style={({ pressed }) => ({
                opacity: sendDisabled ? 0.5 : pressed ? 0.85 : 1,
              })}
            >
              {loading ? (
                <StopCircle color={theme.background} size={18} />
              ) : (
                <Send color={theme.background} size={18} />
              )}
            </Pressable>
          </View>
        </View>

        <Text className="px-sp-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Use @ for files and folders, / for commands.
          {supportsImageGeneration
            ? " This model can also generate images."
            : ""}
        </Text>
      </View>

      <Drawer onOpenChange={setFilesDrawerOpen} open={filesDrawerOpen}>
        <DrawerContent
          showCloseButton
          showHandle
          size={filesDrawerSize}
        >
          <DrawerHeader>
            <DrawerTitle>Select file</DrawerTitle>
            <DrawerDescription>
              {mergedWorkspaceFiles.length} file
              {mergedWorkspaceFiles.length === 1 ? "" : "s"} available
            </DrawerDescription>
          </DrawerHeader>

          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {mergedWorkspaceFiles.length > 0 ? (
              mergedWorkspaceFiles.map((file) => {
                const selected = selectedFileIds.includes(file.id);
                const { binaryFiles, imageFiles } = partitionSelectedFiles([
                  file,
                ]);
                const supported =
                  (imageFiles.length === 0 || supportsImageInput) &&
                  (binaryFiles.length === 0 || supportsTools);

                return (
                  <DrawerSelectRow
                    disabled={!supported && !selected}
                    key={file.id}
                    leading={
                      file.mimeType?.startsWith("image/") ? (
                        <Image
                          contentFit="cover"
                          source={{
                            uri: resolveWorkspaceFile(file.relativePath).uri,
                          }}
                          style={{
                            borderRadius: 10,
                            height: 48,
                            width: 48,
                          }}
                        />
                      ) : null
                    }
                    onPress={() => {
                      setFilesDrawerOpen(false);
                      setSelectedFileIds(
                        selectedFileIds.includes(file.id)
                          ? selectedFileIds.filter((id) => id !== file.id)
                          : [...selectedFileIds, file.id],
                      ).catch(console.error);
                    }}
                    deleting={deletingFileId === file.id}
                    onDelete={() => {
                      handleDeleteUploadedFile(file);
                    }}
                    selected={selected}
                    subtitle={
                      supported
                        ? (file.mimeType ?? "Unknown type")
                        : "Not supported with current model"
                    }
                    title={file.displayName}
                  />
                );
              })
            ) : (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                No files in the workspace yet. Upload one below to attach it.
              </Text>
            )}
          </DrawerBody>
          <DrawerFooter>
            <View className="gap-sp-2">
              <Button
                leftIcon={<Upload color={theme.text} size={16} />}
                loading={busyAction === "import"}
                onPress={handleImportFiles}
                variant="secondary"
              >
                Upload new file
              </Button>
              <Button
                disabled={mergedWorkspaceFiles.length === 0 || loading}
                leftIcon={<Trash2 color={theme.destructive} size={16} />}
                loading={busyAction === "clear"}
                onPress={handleClearWorkspaceFiles}
                textClassName="text-destructive dark:text-destructive-dark"
                variant="ghost"
              >
                Clear all workspace files
              </Button>
            </View>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer
        onOpenChange={(open) => {
          setFolderDrawerOpen(open);

          if (!open) {
            setPendingFolderSend(null);
          }
        }}
        open={folderDrawerOpen}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Grant folder access</DrawerTitle>
            <DrawerDescription>
              Choose one folder for this chat only.
            </DrawerDescription>
          </DrawerHeader>

          <DrawerFooter className="border-t-0 pt-0">
            <Button
              loading={busyAction === "folder"}
              onPress={handleGrantFolderAccess}
            >
              Choose folder
            </Button>
            <Button
              onPress={() => {
                setFolderDrawerOpen(false);
                setPendingFolderSend(null);
              }}
              variant="outline"
            >
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer onOpenChange={setReasoningDrawerOpen} open={reasoningDrawerOpen}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Reasoning level</DrawerTitle>
            <DrawerDescription>
              Choose how much reasoning the model should use for this chat.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {REASONING_EFFORT_OPTIONS.map((option) => (
              <DrawerSelectRow
                key={option.value}
                onPress={() => {
                  setReasoningEffort(option.value)
                    .then(() => {
                      setReasoningDrawerOpen(false);
                    })
                    .catch(console.error);
                }}
                selected={reasoningEffort === option.value}
                subtitle={option.description}
                title={option.label}
              />
            ))}
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <Drawer onOpenChange={setModelsDrawerOpen} open={modelsDrawerOpen}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Select model</DrawerTitle>
            <DrawerDescription>
              Switch the current model for this chat.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {activeModels.length > 0 ? (
              modelGroups.map(([providerLabel, models]) => (
                <View className="gap-sp-2" key={providerLabel}>
                  <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                    {providerLabel}
                  </Text>
                  {models.map((model) => (
                    <DrawerSelectRow
                      key={model.ref}
                      onPress={() => {
                        selectModel(model.ref)
                          .then(() => {
                            setModelsDrawerOpen(false);
                          })
                          .catch(console.error);
                      }}
                      selected={currentModelRef === model.ref}
                      title={model.label}
                    />
                  ))}
                </View>
              ))
            ) : (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                No active models
              </Text>
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button
              onPress={() => {
                setModelsDrawerOpen(false);
                onOpenSettings();
              }}
              variant="outline"
            >
              Manage models
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer onOpenChange={setSkillsDrawerOpen} open={skillsDrawerOpen}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Skills</DrawerTitle>
            <DrawerDescription>
              {selectedSkills.length} selected for this chat.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {enabledSkills.length > 0 ? (
              enabledSkills.map((skill) => {
                const selected = selectedSkillIds.includes(skill.id);

                return (
                  <DrawerSelectRow
                    key={skill.id}
                    onPress={() => {
                      setSelectedSkillIds(
                        selected
                          ? selectedSkillIds.filter((id) => id !== skill.id)
                          : [...selectedSkillIds, skill.id],
                      ).catch(console.error);
                    }}
                    selected={selected}
                    subtitle={
                      skill.autoMatch
                        ? skill.description
                          ? `Auto · ${skill.description}`
                          : "Auto"
                        : (skill.description ?? undefined)
                    }
                    title={skill.title}
                  />
                );
              })
            ) : (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                No enabled skills
              </Text>
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button
              onPress={() => {
                setSkillsDrawerOpen(false);
                onOpenSettings();
              }}
              variant="outline"
            >
              Manage skills
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer
        onOpenChange={setMcpServersDrawerOpen}
        open={mcpServersDrawerOpen}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>MCP servers</DrawerTitle>
            <DrawerDescription>
              {activeMcpServerIds.size} used in this chat.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {enabledMcpServers.length > 0 ? (
              enabledMcpServers.map((server) => (
                <DrawerSelectRow
                  key={server.id}
                  onPress={() => {
                    toggleMcpServer(server.id).catch(console.error);
                  }}
                  selected={activeMcpServerIds.has(server.id)}
                  subtitle={server.url}
                  title={server.label}
                />
              ))
            ) : (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                No enabled MCP servers. Enable one in MCP servers settings.
              </Text>
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button
              onPress={() => {
                setMcpServersDrawerOpen(false);
                onOpenMcpSettings();
              }}
              variant="outline"
            >
              Manage MCP servers
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer
        onOpenChange={setApprovalModeDrawerOpen}
        open={approvalModeDrawerOpen}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Tool approval</DrawerTitle>
            <DrawerDescription>
              Choose how built-in tools run during chat.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            <DrawerSelectRow
              onPress={() => {
                updateToolApprovalMode("ask")
                  .then(() => {
                    setApprovalModeDrawerOpen(false);
                  })
                  .catch(console.error);
              }}
              selected={toolApprovalMode === "ask"}
              subtitle="Ask before every tool action"
              title="Always ask"
            />
            <DrawerSelectRow
              onPress={() => {
                updateToolApprovalMode("auto")
                  .then(() => {
                    setApprovalModeDrawerOpen(false);
                  })
                  .catch(console.error);
              }}
              selected={toolApprovalMode === "auto"}
              subtitle="Run tools without asking each time"
              title="Always allow"
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </View>
  );
}

function ComposerMenuRow({
  icon,
  disabled = false,
  label,
  onPress,
  subtitle,
}: {
  icon: ReactNode;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  subtitle?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={cn(
        "flex-row items-center gap-sp-3 px-sp-4 py-sp-3",
        disabled && "opacity-50",
      )}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-background dark:bg-background-dark">
        {icon}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
          {label}
        </Text>
        {subtitle ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function DrawerSelectRow({
  deleting = false,
  disabled = false,
  leading,
  onDelete,
  onPress,
  selected,
  subtitle,
  title,
}: {
  deleting?: boolean;
  disabled?: boolean;
  leading?: ReactNode;
  onDelete?: () => void;
  onPress: () => void;
  selected: boolean;
  subtitle?: string;
  title: string;
}) {
  const theme = useTheme();

  return (
    <View
      className={cn(
        "flex-row items-center gap-sp-3 rounded-ui border px-sp-4 py-sp-3",
        selected
          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark",
      )}
    >
      <Pressable
        accessibilityState={{ disabled }}
        accessibilityRole="button"
        className={cn(
          "min-w-0 flex-1 flex-row items-center gap-sp-3",
          disabled && "opacity-50",
        )}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
      >
        {leading ? (
          <View className="h-12 w-12 shrink-0 overflow-hidden rounded-card">
            {leading}
          </View>
        ) : null}
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            {title}
          </Text>
          {subtitle ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {onDelete ? (
        <Pressable
          accessibilityLabel={`Delete ${title}`}
          accessibilityRole="button"
          disabled={deleting}
          hitSlop={8}
          onPress={onDelete}
          style={({ pressed }) => ({
            opacity: deleting ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <Trash2 color={theme.destructive} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}
