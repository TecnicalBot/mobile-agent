import { Alert, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";

export const ALLOWED_LINK_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
]);

export function getLinkProtocol(url: string): string | null {
  return /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? null;
}

/**
 * Opens a link in an in-app browser. http(s) links go through Chrome Custom
 * Tabs / SFSafariViewController — the same mechanism Instagram and X use —
 * instead of handing off to the system browser. email and tel: stay on the
 * external path because they have no in-app rendering.
 */
export async function openExternalLink(url: string) {
  const protocol = getLinkProtocol(url);

  if (!protocol || !ALLOWED_LINK_PROTOCOLS.has(`${protocol}:`)) {
    Alert.alert("Unable to open link", "This link type is not supported.");
    return;
  }

  try {
    if (protocol === "http" || protocol === "https") {
      try {
        await WebBrowser.openBrowserAsync(url);
        return;
      } catch {
        // Chrome Custom Tabs unavailable (or no browser activity answer) on
        // this device — fall back to whatever the OS has registered.
        await Linking.openURL(url);
        return;
      }
    }

    await Linking.openURL(url);
  } catch (error) {
    Alert.alert(
      "Unable to open link",
      error instanceof Error ? error.message : "No app could open this link.",
    );
  }
}