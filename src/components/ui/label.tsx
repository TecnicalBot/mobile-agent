import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { Text } from 'react-native';

import { cn } from '@/lib/utils';

export type LabelProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
  disabled?: boolean;
  required?: boolean;
};

export const Label = forwardRef<Text, LabelProps>(
  ({ children, className, disabled = false, required = false, ...props }, ref) => (
    <Text
      ref={ref}
      className={cn(
        'font-sans text-sm font-medium text-foreground dark:text-foreground-dark',
        disabled && 'text-muted-foreground dark:text-muted-foreground-dark',
        className
      )}
      {...props}>
      {children}
      {required ? (
        <Text className="text-destructive dark:text-destructive-dark">{' *'}</Text>
      ) : null}
    </Text>
  )
);

Label.displayName = 'Label';
