import { useRef, useState } from "react";
import { PanResponder, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/core/utils";

export function Slider({
  accessibilityLabel,
  disabled = false,
  maximumValue = 1,
  minimumValue = 0,
  onValueChange,
  step = 0.01,
  value,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  maximumValue?: number;
  minimumValue?: number;
  onValueChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  const theme = useTheme();
  const trackWidthRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);

  const clampValue = (raw: number) => {
    const stepped = Math.round(raw / step) * step;
    const clamped = Math.min(
      maximumValue,
      Math.max(minimumValue, stepped),
    );
    return Number(clamped.toFixed(4));
  };

  const valueToOffset = (v: number) => {
    if (maximumValue === minimumValue) return 0;
    return (v - minimumValue) / (maximumValue - minimumValue);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (event) => {
        const locationX = event.nativeEvent.locationX;
        onValueChange(
          clampValue(
            minimumValue +
              valueToOffset(locationX) * (maximumValue - minimumValue),
          ),
        );
      },
      onPanResponderMove: (event) => {
        const locationX = event.nativeEvent.locationX;
        const next = clampValue(
          minimumValue +
            (locationX / Math.max(trackWidth, 1)) *
              (maximumValue - minimumValue),
        );
        onValueChange(next);
      },
    }),
  ).current;

  const progress = valueToOffset(value);
  const normalized = Math.max(0, Math.min(1, progress));
  const thumbRadius = 10;
  const fillWidth = normalized * trackWidth;
  const thumbLeft = Math.max(
    thumbRadius,
    Math.min(trackWidth - thumbRadius, trackWidth * normalized),
  );

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      className="py-sp-2"
    >
      <View
        ref={(node) => {
          if (node) {
            node.measureInWindow((_x, _y, measuredWidth) => {
              if (measuredWidth > 0 && measuredWidth !== trackWidthRef.current) {
                trackWidthRef.current = measuredWidth;
                setTrackWidth(measuredWidth);
              }
            });
          }
        }}
        {...panResponder.panHandlers}
        className={cn(
          "relative h-6 justify-center",
          disabled && "opacity-50",
        )}
      >
        <View className="h-1.5 w-full rounded-full bg-border dark:bg-border-dark" />
        <View
          pointerEvents="none"
          className="absolute h-1.5 rounded-full bg-accent dark:bg-accent"
          style={{ width: fillWidth }}
        />
        <View
          pointerEvents="none"
          className="absolute h-5 w-5 rounded-full shadow-md"
          style={{
            backgroundColor: theme.accent,
            left: thumbLeft - thumbRadius,
            borderColor: theme.accentForeground,
          }}
        />
      </View>
    </View>
  );
}
