import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/hooks/use-theme";
import { NATIVE_AGENTS } from "@/modules/agents/registry";

const displayName = (name: string) =>
  name === "build" ? "Build" : name === "plan" ? "Plan" : name;

export default function BuiltInAgentsScreen() {
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
          onPress={() => router.back()}
          size="icon-xs"
          variant="ghost"
        />
        <Text className="min-w-0 flex-1 font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Built-in agents
        </Text>
      </View>

      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        Built-in agents ship with the app and are always available.
      </Text>

      <Card className="overflow-hidden">
        {NATIVE_AGENTS.map((agent, index) => (
          <View key={agent.id}>
            <View className="min-h-14 px-sp-4 py-sp-3">
              <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
                {displayName(agent.name)}
              </Text>
              {agent.description ? (
                <Text
                  className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                  numberOfLines={2}
                >
                  {agent.description}
                </Text>
              ) : null}
            </View>
            {index < NATIVE_AGENTS.length - 1 ? <Separator /> : null}
          </View>
        ))}
      </Card>
    </Container>
  );
}
