import * as MediaLibrary from "expo-media-library";
import { Asset } from "expo-media-library";
import { Download, Monitor, Smartphone, X, Code, Eye } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  type LayoutChangeEvent,
  Pressable,
  Text,
  View,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import { WebView } from "react-native-webview";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useTheme } from "@/hooks/use-theme";
import { downloadText } from "@/core/services/download-service";
import { buildCodeDocument } from "@/modules/preview/code-document";
import { withDesktopPreviewViewport } from "@/modules/preview/html-document";
import { handlePreviewDownloadMessage, PREVIEW_DOWNLOAD_HOOK } from "@/modules/preview/preview-downloads";

/**
 * CSS viewport width used for desktop rendering. Wide enough to trip the
 * `@media (min-width: …)` breakpoints of anything written for a laptop, which
 * is the whole point: the mobile-width web view always renders the phone
 * layout, so a responsive page cannot be checked without this.
 */
const DESKTOP_VIEWPORT_WIDTH = 1280;

/**
 * Keeps a capture busy indicator on screen long enough to be perceived. The
 * capture itself is usually faster than a single frame, so without this the
 * button would appear to do nothing.
 */
const MIN_CAPTURE_FEEDBACK_MS = 350;

type Viewport = "desktop" | "mobile";
type ViewMode = "code" | "preview";

export type CodePreviewDialogProps = {
  /** Complete HTML document, as built by `buildPreviewDocument`. */
  html: string;
  /** Raw fenced code, shown when the user switches to the code view. */
  code: string;
  language: string;
  onDismiss: () => void;
};

/**
 * Full-screen rendered output for a markup code fence.
 *
 * Desktop uses a 1280px browser viewport scaled to the measured frame width.
 * The native WebView stays frame-sized so clipping and scrolling agree.
 */
export function CodePreviewDialog({
  html,
  code,
  language,
  onDismiss,
}: CodePreviewDialogProps) {
  const theme = useTheme();
  const [viewport, setViewport] = useState<Viewport>("mobile");
  const [mode, setMode] = useState<ViewMode>("preview");
  const [frame, setFrame] = useState<{ height: number; width: number } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  // Capture only the page frame, without the drawer controls.
  const frameRef = useRef<View>(null);
  const desktop = viewport === "desktop";
  // Fall back to unscaled until the first layout pass reports the real frame.
  const scale =
    desktop && frame && frame.width > 0
      ? frame.width / DESKTOP_VIEWPORT_WIDTH
      : 1;
  const previewHtml = useMemo(
    () =>
      desktop
        ? withDesktopPreviewViewport(html, DESKTOP_VIEWPORT_WIDTH, scale)
        : html,
    [desktop, html, scale],
  );
  const codeHtml = useMemo(
    () => mode === "code" ? buildCodeDocument(code, language, theme) : "",
    [code, language, mode, theme],
  );

  const handleSave = useCallback(async () => {
    if (saving || !frameRef.current) {
      return;
    }

    setSaving(true);
    const startedAt = Date.now();

    try {
      if (mode === "code") {
        const extension = ["html", "htm", "svg", "xml"].includes(language.toLowerCase())
          ? language.toLowerCase() : "txt";
        const name = `code-${Date.now()}.${extension}`;
        const mimeType = extension === "svg" ? "image/svg+xml"
          : extension === "xml" ? "application/xml"
          : extension === "txt" ? "text/plain" : "text/html";
        const result = await downloadText(code, name, mimeType);
        if (result) Alert.alert("Code saved", `${result.name} has been saved to Downloads.`);
        return;
      }
      const uri = await captureRef(frameRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });

      const permission = await MediaLibrary.requestPermissionsAsync(true);

      if (!permission.granted) {
        Alert.alert(
          "Permission required",
          "Please allow photo access to save this image.",
        );
        return;
      }

      await Asset.create(uri);

      Alert.alert("Image saved", "The preview has been saved to your gallery.");
    } catch (error) {
      Alert.alert(
        "Download failed",
        error instanceof Error ? error.message : "Failed to save the file.",
      );
    } finally {
      // Hold the spinner long enough to be seen, otherwise the button appears
      // inert and users tap it repeatedly.
      const elapsed = Date.now() - startedAt;

      if (elapsed < MIN_CAPTURE_FEEDBACK_MS) {
        await new Promise((resolve) => {
          setTimeout(resolve, MIN_CAPTURE_FEEDBACK_MS - elapsed);
        });
      }

      setSaving(false);
    }
  }, [code, language, mode, saving]);

  const handleLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const { height, width } = nativeEvent.layout;
    setFrame((previous) =>
      previous && previous.width === width && previous.height === height
        ? previous
        : { height, width },
    );
  }, []);

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
              {language.toUpperCase()} ·{" "}
              {mode === "code"
                ? "Source"
                : desktop
                  ? `${DESKTOP_VIEWPORT_WIDTH}px desktop viewport`
                  : "Fits your screen"}
            </Text>
          </View>
          <ViewModeToggle value={mode} onChange={setMode} disabled={saving} />
          <SavePreviewButton
            mode={mode}
            disabled={saving || !frame}
            onPress={handleSave}
            saving={saving}
          />
          <DrawerClose asChild>
            <Pressable
              accessibilityLabel="Close preview"
              className="h-11 w-11 items-center justify-center rounded-full bg-card dark:bg-card-dark"
            >
              <X color={theme.text} size={20} />
            </Pressable>
          </DrawerClose>
        </View>
        {mode === "preview" ? (
          <ViewportToggle value={viewport} onChange={setViewport} />
        ) : null}
        {/*
          `flex-1` with a zero basis, so this frame's size comes from the drawer
          and never from the page inside it. That keeps the measured width — and
          therefore the desktop scale — independent of what is being rendered.
        */}
        <View
          className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card dark:border-border-dark dark:bg-card-dark"
          onLayout={handleLayout}
          ref={frameRef}
        >
          {frame && frame.width > 0 && frame.height > 0 ? (
            mode === "code" ? (
              <WebView
                key="source"
                javaScriptEnabled={false}
                originWhitelist={["about:blank"]}
                scrollEnabled
                nestedScrollEnabled
                showsHorizontalScrollIndicator
                showsVerticalScrollIndicator
                source={{ html: codeHtml }}
                style={{ backgroundColor: theme.backgroundElement, flex: 1 }}
              />
            ) : (
              <View style={{ flex: 1 }}>
                <WebView
                  key={viewport}
                  allowsInlineMediaPlayback
                  originWhitelist={["http://*", "https://*"]}
                  scrollEnabled
                  setSupportMultipleWindows={false}
                  injectedJavaScript={PREVIEW_DOWNLOAD_HOOK}
                  onMessage={handlePreviewDownloadMessage}
                  source={{ html: previewHtml }}
                  style={{ backgroundColor: theme.backgroundElement, flex: 1 }}
                />
              </View>
            )
          ) : null}
        </View>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Saves raw source in code mode and the visible preview to the gallery otherwise.
 * Disabled until the frame is measured to avoid capturing an empty image.
 */
function SavePreviewButton({
  mode,
  disabled,
  onPress,
  saving,
}: {
  mode: ViewMode;
  disabled: boolean;
  onPress: () => void;
  saving: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={mode === "code" ? "Download source code" : "Save preview as image"}
      accessibilityRole="button"
      className="h-11 w-11 items-center justify-center rounded-full bg-card dark:bg-card-dark active:opacity-70"
      disabled={disabled}
      onPress={onPress}
      style={{ opacity: disabled && !saving ? 0.4 : 1 }}
    >
      {saving ? (
        <ActivityIndicator color={theme.text} size="small" />
      ) : (
        <Download color={theme.text} size={20} />
      )}
    </Pressable>
  );
}

function ViewModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  disabled: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={value === "preview" ? "Show code" : "Show preview"}
      accessibilityRole="button"
      className="h-11 w-11 items-center justify-center rounded-full bg-card dark:bg-card-dark active:opacity-70"
      disabled={disabled}
      onPress={() => onChange(value === "preview" ? "code" : "preview")}
    >
      {value === "preview" ? <Code color={theme.text} size={20} /> : <Eye color={theme.text} size={20} />}
    </Pressable>
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
              backgroundColor: selected
                ? theme.backgroundSelected
                : "transparent",
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
