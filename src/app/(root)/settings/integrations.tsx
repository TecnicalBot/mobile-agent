import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { PhoneBridgeDrawer } from "@/components/settings/phone-bridge-drawer";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTheme } from "@/hooks/use-theme";
import { usePhoneBridge } from "@/providers/phone-bridge-state";

export default function SettingsIntegrationsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const bridge = usePhoneBridge();
  const { phoneTools } = useLocalSearchParams<{ phoneTools?: string }>();
  const [bridgeOpen, setBridgeOpen] = useState(phoneTools === "1");

  useEffect(() => {
    if (phoneTools === "1") setBridgeOpen(true);
  }, [phoneTools]);

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.back()}
          size="icon-xs"
          variant="ghost"
        />
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Integrations
        </Text>
      </View>
      <Card className="overflow-hidden">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Device sharing (MCP)"
          className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
          onPress={() => setBridgeOpen(true)}
          style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
        >
          <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
            Device sharing (MCP)
          </Text>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {bridge.sharing ? "Sharing" : "Not shared"}
          </Text>
          <ChevronRight color={theme.textSecondary} size={18} />
        </Pressable>
      </Card>
      <PhoneBridgeDrawer open={bridgeOpen} onOpenChange={setBridgeOpen} />
    </Container>
  );
}
