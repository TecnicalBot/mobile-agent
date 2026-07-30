import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

let notificationChannelReady = false;
let notificationPermissionsRequested = false;

export const RUN_NOTIFICATION_CHANNEL_ID = "agent-runs";

export async function prepareRunNotificationsAsync() {
  if (Platform.OS === "android" && !notificationChannelReady) {
    await Notifications.setNotificationChannelAsync(RUN_NOTIFICATION_CHANNEL_ID, {
      name: "Agent runs",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    notificationChannelReady = true;
  }

  if (!notificationPermissionsRequested) {
    notificationPermissionsRequested = true;

    const currentPermissions = await Notifications.getPermissionsAsync();

    if (currentPermissions.status !== "granted") {
      await Notifications.requestPermissionsAsync();
    }
  }
}

export async function notifyRunFinishedAsync(input: {
  body: string;
  conversationId: string;
  title: string;
}) {
  await prepareRunNotificationsAsync();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      data: {
        conversationId: input.conversationId,
        url: "/",
      },
    },
    trigger: null,
  });
}
