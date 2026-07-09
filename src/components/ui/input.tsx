import { cva } from 'class-variance-authority';
import { forwardRef, useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { TextInput } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  'rounded-ui border bg-input px-sp-4 py-sp-3 font-sans text-base text-foreground dark:bg-input-dark dark:text-foreground-dark',
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

export type InputProps = Omit<ComponentPropsWithoutRef<typeof TextInput>, 'editable'> & {
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
};

export const Input = forwardRef<TextInput, InputProps>(
  ({ className, disabled = false, invalid = false, onBlur, onFocus, ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    const theme = useTheme();

    return (
      <TextInput
        ref={ref}
        aria-disabled={disabled}
        className={cn(inputVariants({ disabled, focused, invalid }), className)}
        editable={!disabled}
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
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
