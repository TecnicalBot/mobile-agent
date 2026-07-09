import { X } from "lucide-react-native";
import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  type GestureResponderEvent,
  Modal as ReactNativeModal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

type ModalContextValue = {
  dismissible: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext(name: string) {
  const context = useContext(ModalContext);

  if (!context) {
    throw new Error(`${name} must be used within a Modal`);
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

export type ModalProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  dismissible?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

export function Modal({
  children,
  defaultOpen = false,
  dismissible = true,
  onOpenChange,
  open,
}: ModalProps) {
  const [isOpen, setIsOpen] = useControllableState({
    defaultValue: defaultOpen,
    onChange: onOpenChange,
    value: open,
  });

  const value = useMemo(
    () => ({
      dismissible,
      open: isOpen,
      setOpen: setIsOpen,
    }),
    [dismissible, isOpen, setIsOpen],
  );

  return (
    <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
  );
}

export type ModalTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
};

export const ModalTrigger = forwardRef<
  ComponentRef<typeof Pressable>,
  ModalTriggerProps
>(({ asChild = false, children, className, onPress, ...props }, ref) => {
  const { setOpen } = useModalContext("ModalTrigger");

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

ModalTrigger.displayName = "ModalTrigger";

export type ModalContentProps = ComponentPropsWithoutRef<typeof View> & {
  children: ReactNode;
  closeOnOverlayPress?: boolean;
  contentClassName?: string;
  overlayClassName?: string;
  presentation?: "bottom" | "center";
  scrollable?: boolean;
  showCloseButton?: boolean;
};

export const ModalContent = forwardRef<ComponentRef<typeof View>, ModalContentProps>(
  (
    {
      children,
      className,
      closeOnOverlayPress = true,
      contentClassName,
      overlayClassName,
      presentation = "center",
      scrollable = false,
      showCloseButton = true,
      style,
      ...props
    },
    ref,
  ) => {
    const { dismissible, open, setOpen } = useModalContext("ModalContent");
    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const { height } = useWindowDimensions();

    if (!open) {
      return null;
    }

    const maxHeight = Math.max(height - insets.top - insets.bottom - 32, 240);
    const animatedProps =
      presentation === "bottom"
        ? {
            entering: SlideInDown.springify().damping(18),
            exiting: SlideOutDown.springify().damping(20),
          }
        : {
            entering: ZoomIn.duration(180),
            exiting: ZoomOut.duration(140),
          };

    const handleDismiss = () => {
      if (!dismissible) return;
      setOpen(false);
    };

    return (
      <ReactNativeModal
        animationType="none"
        onRequestClose={handleDismiss}
        statusBarTranslucent
        transparent
        visible={open}
      >
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
          className={cn(
            "flex-1 px-sp-4",
            presentation === "bottom" ? "justify-end" : "justify-center",
            className,
          )}
          style={[
            presentation === "center"
              ? {
                  paddingTop: insets.top + 16,
                  paddingBottom: insets.bottom + 16,
                }
              : null,
            style,
          ]}
          {...props}
        >
          <Pressable
            className={cn("absolute inset-0 bg-black/55", overlayClassName)}
            onPress={
              closeOnOverlayPress && dismissible ? () => setOpen(false) : undefined
            }
          />
          <Animated.View
            ref={ref}
            className={cn(
              "w-full self-center overflow-hidden rounded-[28px] border border-border bg-popover shadow-lg dark:border-border-dark dark:bg-popover-dark",
              presentation === "center" ? "max-w-md" : "rounded-b-none",
              contentClassName,
            )}
            style={[
              { maxHeight },
              presentation === "bottom"
                ? { paddingBottom: insets.bottom + 20 }
                : null,
            ]}
            {...animatedProps}
          >
            {showCloseButton ? (
              <View className="absolute right-sp-3 top-sp-3 z-10">
                <Button
                  accessibilityLabel="Close modal"
                  className="h-10 w-10 rounded-full bg-secondary/90 dark:bg-secondary-dark/90"
                  onPress={handleDismiss}
                  size="icon-xs"
                  variant="ghost"
                >
                  <X color={theme.text} size={18} />
                </Button>
              </View>
            ) : null}
            {scrollable ? (
              <ScrollView
                className="max-h-full"
                contentContainerClassName="gap-sp-4 p-sp-5"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            ) : (
              <View className="gap-sp-4 p-sp-5">{children}</View>
            )}
          </Animated.View>
        </Animated.View>
      </ReactNativeModal>
    );
  },
);

ModalContent.displayName = "ModalContent";

export type ModalHeaderProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const ModalHeader = forwardRef<ComponentRef<typeof View>, ModalHeaderProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("gap-sp-2 pr-12", className)}
      {...props}
    />
  ),
);

ModalHeader.displayName = "ModalHeader";

export type ModalFooterProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const ModalFooter = forwardRef<ComponentRef<typeof View>, ModalFooterProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("flex-row flex-wrap justify-end gap-sp-2", className)}
      {...props}
    />
  ),
);

ModalFooter.displayName = "ModalFooter";

export type ModalTitleProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const ModalTitle = forwardRef<ComponentRef<typeof Text>, ModalTitleProps>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      className={cn(
        "font-sans text-xl font-semibold text-foreground dark:text-foreground-dark",
        className,
      )}
      {...props}
    />
  ),
);

ModalTitle.displayName = "ModalTitle";

export type ModalDescriptionProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const ModalDescription = forwardRef<
  ComponentRef<typeof Text>,
  ModalDescriptionProps
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

ModalDescription.displayName = "ModalDescription";

export type ModalCloseProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
};

export const ModalClose = forwardRef<ComponentRef<typeof Pressable>, ModalCloseProps>(
  ({ asChild = false, children, className, onPress, ...props }, ref) => {
    const { dismissible, setOpen } = useModalContext("ModalClose");

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
  },
);

ModalClose.displayName = "ModalClose";

export type ModalBodyProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const ModalBody = forwardRef<ComponentRef<typeof View>, ModalBodyProps>(
  ({ className, ...props }, ref) => (
    <View ref={ref} className={cn("gap-sp-4", className)} {...props} />
  ),
);

ModalBody.displayName = "ModalBody";
