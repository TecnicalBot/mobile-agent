import { cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function withSlottedProps<T extends Record<string, unknown>>(
  child: ReactNode,
  props: T & { className?: string }
) {
  if (!isValidElement(child)) {
    return null;
  }

  const childProps = (child.props ?? {}) as { className?: string };

  return cloneElement(child, {
    ...props,
    ...childProps,
    className: cn(props.className, childProps.className),
  });
}
