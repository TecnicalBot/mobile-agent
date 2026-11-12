import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardHandler } from "react-native-keyboard-controller";

import { useChatKeyboardStyle } from "./use-chat-keyboard-style";

const state = vi.hoisted(() => ({
  visible: false,
  height: 0,
  sharedHeight: null as { value: number } | null,
  computeStyle: null as (() => { paddingBottom: number }) | null,
}));

vi.mock("react-native-keyboard-controller", () => ({
  KeyboardController: {
    isVisible: () => state.visible,
    state: () => ({ height: state.height }),
  },
  useKeyboardHandler: vi.fn(),
}));

vi.mock("react-native-reanimated", () => ({
  useSharedValue: (initialValue: number) => {
    state.sharedHeight ??= { value: initialValue };
    return state.sharedHeight;
  },
  useAnimatedStyle: (computeStyle: () => { paddingBottom: number }) => {
    state.computeStyle = computeStyle;
    return {};
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.visible = false;
  state.height = 0;
  state.sharedHeight = null;
  state.computeStyle = null;
});

const event = (height: number) => ({
  height,
  progress: height > 0 ? 1 : 0,
  duration: 250,
  target: 1,
});

describe("chat keyboard padding", () => {
  it("does not reserve the last known keyboard height while hidden", () => {
    state.height = 340;
    useChatKeyboardStyle(false);
    expect(state.computeStyle?.()).toEqual({ paddingBottom: 0 });
  });

  it("starts with the keyboard height when mounted with an open keyboard", () => {
    state.visible = true;
    state.height = 340;
    useChatKeyboardStyle(true);
    expect(state.computeStyle?.()).toEqual({ paddingBottom: 340 });
  });

  it("follows opening, interactive dismissal, and the final hide frame", () => {
    useChatKeyboardStyle(true);
    const handler = vi.mocked(useKeyboardHandler).mock.calls[0][0];

    handler.onMove?.(event(340));
    expect(state.computeStyle?.()).toEqual({ paddingBottom: 340 });

    handler.onInteractive?.(event(170));
    expect(state.computeStyle?.()).toEqual({ paddingBottom: 170 });

    handler.onEnd?.(event(0));
    expect(state.computeStyle?.()).toEqual({ paddingBottom: 0 });
  });

  it("explicitly clears stale padding when the final animation frame is missed", () => {
    useChatKeyboardStyle(true);
    const handler = vi.mocked(useKeyboardHandler).mock.calls[0][0];
    handler.onMove?.(event(340));
    expect(state.computeStyle?.()).toEqual({ paddingBottom: 340 });

    // keyboardDidHide arrives without an onEnd/onMove with height zero.
    useChatKeyboardStyle(false);
    expect(state.sharedHeight?.value).toBe(340);
    expect(state.computeStyle?.()).toEqual({ paddingBottom: 0 });

    // The next focus/keyboard cycle must still resize the chat normally.
    useChatKeyboardStyle(true);
    handler.onMove?.(event(300));
    expect(state.computeStyle?.()).toEqual({ paddingBottom: 300 });
  });

  it("uses guarded padding without a second keyboard-avoidance or blur path", () => {
    const source = readFileSync(
      new URL("../app/(root)/index.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("useChatKeyboardStyle(keyboardVisible)");
    expect(source).toContain("style={[{ flex: 1 }, chatKeyboardStyle]}");
    expect(source).not.toContain("KeyboardAvoidingView");
    expect(source).not.toContain("composerRef.current?.blur()");
  });
});
