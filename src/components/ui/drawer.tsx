import { X } from "lucide-react-native";
import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Animated,
  Pressable,
  Easing as ReactNativeEasing,
  Modal as ReactNativeModal,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

type DrawerDirection = "top" | "right" | "bottom" | "left";

type DrawerContextValue = {
  direction: DrawerDirection;
  dismissible: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
};

type DrawerLayoutContextValue = {
  fillAvailableSpace: boolean;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);
const DrawerLayoutContext = createContext<DrawerLayoutContextValue | null>(
  null,
);

function useDrawerContext(name: string) {
  const context = useContext(DrawerContext);

  if (!context) {
    throw new Error(`${name} must be used within a Drawer`);
  }

  return context;
}

function useControllableState({
  defaultValue,
  onChange,
  value,
}: {
  defaultValue: boolean;
  onChange?: (value: boolean) => void;
  value?: boolean;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const setValue = (nextValue: boolean) => {
    if (!isControlled) {
      setInternalValue(nextValue);
    }

    onChange?.(nextValue);
  };

  return [currentValue, setValue] as const;
}

function slotPressableChild(
  child: ReactNode,
  props: ComponentPropsWithoutRef<typeof Pressable> & { className?: string },
) {
  if (!isValidElement(child)) {
    return null;
  }

  const element = child as ReactElement<
    ComponentPropsWithoutRef<typeof Pressable> & {
      className?: string;
      onPress?: (event: GestureResponderEvent) => void;
    }
  >;
  const childProps = (element.props ?? {}) as ComponentPropsWithoutRef<
    typeof Pressable
  > & {
    className?: string;
    onPress?: (event: GestureResponderEvent) => void;
  };

  return cloneElement(element, {
    ...props,
    ...childProps,
    className: cn(props.className, childProps.className),
    onPress: (event: GestureResponderEvent) => {
      props.onPress?.(event);
      childProps.onPress?.(event);
    },
  });
}

export type DrawerProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  direction?: DrawerDirection;
  dismissible?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

export function Drawer({
  children,
  defaultOpen = false,
  direction = "bottom",
  dismissible = true,
  onOpenChange,
  open,
}: DrawerProps) {
  const [isOpen, setIsOpen] = useControllableState({
    defaultValue: defaultOpen,
    onChange: onOpenChange,
    value: open,
  });

  const value = useMemo(
    () => ({
      direction,
      dismissible,
      open: isOpen,
      setOpen: setIsOpen,
    }),
    [direction, dismissible, isOpen, setIsOpen],
  );

  return (
    <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>
  );
}

export type DrawerTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
};

export const DrawerTrigger = forwardRef<
  ComponentRef<typeof Pressable>,
  DrawerTriggerProps
>(({ asChild = false, children, className, onPress, ...props }, ref) => {
  const { setOpen } = useDrawerContext("DrawerTrigger");

  const handlePress: ComponentPropsWithoutRef<typeof Pressable>["onPress"] = (
    event,
  ) => {
    onPress?.(event);
    setOpen(true);
  };

  if (asChild) {
    return slotPressableChild(children, {
      ...props,
      className,
      onPress: handlePress,
    });
  }

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      className={cn("items-start", className)}
      onPress={handlePress}
      {...props}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
});

DrawerTrigger.displayName = "DrawerTrigger";

export type DrawerContentProps = ComponentPropsWithoutRef<typeof View> & {
  children: ReactNode;
  closeOnOverlayPress?: boolean;
  contentClassName?: string;
  overlayClassName?: string;
  showCloseButton?: boolean;
  showHandle?: boolean;
  size?: number;
};

export const DrawerContent = forwardRef<
  ComponentRef<typeof View>,
  DrawerContentProps
>(
  (
    {
      children,
      className,
      closeOnOverlayPress = true,
      contentClassName,
      overlayClassName,
      showCloseButton = false,
      showHandle = true,
      size,
      style,
      ...props
    },
    ref,
  ) => {
    const { direction, dismissible, open, setOpen } =
      useDrawerContext("DrawerContent");
    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const { height, width } = useWindowDimensions();
    const [mounted, setMounted] = useState(open);
    const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
    const isVertical = direction === "top" || direction === "bottom";
    const maxHeight = Math.max(Math.floor(height * 0.9), 220);
    const maxWidth = Math.max(width - 24, 280);
    const resolvedVerticalSize =
      size !== undefined ? Math.min(size, maxHeight) : maxHeight;
    const fillAvailableSpace = true;

    const panelStyle = isVertical
      ? {
          width: "100%" as const,
          maxHeight,
          height: resolvedVerticalSize,
        }
      : {
          height: "100%" as const,
          maxWidth,
          width: size ?? Math.min(420, maxWidth),
        };

    useEffect(() => {
      if (open) {
        setMounted(true);

        Animated.timing(progress, {
          toValue: 1,
          duration: 180,
          easing: ReactNativeEasing.out(ReactNativeEasing.cubic),
          useNativeDriver: true,
        }).start();

        return;
      }

      Animated.timing(progress, {
        toValue: 0,
        duration: 160,
        easing: ReactNativeEasing.in(ReactNativeEasing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false);
        }
      });
    }, [open, progress]);

    const handleDismiss = () => {
      if (!dismissible) return;
      setOpen(false);
    };

    if (!mounted) {
      return null;
    }

    const translateStyle =
      direction === "top"
        ? {
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-height, 0],
                }),
              },
            ],
          }
        : direction === "left"
          ? {
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-width, 0],
                  }),
                },
              ],
            }
          : direction === "right"
            ? {
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [width, 0],
                    }),
                  },
                ],
              }
            : {
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [height, 0],
                    }),
                  },
                ],
              };

    return (
      <ReactNativeModal
        animationType="none"
        hardwareAccelerated
        onRequestClose={handleDismiss}
        statusBarTranslucent
        transparent
        visible={mounted}
      >
        <View
          className={cn(
            "flex-1 bg-transparent",
            direction === "bottom" && "justify-end",
            direction === "top" && "justify-start",
            direction === "left" && "flex-row justify-start",
            direction === "right" && "flex-row justify-end",
            className,
          )}
          style={[
            direction === "bottom"
              ? { paddingTop: insets.top, paddingBottom: 0 }
              : direction === "top"
                ? { paddingTop: 0, paddingBottom: insets.bottom }
                : {
                    paddingTop: insets.top + 12,
                    paddingBottom: insets.bottom + 12,
                  },
            style,
          ]}
          {...props}
        >
          <Pressable
            className={cn("absolute inset-0 bg-transparent", overlayClassName)}
            onPress={
              closeOnOverlayPress && dismissible
                ? () => setOpen(false)
                : undefined
            }
          />
          <Animated.View ref={ref} style={translateStyle}>
            <View
              className={cn(
                "overflow-hidden bg-popover dark:bg-popover-dark",
                direction !== "bottom" &&
                  "border border-border shadow-lg dark:border-border-dark",
                direction === "bottom" && "rounded-t-[28px] shadow-lg",
                direction === "top" && "rounded-b-[28px]",
                direction === "left" && "rounded-r-[28px]",
                direction === "right" && "rounded-l-[28px]",
                contentClassName,
              )}
              style={[
                panelStyle,
                direction === "bottom"
                  ? { paddingBottom: insets.bottom + 16 }
                  : null,
                direction === "top" ? { paddingTop: insets.top + 8 } : null,
              ]}
            >
              {showHandle && isVertical ? (
                <View className="items-center pt-sp-3">
                  <View className="h-1.5 w-12 rounded-full bg-border dark:bg-border-dark" />
                </View>
              ) : null}
              {showCloseButton ? (
                <View className="absolute right-sp-3 top-sp-3 z-10">
                  <Pressable
                    accessibilityLabel="Close drawer"
                    className="h-9 w-9 items-center justify-center rounded-full"
                    onPress={handleDismiss}
                  >
                    <X color={theme.text} size={18} />
                  </Pressable>
                </View>
              ) : null}
              <DrawerLayoutContext.Provider value={{ fillAvailableSpace }}>
                <View
                  className={cn(
                    "min-h-0 gap-sp-4 p-sp-5",
                    fillAvailableSpace && "flex-1",
                  )}
                >
                  {children}
                </View>
              </DrawerLayoutContext.Provider>
            </View>
          </Animated.View>
        </View>
      </ReactNativeModal>
    );
  },
);

DrawerContent.displayName = "DrawerContent";

export type DrawerHeaderProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const DrawerHeader = forwardRef<
  ComponentRef<typeof View>,
  DrawerHeaderProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-sp-2 pr-12", className)} {...props} />
));

DrawerHeader.displayName = "DrawerHeader";

export type DrawerBodyProps = ComponentPropsWithoutRef<typeof ScrollView> & {
  className?: string;
};

export const DrawerBody = forwardRef<
  ComponentRef<typeof ScrollView>,
  DrawerBodyProps
>(({ className, contentContainerClassName, style, ...props }, ref) => {
  const layout = useContext(DrawerLayoutContext);
  const fillAvailableSpace = layout?.fillAvailableSpace ?? true;

  if (!fillAvailableSpace) {
    return (
      <View className={cn("gap-sp-4", contentContainerClassName, className)}>
        {props.children}
      </View>
    );
  }

  return (
    <ScrollView
      ref={ref}
      className={cn(fillAvailableSpace && "min-h-0 flex-1", className)}
      contentContainerClassName={cn("gap-sp-4", contentContainerClassName)}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={style}
      {...props}
    />
  );
});

DrawerBody.displayName = "DrawerBody";

export type DrawerFooterProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const DrawerFooter = forwardRef<
  ComponentRef<typeof View>,
  DrawerFooterProps
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn(
      "shrink-0 gap-sp-2 border-t border-border pt-sp-4 dark:border-border-dark",
      className,
    )}
    {...props}
  />
));

DrawerFooter.displayName = "DrawerFooter";

export type DrawerTitleProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const DrawerTitle = forwardRef<
  ComponentRef<typeof Text>,
  DrawerTitleProps
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn(
      "font-sans text-xl font-semibold text-foreground dark:text-foreground-dark",
      className,
    )}
    {...props}
  />
));

DrawerTitle.displayName = "DrawerTitle";

export type DrawerDescriptionProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const DrawerDescription = forwardRef<
  ComponentRef<typeof Text>,
  DrawerDescriptionProps
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn(
      "font-sans text-sm leading-5 text-muted-foreground dark:text-muted-foreground-dark",
      className,
    )}
    {...props}
  />
));

DrawerDescription.displayName = "DrawerDescription";

export type DrawerCloseProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
};

export const DrawerClose = forwardRef<
  ComponentRef<typeof Pressable>,
  DrawerCloseProps
>(({ asChild = false, children, className, onPress, ...props }, ref) => {
  const { dismissible, setOpen } = useDrawerContext("DrawerClose");

  const handlePress: ComponentPropsWithoutRef<typeof Pressable>["onPress"] = (
    event,
  ) => {
    onPress?.(event);

    if (dismissible) {
      setOpen(false);
    }
  };

  if (asChild) {
    return slotPressableChild(children, {
      ...props,
      className,
      onPress: handlePress,
    });
  }

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      className={cn("items-start", className)}
      onPress={handlePress}
      {...props}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
});

DrawerClose.displayName = "DrawerClose";
