import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import type { BuiltInToolKey } from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useConfig } from "@/hooks/use-config";
import { isBuiltInFileToolEnabled } from "@/modules/config/built-in-tools";

type ToolControl = {
  keys: BuiltInToolKey[];
  label: string;
};

export function ToolToggleList({
  controls,
  disabled = false,
}: {
  controls: ToolControl[];
  disabled?: boolean;
}) {
  const { toolSettings, updateBuiltInToolSettings } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const setEnabled = async (control: ToolControl, enabled: boolean) => {
    const key = control.keys.join(",");
    const nextSettings = Object.fromEntries(
      control.keys.map((toolKey) => [toolKey, enabled]),
    ) as Partial<Record<BuiltInToolKey, boolean>>;

    setBusyKey(key);
    try {
      await updateBuiltInToolSettings(nextSettings);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      {controls.map((control, index) => {
        const key = control.keys.join(",");
        const checked = isBuiltInFileToolEnabled(
          toolSettings,
          control.keys,
        );
        const inactive = disabled || busyKey === key;

        return (
          <View key={control.label}>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked, disabled: inactive }}
              className={cn(
                "min-h-14 flex-row items-center justify-between gap-sp-3 px-sp-4 py-sp-3",
                inactive && "opacity-50",
              )}
              disabled={inactive}
              onPress={() => {
                setEnabled(control, !checked).catch(console.error);
              }}
              style={({ pressed }) =>
                pressed && !inactive ? { opacity: 0.82 } : null
              }
            >
              <Text
                className={cn(
                  "flex-1 font-sans text-base",
                  inactive
                    ? "text-muted-foreground dark:text-muted-foreground-dark"
                    : "text-foreground dark:text-foreground-dark",
                )}
              >
                {control.label}
              </Text>
              <View pointerEvents="none">
                <Checkbox checked={checked} onCheckedChange={() => {}} />
              </View>
            </Pressable>
            {index < controls.length - 1 ? <Separator /> : null}
          </View>
        );
      })}
    </Card>
  );
}
