import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Save, Sparkles, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
  { label: "Chat only", value: "primary" },
  { label: "Subagent only", value: "subagent" },
];

type Draft = {
  description: string;
  mode: AgentVisibilityMode;
  modelRef: string;
  name: string;
  prompt: string;
  temperature: string;
  toolPermissions: AgentToolPermissions;
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
    modelRef:
      agent.modelProviderId && agent.modelModelId
        ? `${agent.modelProviderId}/${agent.modelModelId}`
        : "",
    name: agent.name,
    prompt: agent.prompt ?? "",
    temperature:
      agent.temperature !== null && agent.temperature !== undefined
        ? String(agent.temperature)
        : "",
    toolPermissions: agent.toolPermissions,
  };
}

const EMPTY_DRAFT: Draft = {
  description: "",
  mode: "all",
  modelRef: "",
  name: "",
  prompt: "",
  temperature: "",
  toolPermissions: {},
};

export default function SettingsAgentEditorScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    activeModels,
    agents,
    createAgent,
    currentModel,
    mcpServers,
    providers,
    updateAgent,
    deleteAgent,
  } = useConfig();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";

  const existing = useMemo(
    () => agents.find((agent) => agent.id === id) ?? null,
    [agents, id],
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<null | "generate" | "save">(null);
  const [error, setError] = useState<string | null>(null);

  if (!draft) {
    if (existing) {
      setDraft(draftFromAgent(existing));
    } else if (isNew) {
      setDraft({ ...EMPTY_DRAFT });
    }
  }

  if (!isNew && !existing) {
    return (
      <Container scroll contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false}>
        <View className="flex-row items-center gap-sp-2">
          <Button
            leftIcon={<ChevronLeft color={theme.text} size={16} />}
            onPress={() => router.push("/settings/agents" as never)}
            size="icon-xs"
            variant="ghost"
          />
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Agent not found
          </Text>
        </View>
      </Container>
    );
  }

  const current = draft ?? EMPTY_DRAFT;
  const updateDraft = (patch: Partial<Draft>) =>
    setDraft({ ...current, ...patch });

  const parseModelRefInput = (value: string) => {
    const trimmed = value.trim();

    if (!trimmed) {
      return { modelId: null, providerId: null };
    }

    const separatorIndex = trimmed.indexOf("/");

    if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
      return undefined;
    }

    return {
      providerId: trimmed.slice(0, separatorIndex),
      modelId: trimmed.slice(separatorIndex + 1),
    };
  };

  const handleSave = async () => {
    if (busy || !current.name.trim()) {
      setError("Give the agent a name.");
      return;
    }

    const parsedModel = parseModelRefInput(current.modelRef);

    if (parsedModel === undefined) {
      setError("Model must look like provider/model, or stay empty.");
      return;
    }

    let temperature: number | null = null;

    if (current.temperature.trim()) {
      temperature = Number.parseFloat(current.temperature);

      if (!Number.isFinite(temperature)) {
        setError("Temperature must be a number like 0.3, or stay empty.");
        return;
      }
    }

    setBusy("save");
    setError(null);

    try {
      const payload = {
        description: current.description.trim() || null,
        mode: current.mode,
        ...parsedModel,
        prompt: current.prompt.trim() || null,
        temperature,
        toolPermissions: current.toolPermissions,
      };

      if (existing) {
        await updateAgent(existing.id, {
          ...payload,
          name: current.name,
        });
      } else {
        await createAgent({
          ...payload,
          name: current.name,
        });
      }

      router.back();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (busy || !existing) {
      return;
    }

    setBusy("save");
    setError(null);

    try {
      await deleteAgent(existing.id);
      router.replace("/settings/agents" as never);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete.",
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
              existingNames: agents.map((agent) => agent.name),
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
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.name ? { name: parsed.name } : {}),
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

  return (
    <Container scroll contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false}>
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.push("/settings/agents" as never)}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            {isNew ? "New agent" : current.name || "Agent"}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Persona, model override, and tool access
          </Text>
        </View>
      </View>

      <Card className="gap-sp-3 px-sp-4 py-sp-4">
        <View className="gap-sp-2">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            Name
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
          <Input
            onChangeText={(description) => updateDraft({ description })}
            placeholder="When should this agent be used?"
            value={current.description}
          />
        </View>
        <ModePicker draft={current} onChange={updateDraft} />
        <View className="gap-sp-2">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            Model override
          </Text>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(modelRef) => updateDraft({ modelRef })}
            placeholder="provider/model — empty uses the chat model"
            value={current.modelRef}
          />
        </View>
        <View className="gap-sp-2">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            Temperature
          </Text>
          <Input
            autoCapitalize="none"
            keyboardType="decimal-pad"
            onChangeText={(temperature) => updateDraft({ temperature })}
            placeholder="Empty uses the model default"
            value={current.temperature}
          />
        </View>
      </Card>

      <Card className="gap-sp-3 px-sp-4 py-sp-4">
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
          className="min-h-40"
          onChangeText={(prompt) => updateDraft({ prompt })}
          placeholder={DEFAULT_AGENT_SYSTEM_PROMPT_PLACEHOLDER}
          value={current.prompt}
        />
        {!current.prompt.trim() ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Empty uses the default Mobile Agent system prompt.
          </Text>
        ) : null}
      </Card>

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

      <View className="flex-row gap-sp-2">
        <Button
          leftIcon={<Save color={theme.background} size={16} />}
          loading={busy === "save"}
          onPress={handleSave}
          size="sm"
        >
          {isNew ? "Create agent" : "Save changes"}
        </Button>
        {!isNew && existing ? (
          <Button
            disabled={busy !== null}
            leftIcon={<Trash2 color={theme.destructive} size={16} />}
            onPress={handleDelete}
            size="sm"
            variant="ghost"
          >
            Delete
          </Button>
        ) : null}
      </View>
    </Container>
  );
}

function ModePicker({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    MODE_OPTIONS.find((option) => option.value === draft.mode)?.label ??
    "Chat + Subagent";

  return (
    <Drawer onOpenChange={setOpen} open={open}>
      <DrawerTrigger asChild>
        <Pressable
          accessibilityRole="button"
          className="flex-row items-center justify-between rounded-ui border border-border bg-input px-sp-3 py-sp-3 dark:border-border-dark dark:bg-input-dark"
          style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
        >
          <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
            Where available: {label}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Change
          </Text>
        </Pressable>
      </DrawerTrigger>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Availability</DrawerTitle>
          <DrawerDescription>
            Chat agents are selectable in chats; subagents are invoked by other
            agents via the task tool.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
          {MODE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              className="flex-row items-center gap-sp-3 rounded-ui border border-border px-sp-3 py-sp-3 dark:border-border-dark"
              onPress={() => {
                onChange({ mode: option.value });
                setOpen(false);
              }}
            >
              <Checkbox checked={draft.mode === option.value} onCheckedChange={() => {}} />
              <Text className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
                {option.label}
              </Text>
            </Pressable>
          ))}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
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
  const [open, setOpen] = useState(false);
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
    <Card className="gap-sp-3 px-sp-4 py-sp-4">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        Tool access
      </Text>
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Agents can use every globally-enabled tool by default. Toggle tools off
        to deny them for this agent.
      </Text>
      <Button onPress={() => setOpen(true)} size="sm" variant="outline">
        Configure tool access
      </Button>
      <Drawer onOpenChange={setOpen} open={open}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Tool access</DrawerTitle>
            <DrawerDescription>
              Enabled tools stay subject to the global tool settings; disabled
              ones are denied for this agent.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-1 pb-sp-4">
            {ALL_BUILT_IN_TOOL_KEYS.map((key, index) => (
              <View key={key}>
                <Pressable
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
                {index < ALL_BUILT_IN_TOOL_KEYS.length - 1 ? (
                  <Separator />
                ) : null}
              </View>
            ))}
            {mcpServerIds.length > 0 ? (
              <>
                <Text className="px-sp-1 pt-sp-3 font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                  MCP servers
                </Text>
                {mcpServerIds.map((serverId) => (
                  <Pressable
                    key={serverId}
                    accessibilityRole="button"
                    className="flex-row items-center gap-sp-3 px-sp-1 py-sp-2"
                    onPress={() =>
                      setMcpAllowed(serverId, mcpPermissions[serverId] !== false)
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
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </Card>
  );
}
