import type { ComponentPropsWithoutRef } from "react";
import { useEffect } from "react";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { cn } from "@/core/utils";

export type SkeletonProps = ComponentPropsWithoutRef<typeof Animated.View> & {
  className?: string;
};

export function Skeleton({ className, ...props }: SkeletonProps) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 0.6 : 0.38);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    if (!reduceMotion) {
      opacity.value = withRepeat(withTiming(0.78, { duration: 850 }), -1, true);
    }

    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      className={cn("rounded-ui bg-muted dark:bg-muted-dark", className)}
      importantForAccessibility="no-hide-descendants"
      style={animatedStyle}
      {...props}
    />
  );
}
