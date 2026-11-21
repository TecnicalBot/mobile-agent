import { useEffect } from "react";
import { Keyboard } from "react-native";
import {
  KeyboardController,
  KeyboardEvents,
  useKeyboardHandler,
} from "react-native-keyboard-controller";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/** Keyboard padding for the full-screen chat (safe areas live inside it). */
export function useChatKeyboardStyle(keyboardVisible: boolean) {
  const keyboardHeight = useSharedValue(
    KeyboardController.isVisible() ? KeyboardController.state().height : 0,
  );

  useKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        // A dismissal can lose its move/end callbacks when focus changes or
        // the JS thread is busy streaming. Start a UI-thread fallback so the
        // reserved space still closes; live frames take over when available.
        if (event.height === 0 || event.progress === 0) {
          keyboardHeight.value = withTiming(0, {
            duration: Math.max(0, event.duration),
          });
        } else if (event.duration <= 0) {
          keyboardHeight.value = event.height;
        }
      },
      onMove: (event) => {
        "worklet";
        keyboardHeight.value = event.progress === 0 ? 0 : event.height;
      },
      onInteractive: (event) => {
        "worklet";
        keyboardHeight.value = event.progress === 0 ? 0 : event.height;
      },
      onEnd: (event) => {
        "worklet";
        keyboardHeight.value = event.progress === 0 ? 0 : event.height;
      },
    },
    [],
  );

  useEffect(() => {
    const clearHeight = () => {
      keyboardHeight.value = 0;
    };
    // Clear the shared value directly, without waiting for a React render.
    // RN's independent hide event also covers missed controller callbacks.
    const controllerHide = KeyboardEvents.addListener(
      "keyboardDidHide",
      clearHeight,
    );
    const nativeHide = Keyboard.addListener("keyboardDidHide", clearHeight);
    return () => {
      controllerHide.remove();
      nativeHide.remove();
    };
  }, [keyboardHeight]);

  useEffect(() => {
    if (!keyboardVisible) keyboardHeight.value = 0;
  }, [keyboardHeight, keyboardVisible]);

  // A hide notification must clear the padding even if Android's final
  // animation frame was missed. Return an explicit zero: dropping an animated
  // style property does not undo the value already applied to the native view.
  return useAnimatedStyle(() => ({
    paddingBottom: keyboardVisible ? Math.max(0, keyboardHeight.value) : 0,
  }));
}
