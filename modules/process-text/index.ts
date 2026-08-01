import { requireNativeModule } from "expo";
import { Platform } from "react-native";

type ProcessTextNativeModule = {
  consumePendingText(): Promise<string | null>;
};

const ProcessText =
  Platform.OS === "android"
    ? requireNativeModule<ProcessTextNativeModule>("ProcessText")
    : null;

export async function consumePendingText(): Promise<string | null> {
  return ProcessText ? ProcessText.consumePendingText() : null;
}
