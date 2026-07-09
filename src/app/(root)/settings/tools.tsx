import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  BUILT_IN_FILE_TOOL_CONTROLS,
  isBuiltInFileToolEnabled,
} from "@/lib/config/built-in-tools";
import { cn } from "@/lib/utils";
import type { BuiltInToolKey } from "@/types/app-state";

export default function SettingsToolsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    toolApprovalMode,
    toolSettings,
    updateBuiltInToolSettings,
    updateToolApprovalMode,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);

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
    </Container>
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
