import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Plus, Save, Sparkles, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

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
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import type {
  AgentConfig,
  AgentToolPermissions,
  AgentVisibilityMode,
  BuiltInToolKey,
} from "@/core/types/app-state";
import { secureSecretStore } from "@/core/services/secrets";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  DEFAULT_AGENT_SYSTEM_PROMPT_PLACEHOLDER,
  buildAgentGeneratePrompt,
  parseAgentJsonDraft,
} from "@/modules/agents/generate";
import { ALL_BUILT_IN_TOOL_KEYS } from "@/modules/config/built-in-tools";
import { modelRuntime } from "@/modules/runtime/model-runtime";

const MODE_OPTIONS: { label: string; value: AgentVisibilityMode }[] = [
  { label: "Chat + Subagent", value: "all" },
  { label: "Chat only (primary)", value: "primary" },
  { label: "Subagent only", value: "subagent" },
];

type DocDraft = {
  name: string;
  content: string;
  mimeType: string | null;
  size: number | null;
};

type Draft = {
  description: string;
  mode: AgentVisibilityMode;
  name: string;
  prompt: string;
  temperature: number;
  toolPermissions: AgentToolPermissions;
  docs: DocDraft[];
};

const BUILT_IN_TOOL_LABELS: Record<BuiltInToolKey, string> = {
  downloadFile: "Download files",
  folderCreateDirectory: "Create folders (external)",
  folderCreateFile: "Create files (external)",
  folderDeleteEntry: "Delete entries (external)",
  folderEdit: "Edit files (external)",
  folderGlob: "Find files (external)",
  folderGrep: "Search text (external)",
  folderListDirectory: "List folders (external)",
  folderMoveEntry: "Move entries (external)",
  folderRead: "Read files (external)",
  folderRenameEntry: "Rename entries (external)",
  folderWrite: "Write files (external)",
  question: "Ask questions",
  schedules: "Scheduled jobs",
  skill: "Use skills",
  todos: "Todo lists",
  workspaceCreateFile: "Create files",
  workspaceEdit: "Edit files",
  workspaceGlob: "Find files",
  workspaceGrep: "Search text",
  workspaceListFiles: "List files",
  workspaceRead: "Read files",
  workspaceWrite: "Write files",
};

function draftFromAgent(agent: AgentConfig): Draft {
  return {
    description: agent.description ?? "",
    mode: agent.mode,
    name: agent.name,
    prompt: agent.prompt ?? "",
    temperature:
      agent.temperature !== null && agent.temperature !== undefined
        ? Math.min(Math.max(agent.temperature, 0), 1)
        : 0.5,
    toolPermissions: agent.toolPermissions,
    docs: agent.docs.map((doc) => ({
      name: doc.name,
      content: doc.content,
      mimeType: doc.mimeType,
      size: doc.size,
    })),
  };
}

export function AgentEditorDrawer({
  agent,
  onOpenChange,
  open,
}: {
  agent: AgentConfig | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const theme = useTheme();
  const {
    activeModels,
    currentModel,
    mcpServers,
    providers,
    updateAgent,
  } = useConfig();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<null | "generate" | "save" | "docs">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && agent) {
      setDraft(draftFromAgent(agent));
      setError(null);
    } else if (!open) {
      setDraft(null);
    }
  }, [agent, open]);

  if (!open || !agent || !draft) {
    return (
      <Drawer onOpenChange={onOpenChange} open={open}>
                <DrawerContent showCloseButton showHandle size={440}>
          {null}
        </DrawerContent>
      </Drawer>
    );
  }

  const current = draft;
  const updateDraft = (patch: Partial<Draft>) =>
    setDraft({ ...current, ...patch });

  const handleSave = async () => {
    if (busy || !current.name.trim()) {
      setError("Give the agent a name.");
      return;
    }

    setBusy("save");
    setError(null);

    try {
      await updateAgent(agent.id, {
        description: current.description.trim() || null,
        mode: current.mode,
        prompt: current.prompt.trim() || null,
        temperature: current.temperature,
        toolPermissions: current.toolPermissions,
        docs: current.docs.map((doc) => ({
          name: doc.name,
          content: doc.content,
          mimeType: doc.mimeType,
          size: doc.size,
        })),
      });
      onOpenChange(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleGenerate = async () => {
    if (busy) {
      return;
    }

    const model = currentModel ?? activeModels[0] ?? null;

    if (!model) {
      setError("Configure a provider first to generate agents with AI.");
      return;
    }

    const provider = providers.find(
      (item: { id: string }) => item.id === model.providerId,
    );

    if (!provider) {
      setError("The selected model's provider is unavailable.");
      return;
    }

    setBusy("generate");
    setError(null);

    try {
      const result = await modelRuntime.generateTextStream({
        maxToolSteps: 1,
        messages: [
          {
            role: "system",
            content:
              "You output only a single JSON object. No markdown fences, no commentary.",
          },
          {
            role: "user",
            content: buildAgentGeneratePrompt({
              description: current.description || current.name,
              existingNames: [],
              hasPrompt: Boolean(current.prompt.trim()),
            }),
          },
        ],
        model,
        provider,
        secretStore: secureSecretStore,
      });
      const parsed = parseAgentJsonDraft(result.text);

      updateDraft({
        ...(parsed.name ? { name: parsed.name } : {}),
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.systemPrompt && !current.prompt.trim()
          ? { prompt: parsed.systemPrompt }
          : {}),
      });
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Generation failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handlePickDocs = async () => {
    if (busy) {
      return;
    }

    setBusy("docs");
    setError(null);
    const existingNames = new Set(
      current.docs.map((doc) => doc.name.toLowerCase()),
    );
    const added: DocDraft[] = [];

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: "*/*",
      });

      if (result.canceled) {
        return;
      }

      for (const asset of result.assets) {
        let content: string;

        try {
          content = await new File(asset.uri).text();
        } catch {
          continue;
        }

        const baseName = asset.name ?? asset.uri.split("/").pop() ?? "doc";

        if (existingNames.has(baseName.toLowerCase())) {
          continue;
        }

        added.push({
          name: baseName,
          content,
          mimeType: asset.mimeType ?? null,
          size: asset.size ?? null,
        });
        existingNames.add(baseName.toLowerCase());
      }

      updateDraft({ docs: [...current.docs, ...added] });
    } catch (pickError) {
      setError(
        pickError instanceof Error
          ? pickError.message
          : "Could not read the selected files.",
      );
    } finally {
      setBusy(null);
    }
  };

  const removeDoc = (index: number) => {
    const next = [...current.docs];
    next.splice(index, 1);
    updateDraft({ docs: next });
  };

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader className="pr-12">
          <DrawerTitle>Edit agent</DrawerTitle>
          <DrawerDescription>
            {current.name || "Agent"}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <View className="gap-sp-2">
            <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
              Title
            </Text>
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(name) => updateDraft({ name })}
              placeholder="code-reviewer"
              value={current.name}
            />
          </View>
          <View className="gap-sp-2">
            <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
              Description
            </Text>
            <Textarea
              className="min-h-24"
              onChangeText={(description) => updateDraft({ description })}
              placeholder="When should this agent be used?"
              value={current.description}
            />
          </View>

          <ModePicker draft={current} onChange={updateDraft} />

          <View className="gap-sp-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                Temperature
              </Text>
              <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                {current.temperature.toFixed(2)}
              </Text>
            </View>
            <Slider
              accessibilityLabel="Temperature"
              maximumValue={1}
              minimumValue={0}
              onValueChange={(temperature) =>
                updateDraft({ temperature })
              }
              step={0.01}
              value={current.temperature}
            />
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Lower values make responses more focused and deterministic;
              higher values make them more creative and varied.
            </Text>
          </View>

          <DocsCard
            busy={busy === "docs"}
            docs={current.docs}
            onPick={handlePickDocs}
            onRemove={removeDoc}
          />

          <View className="gap-sp-2">
            <View className="flex-row items-center justify-between gap-sp-2">
              <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                System prompt
              </Text>
              <Button
                leftIcon={<Sparkles color={theme.text} size={14} />}
                loading={busy === "generate"}
                onPress={handleGenerate}
                size="sm"
                variant="outline"
              >
                Generate with AI
              </Button>
            </View>
            <Textarea
              className="min-h-36"
              onChangeText={(prompt) => updateDraft({ prompt })}
              placeholder={DEFAULT_AGENT_SYSTEM_PROMPT_PLACEHOLDER}
              value={current.prompt}
            />
            {!current.prompt.trim() ? (
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Empty uses the default Mobile Agent system prompt.
              </Text>
            ) : null}
          </View>

          <ToolPermissionsCard
            draft={current}
            mcpServerIds={mcpServers.map((server) => server.id)}
            onChange={updateDraft}
          />

          {error ? (
            <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
              {error}
            </Text>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button
            leftIcon={<Save color={theme.background} size={16} />}
            loading={busy === "save"}
            onPress={handleSave}
          >
            Save changes
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function ModePicker({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  return (
    <View className="gap-sp-2">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        Where available
      </Text>
      <View className="gap-sp-2">
        {MODE_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            className="flex-row items-center gap-sp-3 rounded-ui border border-border px-sp-3 py-sp-3 dark:border-border-dark"
            onPress={() => onChange({ mode: option.value })}
          >
            <Checkbox
              checked={draft.mode === option.value}
              onCheckedChange={() => onChange({ mode: option.value })}
            />
            <Text className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Primary agents are selectable in chats; subagents are invoked by other
        agents via the task tool.
      </Text>
    </View>
  );
}

function DocsCard({
  busy,
  docs,
  onPick,
  onRemove,
}: {
  busy: boolean;
  docs: DocDraft[];
  onPick: () => void;
  onRemove: (index: number) => void;
}) {
  const theme = useTheme();

  return (
    <View className="gap-sp-2">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        Reference docs
      </Text>
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Attach text files (like Claude Projects) that the agent should treat
        as reference material. Their contents are included in its prompt.
      </Text>
      <Button
        leftIcon={<Plus color={theme.text} size={16} />}
        loading={busy}
        onPress={onPick}
        size="sm"
        variant="outline"
      >
        Attach docs
      </Button>
      {docs.length > 0 ? (
        <View className="gap-sp-2">
          {docs.map((doc, index) => (
            <View key={`${doc.name}-${index}`}>
              <View className="flex-row items-center gap-sp-2">
                <Text
                  className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark"
                  numberOfLines={1}
                >
                  {doc.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${doc.name}`}
                  onPress={() => onRemove(index)}
                  hitSlop={8}
                >
                  <X color={theme.textSecondary} size={16} />
                </Pressable>
              </View>
              {index < docs.length - 1 ? <Separator /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ToolPermissionsCard({
  draft,
  mcpServerIds,
  onChange,
}: {
  draft: Draft;
  mcpServerIds: string[];
  onChange: (patch: Partial<Draft>) => void;
}) {
  const builtInDenies = draft.toolPermissions.builtInTools ?? {};
  const mcpPermissions = draft.toolPermissions.mcpServers ?? {};

  const setBuiltInAllowed = (key: BuiltInToolKey, allowed: boolean) => {
    const next = { ...builtInDenies };

    if (allowed) {
      delete next[key];
    } else {
      next[key] = false;
    }

    onChange({
      toolPermissions: {
        ...draft.toolPermissions,
        ...(Object.keys(next).length > 0 ? { builtInTools: next } : {}),
      },
    });
  };

  const setMcpAllowed = (serverId: string, allowed: boolean) => {
    const next = { ...mcpPermissions, [serverId]: allowed };

    onChange({
      toolPermissions: {
        ...draft.toolPermissions,
        mcpServers: next,
      },
    });
  };

  return (
    <View className="gap-sp-2">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        Tool access
      </Text>
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Agents can use every globally-enabled tool by default. Toggle tools
        off to deny them for this agent.
      </Text>
      <View className="gap-sp-2">
        {ALL_BUILT_IN_TOOL_KEYS.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            className="flex-row items-center gap-sp-3 px-sp-1 py-sp-2"
            onPress={() =>
              setBuiltInAllowed(key, builtInDenies[key] !== false)
            }
          >
            <Checkbox
              checked={builtInDenies[key] !== false}
              onCheckedChange={(checked) =>
                setBuiltInAllowed(key, checked === true)
              }
            />
            <Text className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
              {BUILT_IN_TOOL_LABELS[key]}
            </Text>
          </Pressable>
        ))}
        {mcpServerIds.length > 0 ? (
          <>
            <Text className="pt-sp-3 font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
              MCP servers
            </Text>
            {mcpServerIds.map((serverId) => (
              <Pressable
                key={serverId}
                accessibilityRole="button"
                className="flex-row items-center gap-sp-3 px-sp-1 py-sp-2"
                onPress={() =>
                  setMcpAllowed(
                    serverId,
                    mcpPermissions[serverId] !== false,
                  )
                }
              >
                <Checkbox
                  checked={mcpPermissions[serverId] !== false}
                  onCheckedChange={(checked) =>
                    setMcpAllowed(serverId, checked === true)
                  }
                />
                <Text className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
                  {serverId}
                </Text>
              </Pressable>
            ))}
          </>
        ) : null}
      </View>
    </View>
  );
}
