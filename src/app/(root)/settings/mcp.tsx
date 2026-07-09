import { useRouter } from "expo-router";
import {
  ChevronLeft,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { isMcpOAuthCanceledError } from "@/lib/mcp/oauth";
import { cn } from "@/lib/utils";
import type {
  McpServerAuthMode,
  McpServerConfig,
  McpServerTransport,
} from "@/types/app-state";

type Draft = {
  authMode: McpServerAuthMode;
  enabled: boolean;
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

function parseHeaderText(value: string) {
  return Object.fromEntries(
    value
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(":");

        if (separator <= 0) {
          return null;
        }

        const name = line.slice(0, separator).trim();
        const headerValue = line.slice(separator + 1).trim();

        return name && headerValue ? [name, headerValue] : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );
}

function draftFromServer(server: McpServerConfig): Draft {
  return {
    authMode: server.authMode,
    enabled: server.enabled,
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

export default function SettingsMcpScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    clearMcpServerCredentials,
    connectMcpServerOAuth,
    createMcpServer,
    deleteMcpServer,
    mcpServers,
    testMcpServer,
    updateMcpServer,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showAdvancedOAuth, setShowAdvancedOAuth] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);

    try {
      await action();
    } catch (actionError) {
      if (isMcpOAuthCanceledError(actionError)) {
        return;
      }

      setError(
        actionError instanceof Error
          ? actionError.message
          : "MCP action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const openCreate = () => {
    setEditingServer(null);
    setDraft(EMPTY_DRAFT);
    setShowAdvancedOAuth(false);
    setOpen(true);
  };

  const openEdit = (server: McpServerConfig) => {
    setEditingServer(server);
    setDraft(draftFromServer(server));
    setShowAdvancedOAuth(
      Boolean(
        server.oauthAllowedAuthOrigin ||
          server.oauthAuthorizationUrl ||
          server.oauthClientId ||
          server.oauthScopes ||
          server.oauthTokenUrl,
      ),
    );
    setOpen(true);
  };

  const saveDraft = async () => {
    const label = draft.label.trim();
    const url = draft.url.trim();

    if (!label || !url) {
      throw new Error("Label and URL are required.");
    }

    const headerValues = draft.headerText.trim()
      ? parseHeaderText(draft.headerText)
      : undefined;

    if (editingServer) {
      await updateMcpServer(editingServer.id, {
        authMode: draft.authMode,
        enabled: draft.enabled,
        headerValues,
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
        headerValues: parseHeaderText(draft.headerText),
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

    setOpen(false);
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
        <Text className="flex-1 font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          MCP servers
        </Text>
        <Button
          leftIcon={<Plus color={theme.background} size={16} />}
          onPress={openCreate}
          size="sm"
        >
          Add
        </Button>
      </View>

      {mcpServers.length === 0 ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No MCP servers configured.
          </Text>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {mcpServers.map((server, index) => (
            <View key={server.id}>
              <ServerRow
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
                onEdit={() => openEdit(server)}
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
      )}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <Drawer
        onOpenChange={setOpen}
        open={open}
      >
        <DrawerContent showCloseButton>
          <DrawerHeader>
            <DrawerTitle>{editingServer ? "Edit MCP server" : "Add MCP server"}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <View className="gap-sp-3">
              <Field label="Label">
                <Input
                  onChangeText={(label) => setDraft((current) => ({ ...current, label }))}
                  placeholder="Linear"
                  value={draft.label}
                />
              </Field>
              <Field label="URL">
                <Input
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={(url) => setDraft((current) => ({ ...current, url }))}
                  placeholder="https://example.com/mcp"
                  value={draft.url}
                />
              </Field>
              <View className="flex-row gap-sp-2">
                <SegmentButton
                  active={draft.transport === "http"}
                  label="HTTP"
                  onPress={() => setDraft((current) => ({ ...current, transport: "http" }))}
                />
                <SegmentButton
                  active={draft.transport === "sse"}
                  label="SSE"
                  onPress={() => setDraft((current) => ({ ...current, transport: "sse" }))}
                />
              </View>
              <View className="flex-row gap-sp-2">
                {(["none", "headers", "oauth"] as const).map((authMode) => (
                  <SegmentButton
                    key={authMode}
                    active={draft.authMode === authMode}
                    label={authMode === "none" ? "None" : authMode === "headers" ? "Headers" : "OAuth"}
                    onPress={() => setDraft((current) => ({ ...current, authMode }))}
                  />
                ))}
              </View>
              {draft.authMode === "headers" ? (
                <Field
                  label={
                    editingServer?.headerNames.length
                      ? `Headers (${editingServer.headerNames.join(", ")})`
                      : "Headers"
                  }
                >
                  <Textarea
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(headerText) =>
                      setDraft((current) => ({ ...current, headerText }))
                    }
                    placeholder="Authorization: Bearer token"
                    value={draft.headerText}
                  />
                </Field>
              ) : null}
              {draft.authMode === "oauth" ? (
                <>
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    Most MCP servers only need the base URL above. OAuth endpoints
                    and client registration will be discovered automatically when
                    the server supports it.
                  </Text>
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
                      <Field label="Client ID (optional)">
                        <Input
                          autoCapitalize="none"
                          autoCorrect={false}
                          onChangeText={(oauthClientId) =>
                            setDraft((current) => ({ ...current, oauthClientId }))
                          }
                          placeholder="Use this if the server requires a pre-registered app"
                          value={draft.oauthClientId}
                        />
                      </Field>
                      <Field label="Authorization URL (optional)">
                        <Input
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                          onChangeText={(oauthAuthorizationUrl) =>
                            setDraft((current) => ({
                              ...current,
                              oauthAuthorizationUrl,
                            }))
                          }
                          placeholder="Override discovery only when needed"
                          value={draft.oauthAuthorizationUrl}
                        />
                      </Field>
                      <Field label="Token URL (optional)">
                        <Input
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                          onChangeText={(oauthTokenUrl) =>
                            setDraft((current) => ({ ...current, oauthTokenUrl }))
                          }
                          placeholder="Override discovery only when needed"
                          value={draft.oauthTokenUrl}
                        />
                      </Field>
                      <Field label="Scopes (optional)">
                        <Input
                          autoCapitalize="none"
                          autoCorrect={false}
                          onChangeText={(oauthScopes) =>
                            setDraft((current) => ({ ...current, oauthScopes }))
                          }
                          placeholder="openid profile offline_access"
                          value={draft.oauthScopes}
                        />
                      </Field>
                      <Field label="Allowed auth origin (optional)">
                        <Input
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                          onChangeText={(oauthAllowedAuthOrigin) =>
                            setDraft((current) => ({
                              ...current,
                              oauthAllowedAuthOrigin,
                            }))
                          }
                          placeholder="Restrict discovery to this auth origin"
                          value={draft.oauthAllowedAuthOrigin}
                        />
                      </Field>
                    </>
                  ) : null}
                </>
              ) : null}
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: draft.enabled }}
                className="min-h-12 flex-row items-center justify-between gap-sp-3"
                onPress={() =>
                  setDraft((current) => ({ ...current, enabled: !current.enabled }))
                }
              >
                <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                  Enabled
                </Text>
                <View pointerEvents="none">
                  <Checkbox
                    checked={draft.enabled}
                    onCheckedChange={() => {}}
                  />
                </View>
              </Pressable>
            </View>
          </DrawerBody>
          <DrawerFooter>
            <Button
              loading={busyKey === "save"}
              onPress={() => {
                runAction("save", saveDraft).catch(console.error);
              }}
            >
              Save
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Container>
  );
}

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
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
    <Button className="flex-1" onPress={onPress} variant={active ? "default" : "outline"}>
      {label}
    </Button>
  );
}

function ServerRow({
  busyKey,
  onClearCredentials,
  onConnectOAuth,
  onDelete,
  onEdit,
  onTest,
  onToggle,
  server,
}: {
  busyKey: string | null;
  onClearCredentials: () => void;
  onConnectOAuth: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: (enabled: boolean) => void;
  server: McpServerConfig;
}) {
  const theme = useTheme();
  const statusText =
    server.lastStatus === "connected"
      ? `${server.toolCount ?? 0} tools`
      : server.lastStatus === "failed"
        ? "Failed"
        : "Untested";

  return (
    <View className="gap-sp-3 px-sp-4 py-sp-4">
      <Pressable
        accessibilityRole="button"
        className="flex-row items-start gap-sp-3"
        onPress={onEdit}
        style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
      >
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center gap-sp-2">
            <Text className="min-w-0 flex-1 font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
              {server.label}
            </Text>
            <StatusPill status={server.lastStatus} text={statusText} />
          </View>
          <Text
            className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
            numberOfLines={1}
          >
            {server.transport.toUpperCase()} · {server.authMode} · {server.url}
          </Text>
          {server.lastError ? (
            <Text
              className="font-sans text-xs text-destructive dark:text-destructive-dark"
              numberOfLines={2}
            >
              {server.lastError}
            </Text>
          ) : null}
        </View>
        <View pointerEvents="none">
          <Checkbox
            checked={server.enabled}
            onCheckedChange={() => {}}
          />
        </View>
      </Pressable>
      <View className="flex-row flex-wrap gap-sp-2">
        <Button
          disabled={busyKey === `toggle:${server.id}`}
          onPress={() => onToggle(!server.enabled)}
          size="sm"
          variant="outline"
        >
          {server.enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          leftIcon={<RefreshCw color={theme.text} size={14} />}
          loading={busyKey === `test:${server.id}`}
          onPress={onTest}
          size="sm"
          variant="outline"
        >
          Test
        </Button>
        {server.authMode === "oauth" ? (
          <Button
            leftIcon={<KeyRound color={theme.text} size={14} />}
            loading={busyKey === `oauth:${server.id}`}
            onPress={onConnectOAuth}
            size="sm"
            variant="outline"
          >
            OAuth
          </Button>
        ) : null}
        <Button
          loading={busyKey === `clear:${server.id}`}
          onPress={onClearCredentials}
          size="sm"
          variant="ghost"
        >
          Clear auth
        </Button>
        <Button
          leftIcon={<Trash2 color={theme.destructive} size={14} />}
          loading={busyKey === `delete:${server.id}`}
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

function StatusPill({
  status,
  text,
}: {
  status: McpServerConfig["lastStatus"];
  text: string;
}) {
  return (
    <View
      className={cn(
        "rounded-ui border px-sp-2 py-1",
        status === "connected"
          ? "border-border bg-secondary dark:border-border-dark dark:bg-secondary-dark"
          : status === "failed"
            ? "border-destructive bg-destructive/10"
            : "border-border bg-secondary dark:border-border-dark dark:bg-secondary-dark",
      )}
    >
      <Text className="font-sans text-xs text-foreground dark:text-foreground-dark">
        {text}
      </Text>
    </View>
  );
}
