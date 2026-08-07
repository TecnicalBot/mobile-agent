import { useRouter } from "expo-router";
import { ChevronLeft, LoaderCircle } from "lucide-react-native";
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
  captureScreenshot,
  isAccessibilityEnabled,
  isAccessibilityPermissionGranted,
  isScreenCaptureActive,
  openAccessibilitySettings,
  requestScreenCapturePermission,
  stopScreenCapture,
} from "device-automation";
import { requestBatteryOptimizationExemption } from "background-agent-service";

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
  const [screenCaptureActive, setScreenCaptureActive] = useState(false);
  const [captureTestResult, setCaptureTestResult] = useState<string | null>(
    null,
  );

  useEffect(() => {
    requestBatteryOptimizationExemption().catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [connected, granted, capture] = await Promise.all([
        isAccessibilityEnabled(),
        isAccessibilityPermissionGranted(),
        isScreenCaptureActive(),
      ]);
      if (!active) return;
      setAccessibilityConnected(connected);
      setAccessibilityGranted(granted);
      setScreenCaptureActive(capture);
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

  const runCaptureTest = () => {
    setCaptureTestResult(null);
    return runAction("capture-test", async () => {
      const permission = await requestScreenCapturePermission();
      if (!permission.success || !permission.granted) {
        setCaptureTestResult(
          permission.error ?? "Screen capture permission was not granted.",
        );
        return;
      }
      const shot = await captureScreenshot();
      setCaptureTestResult(
        shot.success
          ? `Captured a ${shot.width}x${shot.height} screenshot.`
          : shot.error ?? "Screenshot failed.",
      );
      await stopScreenCapture();
    });
  };

  const accessibilityStatus: AccessibilityStatus = !accessibilityGranted
    ? "not_granted"
    : accessibilityConnected
      ? "working"
      : "granted_not_running";

  const statusLabel: Record<AccessibilityStatus, string> = {
    working: "Working",
    granted_not_running: "Enabled in Settings, but not running",
    not_granted: "Not enabled",
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
        <AccessibilityRow
          status={accessibilityStatus}
          statusLabel={statusLabel[accessibilityStatus]}
          loading={busyKey === "accessibility"}
          onPress={() => {
            runAction("accessibility", openAccessibilitySettings).catch(
              console.error,
            );
          }}
        />
        <Separator />
        <ScreenCaptureRow
          active={screenCaptureActive}
          loading={busyKey === "capture-test"}
          testResult={captureTestResult}
          onTest={runCaptureTest}
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
  statusLabel,
  loading,
  onPress,
}: {
  status: AccessibilityStatus;
  statusLabel: string;
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
        <Text
          className={cn(
            "font-sans text-xs",
            status === "not_granted"
              ? "text-destructive dark:text-destructive-dark"
              : "text-muted-foreground dark:text-muted-foreground-dark",
          )}
        >
          {statusLabel}
        </Text>
      </View>
      <View className="flex-row items-center gap-sp-2">
        {loading ? <LoaderCircle color={theme.textSecondary} size={16} /> : null}
        <Checkbox checked={status === "working"} onCheckedChange={() => {}} />
      </View>
    </Pressable>
  );
}

function ScreenCaptureRow({
  active,
  loading,
  testResult,
  onTest,
}: {
  active: boolean;
  loading: boolean;
  testResult: string | null;
  onTest: () => void;
}) {
  return (
    <View className="gap-sp-2 px-sp-4 py-sp-3">
      <View className="flex-row items-center justify-between gap-sp-3">
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            Screen capture
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {active
              ? "Active"
              : "On demand — the system asks only when the agent needs to see the screen"}
          </Text>
        </View>
        <Button
          loading={loading}
          onPress={onTest}
          size="sm"
          variant="outline"
        >
          Test
        </Button>
      </View>
      {testResult ? (
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {testResult}
        </Text>
      ) : null}
    </View>
  );
}
