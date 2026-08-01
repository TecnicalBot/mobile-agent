import type {
  ComponentPropsWithoutRef,
  ComponentRef,
  ForwardedRef,
  PropsWithChildren,
  ReactElement,
  ReactNode,
  RefObject,
} from "react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Keyboard,
  Platform,
  View,
  type FlatListProps,
  type LayoutChangeEvent,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { Button } from "@/components/ui/button";
import { cn } from "@/core/utils";

type ScrollState = {
  end: boolean;
  start: boolean;
};

type MessageScrollerContextValue = {
  listRef: RefObject<FlatList<unknown> | null>;
  onListContentSizeChange: (contentHeight: number) => void;
  onListLayout: (viewportHeight: number) => void;
  onListScroll: (
    offsetY: number,
    viewportHeight: number,
    contentHeight: number,
  ) => void;
  scheduleFollowToEnd: () => void;
  scrollToEnd: () => void;
  scrollToStart: () => void;
  scrollable: ScrollState;
};

const MessageScrollerContext =
  createContext<MessageScrollerContextValue | null>(null);

function useMessageScrollerContext() {
  const context = useContext(MessageScrollerContext);

  if (!context) {
    throw new Error(
      "MessageScroller components must be used inside MessageScrollerProvider.",
    );
  }

  return context;
}

export type MessageScrollerProviderProps = PropsWithChildren<{
  autoScroll?: boolean;
}>;

export function MessageScrollerProvider({
  autoScroll = false,
  children,
}: MessageScrollerProviderProps) {
  const listRef = useRef<FlatList<unknown>>(null);
  const followRef = useRef(autoScroll);
  const pendingFollowRef = useRef(false);
  const lastScrollableRef = useRef<ScrollState>({ end: false, start: false });
  const metricsRef = useRef({
    contentHeight: 0,
    offsetY: 0,
    viewportHeight: 0,
  });
  const [scrollable, setScrollable] = useState<ScrollState>({
    end: false,
    start: false,
  });

  const recomputeScrollable = useCallback(
    (offsetY: number, viewportHeight: number, contentHeight: number) => {
      metricsRef.current = {
        contentHeight,
        offsetY,
        viewportHeight,
      };

      const maxOffset = Math.max(contentHeight - viewportHeight, 0);
      const next: ScrollState = {
        end: offsetY < maxOffset - 8,
        start: offsetY > 8,
      };

      followRef.current = next.end;

      const previous = lastScrollableRef.current;

      if (previous.start === next.start && previous.end === next.end) {
        return;
      }

      lastScrollableRef.current = next;
      setScrollable(next);
    },
    [],
  );

  const onListScroll = useCallback(
    (offsetY: number, viewportHeight: number, contentHeight: number) => {
      recomputeScrollable(offsetY, viewportHeight, contentHeight);
    },
    [recomputeScrollable],
  );

  const onListLayout = useCallback(
    (viewportHeight: number) => {
      const { contentHeight, offsetY } = metricsRef.current;

      recomputeScrollable(offsetY, viewportHeight, contentHeight);
    },
    [recomputeScrollable],
  );

  const scrollToEnd = useCallback(() => {
    pendingFollowRef.current = false;
    followRef.current = true;
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const scrollToStart = useCallback(() => {
    followRef.current = false;
    listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  }, []);

  const followToEnd = useCallback(() => {
    pendingFollowRef.current = false;

    if (!followRef.current) {
      return;
    }

    listRef.current?.scrollToEnd({ animated: false });
  }, []);

  const scheduleFollowToEnd = useCallback(() => {
    if (!autoScroll || !followRef.current || pendingFollowRef.current) {
      return;
    }

    pendingFollowRef.current = true;
    requestAnimationFrame(followToEnd);
  }, [autoScroll, followToEnd]);

  const onListContentSizeChange = useCallback(
    (contentHeight: number) => {
      const { offsetY, viewportHeight } = metricsRef.current;

      recomputeScrollable(offsetY, viewportHeight, contentHeight);
      scheduleFollowToEnd();
    },
    [recomputeScrollable, scheduleFollowToEnd],
  );

  useEffect(() => {
    if (!autoScroll) {
      return;
    }

    const syncToLatest = () => {
      if (!followRef.current) {
        return;
      }

      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: Platform.OS === "ios" });
      });
    };

    const showSubscription = Keyboard.addListener(
      "keyboardDidShow",
      syncToLatest,
    );
    const hideSubscription = Keyboard.addListener(
      "keyboardDidHide",
      syncToLatest,
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [autoScroll]);

  const value = useMemo<MessageScrollerContextValue>(
    () => ({
      listRef,
      onListContentSizeChange,
      onListLayout,
      onListScroll,
      scheduleFollowToEnd,
      scrollToEnd,
      scrollToStart,
      scrollable,
    }),
    [
      onListContentSizeChange,
      onListLayout,
      onListScroll,
      scheduleFollowToEnd,
      scrollToEnd,
      scrollToStart,
      scrollable,
    ],
  );

  return (
    <MessageScrollerContext.Provider value={value}>
      {children}
    </MessageScrollerContext.Provider>
  );
}

export type MessageScrollerProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const MessageScroller = forwardRef<
  ComponentRef<typeof View>,
  MessageScrollerProps
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn(
      "relative flex-1 overflow-hidden rounded-card border border-border bg-background dark:border-border-dark dark:bg-background-dark",
      className,
    )}
    {...props}
  />
));

MessageScroller.displayName = "MessageScroller";

export type MessageScrollerListProps<ItemT> = Omit<
  FlatListProps<ItemT>,
  "data" | "keyExtractor" | "onContentSizeChange" | "onScroll" | "renderItem"
> & {
  className?: string;
  contentContainerClassName?: string;
  data: ArrayLike<ItemT> | null | undefined;
  keyExtractor?: (item: ItemT, index: number) => string;
  onContentSizeChange?: FlatListProps<ItemT>["onContentSizeChange"];
  onScroll?: FlatListProps<ItemT>["onScroll"];
  renderItem: ListRenderItem<ItemT>;
};

function MessageScrollerListInner<ItemT>(
  {
    className,
    contentContainerClassName,
    keyboardShouldPersistTaps = "handled",
    onContentSizeChange,
    onLayout,
    onScroll,
    scrollEventThrottle = 16,
    ...props
  }: MessageScrollerListProps<ItemT>,
  ref: ForwardedRef<FlatList<ItemT>>,
) {
  const { listRef, onListContentSizeChange, onListLayout, onListScroll } =
    useMessageScrollerContext();

  const handleContentSizeChange = useCallback(
    (width: number, height: number) => {
      onListContentSizeChange(height);
      onContentSizeChange?.(width, height);
    },
    [onContentSizeChange, onListContentSizeChange],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onListLayout(event.nativeEvent.layout.height);
      onLayout?.(event);
    },
    [onLayout, onListLayout],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;

      onListScroll(
        contentOffset.y,
        layoutMeasurement.height,
        contentSize.height,
      );
      onScroll?.(event);
    },
    [onListScroll, onScroll],
  );

  const handleRef = useCallback(
    (node: FlatList<ItemT> | null) => {
      listRef.current = node as FlatList<unknown> | null;

      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [listRef, ref],
  );

  return (
    <FlatList<ItemT>
      ref={handleRef}
      accessibilityLiveRegion="polite"
      className={cn("flex-1", className)}
      contentContainerClassName={cn("gap-sp-3", contentContainerClassName)}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      onContentSizeChange={handleContentSizeChange}
      onLayout={handleLayout}
      onScroll={handleScroll}
      scrollEventThrottle={scrollEventThrottle}
      {...props}
    />
  );
}

type MessageScrollerListComponent = <ItemT>(
  props: MessageScrollerListProps<ItemT> & {
    ref?: ForwardedRef<FlatList<ItemT>>;
  },
) => ReactElement;

export const MessageScrollerList = forwardRef(
  MessageScrollerListInner,
) as MessageScrollerListComponent;

export type MessageScrollerButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  "children"
> & {
  children?: ReactNode;
  className?: string;
  direction?: "start" | "end";
};

export const MessageScrollerButton = forwardRef<
  ComponentRef<typeof Button>,
  MessageScrollerButtonProps
>(({ children, className, direction = "end", ...props }, ref) => {
  const { scrollToEnd, scrollToStart, scrollable } =
    useMessageScrollerContext();
  const canScroll = direction === "end" ? scrollable.end : scrollable.start;

  return (
    <Button
      ref={ref}
      className={cn(
        "absolute bottom-sp-3 right-sp-3",
        !canScroll && "opacity-0",
        className,
      )}
      disabled={!canScroll}
      onPress={direction === "end" ? scrollToEnd : scrollToStart}
      size="sm"
      variant="secondary"
      {...props}
    >
      {children ?? (direction === "end" ? "Jump to latest" : "Jump to start")}
    </Button>
  );
});

MessageScrollerButton.displayName = "MessageScrollerButton";

export function useMessageScroller() {
  const { scrollToEnd, scrollToStart, scrollable } =
    useMessageScrollerContext();

  return {
    scrollToEnd,
    scrollToStart,
    scrollable,
  };
}
