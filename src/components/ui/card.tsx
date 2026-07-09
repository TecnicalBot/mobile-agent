import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { Text, View } from 'react-native';

import { cn } from '@/lib/utils';

export type CardProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const Card = forwardRef<View, CardProps>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn(
      'rounded-card border border-border bg-card dark:border-border-dark dark:bg-card-dark',
      className
    )}
    {...props}
  />
));

Card.displayName = 'Card';

export const CardHeader = forwardRef<View, CardProps>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn('gap-sp-1 p-sp-4', className)} {...props} />
));

CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<Text, ComponentPropsWithoutRef<typeof Text> & { className?: string }>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      className={cn('font-sans text-xl font-semibold text-foreground dark:text-foreground-dark', className)}
      {...props}
    />
  )
);

CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<
  Text,
  ComponentPropsWithoutRef<typeof Text> & { className?: string }
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn(
      'font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark',
      className
    )}
    {...props}
  />
));

CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<View, CardProps>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn('p-sp-4 pt-0', className)} {...props} />
));

CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<View, CardProps>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn('flex-row items-center p-sp-4 pt-0', className)} {...props} />
));

CardFooter.displayName = 'CardFooter';
