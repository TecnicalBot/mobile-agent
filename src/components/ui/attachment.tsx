import { cva, type VariantProps } from "class-variance-authority";
import { createContext, forwardRef, useContext } from "react";
import type { ComponentPropsWithoutRef, ComponentRef, ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn, withSlottedProps } from "@/lib/utils";

const attachmentVariants = cva(
  "relative overflow-hidden rounded-card border border-border bg-card dark:border-border-dark dark:bg-card-dark",
  {
    variants: {
      orientation: {
        horizontal: "flex-row items-center gap-sp-3",
        vertical: "gap-sp-3",
      },
      size: {
        default: "min-h-20 p-sp-3",
        sm: "min-h-16 p-sp-2",
        xs: "min-h-14 p-sp-2",
      },
      state: {
        idle: "",
        uploading: "opacity-90",
        processing: "opacity-90",
        error: "border-destructive dark:border-destructive-dark",
        done: "",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
      size: "default",
      state: "done",
    },
  },
);

type AttachmentOrientation = "horizontal" | "vertical";
type AttachmentSize = "default" | "sm" | "xs";
type AttachmentState = "idle" | "uploading" | "processing" | "error" | "done";

type AttachmentContextValue = {
  orientation: AttachmentOrientation;
  size: AttachmentSize;
  state: AttachmentState;
};

const AttachmentContext = createContext<AttachmentContextValue>({
  orientation: "horizontal",
  size: "default",
  state: "done",
});

export type AttachmentProps = ComponentPropsWithoutRef<typeof View> &
  VariantProps<typeof attachmentVariants> & {
    className?: string;
  };

export const Attachment = forwardRef<ComponentRef<typeof View>, AttachmentProps>(
  (
    {
      children,
      className,
      orientation = "horizontal",
      size = "default",
      state = "done",
      ...props
    },
    ref,
  ) => (
    <AttachmentContext.Provider
      value={{
        orientation: orientation as AttachmentOrientation,
        size: size as AttachmentSize,
        state: state as AttachmentState,
      }}
    >
      <View
        ref={ref}
        className={cn(attachmentVariants({ orientation, size, state }), className)}
        {...props}
      >
        {(state === "uploading" || state === "processing") && (
          <View className="absolute inset-x-0 top-0 h-1 bg-ring/40 dark:bg-ring-dark/40" />
        )}
        {children}
      </View>
    </AttachmentContext.Provider>
  ),
);

Attachment.displayName = "Attachment";

export type AttachmentMediaProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
  variant?: "icon" | "image";
};

export const AttachmentMedia = forwardRef<
  ComponentRef<typeof View>,
  AttachmentMediaProps
>(({ className, variant = "icon", ...props }, ref) => {
  const { orientation, size } = useContext(AttachmentContext);

  return (
    <View
      ref={ref}
      className={cn(
        "shrink-0 overflow-hidden rounded-ui bg-background dark:bg-background-dark",
        variant === "icon" && "items-center justify-center",
        orientation === "horizontal"
          ? size === "xs"
            ? "h-10 w-10"
            : size === "sm"
              ? "h-12 w-12"
              : "h-14 w-14"
          : "aspect-[4/3] w-full",
        className,
      )}
      {...props}
    />
  );
});

AttachmentMedia.displayName = "AttachmentMedia";

export type AttachmentContentProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const AttachmentContent = forwardRef<
  ComponentRef<typeof View>,
  AttachmentContentProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("min-w-0 flex-1 gap-1", className)} {...props} />
));

AttachmentContent.displayName = "AttachmentContent";

export type AttachmentTitleProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const AttachmentTitle = forwardRef<
  ComponentRef<typeof Text>,
  AttachmentTitleProps
>(({ className, ...props }, ref) => {
  const { state } = useContext(AttachmentContext);

  return (
    <Text
      ref={ref}
      numberOfLines={1}
      className={cn(
        "font-sans text-sm font-medium text-foreground dark:text-foreground-dark",
        (state === "uploading" || state === "processing") && "opacity-80",
        className,
      )}
      {...props}
    />
  );
});

AttachmentTitle.displayName = "AttachmentTitle";

export type AttachmentDescriptionProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const AttachmentDescription = forwardRef<
  ComponentRef<typeof Text>,
  AttachmentDescriptionProps
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    numberOfLines={2}
    className={cn(
      "font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark",
      className,
    )}
    {...props}
  />
));

AttachmentDescription.displayName = "AttachmentDescription";

export type AttachmentActionsProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const AttachmentActions = forwardRef<
  ComponentRef<typeof View>,
  AttachmentActionsProps
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn("z-10 ml-auto flex-row items-center gap-1", className)}
    {...props}
  />
));

AttachmentActions.displayName = "AttachmentActions";

export type AttachmentActionProps = ButtonProps;

export const AttachmentAction = forwardRef<
  ComponentRef<typeof Button>,
  AttachmentActionProps
>(({ className, size = "icon-xs", variant = "ghost", ...props }, ref) => (
  <Button
    ref={ref}
    className={cn("z-10", className)}
    size={size}
    variant={variant}
    {...props}
  />
));

AttachmentAction.displayName = "AttachmentAction";

export type AttachmentTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
};

export const AttachmentTrigger = forwardRef<
  ComponentRef<typeof Pressable>,
  AttachmentTriggerProps
>(({ asChild = false, children, className, ...props }, ref) => {
  const triggerClassName = cn("absolute inset-0 z-0 rounded-card", className);

  if (asChild) {
    return withSlottedProps(children, { ...props, className: triggerClassName });
  }

  return <Pressable ref={ref} className={triggerClassName} {...props} />;
});

AttachmentTrigger.displayName = "AttachmentTrigger";

export type AttachmentGroupProps = ComponentPropsWithoutRef<typeof ScrollView> & {
  className?: string;
};

export const AttachmentGroup = forwardRef<
  ComponentRef<typeof ScrollView>,
  AttachmentGroupProps
>(
  (
    {
      children,
      className,
      contentContainerStyle,
      horizontal = true,
      ...props
    },
    ref,
  ) => (
    <ScrollView
      ref={ref}
      className={className}
      contentContainerStyle={[{ gap: 12, paddingRight: 4 }, contentContainerStyle]}
      horizontal={horizontal}
      showsHorizontalScrollIndicator={false}
      {...props}
    >
      {children}
    </ScrollView>
  ),
);

AttachmentGroup.displayName = "AttachmentGroup";
