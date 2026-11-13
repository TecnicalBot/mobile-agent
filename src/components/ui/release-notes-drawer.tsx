import { Pressable, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { MarkdownView } from "@/components/ui/markdown-view";
import { openExternalLink } from "@/modules/chat/open-link";
import type { AvailableRelease } from "@/modules/updates/github-release";
import { progressPercent } from "@/modules/updates/progress";

/**
 * "What's new" drawer shown when a newer release exists.
 *
 * Renders the published release notes (`.release-notes.md`, fetched with the
 * release) with the app's shared markdown renderer, so the user can read the
 * changes before deciding. Dismissing the drawer (handle, overlay or ✕) keeps
 * the compact banner around for this session; `Skip this version` is
 * persisted, so nothing ever comes back for that release.
 *
 * While the APK transfers, the primary action turns into
 * `Downloading 42%` (`downloadProgress`, 0..1) — no bar, no spinner. The
 * fraction stays `null` until the server reports a total size, so an unknown
 * length simply reads 0%.
 */
export function ReleaseNotesDrawer({
  downloadProgress = null,
  installing,
  onInstall,
  onLater,
  onSkip,
  open,
  release,
}: {
  downloadProgress?: number | null;
  installing: boolean;
  onInstall: () => void;
  onLater: () => void;
  onSkip: () => void;
  open: boolean;
  release: AvailableRelease;
}) {
  return (
    <Drawer
      dismissible={!installing}
      onOpenChange={(next) => {
        if (!next) {
          onLater();
        }
      }}
      open={open}
    >
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>{`What's new in ${release.name}`}</DrawerTitle>
          <DrawerDescription>
            {`You are on ${release.currentVersion}. Update to ${release.tagName} to get the changes below.`}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          {release.body.trim() ? (
            <MarkdownView>{release.body}</MarkdownView>
          ) : (
            <Text className="font-sans text-sm leading-5 text-muted-foreground dark:text-muted-foreground-dark">
              The full changelog is on the release page.
            </Text>
          )}
        </DrawerBody>

        <DrawerFooter className="items-center gap-sp-3">
          <View className="w-full flex-row gap-sp-2">
            <Button
              className="flex-1"
              disabled={installing}
              onPress={onSkip}
              variant="outline"
            >
              Skip this version
            </Button>
            <Button
              accessibilityLabel={
                installing
                  ? `Downloading, ${progressPercent(downloadProgress ?? 0)} percent`
                  : "Update now"
              }
              className="flex-1"
              disabled={installing}
              onPress={onInstall}
            >
              {installing
                ? `Downloading ${progressPercent(downloadProgress ?? 0)}%`
                : "Update now"}
            </Button>
          </View>
          <Pressable
            accessibilityRole="link"
            className="items-center"
            hitSlop={8}
            onPress={() => {
              openExternalLink(release.url).catch(console.error);
            }}
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
          >
            <Text className="font-sans text-sm text-muted-foreground underline dark:text-muted-foreground-dark">
              View release page
            </Text>
          </Pressable>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
