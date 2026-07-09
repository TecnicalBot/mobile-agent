import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ComponentRef, ReactNode } from "react";
import { forwardRef } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "flex-row items-center justify-center gap-sp-2 rounded-ui",
  {
    variants: {
      variant: {
        default: "bg-foreground dark:bg-foreground-dark",
        secondary: "bg-secondary dark:bg-secondary-dark",
        outline:
          "border border-border bg-background dark:border-border-dark dark:bg-background-dark",
        ghost: "bg-transparent",
        destructive: "bg-destructive dark:bg-destructive-dark",
      },
      size: {
        xs: "min-h-8 px-sp-2 py-1",
        default: "min-h-12 px-sp-4 py-sp-2",
        sm: "min-h-10 px-sp-3 py-sp-2",
        lg: "min-h-14 px-sp-5 py-sp-3",
        "icon-xs": "h-8 w-8",
        icon: "h-12 w-12",
      },
      disabled: {
        true: "opacity-50",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      disabled: false,
    },
  },
);

const buttonTextVariants = cva("font-sans text-base font-medium", {
  variants: {
    variant: {
      default: "text-background dark:text-background-dark",
      secondary: "text-foreground dark:text-foreground-dark",
      outline: "text-foreground dark:text-foreground-dark",
      ghost: "text-foreground dark:text-foreground-dark",
      destructive:
        "text-destructive-foreground dark:text-destructive-foreground-dark",
    },
    size: {
      xs: "text-sm",
      default: "",
      sm: "text-sm",
      lg: "text-lg",
      "icon-xs": "text-sm",
      icon: "text-base",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type PrimitiveChild = string | number;

type PressableProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
>;

export type ButtonProps = PressableProps &
  VariantProps<typeof buttonVariants> & {
    children?: ReactNode;
    className?: string;
    leftIcon?: ReactNode;
    loading?: boolean;
    rightIcon?: ReactNode;
    textClassName?: string;
  };

function isPrimitiveChild(value: ReactNode): value is PrimitiveChild {
  return typeof value === "string" || typeof value === "number";
}

export const Button = forwardRef<ComponentRef<typeof Pressable>, ButtonProps>(
  (
    {
      children,
      className,
      disabled,
      leftIcon,
      loading = false,
      rightIcon,
      size,
      style,
      textClassName,
      variant,
      ...props
    },
    ref,
  ) => {
    const theme = useTheme();
    const isDisabled = disabled || loading;
    const indicatorColor =
      variant === "default"
        ? theme.background
        : variant === "destructive"
          ? "#FFFFFF"
          : theme.text;

    return (
      <Pressable
        ref={ref}
        accessibilityRole="button"
        className={cn(
          buttonVariants({ disabled: isDisabled, size, variant }),
          className,
        )}
        disabled={isDisabled}
        style={(state) => [
          typeof style === "function" ? style(state) : style,
          state.pressed && !isDisabled ? { opacity: 0.85 } : null,
        ]}
        {...props}
      >
        {loading ? (
          <ActivityIndicator color={indicatorColor} size="small" />
        ) : (
          leftIcon
        )}
        {isPrimitiveChild(children) ? (
          <Text
            className={cn(buttonTextVariants({ size, variant }), textClassName)}
          >
            {children}
          </Text>
        ) : (
          children
        )}
        {rightIcon}
      </Pressable>
    );
  },
);

Button.displayName = "Button";
