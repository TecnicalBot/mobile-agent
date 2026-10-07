import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState, Text } from "react-native";

import {
  COMPOSER_TIP_REFRESH_MS,
  DEFAULT_COMPOSER_TIP,
  fetchComposerTip,
} from "@/modules/chat/composer-tip";
import { openExternalLink } from "@/modules/chat/open-link";

export function ComposerTip() {
  const [active, setActive] = useState(AppState.currentState !== "background");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  const { data: tip } = useQuery({
    queryKey: ["composer-tip"],
    queryFn: ({ signal }) => fetchComposerTip(signal),
    initialData: DEFAULT_COMPOSER_TIP,
    initialDataUpdatedAt: 0,
    enabled: active,
    staleTime: COMPOSER_TIP_REFRESH_MS,
    refetchInterval: COMPOSER_TIP_REFRESH_MS,
    retry: false,
  });

  if (!tip.enabled) return null;

  return (
    <Text
      className="px-sp-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
      ellipsizeMode="tail"
      numberOfLines={2}
    >
      {tip.parts.map((part, index) =>
        part.url ? (
          <Text
            key={index}
            accessibilityRole="link"
            className="underline"
            onPress={() => {
              openExternalLink(part.url!).catch(console.error);
            }}
          >
            {part.text}
          </Text>
        ) : (
          <Text key={index}>{part.text}</Text>
        ),
      )}
    </Text>
  );
}
