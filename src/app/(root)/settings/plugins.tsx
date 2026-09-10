import { useRouter } from "expo-router";
import { ChevronLeft, FileDown, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { PluginImportDrawer } from "@/components/plugins/plugin-import-drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";

export default function SettingsPluginsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { deletePlugin, plugins, updatePlugin } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const enabledCount = useMemo(
    () => plugins.filter((plugin) => plugin.enabled).length,
    [plugins],
  );

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Plugin action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Container scroll contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false}>
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.push("/settings")}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Plugins
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {enabledCount} active
          </Text>
        </View>
        <Button
          leftIcon={<FileDown color={theme.text} size={16} />}
          onPress={() => setImportOpen(true)}
          size="sm"
          variant="outline"
        >
          Import
        </Button>
      </View>

      {plugins.length === 0 ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No plugins installed.
          </Text>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {plugins.map((plugin, index) => (
            <View key={plugin.id}>
              <View className="gap-sp-3 px-sp-4 py-sp-4">
                <View className="gap-1">
                  <View className="flex-row items-center justify-between gap-sp-3">
                    <Text className="flex-1 font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                      {plugin.name}
                    </Text>
                    <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      v{plugin.version}
                    </Text>
                  </View>
                  {plugin.description ? (
                    <Text
                      className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                      numberOfLines={2}
                    >
                      {plugin.description}
                    </Text>
                  ) : null}
                  {plugin.lastError ? (
                    <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
                      {plugin.lastError}
                    </Text>
                  ) : null}
                </View>
                <View className="flex-row gap-sp-2">
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
                      runAction(`delete:${plugin.id}`, () => deletePlugin(plugin.id))
                    }
                    size="sm"
                    variant="ghost"
                  >
                    Delete
                  </Button>
                </View>
              </View>
              {index < plugins.length - 1 ? <Separator /> : null}
            </View>
          ))}
        </Card>
      )}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <PluginImportDrawer onOpenChange={setImportOpen} open={importOpen} />
    </Container>
  );
}
