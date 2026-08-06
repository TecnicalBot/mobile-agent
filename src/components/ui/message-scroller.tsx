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

type ScrollState = {
  end: boolean;
  start: boolean;
};

type MessageScrollerContextValue = {
  listRef: RefObject<FlashListRef<unknown> | null>;
  onListContentSizeChange: (contentHeight: number) => void;
  onListLayout: (viewportHeight: number) => void;
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
  onListScroll: MessageScrollerContextValue["onListScroll"];
  scrollToEnd: MessageScrollerContextValue["scrollToEnd"];
  scrollToStart: MessageScrollerContextValue["scrollToStart"];
} | null>(null);

const MessageScrollerScrollableContext = createContext<ScrollState | null>(null);

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
      recomputeScrollable(offsetY, viewportHeight, contentHeight);
    },
    [recomputeScrollable],
  );

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
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd({ animated: false });
          });
        }
      }
    },
    [initialScrollToEnd, recomputeScrollable],
  );

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const scrollToStart = useCallback(() => {
    listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  }, []);

  const onListContentSizeChange = useCallback(
    (contentHeight: number) => {
      const { offsetY, viewportHeight } = metricsRef.current;

      recomputeScrollable(offsetY, viewportHeight, contentHeight);
      if (
        initialScrollToEnd &&
        !didInitialScrollRef.current &&
        viewportHeight > 0 &&
        contentHeight > 0
      ) {
        didInitialScrollRef.current = true;
        if (contentHeight > viewportHeight) {
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd({ animated: false });
          });
        }
      }
    },
    [initialScrollToEnd, recomputeScrollable],
  );

  const value = useMemo<MessageScrollerContextValue>(
    () => ({
      listRef,
      onListContentSizeChange,
      onListLayout,
      onListScroll,
      scrollToEnd,
      scrollToStart,
      scrollable,
    }),
    [
      onListContentSizeChange,
      onListLayout,
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
      onListScroll,
      scrollToEnd,
      scrollToStart,
    }),
    [onListContentSizeChange, onListLayout, onListScroll, scrollToEnd, scrollToStart],
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
    keyboardShouldPersistTaps = "handled",
    maxItemsInRecyclePool = 0,
    onContentSizeChange,
    onLayout,
    onScroll,
    scrollEventThrottle = 16,
    ...props
  }: MessageScrollerListProps<ItemT>,
  ref: ForwardedRef<FlashListRef<ItemT>>,
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

  return (
    <FlashList<ItemT>
      ref={handleRef}
      accessibilityLiveRegion="polite"
      className={cn("flex-1", className)}
      contentContainerClassName={contentContainerClassName}
      ItemSeparatorComponent={ItemSeparatorComponent}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      maxItemsInRecyclePool={maxItemsInRecyclePool}
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
  const { scrollToEnd, scrollToStart, scrollable } = useMessageScrollerContext();

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
