import { useRouter } from "expo-router";
import { ChevronLeft, LoaderCircle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";
import {
  isAccessibilityEnabled,
  isAccessibilityPermissionGranted,
  openAccessibilitySettings,
} from "device-automation";

type AccessibilityStatus =
  | "working"
  | "granted_not_running"
  | "not_granted";

export default function SettingsDevicePermissionsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [accessibilityConnected, setAccessibilityConnected] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [connected, granted] = await Promise.all([
        isAccessibilityEnabled(),
        isAccessibilityPermissionGranted(),
      ]);
      if (!active) return;
      setAccessibilityConnected(connected);
      setAccessibilityGranted(granted);
    };

    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      await action();
    } finally {
      setBusyKey(null);
    }
  };

  const accessibilityStatus: AccessibilityStatus = !accessibilityGranted
    ? "not_granted"
    : accessibilityConnected
      ? "working"
      : "granted_not_running";

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.push("/settings/tools/device" as never)}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Permissions
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Required for device controls
          </Text>
        </View>
      </View>

      <Card className="overflow-hidden">
        <AccessibilityRow
          status={accessibilityStatus}
          loading={busyKey === "accessibility"}
          onPress={() => {
            runAction("accessibility", openAccessibilitySettings).catch(
              console.error,
            );
          }}
        />
      </Card>

      {accessibilityStatus === "granted_not_running" ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          The service was enabled in Settings but stopped running, usually
          because Android killed the app in the background. Open the system
          Accessibility settings and re-toggle Mobile Agent device control (or
          just reopen the app) — it reconnects automatically.
        </Text>
      ) : null}
    </Container>
  );
}

function AccessibilityRow({
  status,
  loading,
  onPress,
}: {
  status: AccessibilityStatus;
  loading: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className={cn(
        "min-h-14 flex-row items-center justify-between gap-sp-3 px-sp-4 py-sp-3",
        loading && "opacity-50",
      )}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => (pressed && !loading ? { opacity: 0.82 } : null)}
    >
      <View className="min-w-0 flex-1">
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          Accessibility service
        </Text>
      </View>
      <View className="flex-row items-center gap-sp-2">
        {loading ? <LoaderCircle color={theme.textSecondary} size={16} /> : null}
        <Checkbox checked={status === "working"} onCheckedChange={() => {}} />
      </View>
    </Pressable>
  );
}
