import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

export function McpScreenHeader({
  backHref,
  title,
}: {
  backHref: string;
  title: string;
}) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <View className="flex-row items-center gap-sp-2">
      <Button
        leftIcon={<ChevronLeft color={theme.text} size={16} />}
        onPress={() => router.replace(backHref as never)}
        size="icon-xs"
        variant="ghost"
      />
      <Text className="min-w-0 flex-1 font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
        {title}
      </Text>
    </View>
  );
}
