import type { ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 500;

export function DismissibleBanner({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const dismissed = useSharedValue(false);
  const translateX = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion
      ? 1
      : 1 - Math.min(Math.abs(translateX.value) / width, 1),
    transform: [{ translateX: reduceMotion ? 0 : translateX.value }],
  }));
  const gesture = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      if (!dismissed.value && !reduceMotion) {
        translateX.value = event.translationX;
      }
    })
    .onEnd((event) => {
      const shouldDismiss =
        Math.abs(event.translationX) >= DISMISS_DISTANCE ||
        Math.abs(event.velocityX) >= DISMISS_VELOCITY;

      if (!shouldDismiss) {
        if (!reduceMotion) {
          translateX.value = withSpring(0, {
            damping: 20,
            stiffness: 220,
          });
        }
        return;
      }

      dismissed.value = true;
      if (reduceMotion) {
        runOnJS(onDismiss)();
        return;
      }

      const direction =
        Math.sign(event.translationX) || Math.sign(event.velocityX) || 1;
      translateX.value = withTiming(
        direction * (width + 32),
        { duration: 180 },
        (finished) => {
          if (finished) {
            runOnJS(onDismiss)();
          }
        },
      );
    });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}
