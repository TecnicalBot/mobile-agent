import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { ChevronLeft, Copy, Plus, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { AgentCreateDrawer } from "@/components/agents/agent-create-drawer";
import { AgentEditorDrawer } from "@/components/agents/agent-editor-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import type { AgentConfig } from "@/core/types/app-state";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { NATIVE_AGENTS } from "@/modules/agents/registry";

export default function SettingsAgentsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    agents,
    deleteAgent,
    exportAgentMarkdown,
    updateAgent,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);

  const customAgents = useMemo(
    () =>
      [...agents].sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);

    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Agent action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const copyAgentMarkdown = async (agentId: string) => {
    const markdown = exportAgentMarkdown(agentId);
    await Clipboard.setStringAsync(markdown);
  };

  const handleCreated = (agent: AgentConfig) => {
    setEditingAgent(agent);
    setCreateOpen(false);
    setError(null);
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
          onPress={() => router.replace("/settings" as never)}
          size="icon-xs"
          variant="ghost"
        />
        <Text className="min-w-0 flex-1 font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Agents
        </Text>
        <Button
          className="ml-auto"
          leftIcon={<Plus color={theme.text} size={16} />}
          onPress={() => setCreateOpen(true)}
          size="sm"
          variant="outline"
        >
          Create
        </Button>
      </View>
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        {customAgents.length} custom · built-ins always available
      </Text>

      <Card className="overflow-hidden">
        {NATIVE_AGENTS.map((agent, index) => (
          <View key={agent.id}>
            <NativeAgentRow agent={agent} />
            {index < NATIVE_AGENTS.length - 1 ? <Separator /> : null}
          </View>
        ))}
      </Card>

      {customAgents.length === 0 ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No custom agents yet. Create one from scratch, with AI, or import
            an AGENT.md file.
          </Text>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {customAgents.map((agent, index) => (
            <View key={agent.id}>
              <AgentRow
                agent={agent}
                busyKey={busyKey}
                onDelete={() =>
                  runAction(`delete:${agent.id}`, async () => {
                    await deleteAgent(agent.id);
                  })
                }
                onExport={() =>
                  runAction(`export:${agent.id}`, () =>
                    copyAgentMarkdown(agent.id),
                  )
                }
                onOpen={() => {
                  setEditingAgent(agent);
                  setError(null);
                }}
                onToggle={(enabled) =>
                  runAction(`toggle:${agent.id}`, async () => {
                    await updateAgent(agent.id, { enabled });
                  })
                }
              />
              {index < customAgents.length - 1 ? <Separator /> : null}
            </View>
          ))}
        </Card>
      )}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <AgentCreateDrawer
        onCreated={handleCreated}
        onOpenChange={setCreateOpen}
        open={createOpen}
      />
      <AgentEditorDrawer
        agent={editingAgent}
        onOpenChange={(open) => {
          if (!open) {
            setEditingAgent(null);
          }
        }}
        open={editingAgent !== null}
      />
    </Container>
  );
}

function agentModeLabel(mode: AgentConfig["mode"]) {
  if (mode === "primary") return "Chat only";
  if (mode === "subagent") return "Subagent";
  return "Chat + Subagent";
}

function NativeAgentRow({ agent }: { agent: AgentConfig }) {
  return (
    <View className="gap-sp-2 px-sp-4 py-sp-4">
      <View className="flex-row items-center gap-sp-2">
        <Text className="flex-1 font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
          {agent.name === "build"
            ? "Build"
            : agent.name === "plan"
              ? "Plan"
              : agent.name}
        </Text>
        <Badge variant="secondary">Built-in</Badge>
      </View>
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {agent.description}
      </Text>
    </View>
  );
}

function AgentRow({
  agent,
  busyKey,
  onDelete,
  onExport,
  onOpen,
  onToggle,
}: {
  agent: AgentConfig;
  busyKey: string | null;
  onDelete: () => void;
  onExport: () => void;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const theme = useTheme();

  return (
    <View className="gap-sp-3 px-sp-4 py-sp-4">
      <Pressable
        accessibilityRole="button"
        className="flex-row items-start gap-sp-3"
        onPress={onOpen}
        style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
      >
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
            {agent.name}
          </Text>
          {agent.description ? (
            <Text
              className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
              numberOfLines={2}
            >
              {agent.description}
            </Text>
          ) : null}
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {agentModeLabel(agent.mode)}
          </Text>
        </View>
        <View pointerEvents="none">
          <Checkbox checked={agent.enabled} onCheckedChange={() => {}} />
        </View>
      </Pressable>
      <View className="flex-row flex-wrap gap-sp-2">
        <Button
          disabled={busyKey === `toggle:${agent.id}`}
          onPress={() => onToggle(!agent.enabled)}
          size="sm"
          variant="outline"
        >
          {agent.enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          leftIcon={<Copy color={theme.text} size={14} />}
          loading={busyKey === `export:${agent.id}`}
          onPress={onExport}
          size="sm"
          variant="ghost"
        >
          Copy
        </Button>
        <Button
          leftIcon={<Trash2 color={theme.destructive} size={14} />}
          loading={busyKey === `delete:${agent.id}`}
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
