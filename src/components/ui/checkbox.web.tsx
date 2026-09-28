import { Check } from 'lucide-react-native';
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { cn } from '@/core/utils';
import { useTheme } from '@/hooks/use-theme';

/**
 * Web variant of the checkbox.
 *
 * `expo-symbols` renders SF Symbols / Material icons through a native view and
 * has no web implementation, so this variant draws the checkmark with
 * `lucide-react-native`, which already renders to SVG on react-native-web.
 *
 * The props and class names are kept identical to `checkbox.tsx` so the two
 * implementations stay interchangeable.
 */

type CheckboxPressableProps = Omit<ComponentPropsWithoutRef<typeof Pressable>, 'children' | 'onPress'>;

export type CheckboxProps = CheckboxPressableProps & {
  checked: boolean;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  labelClassName?: string;
  onCheckedChange: (checked: boolean) => void;
};

function renderLabel(children: ReactNode, className?: string) {
  if (typeof children === 'string' || typeof children === 'number') {
    return (
      <Text className={cn('font-sans text-base text-foreground dark:text-foreground-dark', className)}>
        {children}
      </Text>
    );
  }

  return children;
}

export const Checkbox = forwardRef<ElementRef<typeof Pressable>, CheckboxProps>(
  ({ checked, children, className, disabled = false, labelClassName, onCheckedChange, ...props }, ref) => {
    const theme = useTheme();

    return (
      <Pressable
        ref={ref}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        className={cn('flex-row items-center gap-sp-2', disabled && 'opacity-50', className)}
        disabled={disabled}
        onPress={() => onCheckedChange(!checked)}
        style={({ pressed }) => (pressed && !disabled ? { opacity: 0.85 } : null)}
        {...props}>
        <View
          className={cn(
            'h-5 w-5 items-center justify-center rounded border border-border bg-background dark:border-border-dark dark:bg-background-dark',
            checked && 'border-foreground bg-foreground dark:border-foreground-dark dark:border-foreground-dark'
          )}>
          {checked ? <Check color={theme.background} size={12} strokeWidth={3} /> : null}
        </View>
        {renderLabel(children, labelClassName)}
      </Pressable>
    );
  }
);

Checkbox.displayName = 'Checkbox';
