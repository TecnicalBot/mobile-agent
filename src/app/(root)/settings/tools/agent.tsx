import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Text, View } from "react-native";

import { ToolToggleList } from "@/components/settings/tool-toggle-list";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  AGENT_TOOL_CONTROLS,
  countEnabledAgentTools,
} from "@/modules/config/built-in-tools";

export default function SettingsAgentToolsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { toolSettings } = useConfig();

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
            Agent tools
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {countEnabledAgentTools(toolSettings)} active
          </Text>
        </View>
      </View>

      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        Let the agent clarify its next step, track task progress, and load skill
        instructions on demand.
      </Text>

      <ToolToggleList controls={AGENT_TOOL_CONTROLS} />
    </Container>
  );
}
