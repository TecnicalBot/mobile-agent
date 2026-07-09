import { cva, type VariantProps } from "class-variance-authority";
import { createContext, forwardRef, useContext } from "react";
import type { ComponentPropsWithoutRef, ComponentRef, ReactNode } from "react";
import { Text, View } from "react-native";

import { cn, withSlottedProps } from "@/lib/utils";

export const markerVariants = cva("self-center", {
  variants: {
    variant: {
      default:
        "flex-row items-center gap-2 rounded-pill bg-card px-sp-3 py-1 dark:bg-card-dark",
      border:
        "w-full flex-row items-center justify-center gap-2 border-b border-border py-sp-2 dark:border-border-dark",
      separator: "w-full flex-row items-center gap-2 py-sp-2",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type MarkerVariant = "default" | "border" | "separator";

type MarkerContextValue = {
  variant: MarkerVariant;
};

const MarkerContext = createContext<MarkerContextValue>({
  variant: "default",
});

export type MarkerProps = Omit<
  ComponentPropsWithoutRef<typeof View>,
  "children"
> &
  VariantProps<typeof markerVariants> & {
    asChild?: boolean;
    children?: ReactNode;
    className?: string;
  };

export const Marker = forwardRef<ComponentRef<typeof View>, MarkerProps>(
  (
    {
      asChild = false,
      children,
      className,
      variant = "default",
      ...props
    },
    ref,
  ) => {
    const markerClassName = cn(markerVariants({ variant }), className);

    if (asChild) {
      return withSlottedProps(children, { ...props, className: markerClassName });
    }

    return (
      <MarkerContext.Provider value={{ variant: variant as MarkerVariant }}>
        <View ref={ref} className={markerClassName} {...props}>
          {variant === "separator" ? (
            <View className="h-px flex-1 bg-border dark:bg-border-dark" />
          ) : null}
          {children}
          {variant === "separator" ? (
            <View className="h-px flex-1 bg-border dark:bg-border-dark" />
          ) : null}
        </View>
      </MarkerContext.Provider>
    );
  },
);

Marker.displayName = "Marker";

export type MarkerIconProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const MarkerIcon = forwardRef<ComponentRef<typeof View>, MarkerIconProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      accessibilityElementsHidden
      aria-hidden
      className={cn("items-center justify-center", className)}
      {...props}
    />
  ),
);

MarkerIcon.displayName = "MarkerIcon";

export type MarkerContentProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const MarkerContent = forwardRef<
  ComponentRef<typeof Text>,
  MarkerContentProps
>(({ className, ...props }, ref) => {
  const { variant } = useContext(MarkerContext);

  return (
    <Text
      ref={ref}
      className={cn(
        "font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark",
        variant === "separator" && "text-center",
        className,
      )}
      {...props}
    />
  );
});

MarkerContent.displayName = "MarkerContent";
