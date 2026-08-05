import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Platform, Text, TextInput, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  BUILT_IN_FILE_TOOL_CONTROLS,
  DEVICE_TOOL_CONTROLS,
  isBuiltInFileToolEnabled,
} from "@/modules/config/built-in-tools";
import {
  isAccessibilityEnabled,
  isScreenCaptureActive,
  openAccessibilitySettings,
  requestScreenCapturePermission,
} from "device-automation";
import { cn } from "@/core/utils";
import type { BuiltInToolKey } from "@/core/types/app-state";

export default function SettingsToolsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    toolApprovalMode,
    maxToolSteps,
    toolSettings,
    updateBuiltInToolSettings,
    updateToolApprovalMode,
    updateMaxToolSteps,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState(String(maxToolSteps));
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const [screenCaptureActive, setScreenCaptureActive] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    let active = true;
    const refresh = async () => {
      const enabled = await isAccessibilityEnabled();
      if (active) setAccessibilityEnabled(enabled);
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    let active = true;
    const refresh = async () => {
      const enabled = await isScreenCaptureActive();
      if (active) setScreenCaptureActive(enabled);
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);

    try {
      await action();
    } finally {
      setBusyKey(null);
    }
  };

  const setBuiltInToolEnabled = (keys: BuiltInToolKey[], enabled: boolean) => {
    const nextSettings = Object.fromEntries(
      keys.map((key) => [key, enabled]),
    ) as Partial<Record<BuiltInToolKey, boolean>>;

    runAction(`tool:${keys.join(",")}`, async () => {
      await updateBuiltInToolSettings(nextSettings);
    }).catch(console.error);
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
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Built-in tools
        </Text>
      </View>

      <Card className="overflow-hidden">
        <View className="gap-sp-3 px-sp-4 py-sp-4">
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            Tool approval
          </Text>
          <View className="flex-row gap-sp-2">
            <ApprovalModeButton
              active={toolApprovalMode === "ask"}
              disabled={busyKey === "approval-mode:ask"}
              label="Always ask"
              onPress={() => {
                runAction("approval-mode:ask", async () => {
                  await updateToolApprovalMode("ask");
                }).catch(console.error);
              }}
            />
            <ApprovalModeButton
              active={toolApprovalMode === "auto"}
              disabled={busyKey === "approval-mode:auto"}
              label="Always allow"
              onPress={() => {
                runAction("approval-mode:auto", async () => {
                  await updateToolApprovalMode("auto");
                }).catch(console.error);
              }}
            />
          </View>
        </View>
      </Card>

      <Card className="overflow-hidden">
        <View className="gap-sp-2 px-sp-4 py-sp-4">
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            Maximum tool steps
          </Text>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Stop an agent loop after this many model steps (1–100).
          </Text>
          <View className="flex-row items-center gap-sp-2">
            <TextInput
              className="min-h-10 flex-1 rounded-md border border-border px-sp-3 text-foreground dark:border-border-dark dark:text-foreground-dark"
              keyboardType="number-pad"
              onChangeText={setStepDraft}
              value={stepDraft}
            />
            <Button
              disabled={busyKey === "max-tool-steps"}
              onPress={() => {
                const value = Number(stepDraft);
                if (!Number.isFinite(value)) {
                  setStepDraft(String(maxToolSteps));
                  return;
                }
                runAction("max-tool-steps", async () => {
                  const normalized = Math.max(1, Math.min(100, Math.round(value)));
                  await updateMaxToolSteps(normalized);
                  setStepDraft(String(normalized));
                }).catch(console.error);
              }}
              variant="outline"
            >
              Save
            </Button>
          </View>
        </View>
      </Card>

      <Card className="overflow-hidden">
        {BUILT_IN_FILE_TOOL_CONTROLS.map((item, index) => {
          const actionKey = `tool:${item.keys.join(",")}`;

          return (
            <View key={item.label}>
              <ToolToggleRow
                checked={isBuiltInFileToolEnabled(toolSettings, item.keys)}
                disabled={busyKey === actionKey}
                label={item.label}
                onCheckedChange={(checked) => {
                  setBuiltInToolEnabled(item.keys, checked);
                }}
              />
              {index < BUILT_IN_FILE_TOOL_CONTROLS.length - 1 ? <Separator /> : null}
            </View>
          );
        })}
      </Card>

      {Platform.OS === "android" ? (
        <Card className="overflow-hidden">
          <View className="gap-sp-3 px-sp-4 py-sp-4">
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Device automation
            </Text>
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Lets the agent read the screen and perform actions (tap, type,
              swipe, open apps, follow links) on your phone. Requires the
              accessibility service below. Tools are opt-in and individually
              listed.
            </Text>
            <AccessibilityStatusRow
              enabled={accessibilityEnabled}
              onEnable={() => {
                runAction("accessibility-enable", async () => {
                  await openAccessibilitySettings();
                }).catch(console.error);
              }}
            />
            <ScreenCaptureStatusRow
              active={screenCaptureActive}
              onEnable={() => {
                runAction("screen-capture-enable", async () => {
                  await requestScreenCapturePermission();
                }).catch(console.error);
              }}
            />
          </View>
          {DEVICE_TOOL_CONTROLS.map((item, index) => {
            const actionKey = `tool:${item.keys.join(",")}`;

            return (
              <View key={item.label}>
                <ToolToggleRow
                  checked={isBuiltInFileToolEnabled(toolSettings, item.keys)}
                  disabled={busyKey === actionKey}
                  label={item.label}
                  onCheckedChange={(checked) => {
                    setBuiltInToolEnabled(item.keys, checked);
                  }}
                />
                {index < DEVICE_TOOL_CONTROLS.length - 1 ? <Separator /> : null}
              </View>
            );
          })}
        </Card>
      ) : null}
    </Container>
  );
}

function AccessibilityStatusRow({
  enabled,
  onEnable,
}: {
  enabled: boolean;
  onEnable?: () => void;
}) {
  return (
    <View className="gap-sp-2">
      <View className="flex-row items-center gap-sp-2">
        <View
          className={cn(
            "size-2.5 rounded-full",
            enabled
              ? "bg-green-500"
              : "bg-muted-foreground dark:bg-muted-foreground-dark",
          )}
        />
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Accessibility service: {enabled ? "enabled" : "disabled"}
        </Text>
      </View>
      {!enabled ? (
        <Button onPress={onEnable} variant="outline">
          Enable accessibility service
        </Button>
      ) : null}
    </View>
  );
}

function ScreenCaptureStatusRow({
  active,
  onEnable,
}: {
  active: boolean;
  onEnable?: () => void;
}) {
  return (
    <View className="gap-sp-2">
      <View className="flex-row items-center gap-sp-2">
        <View
          className={cn(
            "size-2.5 rounded-full",
            active
              ? "bg-green-500"
              : "bg-muted-foreground dark:bg-muted-foreground-dark",
          )}
        />
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Screen capture: {active ? "active" : "not active"}
        </Text>
      </View>
      {!active ? (
        <Button onPress={onEnable} variant="outline">
          Enable screen capture
        </Button>
      ) : null}
    </View>
  );
}

function ApprovalModeButton({
  active,
  disabled = false,
  label,
  onPress,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onPress?: () => void;
}) {
  return (
    <Button
      accessibilityRole="button"
      className="flex-1"
      disabled={disabled}
      onPress={onPress}
      variant={active ? "default" : "outline"}
    >
      {label}
    </Button>
  );
}

function ToolToggleRow({
  checked,
  disabled = false,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      className={cn(
        "min-h-14 flex-row items-center justify-between gap-sp-3 px-sp-4 py-sp-3",
        disabled && "opacity-50",
      )}
      disabled={disabled}
      onPress={() => {
        onCheckedChange(!checked);
      }}
      style={({ pressed }) => (pressed && !disabled ? { opacity: 0.82 } : null)}
    >
      <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      <View pointerEvents="none">
        <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      </View>
    </Pressable>
  );
}
