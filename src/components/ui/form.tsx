import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { Text, View } from 'react-native';

import { cn } from '@/lib/utils';

type ViewPrimitiveProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

type TextPrimitiveProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const FormItem = forwardRef<View, ViewPrimitiveProps>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn('gap-sp-2', className)} {...props} />
));

FormItem.displayName = 'FormItem';

export const FormDescription = forwardRef<Text, TextPrimitiveProps>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn('font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark', className)}
    {...props}
  />
));

FormDescription.displayName = 'FormDescription';

export const FormMessage = forwardRef<Text, TextPrimitiveProps>(
  ({ children, className, ...props }, ref) => {
    if (!children) {
      return null;
    }

    return (
      <Text
        ref={ref}
        className={cn('font-sans text-sm text-destructive dark:text-destructive-dark', className)}
        {...props}>
        {children}
      </Text>
    );
  }
);

FormMessage.displayName = 'FormMessage';
