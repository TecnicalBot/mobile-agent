import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  SquarePen,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { AgentCreateDrawer } from "@/components/agents/agent-create-drawer";
import { AgentEditorDrawer } from "@/components/agents/agent-editor-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentConfig } from "@/core/types/app-state";
import { useChat } from "@/hooks/use-chat";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { NATIVE_AGENTS } from "@/modules/agents/registry";

export default function SettingsAgentsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { createConversation } = useChat();
  const {
    agents,
    deleteAgent,
    exportAgentMarkdown,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);

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

  const startChatWithAgent = async (agent: AgentConfig) => {
    try {
      await createConversation({ agentId: agent.id });
      router.replace("/" as never);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Failed to start chat.",
      );
    }
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

      <Card className="overflow-hidden">
        <Pressable
          className="min-h-16 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
          onPress={() => router.push("/settings/built-in" as never)}
          style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
        >
          <View className="min-w-0 flex-1">
            <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              Built-in agents
            </Text>
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {NATIVE_AGENTS.length} available
            </Text>
          </View>
          <ChevronRight color={theme.textSecondary} size={18} />
        </Pressable>
      </Card>

      {agents.length > 0 ? (
        <>
          <Card className="overflow-hidden">
            {agents.map((agent, index) => (
              <View key={agent.id}>
                <CustomAgentRow
                  agent={agent}
                  busyKey={busyKey}
                  onChat={() => startChatWithAgent(agent)}
                  onDelete={() =>
                    runAction(`delete:${agent.id}`, async () => {
                      await deleteAgent(agent.id);
                    })
                  }
                  onEdit={() => {
                    setEditingAgent(agent);
                    setError(null);
                  }}
                  onExport={() =>
                    runAction(`export:${agent.id}`, async () => {
                      const markdown = exportAgentMarkdown(agent.id);
                      await Clipboard.setStringAsync(markdown);
                    })
                  }
                />
                {index < agents.length - 1 ? <Separator /> : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <AgentCreateDrawer
        onCreated={() => {
          setCreateOpen(false);
          setError(null);
        }}
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

function CustomAgentRow({
  agent,
  busyKey,
  onChat,
  onDelete,
  onEdit,
  onExport,
}: {
  agent: AgentConfig;
  busyKey: string | null;
  onChat: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onExport: () => void;
}) {
  const theme = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger triggerOn="longPress">
        <Pressable
          className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
          onPress={onChat}
          style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
        >
          <View className="min-w-0 flex-1">
            <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              {agent.name}
            </Text>
            {agent.description ? (
              <Text
                className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                numberOfLines={1}
              >
                {agent.description}
              </Text>
            ) : null}
          </View>
          {!agent.enabled ? (
            <Badge variant="secondary">Disabled</Badge>
          ) : null}
          <ChevronRight color={theme.textSecondary} size={18} />
        </Pressable>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onPress={onEdit}>
          <View className="flex-row items-center gap-sp-3">
            <SquarePen color={theme.text} size={16} />
            <Text className="text-foreground dark:text-foreground-dark">
              Edit
            </Text>
          </View>
        </DropdownMenuItem>
        <DropdownMenuItem
          onPress={onExport}
          disabled={busyKey === `export:${agent.id}`}
        >
          <View className="flex-row items-center gap-sp-3">
            <Copy color={theme.text} size={16} />
            <Text className="text-foreground dark:text-foreground-dark">
              Copy
            </Text>
          </View>
        </DropdownMenuItem>
        <DropdownMenuItem
          onPress={onDelete}
          disabled={busyKey === `delete:${agent.id}`}
        >
          <View className="flex-row items-center gap-sp-3">
            <Trash2 color={theme.destructive} size={16} />
            <Text className="text-destructive dark:text-destructive-dark">
              Delete
            </Text>
          </View>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
