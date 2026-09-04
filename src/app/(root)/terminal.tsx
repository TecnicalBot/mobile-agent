import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { useTermuxStream } from "@/hooks/use-termux-stream";
import type { TermuxStreamEvent } from "termux-stream";

export default function TerminalScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { mcpServers } = useConfig();
  const { command, output, pending, taskId } = useLocalSearchParams<{
    command?: string;
    output?: string;
    pending?: string;
    taskId?: string;
  }>();
  const termux = useTermuxStream();
  const onTermuxEvent = termux.onEvent;
  const [connecting, setConnecting] = useState(false);
  const commandText = typeof command === "string" ? command : "";
  const [transcript, setTranscript] = useState(() =>
    typeof output === "string" ? output : "",
  );

  // Connect to termux-mcp whenever the configured MCP server list changes,
  // then stream the requested task.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    setConnecting(true);
    termux
      .connect(mcpServers)
      .then((ok) => {
        if (cancelled || !ok) return;
        return termux.start(taskId);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setConnecting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandText, mcpServers, taskId]);

  useEffect(() => {
    if (taskId || typeof output !== "string") return;
    setTranscript(output);
  }, [output, taskId]);

  // Route streaming output into the terminal grid and react to completion.
  useEffect(() => {
    return onTermuxEvent((event: TermuxStreamEvent) => {
      if (event.type === "output") {
        setTranscript((current) => current + event.data);
      }
    });
  }, [onTermuxEvent]);

  // Tear down streaming when leaving the screen.
  useEffect(() => {
    return () => {
      termux.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = useCallback(async () => {
    await termux.disconnect();
    router.back();
  }, [router, termux]);

  return (
    <Container
      className="bg-background dark:bg-background-dark"
      contentClassName="gap-sp-4 py-sp-4"
      contentStyle={{ paddingBottom: 0 }}
      includeBottomTabInset={false}
      safeArea
      edges={["top", "right", "bottom", "left"]}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={handleClose}
          size="icon-xs"
          variant="ghost"
        />
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Terminal
        </Text>
      </View>

      <View className="flex-1 w-full">
        {taskId || typeof output === "string" || pending === "true" ? (
          <ScrollView
            className="flex-1"
            contentContainerClassName="gap-sp-1 pb-sp-4"
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row items-start gap-sp-2">
              <Text className="font-mono text-base text-muted-foreground dark:text-muted-foreground-dark">
                $
              </Text>
              <Text className="min-w-0 flex-1 font-mono text-base text-foreground dark:text-foreground-dark">
                {commandText}
              </Text>
            </View>
            {transcript ? (
              <Text
                selectable
                className="font-mono text-base leading-6 text-foreground dark:text-foreground-dark"
              >
                {stripAnsi(transcript)}
              </Text>
            ) : null}
            {!transcript && connecting ? (
              <ActivityIndicator
                className="self-start"
                color={theme.textSecondary}
                size="small"
              />
            ) : null}
            {taskId && termux.error && !transcript ? (
              <Text className="font-mono text-base text-destructive dark:text-destructive-dark">
                {termux.error}
              </Text>
            ) : null}
          </ScrollView>
        ) : (
          <View className="flex-1 items-center justify-center gap-sp-3 px-sp-6">
            <Text className="text-center font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
              No command selected.
            </Text>
          </View>
        )}
      </View>
    </Container>
  );
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}
