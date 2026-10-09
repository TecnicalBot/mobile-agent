import { Redirect, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { PluginImportDrawer } from "@/components/plugins/plugin-import-drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAppState } from "@/hooks/use-app-state";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";

export default function ConnectedPluginsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { ready } = useAppState();
  const { plugins } = useConfig();
  const [importOpen, setImportOpen] = useState(false);
  const enabledCount = useMemo(
    () => plugins.filter((plugin) => plugin.enabled).length,
    [plugins],
  );

  if (ready && plugins.length === 0) {
    return <Redirect href={"/settings/plugins/list" as never} />;
  }

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
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Plugins
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {enabledCount} active
          </Text>
        </View>
        <Button
          className="ml-auto"
          leftIcon={<Plus color={theme.text} size={16} />}
          onPress={() => setImportOpen(true)}
          size="sm"
          variant="outline"
        >
          Add custom
        </Button>
      </View>

      {!ready ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Loading plugins…
          </Text>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            {plugins.map((plugin, index) => (
              <View key={plugin.id}>
                <Pressable
                  accessibilityRole="button"
                  className="flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
                  onPress={() =>
                    router.push(
                      `/settings/plugins/${encodeURIComponent(plugin.id)}` as never,
                    )
                  }
                  style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
                >
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text
                      className="font-sans text-base font-medium text-foreground dark:text-foreground-dark"
                      numberOfLines={1}
                    >
                      {plugin.name}
                    </Text>
                    <Text
                      className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                      numberOfLines={1}
                    >
                      {plugin.enabled
                        ? plugin.description || "Enabled"
                        : "Disabled"}
                    </Text>
                    {plugin.lastError ? (
                      <Text
                        className="font-sans text-xs text-destructive dark:text-destructive-dark"
                        numberOfLines={1}
                      >
                        {plugin.lastError}
                      </Text>
                    ) : null}
                  </View>
                  <ChevronRight color={theme.textSecondary} size={18} />
                </Pressable>
                {index < plugins.length - 1 ? <Separator /> : null}
              </View>
            ))}
          </Card>
          <Button
            leftIcon={<Plus color={theme.text} size={16} />}
            onPress={() => router.push("/settings/plugins/list" as never)}
            variant="outline"
          >
            Add more
          </Button>
        </>
      )}

      <PluginImportDrawer onOpenChange={setImportOpen} open={importOpen} />
    </Container>
  );
}