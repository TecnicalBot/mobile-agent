import type { ComponentPropsWithoutRef, ComponentRef } from "react";
import { forwardRef, useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";

const GRID_PERIMETER_STEPS = [0, 1, 2, 7, null, 3, 6, 5, 4] as const;

export type LoadingIndicatorProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
  iconClassName?: string;
  label?: string;
  size?: number;
  color?: string;
};

export const Loading = forwardRef<
  ComponentRef<typeof View>,
  LoadingIndicatorProps
>(
  (
    {
      accessibilityLabel,
      className,
      iconClassName,
      size = 16,
      color,
      label = "Thinking",
      ...props
    },
    ref,
  ) => {
    const theme = useTheme();
    const reduceMotion = useReducedMotion();
    const progress = useSharedValue(0);
    const dotSize = size / 4;
    const dotGap = dotSize / 2;
    const indicatorColor = color ?? theme.textSecondary;

    useEffect(() => {
      progress.value = 0;

      if (!reduceMotion) {
        progress.value = withRepeat(
          withTiming(8, {
            duration: 1120,
            easing: Easing.linear,
          }),
          -1,
          false,
        );
      }

      return () => {
        cancelAnimation(progress);
      };
    }, [progress, reduceMotion]);

    return (
      <View
        ref={ref}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityLiveRegion="polite"
        accessibilityRole="progressbar"
        className={cn("flex-row items-center gap-sp-2", className)}
        {...props}
      >
        <View
          accessible={false}
          className={cn("flex-row flex-wrap", iconClassName)}
          style={{ gap: dotGap, height: size, width: size }}
        >
          {GRID_PERIMETER_STEPS.map((perimeterStep, gridIndex) => (
            <LoadingDot
              key={`${perimeterStep ?? "center"}-${gridIndex}`}
              color={indicatorColor}
              perimeterStep={perimeterStep}
              progress={progress}
              reduceMotion={reduceMotion}
              size={dotSize}
            />
          ))}
        </View>
        <Text
          className="font-mono text-sm font-semibold"
          style={{ color: indicatorColor }}
        >
          {label}
        </Text>
      </View>
    );
  },
);

Loading.displayName = "Loading";

function LoadingDot({
  color,
  perimeterStep,
  progress,
  reduceMotion,
  size,
}: {
  color: string;
  perimeterStep: number | null;
  progress: SharedValue<number>;
  reduceMotion: boolean;
  size: number;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: 0.55, transform: [{ scale: 1 }] };
    }

    if (perimeterStep === null) {
      return { opacity: 0.22, transform: [{ scale: 1 }] };
    }

    const activeStep = Math.floor(progress.value) % 8;
    const trailDistance = (activeStep - perimeterStep + 8) % 8;

    return {
      opacity:
        trailDistance === 0
          ? 1
          : trailDistance === 1
            ? 0.62
            : trailDistance === 2
              ? 0.36
              : 0.18,
      transform: [{ scale: trailDistance === 0 ? 1.2 : 1 }],
    };
  }, [perimeterStep, reduceMotion]);

  return (
    <Animated.View
      style={[
        {
          backgroundColor: color,
          borderRadius: size / 2,
          height: size,
          width: size,
        },
        animatedStyle,
      ]}
    />
  );
}
