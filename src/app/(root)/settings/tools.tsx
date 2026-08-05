import { useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Smartphone,
  Wrench,
} from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, Platform, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  countEnabledBuiltInFileTools,
  countEnabledDeviceTools,
} from "@/modules/config/built-in-tools";

export default function SettingsToolsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    maxToolSteps,
    toolSettings,
    updateMaxToolSteps,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState(String(maxToolSteps));
  const [stepsDrawerOpen, setStepsDrawerOpen] = useState(false);

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
        <ToolGroupRow
          icon={<ListChecks color={theme.text} size={19} />}
          label="Maximum tool steps"
          onPress={() => {
            setStepDraft(String(maxToolSteps));
            setStepsDrawerOpen(true);
          }}
          value={`${maxToolSteps}`}
        />
        <Separator />
        <ToolGroupRow
          icon={<Wrench color={theme.text} size={19} />}
          label="Core tools"
          onPress={() => router.push("/settings/tools/core" as never)}
          value={`${countEnabledBuiltInFileTools(toolSettings)} active`}
        />
        {Platform.OS === "android" ? <Separator /> : null}
        {Platform.OS === "android" ? (
          <ToolGroupRow
            icon={<Smartphone color={theme.text} size={19} />}
            label="Device controls"
            onPress={() => router.push("/settings/tools/device" as never)}
            value={`${countEnabledDeviceTools(toolSettings)} active`}
          />
        ) : null}
      </Card>

      <Drawer onOpenChange={setStepsDrawerOpen} open={stepsDrawerOpen}>
        <DrawerContent showCloseButton>
          <DrawerHeader>
            <DrawerTitle>Maximum tool steps</DrawerTitle>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-3">
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Stop an agent loop after this many model steps (1–100).
            </Text>
            <Input
              keyboardType="number-pad"
              onChangeText={setStepDraft}
              value={stepDraft}
            />
          </DrawerBody>
          <DrawerFooter>
            <Button
              loading={busyKey === "max-tool-steps"}
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
                  setStepsDrawerOpen(false);
                }).catch(console.error);
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

function ToolGroupRow({
  icon,
  label,
  onPress,
  value,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  value: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-16 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
    >
      <View className="size-10 items-center justify-center rounded-xl bg-muted dark:bg-muted-dark">
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
          {label}
        </Text>
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {value}
        </Text>
      </View>
      <ChevronRight color={theme.textSecondary} size={18} />
    </Pressable>
  );
}
