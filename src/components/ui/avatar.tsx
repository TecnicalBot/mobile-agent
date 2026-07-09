import { Image as ExpoImage } from "expo-image";
import { cva, type VariantProps } from "class-variance-authority";
import {
  Children,
  createContext,
  forwardRef,
  useContext,
  useMemo,
  useState,
} from "react";
import type {
  ComponentPropsWithoutRef,
  ComponentRef,
  PropsWithChildren,
  ReactNode,
} from "react";
import { Text, View } from "react-native";

import { cn } from "@/lib/utils";

const avatarVariants = cva(
  "relative shrink-0 items-center justify-center overflow-hidden rounded-full bg-card dark:bg-card-dark",
  {
    variants: {
      size: {
        sm: "h-8 w-8",
        default: "h-10 w-10",
        lg: "h-12 w-12",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

const avatarFallbackVariants = cva(
  "items-center justify-center rounded-full bg-card dark:bg-card-dark",
  {
    variants: {
      size: {
        sm: "h-8 w-8",
        default: "h-10 w-10",
        lg: "h-12 w-12",
      },
      tone: {
        default: "bg-card dark:bg-card-dark",
        primary: "bg-foreground dark:bg-foreground-dark",
      },
    },
    defaultVariants: {
      size: "default",
      tone: "default",
    },
  },
);

const avatarFallbackTextVariants = cva("font-sans font-semibold", {
  variants: {
    size: {
      sm: "text-xs",
      default: "text-sm",
      lg: "text-base",
    },
    tone: {
      default: "text-foreground dark:text-foreground-dark",
      primary: "text-background dark:text-background-dark",
    },
  },
  defaultVariants: {
    size: "default",
    tone: "default",
  },
});

type AvatarContextValue = {
  imageLoaded: boolean;
  setImageLoaded: (loaded: boolean) => void;
  size: AvatarSize;
};

type AvatarSize = "sm" | "default" | "lg";

const AvatarContext = createContext<AvatarContextValue>({
  imageLoaded: false,
  setImageLoaded: () => undefined,
  size: "default",
});

export type AvatarProps = ComponentPropsWithoutRef<typeof View> &
  VariantProps<typeof avatarVariants> & {
    className?: string;
  };

export const Avatar = forwardRef<ComponentRef<typeof View>, AvatarProps>(
  ({ children, className, size = "default", ...props }, ref) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const context = useMemo(
      () => ({
        imageLoaded,
        setImageLoaded,
        size: size as AvatarSize,
      }),
      [imageLoaded, size],
    );

    return (
      <AvatarContext.Provider value={context}>
        <View
          ref={ref}
          className={cn(avatarVariants({ size }), className)}
          {...props}
        >
          {children}
        </View>
      </AvatarContext.Provider>
    );
  },
);

Avatar.displayName = "Avatar";

export type AvatarImageProps = Omit<
  ComponentPropsWithoutRef<typeof ExpoImage>,
  "source"
> & {
  alt?: string;
  className?: string;
  src?: string;
};

export const AvatarImage = forwardRef<ComponentRef<typeof ExpoImage>, AvatarImageProps>(
  ({ alt, className, onError, onLoad, src, style, ...props }, ref) => {
    const { setImageLoaded } = useContext(AvatarContext);

    if (!src) {
      return null;
    }

    return (
      <ExpoImage
        ref={ref}
        accessibilityLabel={alt}
        className={cn("h-full w-full", className)}
        contentFit="cover"
        onError={(event) => {
          setImageLoaded(false);
          onError?.(event);
        }}
        onLoad={(event) => {
          setImageLoaded(true);
          onLoad?.(event);
        }}
        source={{ uri: src }}
        style={[{ width: "100%", height: "100%" }, style]}
        {...props}
      />
    );
  },
);

AvatarImage.displayName = "AvatarImage";

export type AvatarFallbackProps = ComponentPropsWithoutRef<typeof View> &
  VariantProps<typeof avatarFallbackVariants> & {
    className?: string;
    textClassName?: string;
  };

export const AvatarFallback = forwardRef<
  ComponentRef<typeof View>,
  AvatarFallbackProps
>(
  (
    {
      children,
      className,
      size,
      textClassName,
      tone = "default",
      ...props
    },
    ref,
  ) => {
    const context = useContext(AvatarContext);
    const resolvedSize = (size ?? context.size) as AvatarSize;

    if (context.imageLoaded) {
      return null;
    }

    return (
      <View
        ref={ref}
        className={cn(avatarFallbackVariants({ size: resolvedSize, tone }), className)}
        {...props}
      >
        {typeof children === "string" || typeof children === "number" ? (
          <Text
            className={cn(
              avatarFallbackTextVariants({ size: resolvedSize, tone }),
              textClassName,
            )}
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    );
  },
);

AvatarFallback.displayName = "AvatarFallback";

export type AvatarBadgeProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const AvatarBadge = forwardRef<ComponentRef<typeof View>, AvatarBadgeProps>(
  ({ children, className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "absolute bottom-0 right-0 z-10 min-h-3 min-w-3 items-center justify-center rounded-full border-2 border-background bg-emerald-500 px-1 dark:border-background-dark",
        className,
      )}
      {...props}
    >
      {children}
    </View>
  ),
);

AvatarBadge.displayName = "AvatarBadge";

export type AvatarGroupProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const AvatarGroup = forwardRef<ComponentRef<typeof View>, AvatarGroupProps>(
  ({ children, className, ...props }, ref) => (
    <View ref={ref} className={cn("flex-row items-center", className)} {...props}>
      {Children.map(children, (child, index) => (
        <View className={cn(index === 0 ? "" : "-ml-2")}>{child}</View>
      ))}
    </View>
  ),
);

AvatarGroup.displayName = "AvatarGroup";

export type AvatarGroupCountProps = PropsWithChildren<{
  className?: string;
  size?: AvatarSize;
}>;

export const AvatarGroupCount = forwardRef<
  ComponentRef<typeof View>,
  AvatarGroupCountProps
>(({ children, className, size = "default" }, ref) => (
  <View ref={ref} className={cn("-ml-2", className)}>
    <Avatar
      className={cn(
        "border-2 border-background dark:border-background-dark",
        size === "sm" && "h-8 w-8",
        size === "default" && "h-10 w-10",
        size === "lg" && "h-12 w-12",
      )}
      size={size}
    >
      <AvatarFallback>{children}</AvatarFallback>
    </Avatar>
  </View>
));

AvatarGroupCount.displayName = "AvatarGroupCount";
