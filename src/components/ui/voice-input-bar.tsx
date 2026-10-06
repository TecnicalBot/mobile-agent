import { Check, X } from "lucide-react-native";
import { memo, useEffect } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
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

import { useTheme } from "@/hooks/use-theme";

const BAR_COUNT = 44;
const BAR_MIN_HEIGHT = 4;
const BAR_MAX_HEIGHT = 44;
const WAVE_HEIGHT = 76;

export type VoiceInputBarProps = {
  /** Normalized (0..1) current microphone amplitude. */
  level: number;
  /** True while a final result is being awaited after tapping the check. */
  processing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function VoiceInputBar({
  level,
  processing,
  onCancel,
  onConfirm,
}: VoiceInputBarProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  return (
    <View
      accessibilityLiveRegion="polite"
      className="flex-row items-center gap-2 bg-white px-2 dark:bg-card-dark"
      style={{ height: WAVE_HEIGHT }}
    >
      <Pressable
        accessibilityLabel="Cancel voice input"
        accessibilityRole="button"
        className="h-12 w-12 items-center justify-center rounded-full bg-[#F0F0F3] dark:bg-secondary-dark"
        hitSlop={8}
        onPress={onCancel}
        style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
      >
        <X color={theme.text} size={20} />
      </Pressable>

      <View className="min-w-0 flex-1 items-center justify-center">
        <VoiceWaveform
          level={level}
          muted={processing}
          reduceMotion={reduceMotion}
          tint={theme.text}
        />
      </View>

      <Pressable
        accessibilityLabel="Use transcript"
        accessibilityRole="button"
        className="h-12 w-12 items-center justify-center rounded-full bg-foreground dark:bg-foreground-dark"
        disabled={processing}
        hitSlop={8}
        onPress={onConfirm}
        style={({ pressed }) => ({
          opacity: processing ? 0.6 : pressed ? 0.85 : 1,
        })}
      >
        {processing ? (
          <ActivityIndicator color={theme.background} size="small" />
        ) : (
          <Check color={theme.background} size={22} />
        )}
      </Pressable>
    </View>
  );
}

const VoiceWaveform = memo(function VoiceWaveform({
  level,
  muted,
  reduceMotion,
  tint,
}: {
  level: number;
  muted: boolean;
  reduceMotion: boolean;
  tint: string;
}) {
  const amplitude = useSharedValue(0.32);
  const clock = useSharedValue(0);

  useEffect(() => {
    amplitude.value = withTiming(muted ? 0.18 : Math.max(0.3, level), {
      duration: 120,
      easing: Easing.out(Easing.quad),
    });
  }, [amplitude, level, muted]);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(clock);
      clock.value = 0.25;
      return;
    }

    clock.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );

    return () => {
      cancelAnimation(clock);
    };
  }, [clock, reduceMotion]);

  return (
    <View
      accessible={false}
      className="w-full flex-row items-center justify-between self-center"
      style={{ height: BAR_MAX_HEIGHT, maxWidth: 340 }}
    >
      {Array.from({ length: BAR_COUNT }).map((_, index) => (
        <VoiceBar
          amplitude={amplitude}
          clock={clock}
          index={index}
          key={index}
          reduceMotion={reduceMotion}
          tint={tint}
        />
      ))}
    </View>
  );
});

function VoiceBar({
  amplitude,
  clock,
  index,
  reduceMotion,
  tint,
}: {
  amplitude: SharedValue<number>;
  clock: SharedValue<number>;
  index: number;
  reduceMotion: boolean;
  tint: string;
}) {
  const position = index / (BAR_COUNT - 1);
  // Symmetric bell envelope so the silhouette matches a spoken waveform.
  const envelope = 0.28 + 0.72 * Math.sin(Math.PI * position);
  const phase = position * Math.PI * 4;

  const animatedStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      const idle = BAR_MIN_HEIGHT + (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT) * envelope * 0.6;
      return { height: idle };
    }

    const wobble = 0.62 + 0.38 * Math.sin(clock.value * Math.PI * 2 + phase);
    const height = Math.max(
      BAR_MIN_HEIGHT,
      Math.min(
        BAR_MAX_HEIGHT,
        BAR_MIN_HEIGHT +
          (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT) * envelope * amplitude.value * wobble,
      ),
    );

    return { height };
  }, [envelope, phase, reduceMotion]);

  return (
    <Animated.View
      style={[
        {
          backgroundColor: tint,
          borderRadius: 2,
          width: 3,
        },
        animatedStyle,
      ]}
    />
  );
}
