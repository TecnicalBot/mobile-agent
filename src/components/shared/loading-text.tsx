"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { Text } from "react-native";

type AnimatedTextProps = React.ComponentProps<typeof Text> & {
  text: string;
  variant?: "ellipsis";
  interval?: number;
};

export function LoadingText({
  text,
  variant = "ellipsis",
  interval = 400,
  className,
  ...props
}: AnimatedTextProps) {
  const [frame, setFrame] = React.useState(0);

  React.useEffect(() => {
    if (variant !== "ellipsis") return;

    const id = setInterval(() => {
      setFrame((prev) => (prev + 1) % 4);
    }, interval);

    return () => clearInterval(id);
  }, [interval, variant]);

  const displayText = React.useMemo(() => {
    if (variant !== "ellipsis") return text;

    const match = text.match(/(\.+)$/);

    if (!match) return text;

    const dots = match[1].length;
    const base = text.slice(0, -dots);

    return base + ".".repeat(frame);
  }, [frame, text, variant]);

  return (
    <Text className={cn(className)} {...props}>
      {displayText}
    </Text>
  );
}
