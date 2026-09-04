import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";

import { cn } from "@/core/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawerBody, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  DrawerPager,
  DrawerPagerPage,
} from "@/components/ui/drawer-pager";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAppState } from "@/hooks/use-app-state";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  fetchMcpServerCatalogCached,
  type McpServerPreset,
} from "@/modules/mcp/catalog";
import type {
  McpServerAuthMode,
  McpServerConfig,
  McpServerTransport,
} from "@/core/types/app-state";

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

const AUTH_OPTIONS: {
  label: string;
  value: McpServerAuthMode;
  subtitle?: string;
}[] = [
  {
    label: "None",
    subtitle: "No authentication required",
    value: "none",
  },
  {
    label: "Headers",
    subtitle: "Send custom headers with each request",
    value: "headers",
  },
  {
    label: "OAuth",
    subtitle: "Authenticate using the OAuth flow",
    value: "oauth",
  },
];

function authModeLabel(mode: McpServerAuthMode): string {
  return AUTH_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

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

export function McpServerForm({
  onSaved,
  presetId,
  serverId,
  title,
}: {
  onSaved: () => void;
  presetId?: string;
  serverId?: string;
  title: string;
}) {
  const { ready } = useAppState();
  const { createMcpServer, mcpServers, updateMcpServer } = useConfig();
  const theme = useTheme();
  const targetServer = serverId
    ? mcpServers.find((server) => server.id === serverId)
    : null;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() =>
    !serverId && !presetId ? EMPTY_DRAFT : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (serverId) {
      if (!ready) return;

      if (!targetServer) {
        setError("MCP server not found.");
        return;
      }

      setDraft(draftFromServer(targetServer));
      setPage(0);
      return;
    }

    if (!presetId) {
      setDraft(EMPTY_DRAFT);
      return;
    }

    const controller = new AbortController();
    fetchMcpServerCatalogCached(controller.signal)
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
  }, [presetId, ready, serverId, targetServer]);

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

    onSaved();
  };

  return (
    <DrawerPager onPageChange={setPage} page={page}>
      <DrawerPagerPage>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="pb-sp-4">
          <View className="gap-sp-4">
            {draft ? (
            <View className="gap-sp-3">
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
                    setDraft((current) =>
                      current ? { ...current, url } : current,
                    )
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
              <View className="gap-sp-1">
                <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                  Authentication
                </Text>
                <Pressable
                  accessibilityLabel={`Authentication ${authModeLabel(draft.authMode)}`}
                  accessibilityRole="button"
                  className="min-h-12 flex-row items-center justify-between rounded-ui border border-border bg-input px-sp-3 dark:border-border-dark dark:bg-input-dark"
                  onPress={() => setPage(1)}
                >
                  <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                    {authModeLabel(draft.authMode)}
                  </Text>
                  <ChevronRight color={theme.textSecondary} size={20} />
                </Pressable>
              </View>
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
            </View>
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
            </View>
          </DrawerBody>
      </DrawerPagerPage>

      <DrawerPagerPage>
        <DrawerHeader className="flex-row items-center gap-sp-2">
          <Pressable
            accessibilityLabel="Back to server"
            className="h-9 w-9 items-center justify-center rounded-full"
            onPress={() => setPage(0)}
          >
            <ChevronLeft color={theme.text} size={22} />
          </Pressable>
          <DrawerTitle>Authentication</DrawerTitle>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="pb-sp-4">
        <View className="gap-sp-4">
          {draft ? (
            <View className="gap-sp-3">
              {AUTH_OPTIONS.map((option) => {
                const selected = draft.authMode === option.value;
                return (
                  <DrawerOptionRow
                    key={option.value}
                    label={option.label}
                    onPress={() =>
                      setDraft((current) =>
                        current ? { ...current, authMode: option.value } : current,
                      )
                    }
                    selected={selected}
                    subtitle={option.subtitle}
                  />
                );
              })}
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
                <AdvancedOauthRow onPress={() => setPage(2)} />
              ) : null}
            </View>
          ) : null}
          <Button onPress={() => setPage(0)}>Done</Button>
        </View>
        </DrawerBody>
      </DrawerPagerPage>

      <DrawerPagerPage>
        <DrawerHeader className="flex-row items-center gap-sp-2">
          <Pressable
            accessibilityLabel="Back to authentication"
            className="h-9 w-9 items-center justify-center rounded-full"
            onPress={() => setPage(1)}
          >
            <ChevronLeft color={theme.text} size={22} />
          </Pressable>
          <DrawerTitle>Advanced OAuth</DrawerTitle>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="pb-sp-4">
        <View className="gap-sp-4">
          {draft ? (
            <View className="gap-sp-3">
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
                    current ? { ...current, oauthAuthorizationUrl } : current,
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
                    current ? { ...current, oauthAllowedAuthOrigin } : current,
                  )
                }
                placeholder="Restrict discovery to this auth origin"
                value={draft.oauthAllowedAuthOrigin}
              />
            </View>
          ) : null}
          <Button onPress={() => setPage(1)}>Done</Button>
        </View>
        </DrawerBody>
      </DrawerPagerPage>
    </DrawerPager>
  );
}

function AdvancedOauthRow({ onPress }: { onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-12 flex-row items-center justify-between gap-sp-3 rounded-ui border border-border bg-input px-sp-3 dark:border-border-dark dark:bg-input-dark"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.86 } : null)}
    >
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        Advanced OAuth
      </Text>
      <ChevronRight color={theme.textSecondary} size={18} />
    </Pressable>
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

function DrawerOptionRow({
  label,
  onPress,
  selected = false,
  subtitle,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  subtitle?: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className={cn(
        "min-h-14 flex-row items-center gap-sp-3 rounded-ui border px-sp-4 py-sp-3",
        selected
          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark",
      )}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.86 } : null)}
    >
      <View className="flex-1 gap-1">
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          {label}
        </Text>
        {subtitle ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Check color={theme.text} size={18} /> : null}
    </Pressable>
  );
}
