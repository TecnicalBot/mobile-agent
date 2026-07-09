import type { ComponentPropsWithoutRef, ComponentRef } from "react";
import { forwardRef, useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { Loader } from "lucide-react-native";

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
    { className, iconClassName, size, color, label = "Thinking...", ...props },
    ref,
  ) => {
    const theme = useTheme();
    const rotation = useSharedValue(0);

    useEffect(() => {
      rotation.value = withRepeat(
        withTiming(360, {
          duration: 900,
          easing: Easing.linear,
        }),
        -1,
        false,
      );

      return () => {
        cancelAnimation(rotation);
      };
    }, [rotation]);

    const iconStyle = useAnimatedStyle(() => ({
      transform: [{ rotate: `${rotation.value}deg` }],
    }));

    return (
      <View
        ref={ref}
        className={cn("flex-row items-center gap-sp-2", className)}
        {...props}
      >
        <Animated.View
          className={cn("size-8 items-center justify-center", iconClassName)}
          style={iconStyle}
        >
          <Loader size={size ?? 32} color={color ?? theme.textSecondary} />
        </Animated.View>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {label}
        </Text>
      </View>
    );
  },
);

Loading.displayName = "Loading";
