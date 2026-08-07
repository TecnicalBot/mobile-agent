import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { ToolToggleList } from "@/components/settings/tool-toggle-list";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfig } from "@/hooks/use-config";
import { useDeviceAutomationPermissions } from "@/hooks/use-device-automation-permissions";
import { useTheme } from "@/hooks/use-theme";
import {
  countEnabledDeviceTools,
  DEVICE_TOOL_CONTROLS,
} from "@/modules/config/built-in-tools";

export default function SettingsDeviceToolsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { toolSettings } = useConfig();
  const permissions = useDeviceAutomationPermissions();
  const permissionsGranted =
    permissions.accessibilityEnabled && permissions.screenCaptureActive;

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.push("/settings/tools")}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Device controls
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {countEnabledDeviceTools(toolSettings, permissions)} active
          </Text>
        </View>
      </View>

      <Card className="overflow-hidden">
        <Pressable
          accessibilityRole="button"
          className="min-h-16 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
          onPress={() =>
            router.push("/settings/tools/device/permissions" as never)
          }
          style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
        >
          <View className="size-10 items-center justify-center rounded-xl bg-muted dark:bg-muted-dark">
            <ShieldCheck color={theme.text} size={19} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              Permissions
            </Text>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Required for device control
            </Text>
          </View>
          <ChevronRight color={theme.textSecondary} size={18} />
        </Pressable>
      </Card>

      {!permissionsGranted ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Grant the permissions above to enable device controls.
        </Text>
      ) : null}

      <ToolToggleList
        controls={DEVICE_TOOL_CONTROLS}
        disabled={!permissionsGranted}
      />
    </Container>
  );
}
