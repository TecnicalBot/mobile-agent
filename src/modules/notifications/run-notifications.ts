import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

let notificationChannelReady = false;
let notificationCategoryReady = false;
let notificationPermissionsRequested = false;

export const RUN_NOTIFICATION_CHANNEL_ID = "agent-runs";
export const APPROVAL_NOTIFICATION_CHANNEL_ID = "agent_approvals_v1";
export const RESULTS_NOTIFICATION_CHANNEL_ID = "agent_results_v1";

export const TOOL_APPROVAL_CATEGORY_ID = "tool_approval_v1";
export const TOOL_APPROVAL_APPROVE_ACTION_ID = "tool_approval_approve_v1";
export const TOOL_APPROVAL_REJECT_ACTION_ID = "tool_approval_reject_v1";

export type ApprovalNotificationData = {
  type: "tool-approval";
  schemaVersion: 1;
  runId: string;
  approvalId: string;
  conversationId: string;
};

export type RunFinishedNotificationData = {
  type: "run-finished";
  schemaVersion: 1;
  conversationId: string;
  status: "success" | "failed";
};

const approvalNotificationIds = new Map<string, string>();
const runFinishedNotificationIds = new Map<string, string>();

export async function prepareRunNotificationsAsync(input?: {
  requestPermission?: boolean;
}) {
  const requestPermission = input?.requestPermission ?? true;

  if (Platform.OS === "android" && !notificationChannelReady) {
    await Promise.all([
      Notifications.setNotificationChannelAsync(RUN_NOTIFICATION_CHANNEL_ID, {
        name: "Agent runs",
        importance: Notifications.AndroidImportance.DEFAULT,
      }),
      Notifications.setNotificationChannelAsync(
        APPROVAL_NOTIFICATION_CHANNEL_ID,
        {
          name: "Approval requests",
          description: "Asks you to allow or deny an agent tool call.",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 200, 250],
        },
      ),
      Notifications.setNotificationChannelAsync(RESULTS_NOTIFICATION_CHANNEL_ID, {
        name: "Agent results",
        description: "Alerts you when the agent finishes a task.",
        importance: Notifications.AndroidImportance.DEFAULT,
      }),
    ]);
    notificationChannelReady = true;
  }

  if (!notificationCategoryReady) {
    await Notifications.setNotificationCategoryAsync(
      TOOL_APPROVAL_CATEGORY_ID,
      [
        {
          identifier: TOOL_APPROVAL_APPROVE_ACTION_ID,
          buttonTitle: "Approve",
          options: {
            opensAppToForeground: true,
            isDestructive: false,
            isAuthenticationRequired: Platform.OS === "ios",
          },
        },
        {
          identifier: TOOL_APPROVAL_REJECT_ACTION_ID,
          buttonTitle: "Reject",
          options: {
            opensAppToForeground: true,
            isDestructive: true,
            isAuthenticationRequired: false,
          },
        },
      ],
      {
        previewPlaceholder: "The agent is asking for permission",
      },
    );
    notificationCategoryReady = true;
  }

  if (!requestPermission || notificationPermissionsRequested) {
    return;
  }

  notificationPermissionsRequested = true;

  const currentPermissions = await Notifications.getPermissionsAsync();

  if (currentPermissions.status !== "granted") {
    await Notifications.requestPermissionsAsync();
  }
}

function buildAlertTrigger(channelId: string) {
  return {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: 1,
    channelId,
  } as const;
}

export async function notifyApprovalRequestedAsync(input: {
  approvalId: string;
  chatTitle: string;
  conversationId: string;
  inputSummary: string;
  runId: string;
  toolName: string;
}) {
  await prepareRunNotificationsAsync();

  await dismissApprovalNotification(input.runId);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${input.chatTitle} needs approval`,
      body: `${input.toolName}: ${input.inputSummary}`,
      sound: Platform.OS === "ios" ? "default" : undefined,
      categoryIdentifier: TOOL_APPROVAL_CATEGORY_ID,
      data: {
        type: "tool-approval",
        schemaVersion: 1,
        runId: input.runId,
        approvalId: input.approvalId,
        conversationId: input.conversationId,
        url: "/",
      },
    },
    trigger: buildAlertTrigger(APPROVAL_NOTIFICATION_CHANNEL_ID),
  });

  approvalNotificationIds.set(input.runId, notificationId);
}

export async function dismissApprovalNotification(runId: string) {
  const notificationId = approvalNotificationIds.get(runId);

  if (!notificationId) {
    return;
  }

  approvalNotificationIds.delete(runId);

  await Promise.allSettled([
    Notifications.cancelScheduledNotificationAsync(notificationId),
    Notifications.dismissNotificationAsync(notificationId),
  ]);
}

export async function notifyRunFinishedAsync(input: {
  body: string;
  conversationId: string;
  status: "success" | "failed";
  title: string;
}) {
  await prepareRunNotificationsAsync();

  await dismissRunFinishedNotification(input.conversationId);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: input.status === "success" ? "Agent finished" : "Agent failed",
      body: `${input.title}: ${input.body}`,
      sound: Platform.OS === "ios" ? "default" : undefined,
      data: {
        type: "run-finished",
        schemaVersion: 1,
        conversationId: input.conversationId,
        status: input.status,
        url: "/",
      },
    },
    trigger: buildAlertTrigger(RESULTS_NOTIFICATION_CHANNEL_ID),
  });

  runFinishedNotificationIds.set(input.conversationId, notificationId);
}

export async function dismissRunFinishedNotification(conversationId: string) {
  const notificationId = runFinishedNotificationIds.get(conversationId);

  if (!notificationId) {
    return;
  }

  runFinishedNotificationIds.delete(conversationId);

  await Promise.allSettled([
    Notifications.cancelScheduledNotificationAsync(notificationId),
    Notifications.dismissNotificationAsync(notificationId),
  ]);
}

export async function dismissStaleApprovalNotificationsAsync(
  valid: { approvalId: string; runId: string }[],
) {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return;
  }

  try {
    const validKeys = new Set(
      valid.map((item) => `${item.runId}:${item.approvalId}`),
    );
    const presented =
      await Notifications.getPresentedNotificationsAsync();

    for (const notification of presented) {
      const data = notification.request.content.data as
        | ApprovalNotificationData
        | null;

      if (data?.type !== "tool-approval") {
        continue;
      }

      if (validKeys.has(`${data.runId}:${data.approvalId}`)) {
        continue;
      }

      await Notifications.dismissNotificationAsync(
        notification.request.identifier,
      ).catch(() => {});
    }
  } catch {
    // Notifications list is best-effort; ignore platform failures.
  }
}
