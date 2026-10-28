import { useAppState } from "@/hooks/use-app-state";
import { useChat } from "@/hooks/use-chat";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { AudioAnalysisHost } from "@/components/ui/audio-analysis-host";
import { DismissibleBanner } from "@/components/ui/dismissible-banner";
import { BrowserHost } from "@/components/ui/browser-host";
import { ReleaseNotesDrawer } from "@/components/ui/release-notes-drawer";
import { OtaUpdateDrawer } from "@/components/ui/ota-update-drawer";
import { ScenePreviewHost } from "@/components/ui/video-preview-host";
import { MixCheckHost } from "@/components/ui/video-mix-host";
import { VideoRenderHost } from "@/components/ui/video-render-host";
import { migrateAppDatabase } from "@/core/db/database";
import { AppStateProvider } from "@/providers/app-state";
import { HarnessProvider } from "@/providers/harness-state";
import { PhoneBridgeProvider } from "@/providers/phone-bridge-state";
import { UpdateProvider, useUpdate } from "@/providers/check-for-updates";
import { AppQueryProvider } from "@/providers/query-provider";
import {
  TOOL_APPROVAL_APPROVE_ACTION_ID,
  TOOL_APPROVAL_REJECT_ACTION_ID,
} from "@/modules/notifications/run-notifications";
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from "@expo-google-fonts/geist";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import {
  DarkTheme,
  DefaultTheme,
  router,
  Slot,
  ThemeProvider,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SQLiteProvider } from "expo-sqlite";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { enableFreeze } from "react-native-screens";
import "./global.css";

// Freeze off-screen native screens: settings/library/terminal stop
// re-rendering while the chat streams. Called once at module scope.
enableFreeze(true);

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as
      | { type?: string }
      | null;
    const alertKind = data?.type;

    return {
      shouldPlaySound:
        alertKind === "tool-approval" ||
        alertKind === "run-finished" ||
        alertKind === "question-request" ||
        alertKind === "secret-request",
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

function NotificationObserver() {
  const { resolveNotificationApproval, selectConversation } = useChat();
  const callbacksRef = useRef({
    resolveNotificationApproval,
    selectConversation,
  });
  callbacksRef.current = { resolveNotificationApproval, selectConversation };

  useEffect(() => {
    function openConversation(
      notification: Notifications.Notification | null | undefined,
    ) {
      const conversationId = notification?.request.content.data?.conversationId;

      if (typeof conversationId === "string") {
        callbacksRef.current
          .selectConversation(conversationId)
          .then(() => {
            router.dismissTo("/");
          })
          .catch(console.error);
      }
    }

    function handleResponse(
      response: Notifications.NotificationResponse | null | undefined,
    ) {
      if (!response?.notification) {
        return;
      }

      const data = response.notification.request.content.data as
        | { approvalId?: string; runId?: string; type?: string }
        | null;

      if (
        data?.type === "tool-approval" &&
        response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
      ) {
        if (
          typeof data.runId === "string" &&
          typeof data.approvalId === "string"
        ) {
          if (
            response.actionIdentifier === TOOL_APPROVAL_APPROVE_ACTION_ID
          ) {
            void callbacksRef.current.resolveNotificationApproval({
              approvalId: data.approvalId,
              decision: "approve",
              runId: data.runId,
            });
          } else if (
            response.actionIdentifier === TOOL_APPROVAL_REJECT_ACTION_ID
          ) {
            void callbacksRef.current.resolveNotificationApproval({
              approvalId: data.approvalId,
              decision: "deny",
              runId: data.runId,
            });
          }
        }

        return;
      }

      openConversation(response.notification);
    }

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        handleResponse(response);
        Notifications.clearLastNotificationResponseAsync().catch(() => {});
      })
      .catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleResponse,
    );

    return () => {
      subscription.remove();
    };
  }, []);

  return null;
}

function InAppNotificationBanner() {
  const theme = useTheme();
  const { dismissInAppNotification, inAppNotification } = useAppState();
  const { currentConversation, selectConversation } = useChat();

  useEffect(() => {
    if (!inAppNotification) {
      return;
    }

    const timeout = setTimeout(() => {
      dismissInAppNotification();
    }, 3500);

    return () => {
      clearTimeout(timeout);
    };
  }, [dismissInAppNotification, inAppNotification]);

  if (!inAppNotification) {
    return null;
  }

  return (
    <View className="absolute inset-x-0 top-0 z-50 px-sp-4 pt-12">
      <DismissibleBanner onDismiss={dismissInAppNotification}>
        <Pressable
          accessibilityRole="button"
          className="rounded-card border border-border bg-card px-sp-4 py-sp-3 shadow-sm dark:border-border-dark dark:bg-card-dark"
          onPress={() => {
            if (currentConversation?.id !== inAppNotification.conversationId) {
              selectConversation(inAppNotification.conversationId)
                .then(() => {
                  router.dismissTo("/");
                })
                .catch(console.error);
            }

            dismissInAppNotification();
          }}
          style={({ pressed }) => (pressed ? { opacity: 0.92 } : null)}
        >
          <View className="flex-row items-start gap-sp-3">
            <View className="min-w-0 flex-1 gap-1">
              <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                {inAppNotification.title}
              </Text>
              <Text
                className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                numberOfLines={2}
              >
                {inAppNotification.body}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Dismiss notification"
              accessibilityRole="button"
              className="p-1"
              hitSlop={8}
              onPress={dismissInAppNotification}
              style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
            >
              <X color={theme.textSecondary} size={16} />
            </Pressable>
          </View>
        </Pressable>
      </DismissibleBanner>
    </View>
  );
}

/**
 * New-release notice: a "what's new" drawer with the release notes. Dismissing it
 * hides it for the rest of the session; "Skip this version" hides it permanently
 * for that release (Settings > App Update stays as the manual path).
 *
 * OTA updates get their own informational drawer instead: it opens only once
 * the downloaded bundle is actually running — never while it downloads — with
 * a full-width Close. An APK release takes precedence — it needs a decision
 * from the user.
 */
function ReleaseUpdateNotice() {
  const {
    release,
    bannerDismissed,
    downloadProgress,
    installing,
    installUpdate,
    skipUpdate,
    ota,
  } = useUpdate();
  const [notesDismissedTag, setNotesDismissedTag] = useState<string | null>(
    null,
  );

  if (release && !bannerDismissed && notesDismissedTag !== release.tagName) {
    return (
      <ReleaseNotesDrawer
        downloadProgress={downloadProgress}
        installing={installing}
        onInstall={() => {
          void installUpdate();
        }}
        onLater={() => {
          setNotesDismissedTag(release.tagName);
        }}
        onSkip={() => {
          void skipUpdate();
        }}
        open
        release={release}
      />
    );
  }

  if (ota.phase === "applied") {
    return (
      <OtaUpdateDrawer
        notes={ota.notes}
        onDone={ota.acknowledge}
        open
      />
    );
  }

  return null;
}

function SplashScreenController({
  ready,
}: {
  ready: boolean;
}) {
  useEffect(() => {
    if (ready) {
      SplashScreen.hide();
    }
  }, [ready]);

  return null;
}

export default function MainLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });
  const fontsReady = fontsLoaded || !!fontError;

  if (!fontsReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <AppQueryProvider>
            <SQLiteProvider
              databaseName="mobile-agent.db"
              onInit={migrateAppDatabase}
            >
              <AppStateProvider>
                <PhoneBridgeProvider>
                <HarnessProvider>
                <UpdateProvider>
                  <SplashScreenController ready={fontsReady} />
                  <NotificationObserver />
                  <InAppNotificationBanner />
                  <ReleaseUpdateNotice />
                  <VideoRenderHost />
                  <ScenePreviewHost />
                  <MixCheckHost />
                  <AudioAnalysisHost />
                  <BrowserHost />
                  <Slot />
                </UpdateProvider>
                </HarnessProvider>
                </PhoneBridgeProvider>
              </AppStateProvider>
            </SQLiteProvider>
          </AppQueryProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
