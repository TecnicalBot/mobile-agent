import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ChevronLeft, Copy, FileDown, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { AgentImportDrawer } from "@/components/agents/agent-import-drawer";
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
  const [importOpen, setImportOpen] = useState(false);

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

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => {
            router.push("/settings");
          }}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Agents
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {customAgents.length} custom · built-ins always available
          </Text>
        </View>
        <Button
          onPress={() => {
            router.push("/settings/agents/new" as never);
          }}
          size="sm"
        >
          New agent
        </Button>
        <Button
          leftIcon={<FileDown color={theme.text} size={16} />}
          onPress={() => setImportOpen(true)}
          size="icon-xs"
          variant="outline"
        />
      </View>

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
                onOpen={() =>
                  router.push(`/settings/agents/${agent.id}` as never)
                }
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

      <AgentImportDrawer onOpenChange={setImportOpen} open={importOpen} />
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
