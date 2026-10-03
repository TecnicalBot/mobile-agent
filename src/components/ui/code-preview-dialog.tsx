import { Monitor, Smartphone, X } from "lucide-react-native";
import { useCallback, useState } from "react";
import { type LayoutChangeEvent, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useTheme } from "@/hooks/use-theme";

/**
 * CSS viewport width used for desktop rendering. Wide enough to trip the
 * `@media (min-width: …)` breakpoints of anything written for a laptop, which
 * is the whole point: the mobile-width web view always renders the phone
 * layout, so a responsive page cannot be checked without this.
 */
const DESKTOP_VIEWPORT_WIDTH = 1280;

type Viewport = "desktop" | "mobile";

export type CodePreviewDialogProps = {
  /** Complete HTML document, as built by `buildPreviewDocument`. */
  html: string;
  language: string;
  onDismiss: () => void;
};

/**
 * Full-screen rendered output for a markup code fence.
 *
 * `react-native-webview` has no notion of a viewport that differs from the view
 * itself, so "desktop" is a real 1280px-wide web view scaled down with a
 * transform. Media queries and `vw` units therefore resolve against 1280px,
 * which a squeezed-in inline web view could never show.
 */
export function CodePreviewDialog({
  html,
  language,
  onDismiss,
}: CodePreviewDialogProps) {
  const theme = useTheme();
  const [viewport, setViewport] = useState<Viewport>("mobile");
  const [frame, setFrame] = useState<{ height: number; width: number } | null>(
    null,
  );
  const desktop = viewport === "desktop";
  // Fall back to unscaled until the first layout pass reports the real frame.
  const scale =
    desktop && frame && frame.width > 0
      ? frame.width / DESKTOP_VIEWPORT_WIDTH
      : 1;

  const handleLayout = useCallback(
    ({ nativeEvent }: LayoutChangeEvent) => {
      const { height, width } = nativeEvent.layout;
      setFrame((previous) =>
        previous && previous.width === width && previous.height === height
          ? previous
          : { height, width },
      );
    },
    [],
  );

  return (
    <Drawer
      dismissible
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
      open
    >
      <DrawerContent contentClassName="max-w-full" showHandle>
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <DrawerTitle>Preview</DrawerTitle>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {language.toUpperCase()} · {desktop
                ? `${DESKTOP_VIEWPORT_WIDTH}px desktop viewport`
                : "Fits your screen"}
            </Text>
          </View>
          <DrawerClose asChild>
            <Pressable
              accessibilityLabel="Close preview"
              className="h-11 w-11 items-center justify-center rounded-full bg-card dark:bg-card-dark"
            >
              <X color={theme.text} size={20} />
            </Pressable>
          </DrawerClose>
        </View>
        <ViewportToggle value={viewport} onChange={setViewport} />
        {/*
          `flex-1` with a zero basis, so this frame's size comes from the drawer
          and never from the page inside it. That keeps the measured width — and
          therefore the desktop scale — independent of what is being rendered.
        */}
        <View
          className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card dark:border-border-dark dark:bg-card-dark"
          onLayout={handleLayout}
        >
          {frame && frame.width > 0 && frame.height > 0 ? (
            <View
              style={
                desktop
                  ? {
                      // Anchor the oversized native view before scaling. A
                      // centre-origin transform can move it outside the clip.
                      position: "absolute",
                      left: 0,
                      top: 0,
                      height: frame.height / scale,
                      flexShrink: 0,
                      transformOrigin: "top left",
                      transform: [{ scale }],
                      width: DESKTOP_VIEWPORT_WIDTH,
                    }
                  : { flex: 1 }
              }
            >
              <WebView
                key={viewport}
                allowsInlineMediaPlayback
                originWhitelist={["http://*", "https://*"]}
                scrollEnabled
                setSupportMultipleWindows={false}
                source={{ html }}
                style={{ backgroundColor: theme.backgroundElement, flex: 1 }}
              />
            </View>
          ) : null}
        </View>
      </DrawerContent>
    </Drawer>
  );
}

function ViewportToggle({
  value,
  onChange,
}: {
  value: Viewport;
  onChange: (value: Viewport) => void;
}) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      className="flex-row gap-1 overflow-hidden rounded-xl bg-card p-1 dark:bg-card-dark"
    >
      {(
        [
          { label: "Mobile", value: "mobile" },
          { label: "Desktop", value: "desktop" },
        ] as const
      ).map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            accessibilityLabel={`${option.label} view`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => {
              onChange(option.value);
            }}
            className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-lg active:opacity-70"
            style={{
              backgroundColor: selected ? theme.backgroundSelected : "transparent",
            }}
          >
            {option.value === "mobile" ? (
              <Smartphone
                color={selected ? theme.text : theme.textSecondary}
                size={18}
              />
            ) : (
              <Monitor
                color={selected ? theme.text : theme.textSecondary}
                size={18}
              />
            )}
            <Text
              className="font-sans text-sm font-semibold"
              style={{ color: selected ? theme.text : theme.textSecondary }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
