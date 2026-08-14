import { X } from "lucide-react-native";
import { forwardRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { Pressable, TextInput, View } from "react-native";

import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";

export type SearchBoxProps = Omit<
  ComponentPropsWithoutRef<typeof TextInput>,
  "editable"
> & {
  className?: string;
  showClearButton?: boolean;
};

export const SearchBox = forwardRef<TextInput, SearchBoxProps>(
  ({ className, onBlur, onChangeText, onFocus, showClearButton = true, value, ...props }, ref) => {
    const theme = useTheme();
    const [focused, setFocused] = useState(false);
    const canClear = showClearButton && typeof value === "string" && value.length > 0;

    return (
      <View
        className={cn(
          "min-h-12 flex-row items-center gap-2 rounded-ui border bg-input px-sp-4 dark:bg-input-dark",
          focused
            ? "border-ring dark:border-ring-dark"
            : "border-border dark:border-border-dark",
          className,
        )}
      >
        <TextInput
          ref={ref}
          className="flex-1 py-sp-2 font-sans text-base text-foreground dark:text-foreground-dark"
          cursorColor={theme.text}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onChangeText={onChangeText}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          placeholderTextColor={theme.textSecondary}
          selectionColor={theme.backgroundSelected}
          selectionHandleColor={theme.text}
          value={value}
          {...props}
        />
        {canClear ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onChangeText?.("")}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
          >
            <X color={theme.textSecondary} size={16} />
          </Pressable>
        ) : null}
      </View>
    );
  },
);

SearchBox.displayName = "SearchBox";
