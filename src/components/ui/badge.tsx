import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Text, View } from 'react-native';

import { cn } from '@/lib/utils';

const badgeVariants = cva('rounded-pill px-sp-2 py-sp-1', {
  variants: {
    variant: {
      default: 'bg-foreground dark:bg-foreground-dark',
      secondary: 'bg-secondary dark:bg-secondary-dark',
      outline: 'border border-border bg-transparent dark:border-border-dark',
      destructive: 'bg-destructive dark:bg-destructive-dark',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

const badgeTextVariants = cva('font-sans text-sm font-medium', {
  variants: {
    variant: {
      default: 'text-background dark:text-background-dark',
      secondary: 'text-foreground dark:text-foreground-dark',
      outline: 'text-foreground dark:text-foreground-dark',
      destructive: 'text-destructive-foreground dark:text-destructive-foreground-dark',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type BadgeProps = ComponentPropsWithoutRef<typeof View> &
  VariantProps<typeof badgeVariants> & {
    className?: string;
    textClassName?: string;
  };

function renderBadgeChildren(children: ReactNode, className?: string, variant?: BadgeProps['variant']) {
  if (typeof children === 'string' || typeof children === 'number') {
    return <Text className={cn(badgeTextVariants({ variant }), className)}>{children}</Text>;
  }

  return children;
}

export const Badge = forwardRef<View, BadgeProps>(
  ({ children, className, textClassName, variant, ...props }, ref) => (
    <View ref={ref} className={cn(badgeVariants({ variant }), className)} {...props}>
      {renderBadgeChildren(children, textClassName, variant)}
    </View>
  )
);

Badge.displayName = 'Badge';
