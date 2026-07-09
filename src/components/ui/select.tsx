import { Check, ChevronDown } from "lucide-react-native";
import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

type SelectContextValue = {
  disabled: boolean;
  open: boolean;
  registerItem: (value: string, label?: string) => void;
  selectedLabel?: string;
  setOpen: (open: boolean) => void;
  setValue: (value: string) => void;
  value?: string;
};

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext(name: string) {
  const context = useContext(SelectContext);

  if (!context) {
    throw new Error(`${name} must be used within a Select`);
  }

  return context;
}

function useControllableState<T>({
  defaultValue,
  onChange,
  value,
}: {
  defaultValue: T;
  onChange?: (value: T) => void;
  value?: T;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const setValue = (nextValue: T) => {
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

function getItemLabel(children: ReactNode, label?: string) {
  if (label) {
    return label;
  }

  if (typeof children === "string" || typeof children === "number") {
    return `${children}`;
  }

  return undefined;
}

export type SelectProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  defaultValue?: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  onValueChange?: (value: string) => void;
  open?: boolean;
  value?: string;
};

export function Select({
  children,
  defaultOpen = false,
  defaultValue,
  disabled = false,
  onOpenChange,
  onValueChange,
  open,
  value,
}: SelectProps) {
  const [isOpen, setIsOpen] = useControllableState<boolean>({
    defaultValue: defaultOpen,
    onChange: onOpenChange,
    value: open,
  });
  const [selectedValue, setSelectedValue] = useControllableState<
    string | undefined
  >({
    defaultValue,
    onChange: onValueChange
      ? (nextValue) => {
          if (nextValue !== undefined) {
            onValueChange(nextValue);
          }
        }
      : undefined,
    value,
  });
  const [labels, setLabels] = useState<Record<string, string>>({});

  const contextValue = useMemo(
    () => ({
      disabled,
      open: isOpen,
      registerItem: (itemValue: string, itemLabel?: string) => {
        if (!itemLabel) return;

        setLabels((current) =>
          current[itemValue] === itemLabel
            ? current
            : { ...current, [itemValue]: itemLabel },
        );
      },
      selectedLabel: selectedValue ? labels[selectedValue] : undefined,
      setOpen: setIsOpen,
      setValue: (nextValue: string) => {
        setSelectedValue(nextValue);
        setIsOpen(false);
      },
      value: selectedValue,
    }),
    [disabled, isOpen, labels, selectedValue, setIsOpen, setSelectedValue],
  );

  return (
    <SelectContext.Provider value={contextValue}>
      {children}
    </SelectContext.Provider>
  );
}

export type SelectTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
  invalid?: boolean;
};

export const SelectTrigger = forwardRef<
  ComponentRef<typeof Pressable>,
  SelectTriggerProps
>(({ asChild = false, children, className, invalid = false, onPress, ...props }, ref) => {
  const { disabled, open, setOpen } = useSelectContext("SelectTrigger");

  const handlePress: ComponentPropsWithoutRef<typeof Pressable>["onPress"] = (
    event,
  ) => {
    onPress?.(event);

    if (!disabled) {
      setOpen(!open);
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
      accessibilityState={{ disabled, expanded: open }}
      className={cn(
        "min-h-12 flex-row items-center justify-between gap-sp-3 rounded-ui border bg-input px-sp-4 py-sp-3",
        invalid
          ? "border-destructive dark:border-destructive-dark"
          : "border-border dark:border-border-dark",
        disabled && "opacity-50",
        className,
      )}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => (pressed && !disabled ? { opacity: 0.9 } : null)}
      {...props}
    >
      <View className="min-w-0 flex-1">{children}</View>
      <SelectIndicator open={open} />
    </Pressable>
  );
});

SelectTrigger.displayName = "SelectTrigger";

function SelectIndicator({ open }: { open: boolean }) {
  const theme = useTheme();

  return (
    <View style={open ? { transform: [{ rotate: "180deg" }] } : undefined}>
      <ChevronDown color={theme.textSecondary} size={18} />
    </View>
  );
}

export type SelectValueProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
  placeholder?: string;
  placeholderClassName?: string;
};

export const SelectValue = forwardRef<ComponentRef<typeof Text>, SelectValueProps>(
  (
    {
      children,
      className,
      placeholder = "Select an option",
      placeholderClassName,
      ...props
    },
    ref,
  ) => {
    const { selectedLabel, value } = useSelectContext("SelectValue");
    const hasValue = Boolean(value);
    const content =
      children ?? (selectedLabel ? selectedLabel : placeholder);

    return (
      <Text
        ref={ref}
        className={cn(
          "font-sans text-base",
          hasValue
            ? "text-foreground dark:text-foreground-dark"
            : "text-muted-foreground dark:text-muted-foreground-dark",
          !hasValue && placeholderClassName,
          className,
        )}
        numberOfLines={1}
        {...props}
      >
        {content}
      </Text>
    );
  },
);

SelectValue.displayName = "SelectValue";

export type SelectContentProps = ComponentPropsWithoutRef<typeof View> & {
  children: ReactNode;
  overlayClassName?: string;
  presentation?: "center" | "sheet";
};

export const SelectContent = forwardRef<
  ComponentRef<typeof View>,
  SelectContentProps
>(({ children, className, overlayClassName, presentation = "sheet", ...props }, ref) => {
  const { open, setOpen } = useSelectContext("SelectContent");
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  if (!open) {
    return null;
  }

  const maxHeight = Math.max(height - insets.top - insets.bottom - 32, 220);

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
          "flex-1 px-sp-4",
          presentation === "sheet" ? "justify-end" : "justify-center",
        )}
      >
        <Pressable
          className={cn("absolute inset-0 bg-black/45", overlayClassName)}
          onPress={() => setOpen(false)}
        />
        <View
          ref={ref}
          className={cn(
            "w-full self-center overflow-hidden rounded-[28px] border border-border bg-popover dark:border-border-dark dark:bg-popover-dark",
            presentation === "center" ? "max-w-md" : "rounded-b-none",
            className,
          )}
          style={[
            { maxHeight },
            presentation === "sheet"
              ? { paddingBottom: insets.bottom + 20 }
              : {
                  marginTop: insets.top + 16,
                  marginBottom: insets.bottom + 16,
                },
          ]}
          {...props}
        >
          <ScrollView
            className="max-h-full"
            contentContainerClassName="gap-sp-2 p-sp-3"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </ReactNativeModal>
  );
});

SelectContent.displayName = "SelectContent";

export type SelectGroupProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SelectGroup = forwardRef<ComponentRef<typeof View>, SelectGroupProps>(
  ({ className, ...props }, ref) => (
    <View ref={ref} className={cn("gap-1", className)} {...props} />
  ),
);

SelectGroup.displayName = "SelectGroup";

export type SelectLabelProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const SelectLabel = forwardRef<ComponentRef<typeof Text>, SelectLabelProps>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      className={cn(
        "px-sp-3 py-2 font-sans text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground dark:text-muted-foreground-dark",
        className,
      )}
      {...props}
    />
  ),
);

SelectLabel.displayName = "SelectLabel";

export type SelectItemProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  label?: string;
  value: string;
};

export const SelectItem = forwardRef<ComponentRef<typeof Pressable>, SelectItemProps>(
  (
    {
      children,
      className,
      disabled = false,
      label,
      onPress,
      value,
      ...props
    },
    ref,
  ) => {
    const { registerItem, setValue, value: selectedValue } = useSelectContext(
      "SelectItem",
    );
    const theme = useTheme();
    const selected = selectedValue === value;
    const itemLabel = getItemLabel(children, label);

    useEffect(() => {
      registerItem(value, itemLabel);
    }, [itemLabel, registerItem, value]);

    return (
      <Pressable
        ref={ref}
        accessibilityRole="menuitem"
        accessibilityState={{ disabled, selected }}
        className={cn(
          "flex-row items-center gap-sp-3 rounded-2xl px-sp-3 py-sp-3",
          selected
            ? "bg-secondary dark:bg-secondary-dark"
            : "bg-transparent",
          disabled && "opacity-50",
          className,
        )}
        disabled={disabled}
        onPress={(event) => {
          onPress?.(event);

          if (!disabled) {
            setValue(value);
          }
        }}
        style={({ pressed }) => (pressed && !disabled ? { opacity: 0.9 } : null)}
        {...props}
      >
        <View className="min-w-0 flex-1">
          {typeof children === "string" || typeof children === "number" ? (
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              {children}
            </Text>
          ) : (
            children
          )}
        </View>
        {selected ? <Check color={theme.text} size={18} /> : null}
      </Pressable>
    );
  },
);

SelectItem.displayName = "SelectItem";

export type SelectSeparatorProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SelectSeparator = forwardRef<
  ComponentRef<typeof View>,
  SelectSeparatorProps
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn("mx-sp-1 my-sp-2 h-px bg-border dark:bg-border-dark", className)}
    {...props}
  />
));

SelectSeparator.displayName = "SelectSeparator";
