import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { McpScreenHeader } from "@/components/settings/mcp/screen-header";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAppState } from "@/hooks/use-app-state";
import { useConfig } from "@/hooks/use-config";
import { fetchMcpServerCatalog, type McpServerPreset } from "@/lib/mcp/catalog";
import type {
  McpServerAuthMode,
  McpServerConfig,
  McpServerTransport,
} from "@/types/app-state";

type Draft = {
  authMode: McpServerAuthMode;
  enabled: boolean;
  headerPlaceholder: string;
  headerText: string;
  label: string;
  oauthAllowedAuthOrigin: string;
  oauthAuthorizationUrl: string;
  oauthClientId: string;
  oauthScopes: string;
  oauthTokenUrl: string;
  transport: McpServerTransport;
  url: string;
};

const EMPTY_DRAFT: Draft = {
  authMode: "none",
  enabled: true,
  headerPlaceholder: "",
  headerText: "",
  label: "",
  oauthAllowedAuthOrigin: "",
  oauthAuthorizationUrl: "",
  oauthClientId: "",
  oauthScopes: "",
  oauthTokenUrl: "",
  transport: "http",
  url: "",
};

function draftFromServer(server: McpServerConfig): Draft {
  return {
    authMode: server.authMode,
    enabled: server.enabled,
    headerPlaceholder: "",
    headerText: "",
    label: server.label,
    oauthAllowedAuthOrigin: server.oauthAllowedAuthOrigin ?? "",
    oauthAuthorizationUrl: server.oauthAuthorizationUrl ?? "",
    oauthClientId: server.oauthClientId ?? "",
    oauthScopes: server.oauthScopes ?? "",
    oauthTokenUrl: server.oauthTokenUrl ?? "",
    transport: server.transport,
    url: server.url,
  };
}

function draftFromPreset(preset: McpServerPreset): Draft {
  return {
    authMode: preset.authMode,
    enabled: true,
    headerPlaceholder: preset.headerTemplate ?? "",
    headerText: "",
    label: preset.label,
    oauthAllowedAuthOrigin: preset.oauthAllowedAuthOrigin ?? "",
    oauthAuthorizationUrl: preset.oauthAuthorizationUrl ?? "",
    oauthClientId: preset.oauthClientId ?? "",
    oauthScopes: preset.oauthScopes ?? "",
    oauthTokenUrl: preset.oauthTokenUrl ?? "",
    transport: preset.transport,
    url: preset.url,
  };
}

function parseHeaderText(value: string) {
  return Object.fromEntries(
    value
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator <= 0) return null;

        const name = line.slice(0, separator).trim();
        const headerValue = line.slice(separator + 1).trim();
        return name && headerValue ? [name, headerValue] : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );
}

export default function AddMcpServerScreen() {
  const router = useRouter();
  const { presetId, serverId } = useLocalSearchParams<{
    presetId?: string;
    serverId?: string;
  }>();
  const { hydrating, ready } = useAppState();
  const { createMcpServer, mcpServers, updateMcpServer } = useConfig();
  const targetServer = serverId
    ? mcpServers.find((server) => server.id === serverId)
    : null;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvancedOAuth, setShowAdvancedOAuth] = useState(false);

  useEffect(() => {
    if (!ready || hydrating) return;

    if (serverId) {
      if (!targetServer) {
        setError("MCP server not found.");
        return;
      }

      setDraft(draftFromServer(targetServer));
      setShowAdvancedOAuth(
        Boolean(
          targetServer.oauthAllowedAuthOrigin ||
          targetServer.oauthAuthorizationUrl ||
          targetServer.oauthClientId ||
          targetServer.oauthScopes ||
          targetServer.oauthTokenUrl,
        ),
      );
      return;
    }

    if (!presetId) {
      setDraft(EMPTY_DRAFT);
      return;
    }

    const controller = new AbortController();
    fetchMcpServerCatalog(controller.signal)
      .then((result) => {
        const preset = result.presets.find((item) => item.id === presetId);
        if (!preset) {
          setError("MCP catalog entry not found.");
          return;
        }
        setDraft(draftFromPreset(preset));
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the MCP catalog entry.",
        );
      });

    return () => controller.abort();
  }, [hydrating, presetId, ready, serverId, targetServer]);

  const save = async () => {
    if (!draft) return;

    const label = draft.label.trim();
    const url = draft.url.trim();
    if (!label || !url) {
      throw new Error("Label and URL are required.");
    }

    const parsedHeaders = parseHeaderText(draft.headerText);
    if (
      draft.authMode === "headers" &&
      !targetServer &&
      Object.keys(parsedHeaders).length === 0
    ) {
      throw new Error("Enter the required authentication header.");
    }

    if (targetServer) {
      await updateMcpServer(targetServer.id, {
        authMode: draft.authMode,
        enabled: draft.enabled,
        headerValues:
          Object.keys(parsedHeaders).length > 0 ? parsedHeaders : undefined,
        label,
        oauthAllowedAuthOrigin: draft.oauthAllowedAuthOrigin.trim() || null,
        oauthAuthorizationUrl: draft.oauthAuthorizationUrl.trim() || null,
        oauthClientId: draft.oauthClientId.trim() || null,
        oauthScopes: draft.oauthScopes.trim() || null,
        oauthTokenUrl: draft.oauthTokenUrl.trim() || null,
        transport: draft.transport,
        url,
      });
    } else {
      await createMcpServer({
        authMode: draft.authMode,
        enabled: draft.enabled,
        headerValues: parsedHeaders,
        label,
        oauthAllowedAuthOrigin: draft.oauthAllowedAuthOrigin.trim() || null,
        oauthAuthorizationUrl: draft.oauthAuthorizationUrl.trim() || null,
        oauthClientId: draft.oauthClientId.trim() || null,
        oauthScopes: draft.oauthScopes.trim() || null,
        oauthTokenUrl: draft.oauthTokenUrl.trim() || null,
        transport: draft.transport,
        url,
      });
    }

    router.replace("/settings/mcp/connected" as never);
  };

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <McpScreenHeader
        backHref={
          targetServer ? "/settings/mcp/connected" : "/settings/mcp/list"
        }
        title={targetServer ? "Edit MCP server" : "Add MCP server"}
      />

      {draft ? (
        <Card className="gap-sp-3 px-sp-4 py-sp-4">
          <Field label="Label">
            <Input
              onChangeText={(label) =>
                setDraft((current) =>
                  current ? { ...current, label } : current,
                )
              }
              placeholder="Linear"
              value={draft.label}
            />
          </Field>
          <Field label="URL">
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={(url) =>
                setDraft((current) => (current ? { ...current, url } : current))
              }
              placeholder="https://example.com/mcp"
              value={draft.url}
            />
          </Field>
          <View className="flex-row gap-sp-2">
            <SegmentButton
              active={draft.transport === "http"}
              label="HTTP"
              onPress={() =>
                setDraft((current) =>
                  current ? { ...current, transport: "http" } : current,
                )
              }
            />
            <SegmentButton
              active={draft.transport === "sse"}
              label="SSE"
              onPress={() =>
                setDraft((current) =>
                  current ? { ...current, transport: "sse" } : current,
                )
              }
            />
          </View>
          <View className="flex-row gap-sp-2">
            {(["none", "headers", "oauth"] as const).map((authMode) => (
              <SegmentButton
                key={authMode}
                active={draft.authMode === authMode}
                label={
                  authMode === "none"
                    ? "None"
                    : authMode === "headers"
                      ? "Headers"
                      : "OAuth"
                }
                onPress={() =>
                  setDraft((current) =>
                    current ? { ...current, authMode } : current,
                  )
                }
              />
            ))}
          </View>
          {draft.authMode === "headers" ? (
            <Field
              label={
                targetServer?.headerNames.length
                  ? `Headers (${targetServer.headerNames.join(", ")})`
                  : "Headers"
              }
            >
              <Textarea
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(headerText) =>
                  setDraft((current) =>
                    current ? { ...current, headerText } : current,
                  )
                }
                placeholder={
                  draft.headerPlaceholder || "Authorization: Bearer token"
                }
                value={draft.headerText}
              />
            </Field>
          ) : null}
          {draft.authMode === "oauth" ? (
            <>
              <Button
                onPress={() => setShowAdvancedOAuth((current) => !current)}
                size="sm"
                variant="outline"
              >
                {showAdvancedOAuth
                  ? "Hide advanced OAuth"
                  : "Show advanced OAuth"}
              </Button>
              {showAdvancedOAuth ? (
                <>
                  <OptionalInput
                    label="Client ID"
                    onChangeText={(oauthClientId) =>
                      setDraft((current) =>
                        current ? { ...current, oauthClientId } : current,
                      )
                    }
                    placeholder="Use this if the server requires a pre-registered app"
                    value={draft.oauthClientId}
                  />
                  <OptionalInput
                    keyboardType="url"
                    label="Authorization URL"
                    onChangeText={(oauthAuthorizationUrl) =>
                      setDraft((current) =>
                        current
                          ? { ...current, oauthAuthorizationUrl }
                          : current,
                      )
                    }
                    placeholder="Override discovery only when needed"
                    value={draft.oauthAuthorizationUrl}
                  />
                  <OptionalInput
                    keyboardType="url"
                    label="Token URL"
                    onChangeText={(oauthTokenUrl) =>
                      setDraft((current) =>
                        current ? { ...current, oauthTokenUrl } : current,
                      )
                    }
                    placeholder="Override discovery only when needed"
                    value={draft.oauthTokenUrl}
                  />
                  <OptionalInput
                    label="Scopes"
                    onChangeText={(oauthScopes) =>
                      setDraft((current) =>
                        current ? { ...current, oauthScopes } : current,
                      )
                    }
                    placeholder="openid profile offline_access"
                    value={draft.oauthScopes}
                  />
                  <OptionalInput
                    keyboardType="url"
                    label="Allowed auth origin"
                    onChangeText={(oauthAllowedAuthOrigin) =>
                      setDraft((current) =>
                        current
                          ? { ...current, oauthAllowedAuthOrigin }
                          : current,
                      )
                    }
                    placeholder="Restrict discovery to this auth origin"
                    value={draft.oauthAllowedAuthOrigin}
                  />
                </>
              ) : null}
            </>
          ) : null}
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: draft.enabled }}
            className="min-h-12 flex-row items-center justify-between gap-sp-3"
            onPress={() =>
              setDraft((current) =>
                current ? { ...current, enabled: !current.enabled } : current,
              )
            }
          >
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Enabled
            </Text>
            <View pointerEvents="none">
              <Checkbox checked={draft.enabled} onCheckedChange={() => {}} />
            </View>
          </Pressable>
        </Card>
      ) : !error ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Loading server configuration…
          </Text>
        </Card>
      ) : null}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      {draft ? (
        <Button
          loading={busy}
          onPress={() => {
            setBusy(true);
            setError(null);
            save()
              .catch((saveError) => {
                setError(
                  saveError instanceof Error
                    ? saveError.message
                    : "Could not save the MCP server.",
                );
              })
              .finally(() => setBusy(false));
          }}
        >
          Save
        </Button>
      ) : null}
    </Container>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View className="gap-sp-2">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      {children}
    </View>
  );
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Button
      className="flex-1"
      onPress={onPress}
      variant={active ? "default" : "outline"}
    >
      {label}
    </Button>
  );
}

function OptionalInput({
  keyboardType,
  label,
  onChangeText,
  placeholder,
  value,
}: {
  keyboardType?: "url";
  label: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <Field label={`${label} (optional)`}>
      <Input
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        value={value}
      />
    </Field>
  );
}
