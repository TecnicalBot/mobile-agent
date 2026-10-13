import { requireOptionalNativeModule, type NativeModule } from "expo";
import { Platform } from "react-native";

type QuoteSelectionEvents = {
  onQuoteSelected(event: { text: string }): void;
};

declare class QuoteSelectionNativeModule extends NativeModule<QuoteSelectionEvents> {
  start(): Promise<void>;
}

const QuoteSelection =
  Platform.OS === "android"
    ? (requireOptionalNativeModule<QuoteSelectionNativeModule>(
        "QuoteSelection",
      ) ?? null)
    : null;

/**
 * Installs the "Quote (Ask)" item into the Android text-selection menu.
 * Safe to call repeatedly — the native side only registers its listener once.
 */
export function enableQuoteSelection(): void {
  QuoteSelection?.start().catch((error) => {
    console.error("[QuoteSelection] start failed:", error);
  });
}

/**
 * Subscribes to text quoted from the native selection menu.
 * Returns an unsubscribe function.
 */
export function subscribeToQuoteSelection(
  callback: (text: string) => void,
): () => void {
  if (!QuoteSelection) return () => {};

  const subscription = QuoteSelection.addListener(
    "onQuoteSelected",
    (event) => {
      callback(event.text);
    },
  );

  return () => subscription.remove();
}
