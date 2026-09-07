import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { useTermuxStream } from "@/hooks/use-termux-stream";
import { subscribeLatestTermuxTask } from "@/modules/termux/latest-task";
import type { TermuxStreamEvent } from "termux-stream";

const STREAM_SCROLL_RETENTION_PX = 96;

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
  const scrollRef = useRef<ScrollView>(null);
  const nearBottomRef = useRef(true);
  const [resolvedTaskId, setResolvedTaskId] = useState<string | null>(null);
  const [fallbackCommand, setFallbackCommand] = useState<string>("");

  // When the screen was opened before a task id existed (pending snapshot),
  // resolve it from the latest termux run published by the MCP runtime.
  useEffect(() => {
    if (taskId || resolvedTaskId) return;
    return subscribeLatestTermuxTask((latest) => {
      setResolvedTaskId(latest.id);
      setFallbackCommand(latest.command);
    });
  }, [resolvedTaskId, taskId]);

  const activeTaskId = taskId ?? resolvedTaskId;

  // Connect to termux-mcp whenever the configured MCP server list or the
  // resolved task id changes, then stream the requested task.
  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;
    setConnecting(true);
    termux
      .connect(mcpServers)
      .then((ok) => {
        if (cancelled || !ok) return;
        return termux.start(activeTaskId);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setConnecting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskId, commandText, mcpServers]);

  useEffect(() => {
    if (taskId || typeof output !== "string") return;
    setTranscript(output);
  }, [output, taskId]);

  // Route streaming output into the terminal grid and react to completion.
  useEffect(() => {
    return onTermuxEvent((event: TermuxStreamEvent) => {
      if (event.type === "output") {
        setTranscript((current) => current + event.data);
        if (nearBottomRef.current) {
          requestAnimationFrame(() => {
            scrollRef.current?.scrollToEnd({ animated: false });
          });
        }
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
        {activeTaskId || typeof output === "string" || pending === "true" ? (
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerClassName="gap-sp-1 pb-sp-4"
            showsVerticalScrollIndicator={false}
            onScroll={(e) => {
              const { contentSize, contentOffset, layoutMeasurement } =
                e.nativeEvent;
              const distanceToBottom =
                contentSize.height -
                (contentOffset.y + layoutMeasurement.height);
              nearBottomRef.current =
                distanceToBottom <= STREAM_SCROLL_RETENTION_PX;
            }}
            scrollEventThrottle={64}
          >
            <View className="flex-row items-start gap-sp-2">
              <Text className="font-mono text-base text-muted-foreground dark:text-muted-foreground-dark">
                $
              </Text>
              <Text className="min-w-0 flex-1 font-mono text-base text-foreground dark:text-foreground-dark">
                {commandText || fallbackCommand || "(command)"}
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
            {activeTaskId && termux.error && !transcript ? (
              <Text className="font-mono text-base text-destructive dark:text-destructive-dark">
                {termux.error}
              </Text>
            ) : null}
            {!activeTaskId && pending === "true" ? (
              <Text className="font-mono text-base text-muted-foreground dark:text-muted-foreground-dark">
                Waiting for task id…
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
