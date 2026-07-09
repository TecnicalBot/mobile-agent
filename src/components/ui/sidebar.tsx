import { PanelLeft, X } from "lucide-react-native";
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
  Pressable,
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

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  side: "left" | "right";
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useSidebarContext(name: string) {
  const context = useContext(SidebarContext);

  if (!context) {
    throw new Error(`${name} must be used within a SidebarProvider`);
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

export type SidebarProviderProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  side?: "left" | "right";
};

export function SidebarProvider({
  children,
  defaultOpen = false,
  onOpenChange,
  open,
  side = "left",
}: SidebarProviderProps) {
  const [isOpen, setIsOpen] = useControllableState({
    defaultValue: defaultOpen,
    onChange: onOpenChange,
    value: open,
  });

  const value = useMemo(
    () => ({
      open: isOpen,
      setOpen: setIsOpen,
      side,
    }),
    [isOpen, setIsOpen, side],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export type SidebarTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
};

export const SidebarTrigger = forwardRef<
  ComponentRef<typeof Pressable>,
  SidebarTriggerProps
>(({ asChild = false, children, className, onPress, ...props }, ref) => {
  const { open, setOpen } = useSidebarContext("SidebarTrigger");
  const theme = useTheme();

  const handlePress: ComponentPropsWithoutRef<typeof Pressable>["onPress"] = (
    event,
  ) => {
    onPress?.(event);
    setOpen(!open);
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
      className={cn(
        "h-12 w-12 items-center justify-center rounded-full border border-border bg-background dark:border-border-dark dark:bg-background-dark",
        className,
      )}
      onPress={handlePress}
      style={({ pressed }) => (pressed ? { opacity: 0.9 } : null)}
      {...props}
    >
      {children ? (
        typeof children === "string" || typeof children === "number" ? (
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            {children}
          </Text>
        ) : (
          children
        )
      ) : (
        <PanelLeft color={theme.text} size={20} />
      )}
    </Pressable>
  );
});

SidebarTrigger.displayName = "SidebarTrigger";

export type SidebarProps = ComponentPropsWithoutRef<typeof View> & {
  children: ReactNode;
  closeOnOverlayPress?: boolean;
  overlayClassName?: string;
  showCloseButton?: boolean;
  width?: number;
};

export const Sidebar = forwardRef<ComponentRef<typeof View>, SidebarProps>(
  (
    {
      children,
      className,
      closeOnOverlayPress = true,
      overlayClassName,
      showCloseButton = false,
      style,
      width = 320,
      ...props
    },
    ref,
  ) => {
    const { open, setOpen, side } = useSidebarContext("Sidebar");
    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const { width: viewportWidth } = useWindowDimensions();

    if (!open) {
      return null;
    }

    const panelWidth = Math.min(width, Math.max(viewportWidth - 24, 280));

    return (
      <ReactNativeModal
        animationType="none"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        transparent
        visible={open}
      >
        <View
          className={cn(
            "flex-1 flex-row",
            side === "right" ? "justify-end" : "justify-start",
          )}
        >
          <Pressable
            className={cn("absolute inset-0 bg-black/50", overlayClassName)}
            onPress={closeOnOverlayPress ? () => setOpen(false) : undefined}
          />
          <View
            ref={ref}
            className={cn(
              "border-border bg-card px-sp-4 dark:border-border-dark dark:bg-card-dark",
              className,
            )}
            style={[
              {
                width: panelWidth,
                paddingTop: insets.top + 12,
                paddingBottom: insets.bottom + 12,
              },
              style,
            ]}
            {...props}
          >
            {showCloseButton ? (
              <View className="absolute right-sp-3 top-sp-3 z-10">
                <Pressable
                  accessibilityLabel="Close sidebar"
                  className="h-10 w-10 items-center justify-center rounded-full bg-secondary dark:bg-secondary-dark"
                  onPress={() => setOpen(false)}
                >
                  <X color={theme.text} size={18} />
                </Pressable>
              </View>
            ) : null}
            <View className="flex-1 gap-sp-4">{children}</View>
          </View>
        </View>
      </ReactNativeModal>
    );
  },
);

Sidebar.displayName = "Sidebar";

export type SidebarInsetProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarInset = forwardRef<
  ComponentRef<typeof View>,
  SidebarInsetProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("flex-1", className)} {...props} />
));

SidebarInset.displayName = "SidebarInset";

export type SidebarHeaderProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarHeader = forwardRef<
  ComponentRef<typeof View>,
  SidebarHeaderProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-sp-3 pb-sp-2", className)} {...props} />
));

SidebarHeader.displayName = "SidebarHeader";

export type SidebarContentProps = ComponentPropsWithoutRef<
  typeof ScrollView
> & {
  className?: string;
};

export const SidebarContent = forwardRef<
  ComponentRef<typeof ScrollView>,
  SidebarContentProps
>(({ className, ...props }, ref) => (
  <ScrollView
    ref={ref}
    className={cn("flex-1", className)}
    contentContainerClassName="gap-sp-4"
    showsVerticalScrollIndicator={false}
    {...props}
  />
));

SidebarContent.displayName = "SidebarContent";

export type SidebarFooterProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarFooter = forwardRef<
  ComponentRef<typeof View>,
  SidebarFooterProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-sp-3 pt-sp-2", className)} {...props} />
));

SidebarFooter.displayName = "SidebarFooter";

export type SidebarGroupProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarGroup = forwardRef<
  ComponentRef<typeof View>,
  SidebarGroupProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-sp-3", className)} {...props} />
));

SidebarGroup.displayName = "SidebarGroup";

export type SidebarGroupLabelProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const SidebarGroupLabel = forwardRef<
  ComponentRef<typeof Text>,
  SidebarGroupLabelProps
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn(
      "px-sp-2 font-sans text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground dark:text-muted-foreground-dark",
      className,
    )}
    {...props}
  />
));

SidebarGroupLabel.displayName = "SidebarGroupLabel";

export type SidebarGroupActionProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  children?: ReactNode;
  className?: string;
};

export const SidebarGroupAction = forwardRef<
  ComponentRef<typeof Pressable>,
  SidebarGroupActionProps
>(({ children, className, ...props }, ref) => (
  <Pressable
    ref={ref}
    accessibilityRole="button"
    className={cn("items-start px-sp-2", className)}
    {...props}
  >
    {typeof children === "string" || typeof children === "number" ? (
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {children}
      </Text>
    ) : (
      children
    )}
  </Pressable>
));

SidebarGroupAction.displayName = "SidebarGroupAction";

export type SidebarGroupContentProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarGroupContent = forwardRef<
  ComponentRef<typeof View>,
  SidebarGroupContentProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-1", className)} {...props} />
));

SidebarGroupContent.displayName = "SidebarGroupContent";

export type SidebarMenuProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarMenu = forwardRef<
  ComponentRef<typeof View>,
  SidebarMenuProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-1", className)} {...props} />
));

SidebarMenu.displayName = "SidebarMenu";

export type SidebarMenuItemProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarMenuItem = forwardRef<
  ComponentRef<typeof View>,
  SidebarMenuItemProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-1", className)} {...props} />
));

SidebarMenuItem.displayName = "SidebarMenuItem";

export type SidebarMenuButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
  isActive?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export const SidebarMenuButton = forwardRef<
  ComponentRef<typeof Pressable>,
  SidebarMenuButtonProps
>(
  (
    {
      asChild = false,
      children,
      className,
      disabled,
      isActive = false,
      leftIcon,
      rightIcon,
      ...props
    },
    ref,
  ) => {
    const content = (
      <>
        {leftIcon ? <View>{leftIcon}</View> : null}
        <View className="min-w-0 flex-1">
          {typeof children === "string" || typeof children === "number" ? (
            <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              {children}
            </Text>
          ) : (
            children
          )}
        </View>
        {rightIcon ? <View>{rightIcon}</View> : null}
      </>
    );

    if (asChild) {
      return slotPressableChild(children, {
        ...props,
        className: cn(
          "min-h-12 flex-row items-center gap-sp-3 rounded-2xl px-sp-3 py-sp-3",
          isActive ? "bg-foreground dark:bg-foreground-dark" : "bg-transparent",
          disabled && "opacity-50",
          className,
        ),
      });
    }

    return (
      <Pressable
        ref={ref}
        accessibilityRole="button"
        className={cn(
          "min-h-12 flex-row items-center gap-sp-3 rounded-2xl px-sp-3 py-sp-3",
          isActive ? "bg-foreground dark:bg-foreground-dark" : "bg-transparent",
          disabled && "opacity-50",
          className,
        )}
        disabled={disabled}
        style={({ pressed }) =>
          pressed && !disabled ? { opacity: 0.9 } : null
        }
        {...props}
      >
        {isActive ? (
          <View className="absolute inset-0 rounded-2xl bg-foreground dark:bg-foreground-dark" />
        ) : null}
        <View className="z-10 flex-1 flex-row items-center gap-sp-3">
          {leftIcon ? <View>{leftIcon}</View> : null}
          <View className="min-w-0 flex-1">
            {typeof children === "string" || typeof children === "number" ? (
              <Text
                className={cn(
                  "font-sans text-base font-medium",
                  isActive
                    ? "text-background dark:text-background-dark"
                    : "text-foreground dark:text-foreground-dark",
                )}
              >
                {children}
              </Text>
            ) : (
              children
            )}
          </View>
          {rightIcon ? <View>{rightIcon}</View> : null}
        </View>
      </Pressable>
    );
  },
);

SidebarMenuButton.displayName = "SidebarMenuButton";

export type SidebarMenuBadgeProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const SidebarMenuBadge = forwardRef<
  ComponentRef<typeof Text>,
  SidebarMenuBadgeProps
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn(
      "rounded-pill bg-secondary px-sp-2 py-1 font-sans text-xs font-medium text-foreground dark:bg-secondary-dark dark:text-foreground-dark",
      className,
    )}
    {...props}
  />
));

SidebarMenuBadge.displayName = "SidebarMenuBadge";

export type SidebarCloseProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
};

export const SidebarClose = forwardRef<
  ComponentRef<typeof Pressable>,
  SidebarCloseProps
>(({ asChild = false, children, className, onPress, ...props }, ref) => {
  const { setOpen } = useSidebarContext("SidebarClose");

  const handlePress: ComponentPropsWithoutRef<typeof Pressable>["onPress"] = (
    event,
  ) => {
    onPress?.(event);
    setOpen(false);
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

SidebarClose.displayName = "SidebarClose";
