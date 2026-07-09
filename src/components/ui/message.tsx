import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ComponentRef } from "react";
import { createContext, forwardRef, useContext } from "react";
import { Text, View } from "react-native";

import { cn } from "@/lib/utils";

const messageVariants = cva("w-full flex-row gap-sp-2", {
  variants: {
    align: {
      start: "justify-start",
      end: "justify-end",
    },
  },
  defaultVariants: {
    align: "start",
  },
});

type MessageAlign = "start" | "end";

type MessageContextValue = {
  align: MessageAlign;
};

const MessageContext = createContext<MessageContextValue>({
  align: "start",
});

export type MessageProps = ComponentPropsWithoutRef<typeof View> &
  VariantProps<typeof messageVariants> & {
    className?: string;
  };

export const Message = forwardRef<ComponentRef<typeof View>, MessageProps>(
  ({ align = "start", children, className, ...props }, ref) => (
    <MessageContext.Provider value={{ align: align as MessageAlign }}>
      <View
        ref={ref}
        className={cn(messageVariants({ align }), className)}
        {...props}
      >
        {children}
      </View>
    </MessageContext.Provider>
  ),
);

Message.displayName = "Message";

export type MessageGroupProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const MessageGroup = forwardRef<
  ComponentRef<typeof View>,
  MessageGroupProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("w-full gap-sp-2", className)} {...props} />
));

MessageGroup.displayName = "MessageGroup";

export type MessageAvatarProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const MessageAvatar = forwardRef<
  ComponentRef<typeof View>,
  MessageAvatarProps
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn("min-h-10 justify-end", className)}
    {...props}
  />
));

MessageAvatar.displayName = "MessageAvatar";

export type MessageContentProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const MessageContent = forwardRef<
  ComponentRef<typeof View>,
  MessageContentProps
>(({ className, ...props }, ref) => {
  const { align } = useContext(MessageContext);

  return (
    <View
      ref={ref}
      className={cn(
        "max-w-full gap-1",
        align === "end" ? "items-end" : "items-start",
        className,
      )}
      {...props}
    />
  );
});

MessageContent.displayName = "MessageContent";

export type MessageHeaderProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const MessageHeader = forwardRef<
  ComponentRef<typeof Text>,
  MessageHeaderProps
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn(
      "font-sans text-sm font-medium text-muted-foreground dark:text-muted-foreground-dark",
      className,
    )}
    {...props}
  />
));

MessageHeader.displayName = "MessageHeader";

export type MessageFooterProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const MessageFooter = forwardRef<
  ComponentRef<typeof View>,
  MessageFooterProps
>(({ className, ...props }, ref) => {
  const { align } = useContext(MessageContext);

  return (
    <View
      ref={ref}
      className={cn(
        "flex-row items-center gap-1",
        align === "end" ? "self-end" : "self-start",
        className,
      )}
      {...props}
    />
  );
});

MessageFooter.displayName = "MessageFooter";
