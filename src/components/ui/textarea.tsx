import { cva } from 'class-variance-authority';
import { forwardRef, useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { Platform, TextInput } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

const textareaVariants = cva(
  'min-h-32 rounded-ui border bg-input px-sp-4 py-sp-3 font-sans text-base text-foreground dark:bg-input-dark dark:text-foreground-dark',
  {
    variants: {
      disabled: {
        true: 'opacity-50',
        false: '',
      },
      focused: {
        true: 'border-ring dark:border-ring-dark',
        false: 'border-border dark:border-border-dark',
      },
      invalid: {
        true: 'border-destructive dark:border-destructive-dark',
        false: '',
      },
    },
    defaultVariants: {
      disabled: false,
      focused: false,
      invalid: false,
    },
  }
);

export type TextareaProps = Omit<ComponentPropsWithoutRef<typeof TextInput>, 'editable' | 'multiline'> & {
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
};

export const Textarea = forwardRef<TextInput, TextareaProps>(
  ({ className, disabled = false, invalid = false, onBlur, onFocus, style, ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    const theme = useTheme();

    return (
      <TextInput
        ref={ref}
        className={cn(textareaVariants({ disabled, focused, invalid }), className)}
        editable={!disabled}
        multiline
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        placeholderTextColor={theme.textSecondary}
        selectionColor={theme.text}
        style={[
          Platform.OS === 'android' ? { textAlignVertical: 'top' } : null,
          style,
        ]}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
