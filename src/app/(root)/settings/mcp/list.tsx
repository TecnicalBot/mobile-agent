import { useRouter } from "expo-router";
import { RefreshCw } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { McpScreenHeader } from "@/components/settings/mcp/screen-header";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { fetchMcpServerCatalog, type McpServerPreset } from "@/lib/mcp/catalog";
import { isMcpOAuthCanceledError } from "@/lib/mcp/oauth";

function normalizeMcpUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

export default function McpCatalogScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { connectMcpServerOAuth, createMcpServer, mcpServers } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogPresets, setCatalogPresets] = useState<McpServerPreset[]>([]);
  const [catalogSource, setCatalogSource] = useState<
    "bundled" | "github" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = async (signal?: AbortSignal) => {
    setCatalogLoading(true);
    setCatalogError(null);

    try {
      const result = await fetchMcpServerCatalog(signal);
      setCatalogPresets(result.presets);
      setCatalogSource(result.source);
    } catch (catalogLoadError) {
      if (signal?.aborted) return;
      setCatalogError(
        catalogLoadError instanceof Error
          ? catalogLoadError.message
          : "Could not load MCP connections.",
      );
    } finally {
      if (!signal?.aborted) setCatalogLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal).catch(console.error);
    return () => controller.abort();
  }, []);

  const connectPreset = async (preset: McpServerPreset) => {
    if (preset.authMode !== "oauth") {
      router.push({
        pathname: "/settings/mcp/add" as never,
        params: { presetId: preset.id },
      });
      return;
    }

    setBusyKey(preset.id);
    setError(null);

    try {
      const server = await createMcpServer({
        authMode: preset.authMode,
        enabled: true,
        label: preset.label,
        oauthAllowedAuthOrigin: preset.oauthAllowedAuthOrigin,
        oauthAuthorizationUrl: preset.oauthAuthorizationUrl,
        oauthClientId: preset.oauthClientId,
        oauthScopes: preset.oauthScopes,
        oauthTokenUrl: preset.oauthTokenUrl,
        transport: preset.transport,
        url: preset.url,
      });

      try {
        await connectMcpServerOAuth(server.id);
      } catch (oauthError) {
        if (!isMcpOAuthCanceledError(oauthError)) throw oauthError;
      }

      router.replace("/settings/mcp/connected" as never);
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Could not connect the MCP server.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <McpScreenHeader
        backHref={
          mcpServers.length > 0 ? "/settings/mcp/connected" : "/settings"
        }
        title="Add MCP server"
      />

      {catalogPresets.length > 0 ? (
        <Card className="overflow-hidden">
          {catalogPresets.map((preset) => {
            const connected = mcpServers.some(
              (server) =>
                normalizeMcpUrl(server.url) === normalizeMcpUrl(preset.url),
            );

            return (
              <View key={preset.id}>
                <PresetRow
                  busy={busyKey === preset.id}
                  connected={connected}
                  onPress={() => connectPreset(preset).catch(console.error)}
                  preset={preset}
                />
                <Separator />
              </View>
            );
          })}
          <CustomRow
            onPress={() => router.push("/settings/mcp/add" as never)}
          />
        </Card>
      ) : catalogLoading ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Loading preconfigured MCP servers…
          </Text>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CustomRow
            onPress={() => router.push("/settings/mcp/add" as never)}
          />
        </Card>
      )}

      {catalogError ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {catalogError}
        </Text>
      ) : null}
      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}
    </Container>
  );
}

function PresetRow({
  busy,
  connected,
  onPress,
  preset,
}: {
  busy: boolean;
  connected: boolean;
  onPress: () => void;
  preset: McpServerPreset;
}) {
  return (
    <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-4">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
          {preset.label}
        </Text>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {preset.description}
        </Text>
      </View>
      <Button
        disabled={connected}
        loading={busy}
        onPress={onPress}
        size="sm"
        variant={connected ? "secondary" : "outline"}
      >
        {connected ? "Added" : preset.authMode === "oauth" ? "Connect" : "Add"}
      </Button>
    </View>
  );
}

function CustomRow({ onPress }: { onPress: () => void }) {
  return (
    <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-4">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
          Custom
        </Text>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Connect an MCP server using your own URL and authentication settings.
        </Text>
      </View>
      <Button onPress={onPress} size="sm" variant="outline">
        Add
      </Button>
    </View>
  );
}
