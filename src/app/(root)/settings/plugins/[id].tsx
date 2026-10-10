import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, KeyRound, Pencil, Plus, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import {
  PluginCapabilityRunner,
  type PluginCapability,
} from "@/components/plugins/plugin-capability-runner";
import type { PluginRunArgs } from "@/components/plugins/plugin-capability-form";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SecretEntryDialog } from "@/components/ui/secret-request-dialog";
import { Separator } from "@/components/ui/separator";
import { secureSecretStore } from "@/core/services/secrets";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import type {
  PluginProgressUpdate,
  PluginToolResult,
} from "@/modules/plugins/types";

export default function SettingsPluginDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    deletePlugin,
    pluginActions,
    plugins,
    pluginTools,
    runPluginAction,
    runPluginTool,
    updatePlugin,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configuredKeys, setConfiguredKeys] = useState<string[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addingSecret, setAddingSecret] = useState(false);

  const plugin = plugins.find((item) => item.id === id);

  const refreshConfiguredKeys = useCallback(async () => {
    if (!id) return;
    const keys = await secureSecretStore.listPluginSecretKeys(id);
    setConfiguredKeys(keys);
    setEditingKey(null);
    setAddingSecret(false);
  }, [id]);

  useEffect(() => {
    refreshConfiguredKeys().catch(() => setConfiguredKeys([]));
  }, [refreshConfiguredKeys]);

  if (!plugin) {
    return (
      <Container
        scroll
        contentClassName="gap-sp-4 py-sp-4"
        includeBottomTabInset={false}
      >
        <View className="flex-row items-center gap-sp-2">
          <Button
            leftIcon={<ChevronLeft color={theme.text} size={16} />}
            onPress={() => router.back()}
            size="icon-xs"
            variant="ghost"
          />
          <Text className="min-w-0 flex-1 font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Plugin
          </Text>
        </View>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Plugin not found.
        </Text>
      </Container>
    );
  }

  const capabilities: PluginCapability[] = [
    ...pluginTools
      .filter((tool) => tool.pluginId === plugin.id)
      .map((tool) => ({
        description: tool.description,
        inputSchema: tool.inputSchema,
        kind: "tool" as const,
        mutating: tool.mutating,
        name: tool.name,
        title: tool.name,
      })),
    ...pluginActions
      .filter((action) => action.pluginId === plugin.id)
      .map((action) => ({
        description: action.description,
        inputSchema: action.inputSchema,
        kind: "action" as const,
        mutating: action.mutating,
        name: action.name,
        title: action.title || action.name,
      })),
  ];

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Plugin action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleRunCapability =
    (capability: PluginCapability) =>
    (
      args: PluginRunArgs,
      onProgress?: (update: PluginProgressUpdate) => void,
    ): Promise<PluginToolResult> =>
      capability.kind === "action"
        ? runPluginAction(plugin.id, capability.name, args, onProgress)
        : runPluginTool(plugin.id, capability.name, args, onProgress);

  const handleSaveSecret = (value: string, key: string) => {
    return runAction(`save:${key}`, async () => {
      if (value) await secureSecretStore.setPluginSecret(plugin.id, key, value);
      await refreshConfiguredKeys();
    });
  };

  const handleDeleteSecret = (key: string) => {
    return runAction(`clear:${key}`, async () => {
      await secureSecretStore.deletePluginSecret(plugin.id, key);
      await refreshConfiguredKeys();
    });
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
          onPress={() => router.back()}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text
            className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark"
            numberOfLines={1}
          >
            {plugin.name}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            v{plugin.version}
            {plugin.sourceUrl ? " · auto-updates on" : ""}
          </Text>
        </View>
      </View>

      <Card className="gap-sp-3 px-sp-4 py-sp-4">
        <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
          {plugin.description || "No description."}
        </Text>
        {plugin.lastError ? (
          <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
            {plugin.lastError}
          </Text>
        ) : null}
        <View className="flex-row flex-wrap gap-sp-2">
          <Button
            loading={busyKey === `toggle:${plugin.id}`}
            onPress={() =>
              runAction(`toggle:${plugin.id}`, () =>
                updatePlugin(plugin.id, { enabled: !plugin.enabled }),
              )
            }
            size="sm"
            variant="outline"
          >
            {plugin.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            leftIcon={<Trash2 color={theme.destructive} size={14} />}
            loading={busyKey === `delete:${plugin.id}`}
            onPress={() =>
              runAction(`delete:${plugin.id}`, () =>
                deletePlugin(plugin.id).then(() => router.back()),
              )
            }
            size="sm"
            variant="ghost"
          >
            Delete
          </Button>
        </View>
      </Card>

      <View className="gap-sp-2">
        <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
          Tools & actions
        </Text>
        {capabilities.length === 0 ? (
          <Card className="px-sp-4 py-sp-4">
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              This plugin defines no tools or actions.
            </Text>
          </Card>
        ) : (
          <View className="overflow-hidden rounded-ui border border-border dark:border-border-dark">
            {capabilities.map((capability, index) => (
              <View key={`${capability.kind}:${capability.name}`}>
                {index > 0 ? <Separator /> : null}
                <PluginCapabilityRunner
                  capability={capability}
                  onRun={handleRunCapability(capability)}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      <View className="gap-sp-2">
        <View className="flex-row items-center gap-sp-2">
          <KeyRound color={theme.text} size={16} />
          <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
            Secrets
          </Text>
        </View>
        <Card className="overflow-hidden">
          {configuredKeys.length === 0 ? (
            <Text className="px-sp-4 py-sp-3 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              No secret keys configured yet.
            </Text>
          ) : (
            configuredKeys.map((key, index) => (
                <View key={key}>
                  {index > 0 ? <Separator /> : null}
                    <View className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3">
                      <Text numberOfLines={1} className="min-w-0 flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
                        {key}
                      </Text>
                        <View className="flex-row gap-sp-2">
                          <Button
                            accessibilityLabel={`Edit ${key}`}
                            disabled={busyKey !== null}
                            onPress={() => { setError(null); setEditingKey(key); }}
                            size="icon-xs"
                            variant="ghost"
                          >
                            <Pencil color={theme.text} size={16} />
                          </Button>
                          <Button
                            accessibilityLabel={`Delete ${key}`}
                            disabled={busyKey !== null}
                            loading={busyKey === `clear:${key}`}
                            onPress={() => handleDeleteSecret(key)}
                            size="icon-xs"
                            variant="ghost"
                          >
                            <Trash2 color={theme.destructive} size={16} />
                          </Button>
                        </View>
                    </View>
                </View>
            ))
          )}
        </Card>
            <Button
              leftIcon={<Plus color={theme.text} size={16} />}
              onPress={() => { setError(null); setAddingSecret(true); }}
              variant="outline"
            >
              Add
            </Button>
      </View>

      {addingSecret || editingKey !== null ? (
        <SecretEntryDialog
          key={editingKey ?? "new"}
          title={addingSecret ? "Add secret" : "Edit secret"}
          description=""
          showContext={false}
          cancelLabel="Cancel"
          editableKey={addingSecret}
          secretRequest={{
            pluginName: plugin.name,
            key: editingKey ?? "",
            purpose: null,
            alreadyConfigured: editingKey !== null,
          }}
          loading={busyKey !== null}
          error={error}
          onSubmit={handleSaveSecret}
          onDismiss={() => { setAddingSecret(false); setEditingKey(null); setError(null); }}
        />
      ) : null}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}
    </Container>
  );
}
