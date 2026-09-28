import { View } from "react-native";

/**
 * Renderer-side implementation of `expo-blur`.
 *
 * `expo-blur` is a native view with no web implementation, and
 * `src/components/ui/drawer.tsx` imports it at module scope. React Native Web
 * has no backdrop filter, so this renders a plain translucent view: visually
 * close enough behind a modal drawer, and it keeps the import graph loadable.
 */

export type BlurTint = "light" | "dark" | "default" | "system";

export type BlurProps = {
  tint?: BlurTint;
  intensity?: number;
  experimentalBlurMethod?: "dimezisBlurView" | "chromaticAberration";
  style?: unknown;
  children?: React.ReactNode;
};

const TINT_OPACITY: Record<string, number> = {
  light: 0.75,
  dark: 0.6,
  default: 0.7,
  system: 0.7,
};

export function BlurView({ tint = "default", style }: BlurProps) {
  return (
    <View
      style={[
        { backgroundColor: `rgba(0, 0, 0, ${TINT_OPACITY[tint] ?? 0.7})` },
        style as object,
      ]}
    />
  );
}

export function CircleBlurView() {
  return <View />;
}

export default BlurView;
