import { Redirect, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { McpScreenHeader } from "@/components/settings/mcp/screen-header";
import { McpServerRow } from "@/components/settings/mcp/server-row";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppState } from "@/hooks/use-app-state";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { isMcpOAuthCanceledError } from "@/modules/mcp/oauth";

export default function ConnectedMcpServersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { ready } = useAppState();
  const {
    clearMcpServerCredentials,
    connectMcpServerOAuth,
    deleteMcpServer,
    mcpServers,
    testMcpServer,
    updateMcpServer,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);

    try {
      await action();
    } catch (actionError) {
      if (isMcpOAuthCanceledError(actionError)) return;
      setError(
        actionError instanceof Error
          ? actionError.message
          : "MCP action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  if (ready && mcpServers.length === 0) {
    return <Redirect href={"/settings/mcp/list" as never} />;
  }

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <McpScreenHeader
        action={
          <Button
            className="ml-auto"
            leftIcon={<Plus color={theme.text} size={16} />}
            onPress={() => router.push("/settings/mcp/add" as never)}
            size="sm"
            variant="outline"
          >
            Add custom
          </Button>
        }
        backHref="/settings"
        title="MCP servers"
      />

      {!ready ? (
        <Card
          accessibilityLabel="Loading connected servers"
          className="gap-sp-3 px-sp-4 py-sp-4"
        >
          {[0, 1, 2].map((item) => (
            <View key={item} className="flex-row items-center gap-sp-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <View className="flex-1 gap-sp-2">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </View>
            </View>
          ))}
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            {mcpServers.map((server, index) => (
              <View key={server.id}>
                <McpServerRow
                  busyKey={busyKey}
                  onClearCredentials={() =>
                    runAction(`clear:${server.id}`, async () => {
                      await clearMcpServerCredentials(server.id);
                    })
                  }
                  onConnectOAuth={() =>
                    runAction(`oauth:${server.id}`, async () => {
                      await connectMcpServerOAuth(server.id);
                    })
                  }
                  onDelete={() =>
                    runAction(`delete:${server.id}`, async () => {
                      await deleteMcpServer(server.id);
                    })
                  }
                  onEdit={() =>
                    router.push({
                      pathname: "/settings/mcp/add" as never,
                      params: { serverId: server.id },
                    })
                  }
                  onTest={() =>
                    runAction(`test:${server.id}`, async () => {
                      await testMcpServer(server.id);
                    })
                  }
                  onToggle={(enabled) =>
                    runAction(`toggle:${server.id}`, async () => {
                      await updateMcpServer(server.id, { enabled });
                    })
                  }
                  server={server}
                />
                {index < mcpServers.length - 1 ? <Separator /> : null}
              </View>
            ))}
          </Card>
          <Button
            leftIcon={<Plus color={theme.text} size={16} />}
            onPress={() => router.push("/settings/mcp/list" as never)}
            variant="outline"
          >
            Add more
          </Button>
        </>
      )}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}
    </Container>
  );
}
