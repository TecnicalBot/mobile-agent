import { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Platform, ScrollView, View } from 'react-native';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { cn } from '@/lib/utils';

export type ContainerProps = PropsWithChildren<{
  className?: string;
  contentClassName?: string;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: Edge[];
  includeBottomTabInset?: boolean;
  safeArea?: boolean;
  scroll?: boolean;
  scrollClassName?: string;
}>;

export function Container({
  children,
  className,
  contentClassName,
  contentStyle,
  edges = ['top', 'right', 'bottom', 'left'],
  includeBottomTabInset = true,
  safeArea = true,
  scroll = false,
  scrollClassName,
}: ContainerProps) {
  const bottomPadding = (includeBottomTabInset ? BottomTabInset : 0) + Spacing.three;
  const Wrapper = safeArea ? SafeAreaView : View;
  const wrapperProps = safeArea ? { edges } : {};

  if (scroll) {
    return (
      <Wrapper
        {...wrapperProps}
        className={cn('flex-1 bg-background dark:bg-background-dark', className)}>
        <ScrollView
          className={cn('flex-1', scrollClassName)}
          contentContainerStyle={{
            alignItems: 'center',
            flexGrow: 1,
            paddingBottom: bottomPadding,
            paddingTop: Platform.OS === 'web' ? Spacing.six : 0,
          }}
          keyboardShouldPersistTaps="handled">
          <View
            className={cn('w-full max-w-content px-sp-4', contentClassName)}
            style={[{ maxWidth: MaxContentWidth }, contentStyle]}>
            {children}
          </View>
        </ScrollView>
      </Wrapper>
    );
  }

  return (
    <Wrapper
      {...wrapperProps}
      className={cn('flex-1 items-center bg-background dark:bg-background-dark', className)}>
      <View
        className={cn('flex-1 w-full max-w-content px-sp-4', contentClassName)}
        style={[
          { maxWidth: MaxContentWidth, paddingBottom: bottomPadding },
          contentStyle,
        ]}>
        {children}
      </View>
    </Wrapper>
  );
}
