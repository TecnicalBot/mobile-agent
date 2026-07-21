import { useAppState } from "@/hooks/use-app-state";
import { useChat } from "@/hooks/use-chat";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { migrateAppDatabase } from "@/lib/db/database";
import { AppStateProvider } from "@/providers/app-state";
import { UpdateProvider, useUpdate } from "@/providers/check-for-updates";
import { AppQueryProvider } from "@/providers/query-provider";
import * as Notifications from "expo-notifications";
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
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import "./global.css";

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function NotificationObserver() {
  const { selectConversation } = useChat();

  useEffect(() => {
    function openConversation(
      notification: Notifications.Notification | null | undefined,
    ) {
      const conversationId = notification?.request.content.data?.conversationId;

      if (typeof conversationId === "string") {
        selectConversation(conversationId)
          .then(() => {
            router.push("/");
          })
          .catch(console.error);
      }
    }

    const response = Notifications.getLastNotificationResponse();

    if (response?.notification) {
      openConversation(response.notification);
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (nextResponse) => {
        openConversation(nextResponse.notification);
      },
    );

    return () => {
      subscription.remove();
    };
  }, [selectConversation]);

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
      <Pressable
        accessibilityRole="button"
        className="rounded-card border border-border bg-card px-sp-4 py-sp-3 shadow-sm dark:border-border-dark dark:bg-card-dark"
        onPress={() => {
          if (currentConversation?.id !== inAppNotification.conversationId) {
            selectConversation(inAppNotification.conversationId)
              .then(() => {
                router.push("/");
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
            onPress={() => {
              dismissInAppNotification();
            }}
            style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
          >
            <X color={theme.textSecondary} size={16} />
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

function ReleaseUpdateBanner() {
  const theme = useTheme();
  const { release, bannerDismissed, installing, installUpdate, dismissUpdate } =
    useUpdate();

  if (!release || bannerDismissed) return null;
  return (
    <View className="absolute inset-x-0 top-10 z-50 px-sp-4 pb-10">
      <View className="rounded-card border border-border bg-card px-sp-4 py-sp-3 shadow-sm dark:border-border-dark dark:bg-card-dark">
        <View className="flex-row items-start gap-sp-3">
          <Pressable
            accessibilityRole="button"
            className="min-w-0 flex-1 gap-1"
            disabled={installing}
            onPress={installUpdate}
          >
            <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
              Update available: {release.tagName}
            </Text>
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {installing
                ? `Downloading ${release.apkName}…`
                : `You have ${release.currentVersion}. Tap to update.`}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Dismiss update"
            accessibilityRole="button"
            className="p-1"
            hitSlop={8}
            onPress={dismissUpdate}
          >
            <X color={theme.textSecondary} size={16} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function SplashScreenController() {
  const { error, hydrating, ready } = useAppState();
  const hasHiddenSplashRef = useRef(false);

  useEffect(() => {
    if (hasHiddenSplashRef.current || (hydrating && !ready && !error)) {
      return;
    }

    hasHiddenSplashRef.current = true;
    SplashScreen.hideAsync().catch(console.error);
  }, [error, hydrating, ready]);

  return null;
}

export default function MainLayout() {
  const colorScheme = useColorScheme();
  return (
    <KeyboardProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AppQueryProvider>
          <SQLiteProvider
            databaseName="mobile-agent.db"
            onInit={migrateAppDatabase}
          >
            <AppStateProvider>
              <UpdateProvider>
                <SplashScreenController />
                <NotificationObserver />
                <InAppNotificationBanner />
                <ReleaseUpdateBanner />
                <Slot />
              </UpdateProvider>
            </AppStateProvider>
          </SQLiteProvider>
        </AppQueryProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
