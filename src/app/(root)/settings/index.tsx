import { useRouter } from "expo-router";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { SearchBox } from "@/components/shared/search-box";
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
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { DatabaseMode, ModelRef } from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useAppState } from "@/hooks/use-app-state";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { countEnabledBuiltInFileTools } from "@/modules/config/built-in-tools";
import { useUpdate } from "@/providers/check-for-updates";
import {
  isBackgroundAgentHeld,
  isIgnoringBatteryOptimizations,
  openBatteryOptimizationSettings,
  requestBatteryOptimizationExemption,
} from "background-agent-service";

type DrawerKey =
  | "current-model"
  | "db"
  | "theme"
  | "background"
  | "notifications"
  | null;

export default function SettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { error, hydrating, ready } = useAppState();
  const {
    activeModels,
    agents,
    currentModel,
    databaseMode,
    databaseUrl,
    memoryEnabled,
    refresh,
    schedules,
    schedulingEnabled,
    selectModel,
    mcpServers,
    notificationSettings,
    savedPrompts,
    skills,
    themeMode,
    toolSettings,
    updateDatabaseSettings,
    updateNotificationSettings,
    updateThemeMode,
    providers,
  } = useConfig();
  const { release, installing, installUpdate } = useUpdate();
  const [databaseUrlInput, setDatabaseUrlInput] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openDrawer, setOpenDrawer] = useState<DrawerKey>(null);
  const [agentActive, setAgentActive] = useState(false);
  const [batteryOptimizationGranted, setBatteryOptimizationGranted] = useState<
    boolean | null
  >(null);

  useEffect(() => {
    setDatabaseUrlInput(databaseUrl ?? "");
  }, [databaseUrl]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const poll = setInterval(async () => {
      setAgentActive(await isBackgroundAgentHeld());
      setBatteryOptimizationGranted(await isIgnoringBatteryOptimizations());
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  const providerCount = providers.length;
  const enabledToolCount = countEnabledBuiltInFileTools(toolSettings);
  const enabledMcpServerCount = mcpServers.filter(
    (server) => server.enabled,
  ).length;
  const enabledSkillCount = skills.filter((skill) => skill.enabled).length;
  const modelSearchQuery = modelSearch.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    if (!modelSearchQuery) {
      return activeModels;
    }

    return activeModels.filter(
      (model) =>
        model.label.toLowerCase().includes(modelSearchQuery) ||
        model.providerLabel.toLowerCase().includes(modelSearchQuery),
    );
  }, [activeModels, modelSearchQuery]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);

    try {
      await action();
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
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => {
            router.push("/");
          }}
          size="icon-xs"
          variant="ghost"
        />
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Settings
        </Text>
      </View>

      <Card className="overflow-hidden">
        <SettingsLinkRow
          label="Providers"
          onPress={() => {
            router.push("/settings/providers");
          }}
          value={providerCount !== null ? `${providerCount}` : undefined}
        />
        <Separator />
        <SettingsLinkRow
          label="Built-in tools"
          onPress={() => {
            router.push("/settings/tools");
          }}
          value={`${enabledToolCount} active`}
        />
        <Separator />
        <SettingsLinkRow
          label="MCP servers"
          onPress={() => {
            router.push("/settings/mcp/connected" as never);
          }}
          value={`${enabledMcpServerCount} active`}
        />
        <Separator />
        <SettingsLinkRow
          label="Skills"
          onPress={() => {
            router.push("/settings/skills" as never);
          }}
          value={`${enabledSkillCount} active`}
        />
        <Separator />
        <SettingsLinkRow
          label="Agents"
          onPress={() => {
            router.push("/settings/agents" as never);
          }}
          value={`${agents.length} custom`}
        />
        <Separator />
        <SettingsLinkRow
          label="Saved prompts"
          onPress={() => {
            router.push("/settings/prompts" as never);
          }}
          value={`${savedPrompts.length}`}
        />
        <Separator />
        <SettingsLinkRow
          label="Memory"
          onPress={() => {
            router.push("/settings/memory" as never);
          }}
          value={memoryEnabled ? "Local" : "Disabled"}
        />
        <Separator />
        <SettingsLinkRow
          label="Jobs"
          onPress={() => {
            router.push("/settings/jobs" as never);
          }}
          value={
            schedulingEnabled
              ? `${schedules.filter((schedule) => schedule.enabled).length} active`
              : "Off"
          }
        />
        <Separator />
        <Drawer
          onOpenChange={(open) => {
            setOpenDrawer(open ? "background" : null);
          }}
          open={openDrawer === "background"}
        >
          <DrawerTrigger asChild>
            <SettingsLinkRow
              label="Background agent"
              value={
                batteryOptimizationGranted === null
                  ? "…"
                  : batteryOptimizationGranted
                    ? agentActive
                      ? "Active"
                      : "Ready"
                    : "Permission needed"
              }
            />
          </DrawerTrigger>
          <DrawerContent showCloseButton>
            <DrawerHeader>
              <DrawerTitle>Background agent</DrawerTitle>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="gap-sp-2">
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Keeps the agent running when the app is in the background. Uses
                a foreground service + wake lock (Android).
              </Text>

              {Platform.OS === "android" ? (
                <View className="flex-row items-center justify-between">
                  <View className="min-w-0 flex-1">
                    <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                      Battery optimization
                    </Text>
                    <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      Stops Android from killing the agent while it runs in the
                      background.
                    </Text>
                  </View>
                  <Checkbox
                    checked={batteryOptimizationGranted ?? false}
                    onCheckedChange={() => {
                      if (batteryOptimizationGranted) {
                        openBatteryOptimizationSettings().catch(() => {});
                      } else {
                        requestBatteryOptimizationExemption().catch(() => {});
                      }
                    }}
                  />
                </View>
              ) : null}
            </DrawerBody>
          </DrawerContent>
        </Drawer>
        <Separator />
        <Drawer
          onOpenChange={(open) => {
            setOpenDrawer(open ? "notifications" : null);
          }}
          open={openDrawer === "notifications"}
        >
          <DrawerTrigger asChild>
            <SettingsLinkRow
              label="Notifications"
              value={
                notificationSettings.approvalRequests ||
                notificationSettings.runFinished
                  ? "On"
                  : "Off"
              }
            />
          </DrawerTrigger>
          <DrawerContent showCloseButton>
            <DrawerHeader>
              <DrawerTitle>Notifications</DrawerTitle>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="gap-sp-2">
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Alerts sent even when the app is in the background.
              </Text>

              <View className="flex-row items-center justify-between">
                <View className="min-w-0 flex-1">
                  <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                    Approval requests
                  </Text>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    Alert when the agent asks permission to use a tool. Includes
                    Approve / Reject actions.
                  </Text>
                </View>
                <Checkbox
                  checked={notificationSettings.approvalRequests}
                  onCheckedChange={async (checked) => {
                    await updateNotificationSettings({
                      approvalRequests: checked,
                    });
                  }}
                />
              </View>

              <View className="flex-row items-center justify-between">
                <View className="min-w-0 flex-1">
                  <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                    Run finished
                  </Text>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    Alert when the agent finishes a task or fails.
                  </Text>
                </View>
                <Checkbox
                  checked={notificationSettings.runFinished}
                  onCheckedChange={async (checked) => {
                    await updateNotificationSettings({
                      runFinished: checked,
                    });
                  }}
                />
              </View>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
        <Separator />
        <Drawer
          onOpenChange={(open) => {
            setOpenDrawer(open ? "current-model" : null);
          }}
          open={openDrawer === "current-model"}
        >
          <DrawerTrigger asChild>
            <SettingsLinkRow
              label="Current model"
              value={currentModel?.label ?? "None"}
            />
          </DrawerTrigger>
          <DrawerContent showCloseButton>
            <DrawerBody>
              <SearchBox
                onChangeText={setModelSearch}
                placeholder="Search models"
                value={modelSearch}
              />
              {activeModels.length > 0 ? (
                filteredModels.length > 0 ? (
                  filteredModels.map((model) => {
                    const selected = currentModel?.ref === model.ref;

                    return (
                      <DrawerOptionRow
                        key={model.ref}
                        label={model.label}
                        onPress={() => {
                          runAction(`model:${model.ref}`, async () => {
                            await selectModel(model.ref as ModelRef);
                            setOpenDrawer(null);
                          }).catch(console.error);
                        }}
                        selected={selected}
                        subtitle={model.providerLabel}
                      />
                    );
                  })
                ) : (
                  <EmptyStateText>No models match “{modelSearch}”.</EmptyStateText>
                )
              ) : (
                <EmptyStateText>No active models</EmptyStateText>
              )}
            </DrawerBody>
            <DrawerFooter>
              <Button
                onPress={() => {
                  setOpenDrawer(null);
                  router.push("/settings/providers");
                }}
                variant="outline"
              >
                Manage providers
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
        <Separator />
        <Drawer
          onOpenChange={(open) => {
            setOpenDrawer(open ? "theme" : null);
          }}
          open={openDrawer === "theme"}
        >
          <DrawerTrigger asChild>
            <SettingsLinkRow
              label="Theme"
              value={
                themeMode === "system"
                  ? "System"
                  : themeMode === "dark"
                    ? "Dark"
                    : "Light"
              }
            />
          </DrawerTrigger>
          <DrawerContent showCloseButton>
            <DrawerHeader>
              <DrawerTitle>Theme</DrawerTitle>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="gap-sp-2">
              {(
                [
                  ["system", "System", "Follow your device appearance"],
                  ["light", "Light", "Always use the light theme"],
                  ["dark", "Dark", "Always use the dark theme"],
                ] as const
              ).map(([value, label, subtitle]) => (
                <DrawerOptionRow
                  key={value}
                  label={label}
                  onPress={() => {
                    runAction(`theme:${value}`, async () => {
                      await updateThemeMode(value);
                      setOpenDrawer(null);
                    }).catch(console.error);
                  }}
                  selected={themeMode === value}
                  subtitle={subtitle}
                />
              ))}
            </DrawerBody>
          </DrawerContent>
        </Drawer>
        <Separator />
        <Drawer
          onOpenChange={(open) => {
            setOpenDrawer(open ? "db" : null);
          }}
          open={openDrawer === "db"}
        >
          <DrawerTrigger asChild>
            <SettingsLinkRow
              label="Database"
              value={databaseMode === "local" ? "Local" : "Remote"}
            />
          </DrawerTrigger>
          <DrawerContent showCloseButton>
            <DrawerHeader>
              <DrawerTitle>Database</DrawerTitle>
            </DrawerHeader>
            <DrawerBody>
              <View className="flex-row gap-sp-2">
                <Button
                  className="flex-1"
                  onPress={() => {
                    runAction("db-mode-local", async () => {
                      await updateDatabaseSettings({
                        databaseMode: "local" as DatabaseMode,
                      });
                    }).catch(console.error);
                  }}
                  variant={databaseMode === "local" ? "default" : "outline"}
                >
                  Local
                </Button>
                <Button
                  className="flex-1"
                  onPress={() => {
                    runAction("db-mode-remote", async () => {
                      await updateDatabaseSettings({
                        databaseMode: "remote" as DatabaseMode,
                      });
                    }).catch(console.error);
                  }}
                  variant={databaseMode === "remote" ? "default" : "outline"}
                >
                  Remote
                </Button>
              </View>
              <View className="gap-sp-2">
                <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                  Database URL
                </Text>
                <Input
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={setDatabaseUrlInput}
                  placeholder="https://example-db.internal"
                  value={databaseUrlInput}
                />
              </View>
            </DrawerBody>
            <DrawerFooter>
              <View className="flex-row gap-sp-2">
                <Button
                  className="flex-1"
                  loading={busyKey === "db-url"}
                  onPress={() => {
                    runAction("db-url", async () => {
                      await updateDatabaseSettings({
                        databaseUrl: databaseUrlInput.trim() || null,
                      });
                    }).catch(console.error);
                  }}
                  variant="secondary"
                >
                  Save
                </Button>
                <Button
                  className="flex-1"
                  loading={busyKey === "db-clear"}
                  onPress={() => {
                    runAction("db-clear", async () => {
                      setDatabaseUrlInput("");
                      await updateDatabaseSettings({ databaseUrl: null });
                    }).catch(console.error);
                  }}
                  variant="outline"
                >
                  Clear
                </Button>
              </View>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Card>

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <Card className="overflow-hidden">
        <SettingsLinkRow
          label="App Update"
          value={
            installing
              ? "Downloading..."
              : release
                ? `Update ${release.tagName}`
                : "Up to date"
          }
          showChevron={!!release}
          disabled={installing}
          onPress={release ? installUpdate : undefined}
        />
        <Separator />
        <SettingsLinkRow
          disabled={!ready || hydrating || busyKey === "refresh"}
          label="Refresh config"
          onPress={() => {
            runAction("refresh", refresh).catch(console.error);
          }}
          showChevron={false}
          value={hydrating || busyKey === "refresh" ? "Loading..." : undefined}
        />
      </Card>
    </Container>
  );
}

function SettingsLinkRow({
  disabled = false,
  label,
  onPress,
  showChevron = true,
  value,
}: {
  disabled?: boolean;
  label: string;
  onPress?: () => void;
  showChevron?: boolean;
  value?: ReactNode;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className={cn(
        "min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3",
        disabled && "opacity-50",
      )}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => (pressed && !disabled ? { opacity: 0.82 } : null)}
    >
      <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text className="max-w-40 text-right font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {value}
        </Text>
      ) : (
        value
      )}
      {showChevron ? (
        <ChevronRight color={theme.textSecondary} size={18} />
      ) : null}
    </Pressable>
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

function EmptyStateText({ children }: { children: ReactNode }) {
  return (
    <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
      {children}
    </Text>
  );
}
