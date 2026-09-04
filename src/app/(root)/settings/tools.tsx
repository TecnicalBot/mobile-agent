import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Text, View } from "react-native";

import { ToolToggleList } from "@/components/settings/tool-toggle-list";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { BUILT_IN_FILE_TOOL_CONTROLS } from "@/modules/config/built-in-tools";

export default function SettingsToolsScreen() {
  const router = useRouter();
  const theme = useTheme();

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

      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        Give the agent access to files in its workspace and selected folders.
      </Text>

      <ToolToggleList controls={BUILT_IN_FILE_TOOL_CONTROLS} />
    </Container>
  );
}
