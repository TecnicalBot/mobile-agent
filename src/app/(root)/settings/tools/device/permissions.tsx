import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";
import {
  isAccessibilityEnabled,
  isScreenCaptureActive,
  openAccessibilitySettings,
  requestScreenCapturePermission,
  stopScreenCapture,
} from "device-automation";

export default function SettingsDevicePermissionsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const [screenCaptureActive, setScreenCaptureActive] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [accessibility, screenCapture] = await Promise.all([
        isAccessibilityEnabled(),
        isScreenCaptureActive(),
      ]);
      if (!active) return;
      setAccessibilityEnabled(accessibility);
      setScreenCaptureActive(screenCapture);
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
        <PermissionRow
          active={accessibilityEnabled}
          label="Accessibility service"
          loading={busyKey === "accessibility"}
          onCheckedChange={() => {
            runAction("accessibility", openAccessibilitySettings).catch(
              console.error,
            );
          }}
        />
        <Separator />
        <PermissionRow
          active={screenCaptureActive}
          label="Screen capture"
          loading={busyKey === "screen-capture"}
          onCheckedChange={(checked) => {
            runAction(
              "screen-capture",
              checked ? requestScreenCapturePermission : stopScreenCapture,
            ).catch(console.error);
          }}
        />
      </Card>
    </Container>
  );
}

function PermissionRow({
  active,
  label,
  loading,
  onCheckedChange,
}: {
  active: boolean;
  label: string;
  loading: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: active, disabled: loading }}
      className={cn(
        "min-h-14 flex-row items-center justify-between gap-sp-3 px-sp-4 py-sp-3",
        loading && "opacity-50",
      )}
      disabled={loading}
      onPress={() => onCheckedChange(!active)}
      style={({ pressed }) => (pressed && !loading ? { opacity: 0.82 } : null)}
    >
      <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      <View pointerEvents="none">
        <Checkbox checked={active} onCheckedChange={() => {}} />
      </View>
    </Pressable>
  );
}
