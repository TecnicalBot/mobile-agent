import { Alert, Linking } from "react-native";

export const ALLOWED_LINK_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
]);

export function getLinkProtocol(url: string): string | null {
  return /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? null;
}

export async function openExternalLink(url: string) {
  const protocol = getLinkProtocol(url);

  if (!protocol || !ALLOWED_LINK_PROTOCOLS.has(`${protocol}:`)) {
    Alert.alert("Unable to open link", "This link type is not supported.");
    return;
  }

  try {
    await Linking.openURL(url);
  } catch (error) {
    Alert.alert(
      "Unable to open link",
      error instanceof Error ? error.message : "No app could open this link.",
    );
  }
}