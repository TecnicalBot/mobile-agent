import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { View } from 'react-native';

import { cn } from '@/lib/utils';

export type SeparatorProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
};

export const Separator = forwardRef<View, SeparatorProps>(
  ({ className, orientation = 'horizontal', ...props }, ref) => (
    <View
      ref={ref}
      aria-hidden
      className={cn(
        'bg-border dark:bg-border-dark',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...props}
    />
  )
);

Separator.displayName = 'Separator';
