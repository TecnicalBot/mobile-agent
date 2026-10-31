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
  FlashList,
  type FlashListProps,
  type FlashListRef,
  type ListRenderItem,
} from "@shopify/flash-list";
import { cssInterop } from "nativewind";
import {
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { Button } from "@/components/ui/button";
import { cn } from "@/core/utils";

cssInterop(FlashList, {
  className: "style",
  contentContainerClassName: "contentContainerStyle",
});

function MessageScrollerSeparator() {
  return <View className="h-sp-3" />;
}

const DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION = {
  // Long rows above the viewport are measured as they enter the recycle
  // window. Preserve the visible message when those estimates shrink;
  // otherwise Android clamps the old pixel offset to the new content end.
  // Do not set autoscroll thresholds here: bottom-follow remains controlled
  // by the user's drag state below, independently of position anchoring.
  disabled: false,
} as const;

type ScrollState = {
  end: boolean;
  start: boolean;
};

type MessageScrollerContextValue = {
  listRef: RefObject<FlashListRef<unknown> | null>;
  onListContentSizeChange: (contentHeight: number) => void;
  onListLayout: (viewportHeight: number) => void;
  onListDragStart: () => void;
  onListDragEnd: () => void;
  onListScroll: (
    offsetY: number,
    viewportHeight: number,
    contentHeight: number,
  ) => void;
  scrollToEnd: () => void;
  scrollToStart: () => void;
  scrollable: ScrollState;
};

const MessageScrollerContext =
  createContext<MessageScrollerContextValue | null>(null);

const MessageScrollerActionsContext = createContext<{
  listRef: MessageScrollerContextValue["listRef"];
  onListContentSizeChange: MessageScrollerContextValue["onListContentSizeChange"];
  onListLayout: MessageScrollerContextValue["onListLayout"];
  onListDragStart: MessageScrollerContextValue["onListDragStart"];
  onListDragEnd: MessageScrollerContextValue["onListDragEnd"];
  onListScroll: MessageScrollerContextValue["onListScroll"];
  scrollToEnd: MessageScrollerContextValue["scrollToEnd"];
  scrollToStart: MessageScrollerContextValue["scrollToStart"];
} | null>(null);

const MessageScrollerScrollableContext = createContext<ScrollState | null>(
  null,
);

function useMessageScrollerContext() {
  const context = useContext(MessageScrollerContext);

  if (!context) {
    throw new Error(
      "MessageScroller components must be used inside MessageScrollerProvider.",
    );
  }

  return context;
}

function useMessageScrollerActionsContext() {
  const context = useContext(MessageScrollerActionsContext);

  if (!context) {
    throw new Error(
      "MessageScroller components must be used inside MessageScrollerProvider.",
    );
  }

  return context;
}

export type MessageScrollerProviderProps = PropsWithChildren<{
  initialScrollToEnd?: boolean;
}>;

export function MessageScrollerProvider({
  children,
  initialScrollToEnd = false,
}: MessageScrollerProviderProps) {
  const listRef = useRef<FlashListRef<unknown>>(null);
  const didInitialScrollRef = useRef(false);
  const lastScrollableRef = useRef<ScrollState>({ end: false, start: false });
  const lastContentHeightRef = useRef(0);
  const draggingRef = useRef(false);
  const dragStartOffsetRef = useRef(0);
  const followingEndRef = useRef(initialScrollToEnd);
  const pendingScrollRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pendingScrollRef.current !== null)
        cancelAnimationFrame(pendingScrollRef.current);
    },
    [],
  );
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
      // Never re-enable following from scroll/measurement events. Recycling
      // tall rows can temporarily report an offset beyond the measured end.
      recomputeScrollable(offsetY, viewportHeight, contentHeight);
    },
    [recomputeScrollable],
  );

  const onListDragStart = useCallback(() => {
    draggingRef.current = true;
    dragStartOffsetRef.current = metricsRef.current.offsetY;
    followingEndRef.current = false;
    didInitialScrollRef.current = true;
    if (pendingScrollRef.current !== null) {
      cancelAnimationFrame(pendingScrollRef.current);
      pendingScrollRef.current = null;
    }
  }, []);
  const onListDragEnd = useCallback(() => {
    draggingRef.current = false;
    const { contentHeight, offsetY, viewportHeight } = metricsRef.current;
    const distanceFromEnd = contentHeight - viewportHeight - offsetY;
    // Only an intentional downward drag back to the end can resume following.
    // Upward drags must stay detached even when recycled height estimates shrink.
    followingEndRef.current =
      offsetY > dragStartOffsetRef.current + 8 &&
      Math.abs(distanceFromEnd) <= 8;
  }, []);
  const scheduleFollowEnd = useCallback(() => {
    if (pendingScrollRef.current !== null) return;
    pendingScrollRef.current = requestAnimationFrame(() => {
      pendingScrollRef.current = null;
      if (followingEndRef.current && !draggingRef.current) {
        listRef.current?.getNativeScrollRef()?.scrollToEnd({ animated: false });
      }
    });
  }, []);

  const onListLayout = useCallback(
    (viewportHeight: number) => {
      const { contentHeight, offsetY } = metricsRef.current;

      recomputeScrollable(offsetY, viewportHeight, contentHeight);
      if (
        initialScrollToEnd &&
        !didInitialScrollRef.current &&
        contentHeight > 0
      ) {
        didInitialScrollRef.current = true;
        if (contentHeight > viewportHeight) {
          scheduleFollowEnd();
        }
      }
    },
    [initialScrollToEnd, recomputeScrollable, scheduleFollowEnd],
  );

  const scrollToEnd = useCallback(() => {
    followingEndRef.current = true;
    // FlashList 2.0.2's scrollToEnd may await a multi-step scrollToIndex and
    // then issue a late native scroll after the user has already dragged away.
    // Use the native scroller; subsequent measured growth is followed above,
    // with every scheduled frame still cancellable by a user drag.
    listRef.current?.getNativeScrollRef()?.scrollToEnd({ animated: true });
  }, []);

  const scrollToStart = useCallback(() => {
    followingEndRef.current = false;
    didInitialScrollRef.current = true;
    listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  }, []);

  const onListContentSizeChange = useCallback(
    (contentHeight: number) => {
      const { offsetY, viewportHeight } = metricsRef.current;
      const previousHeight = lastContentHeightRef.current;

      lastContentHeightRef.current = contentHeight;
      recomputeScrollable(offsetY, viewportHeight, contentHeight);

      // Stick-to-bottom while pinned. FlashList's maintainVisibleContentPosition
      // only autoscrolls on data changes, never when the bottom item itself
      // grows (streaming text, arriving tables, images settling) — Shopify
      // confirmed that gap on flash-list#1666. Until the user scrolls away,
      // keep the viewport glued to the newest content ourselves.
      const grew = previousHeight > 0 && contentHeight > previousHeight + 1;
      if (grew && followingEndRef.current && !draggingRef.current)
        scheduleFollowEnd();

      if (
        initialScrollToEnd &&
        !didInitialScrollRef.current &&
        viewportHeight > 0 &&
        contentHeight > 0
      ) {
        didInitialScrollRef.current = true;
        if (contentHeight > viewportHeight) {
          scheduleFollowEnd();
        }
      }
    },
    [initialScrollToEnd, recomputeScrollable, scheduleFollowEnd],
  );

  const value = useMemo<MessageScrollerContextValue>(
    () => ({
      listRef,
      onListContentSizeChange,
      onListLayout,
      onListDragStart,
      onListDragEnd,
      onListScroll,
      scrollToEnd,
      scrollToStart,
      scrollable,
    }),
    [
      onListContentSizeChange,
      onListLayout,
      onListDragStart,
      onListDragEnd,
      onListScroll,
      scrollToEnd,
      scrollToStart,
      scrollable,
    ],
  );

  const actionsValue = useMemo(
    () => ({
      listRef,
      onListContentSizeChange,
      onListLayout,
      onListDragStart,
      onListDragEnd,
      onListScroll,
      scrollToEnd,
      scrollToStart,
    }),
    [
      onListContentSizeChange,
      onListLayout,
      onListDragStart,
      onListDragEnd,
      onListScroll,
      scrollToEnd,
      scrollToStart,
    ],
  );

  return (
    <MessageScrollerActionsContext.Provider value={actionsValue}>
      <MessageScrollerScrollableContext.Provider value={scrollable}>
        <MessageScrollerContext.Provider value={value}>
          {children}
        </MessageScrollerContext.Provider>
      </MessageScrollerScrollableContext.Provider>
    </MessageScrollerActionsContext.Provider>
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
  FlashListProps<ItemT>,
  "data" | "keyExtractor" | "onContentSizeChange" | "onScroll" | "renderItem"
> & {
  className?: string;
  contentContainerClassName?: string;
  data: readonly ItemT[] | null | undefined;
  keyExtractor?: (item: ItemT, index: number) => string;
  onContentSizeChange?: FlashListProps<ItemT>["onContentSizeChange"];
  onScroll?: FlashListProps<ItemT>["onScroll"];
  renderItem: ListRenderItem<ItemT>;
};

function MessageScrollerListInner<ItemT>(
  {
    className,
    contentContainerClassName,
    ItemSeparatorComponent = MessageScrollerSeparator,
    drawDistance = 800,
    keyboardShouldPersistTaps = "handled",
    maintainVisibleContentPosition = DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION,
    onContentSizeChange,
    onLayout,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    scrollsChildToFocus = false,
    scrollEventThrottle = 16,
    ...props
  }: MessageScrollerListProps<ItemT>,
  ref: ForwardedRef<FlashListRef<ItemT>>,
) {
  const {
    listRef,
    onListContentSizeChange,
    onListLayout,
    onListScroll,
    onListDragStart,
    onListDragEnd,
  } = useMessageScrollerActionsContext();

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
    (node: FlashListRef<ItemT> | null) => {
      listRef.current = node as FlashListRef<unknown> | null;

      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [listRef, ref],
  );

  // Android can scroll a newly focused selectable Text into view even while
  // JS auto-follow is paused (react-native#33440). Disable focus scrolling,
  // not text selection; gestures and explicit actions still position the list.
  return (
    <FlashList<ItemT>
      ref={handleRef}
      accessibilityLiveRegion="polite"
      className={cn("flex-1", className)}
      contentContainerClassName={contentContainerClassName}
      drawDistance={drawDistance}
      ItemSeparatorComponent={ItemSeparatorComponent}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      scrollsChildToFocus={scrollsChildToFocus}
      maintainVisibleContentPosition={maintainVisibleContentPosition}
      onContentSizeChange={handleContentSizeChange}
      onLayout={handleLayout}
      onScroll={handleScroll}
      onScrollBeginDrag={(event) => {
        onListDragStart();
        onScrollBeginDrag?.(event);
      }}
      onScrollEndDrag={(event) => {
        const { contentOffset, layoutMeasurement, contentSize } =
          event.nativeEvent;
        onListScroll(
          contentOffset.y,
          layoutMeasurement.height,
          contentSize.height,
        );
        onListDragEnd();
        onScrollEndDrag?.(event);
      }}
      scrollEventThrottle={scrollEventThrottle}
      {...props}
    />
  );
}

type MessageScrollerListComponent = <ItemT>(
  props: MessageScrollerListProps<ItemT> & {
    ref?: ForwardedRef<FlashListRef<ItemT>>;
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

export function useMessageScrollerActions() {
  const { scrollToEnd, scrollToStart } = useMessageScrollerActionsContext();

  return {
    scrollToEnd,
    scrollToStart,
  };
}
