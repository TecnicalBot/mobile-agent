import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ComponentRef } from "react";
import { Children, createContext, forwardRef, useContext } from "react";
import { Text, View } from "react-native";

import { cn, withSlottedProps } from "@/lib/utils";

const bubbleVariants = cva("self-start max-w-[80%]", {
  variants: {
    align: {
      start: "self-start",
      end: "self-end",
    },
    variant: {
      default: "",
      secondary: "",
      muted: "",
      tinted: "",
      outline: "",
      ghost: "",
      destructive: "",
    },
  },
  defaultVariants: {
    align: "start",
    variant: "default",
  },
});

const bubbleContentVariants = cva("rounded-card px-sp-4 py-sp-3", {
  variants: {
    variant: {
      default: "bg-foreground dark:bg-foreground-dark",
      secondary: "bg-secondary dark:bg-secondary-dark",
      muted: "bg-card dark:bg-card-dark",
      tinted:
        "border border-border bg-secondary dark:border-border-dark dark:bg-secondary-dark",
      outline: "border border-border bg-transparent dark:border-border-dark",
      ghost: "bg-transparent px-0 py-0",
      destructive: "bg-destructive dark:bg-destructive-dark",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const bubbleTextVariants = cva("font-sans text-base", {
  variants: {
    variant: {
      default: "text-background dark:text-background-dark",
      secondary: "text-foreground dark:text-foreground-dark",
      muted: "text-foreground dark:text-foreground-dark",
      tinted: "text-foreground dark:text-foreground-dark",
      outline: "text-foreground dark:text-foreground-dark",
      ghost: "text-foreground dark:text-foreground-dark",
      destructive:
        "text-destructive-foreground dark:text-destructive-foreground-dark",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type BubbleAlign = "start" | "end";
type BubbleVariant =
  | "default"
  | "secondary"
  | "muted"
  | "tinted"
  | "outline"
  | "ghost"
  | "destructive";

type BubbleContextValue = {
  align: BubbleAlign;
  variant: BubbleVariant;
};

const BubbleContext = createContext<BubbleContextValue>({
  align: "start",
  variant: "default",
});

export type BubbleProps = ComponentPropsWithoutRef<typeof View> &
  VariantProps<typeof bubbleVariants> & {
    className?: string;
  };

export const Bubble = forwardRef<ComponentRef<typeof View>, BubbleProps>(
  (
    {
      align = "start",
      children,
      className,
      style,
      variant = "default",
      ...props
    },
    ref,
  ) => (
    <BubbleContext.Provider
      value={{ align: align as BubbleAlign, variant: variant as BubbleVariant }}
    >
      <View
        ref={ref}
        className={cn(bubbleVariants({ align, variant }), className)}
        style={[style]}
        {...props}
      >
        {children}
      </View>
    </BubbleContext.Provider>
  ),
);

Bubble.displayName = "Bubble";

export type BubbleContentProps = ComponentPropsWithoutRef<typeof View> & {
  asChild?: boolean;
  className?: string;
};

export const BubbleContent = forwardRef<
  ComponentRef<typeof View>,
  BubbleContentProps
>(({ asChild = false, children, className, ...props }, ref) => {
  const { variant } = useContext(BubbleContext);
  const contentClassName = cn(bubbleContentVariants({ variant }), className);

  if (asChild) {
    return withSlottedProps(children, {
      ...props,
      className: contentClassName,
    });
  }

  if (typeof children === "string" || typeof children === "number") {
    return (
      <View ref={ref} className={contentClassName} {...props}>
        <Text className={bubbleTextVariants({ variant })}>{children}</Text>
      </View>
    );
  }

  return (
    <View ref={ref} className={contentClassName} {...props}>
      {children}
    </View>
  );
});

BubbleContent.displayName = "BubbleContent";

export type BubbleReactionsProps = ComponentPropsWithoutRef<typeof View> & {
  align?: "start" | "end";
  className?: string;
  side?: "top" | "bottom";
};

export const BubbleReactions = forwardRef<
  ComponentRef<typeof View>,
  BubbleReactionsProps
>(({ align = "end", children, className, side = "bottom", ...props }, ref) => {
  const { align: bubbleAlign } = useContext(BubbleContext);

  return (
    <View
      ref={ref}
      className={cn(
        "mt-1 flex-row flex-wrap items-center gap-1",
        side === "top" && "mb-1 mt-0",
        align === "start" || bubbleAlign === "start"
          ? "self-start"
          : "self-end",
        className,
      )}
      {...props}
    >
      {Children.map(children, (child) =>
        typeof child === "string" || typeof child === "number" ? (
          <Text className="rounded-pill bg-card px-sp-2 py-1 text-sm text-muted-foreground dark:bg-card-dark dark:text-muted-foreground-dark">
            {child}
          </Text>
        ) : (
          child
        ),
      )}
    </View>
  );
});

BubbleReactions.displayName = "BubbleReactions";

export type BubbleGroupProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const BubbleGroup = forwardRef<
  ComponentRef<typeof View>,
  BubbleGroupProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-1", className)} {...props} />
));

BubbleGroup.displayName = "BubbleGroup";
