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
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Platform,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScrollState = {
  end: boolean;
  start: boolean;
};

type ItemLayout = {
  anchor: boolean;
  height: number;
  id: string;
  index?: number;
  messageId?: string;
  y: number;
};

type MessageScrollerContextValue = {
  currentAnchorId: string | null;
  listRef: RefObject<ScrollView | null>;
  onListLayout: (height: number) => void;
  onListScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  registerItem: (item: ItemLayout) => void;
  scrollToEnd: () => void;
  scrollToMessage: (messageId: string) => void;
  scrollToStart: () => void;
  scrollable: ScrollState;
  setContentHeight: (height: number) => void;
  unregisterItem: (id: string) => void;
  visibleMessageIds: string[];
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
  const listRef = useRef<ScrollView>(null);
  const itemLayoutsRef = useRef<Map<string, ItemLayout>>(new Map());
  const followRef = useRef(autoScroll);
  const [contentHeight, setContentHeight] = useState(0);
  const [currentAnchorId, setCurrentAnchorId] = useState<string | null>(null);
  const [offsetY, setOffsetY] = useState(0);
  const [scrollable, setScrollable] = useState<ScrollState>({
    end: false,
    start: false,
  });
  const [viewportHeight, setViewportHeight] = useState(0);
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[]>([]);

  function recompute(
    nextOffsetY = offsetY,
    nextViewportHeight = viewportHeight,
    nextContentHeight = contentHeight,
    options?: {
      updateFollow?: boolean;
    },
  ) {
    const items = Array.from(itemLayoutsRef.current.values()).sort(
      (left, right) => left.y - right.y,
    );
    const maxOffset = Math.max(nextContentHeight - nextViewportHeight, 0);
    const nextScrollable = {
      start: nextOffsetY > 8,
      end: nextOffsetY < maxOffset - 8,
    };

    if (options?.updateFollow ?? false) {
      followRef.current = !nextScrollable.end;
    }
    setScrollable(nextScrollable);

    const nextVisibleIds = items
      .filter(
        (item) =>
          item.messageId &&
          item.y + item.height >= nextOffsetY &&
          item.y <= nextOffsetY + nextViewportHeight,
      )
      .map((item) => item.messageId as string);

    setVisibleMessageIds(nextVisibleIds);

    const anchors = items.filter((item) => item.anchor);
    const anchorId =
      anchors
        .filter((item) => item.y <= nextOffsetY + nextViewportHeight * 0.25)
        .at(-1)?.id ?? null;

    setCurrentAnchorId(anchorId);
  }

  function onListLayout(height: number) {
    setViewportHeight(height);

    if (autoScroll && followRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
      });
    }
  }

  function onListScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextOffsetY = event.nativeEvent.contentOffset.y;
    const nextViewportHeight = event.nativeEvent.layoutMeasurement.height;
    const nextContentHeight = event.nativeEvent.contentSize.height;

    setOffsetY(nextOffsetY);
    setViewportHeight(nextViewportHeight);
    setContentHeight(nextContentHeight);
    recompute(nextOffsetY, nextViewportHeight, nextContentHeight, {
      updateFollow: true,
    });
  }

  function registerItem(item: ItemLayout) {
    itemLayoutsRef.current.set(item.id, item);
    recompute(offsetY, viewportHeight, contentHeight);
  }

  function unregisterItem(id: string) {
    if (!itemLayoutsRef.current.has(id)) {
      return;
    }

    itemLayoutsRef.current.delete(id);
    recompute(offsetY, viewportHeight, contentHeight);
  }

  function scrollToStart() {
    listRef.current?.scrollTo({ animated: true, y: 0 });
  }

  function scrollToEnd() {
    listRef.current?.scrollToEnd({ animated: true });
  }

  function scrollToMessage(messageId: string) {
    const item = Array.from(itemLayoutsRef.current.values()).find(
      (entry) => entry.messageId === messageId,
    );

    if (!item) {
      return;
    }

    listRef.current?.scrollTo({
      animated: true,
      y: Math.max(item.y - viewportHeight * 0.18, 0),
    });
  }

  useEffect(() => {
    recompute(offsetY, viewportHeight, contentHeight);
  }, [contentHeight, offsetY, viewportHeight]);

  useEffect(() => {
    if (!autoScroll || !followRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [autoScroll, contentHeight]);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }

    const syncToLatest = () => {
      if (!followRef.current) {
        return;
      }

      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({
          animated: Platform.OS === "ios",
        });
      });
    };

    const showSubscription = Keyboard.addListener("keyboardDidShow", syncToLatest);
    const hideSubscription = Keyboard.addListener("keyboardDidHide", syncToLatest);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [autoScroll]);

  return (
    <MessageScrollerContext.Provider
      value={{
        currentAnchorId,
        listRef,
        onListLayout,
        onListScroll,
        registerItem,
        scrollToEnd,
        scrollToMessage,
        scrollToStart,
        scrollable,
        setContentHeight,
        unregisterItem,
        visibleMessageIds,
      }}
    >
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
  ComponentPropsWithoutRef<typeof ScrollView>,
  "children" | "onContentSizeChange" | "onLayout" | "onScroll"
> & {
  className?: string;
  contentContainerClassName?: string;
  data: ItemT[];
  keyExtractor?: (item: ItemT, index: number) => string;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
  ListHeaderComponent?: ReactNode;
  onContentSizeChange?: ComponentPropsWithoutRef<
    typeof ScrollView
  >["onContentSizeChange"];
  onLayout?: ComponentPropsWithoutRef<typeof ScrollView>["onLayout"];
  onScroll?: ComponentPropsWithoutRef<typeof ScrollView>["onScroll"];
  renderItem: (input: { index: number; item: ItemT }) => ReactNode;
};

function MessageScrollerListInner<ItemT>(
  {
    className,
    contentContainerClassName,
    data,
    keyboardShouldPersistTaps = "handled",
    keyExtractor,
    ListEmptyComponent,
    ListFooterComponent,
    ListHeaderComponent,
    onContentSizeChange,
    onLayout,
    onScroll,
    renderItem,
    scrollEventThrottle = 16,
    ...props
  }: MessageScrollerListProps<ItemT>,
  ref: ForwardedRef<ScrollView>,
) {
  const context = useMessageScrollerContext();

  return (
    <ScrollView
      ref={(node) => {
        context.listRef.current = node;

        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      className={cn("flex-1", className)}
      contentContainerClassName={cn("gap-sp-3", contentContainerClassName)}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      onContentSizeChange={(width, height) => {
        context.setContentHeight(height);
        onContentSizeChange?.(width, height);
      }}
      onLayout={(event) => {
        context.onListLayout(event.nativeEvent.layout.height);
        onLayout?.(event);
      }}
      onScroll={(event) => {
        context.onListScroll(event);
        onScroll?.(event);
      }}
      scrollEventThrottle={scrollEventThrottle}
      {...props}
    >
      <View
        accessibilityLiveRegion="polite"
        className={cn("gap-sp-3", contentContainerClassName)}
      >
        {ListHeaderComponent}
        {data.length === 0
          ? ListEmptyComponent
          : data.map((item, index) => (
              <View key={keyExtractor?.(item, index) ?? String(index)}>
                {renderItem({ index, item })}
              </View>
            ))}
        {ListFooterComponent}
      </View>
    </ScrollView>
  );
}

type MessageScrollerListComponent = <ItemT>(
  props: MessageScrollerListProps<ItemT> & {
    ref?: ForwardedRef<ScrollView>;
  },
) => ReactElement;

export const MessageScrollerList = forwardRef(
  MessageScrollerListInner,
) as MessageScrollerListComponent;

export type MessageScrollerViewportProps = ComponentPropsWithoutRef<
  typeof View
> & {
  className?: string;
};

export const MessageScrollerViewport = forwardRef<
  ComponentRef<typeof View>,
  MessageScrollerViewportProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("flex-1", className)} {...props} />
));

MessageScrollerViewport.displayName = "MessageScrollerViewport";

export type MessageScrollerContentProps = ComponentPropsWithoutRef<
  typeof View
> & {
  className?: string;
};

export const MessageScrollerContent = forwardRef<
  ComponentRef<typeof View>,
  MessageScrollerContentProps
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    accessibilityLiveRegion="polite"
    className={cn("gap-sp-3", className)}
    {...props}
  />
));

MessageScrollerContent.displayName = "MessageScrollerContent";

export type MessageScrollerItemProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
  index?: number;
  messageId?: string;
  scrollAnchor?: boolean;
};

export const MessageScrollerItem = forwardRef<
  ComponentRef<typeof View>,
  MessageScrollerItemProps
>(
  (
    { className, index, messageId, onLayout, scrollAnchor = false, ...props },
    ref,
  ) => {
    const fallbackId = useId();
    const context = useMessageScrollerContext();
    const layoutId = messageId ?? fallbackId;

    useEffect(() => {
      return () => {
        context.unregisterItem(layoutId);
      };
    }, [context, layoutId]);

    return (
      <View
        ref={ref}
        className={cn("w-full", className)}
        onLayout={(event) => {
          context.registerItem({
            anchor: scrollAnchor,
            height: event.nativeEvent.layout.height,
            id: layoutId,
            index,
            messageId,
            y: event.nativeEvent.layout.y,
          });
          onLayout?.(event);
        }}
        {...props}
      />
    );
  },
);

MessageScrollerItem.displayName = "MessageScrollerItem";

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
  const {
    currentAnchorId,
    scrollToEnd,
    scrollToMessage,
    scrollToStart,
    visibleMessageIds,
  } = useMessageScrollerContext();

  return {
    currentAnchorId,
    scrollToEnd,
    scrollToMessage,
    scrollToStart,
    visibleMessageIds,
  };
}

export function useMessageScrollerScrollable() {
  return useMessageScrollerContext().scrollable;
}
