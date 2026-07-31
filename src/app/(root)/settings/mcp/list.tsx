import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { McpScreenHeader } from "@/components/settings/mcp/screen-header";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { fetchMcpServerCatalog, type McpServerPreset } from "@/modules/mcp/catalog";
import { isMcpOAuthCanceledError } from "@/modules/mcp/oauth";

import { McpServerForm } from "./add";

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
  const { createMcpServerOAuth, mcpServers } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogPresets, setCatalogPresets] = useState<McpServerPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [setupPresetId, setSetupPresetId] = useState<string | null>(null);
  const [setupDrawerOpen, setSetupDrawerOpen] = useState(false);

  const loadCatalog = async (signal?: AbortSignal) => {
    setCatalogLoading(true);
    setCatalogError(null);

    try {
      const result = await fetchMcpServerCatalog(signal);
      setCatalogPresets(result.presets);
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
      setSetupPresetId(preset.id);
      setSetupDrawerOpen(true);
      return;
    }

    setBusyKey(preset.id);
    setError(null);

    try {
      await createMcpServerOAuth({
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

      router.replace("/settings/mcp/connected" as never);
    } catch (connectError) {
      if (isMcpOAuthCanceledError(connectError)) return;
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
            onPress={() => {
              setSetupPresetId(null);
              setSetupDrawerOpen(true);
            }}
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
            onPress={() => {
              setSetupPresetId(null);
              setSetupDrawerOpen(true);
            }}
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

      <Drawer onOpenChange={setSetupDrawerOpen} open={setupDrawerOpen}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Set up MCP server</DrawerTitle>
            <DrawerDescription>
              Review the connection and authentication settings before adding
              this server.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="pb-sp-4">
            <McpServerForm
              key={setupPresetId ?? "custom"}
              onSaved={() => {
                setSetupDrawerOpen(false);
                router.replace("/settings/mcp/connected" as never);
              }}
              presetId={setupPresetId ?? undefined}
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
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
        {connected ? "Added" : "Set up"}
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
        Set up
      </Button>
    </View>
  );
}
