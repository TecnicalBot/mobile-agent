import {
  KeyboardController,
  useKeyboardHandler,
} from "react-native-keyboard-controller";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

/** Keyboard padding for the full-screen chat (safe areas live inside it). */
export function useChatKeyboardStyle(keyboardVisible: boolean) {
  const keyboardHeight = useSharedValue(
    KeyboardController.isVisible() ? KeyboardController.state().height : 0,
  );

  useKeyboardHandler(
    {
      onMove: (event) => {
        "worklet";
        keyboardHeight.value = event.height;
      },
      onInteractive: (event) => {
        "worklet";
        keyboardHeight.value = event.height;
      },
      onEnd: (event) => {
        "worklet";
        keyboardHeight.value = event.height;
      },
    },
    [],
  );

  // A hide notification must clear the padding even if Android's final
  // animation frame was missed. Return an explicit zero: dropping an animated
  // style property does not undo the value already applied to the native view.
  return useAnimatedStyle(() => ({
    paddingBottom: keyboardVisible ? Math.max(0, keyboardHeight.value) : 0,
  }));
}
