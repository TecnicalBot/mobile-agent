import {
  cloneElement,
  createContext,
  forwardRef,
  ReactElement,
  ReactNode,
  useContext,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentRef,
} from "react";
import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";

import { cn } from "@/core/utils";

type Position = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DropdownContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  position: Position | null;
  setPosition: (position: Position) => void;
};

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdown(name: string) {
  const ctx = useContext(DropdownContext);

  if (!ctx) {
    throw new Error(`${name} must be used inside DropdownMenu`);
  }

  return ctx;
}

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  return (
    <DropdownContext.Provider
      value={{
        open,
        setOpen,
        position,
        setPosition,
      }}
    >
      {children}
    </DropdownContext.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  triggerOn = "press",
}: {
  children: ReactElement;
  triggerOn?: "press" | "longPress";
}) {
  const ref = useRef<View>(null);

  const { open, setOpen, setPosition } = useDropdown("DropdownMenuTrigger");
  const child = children as ReactElement<any>;
  const openMenu = () => {
    ref.current?.measureInWindow((x, y, width, height) => {
      setPosition({
        x,
        y,
        width,
        height,
      });
    });
  };

  if (triggerOn === "longPress") {
    return cloneElement(child, {
      ref,

      onLongPress: (...args: any[]) => {
        openMenu();
        setOpen(true);
        child.props.onLongPress?.(...args);
      },
    });
  }

  return cloneElement(child, {
    ref,

    onPress: (...args: any[]) => {
      openMenu();
      setOpen(!open);

      child.props.onPress?.(...args);
    },
  });
}

export function DropdownMenuContent({
  alignOffset = 0,
  children,
  sideOffset = 4,
  width = 180,
}: {
  alignOffset?: number;
  children: ReactNode;
  sideOffset?: number;
  width?: number;
}) {
  const { open, setOpen, position } = useDropdown("DropdownMenuContent");
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [menuHeight, setMenuHeight] = useState(0);

  if (!open || !position) {
    return null;
  }

  const top = Math.min(
    position.y + position.height + sideOffset,
    screenHeight - menuHeight - 8,
  );

  return (
    <Modal
      transparent
      animationType="fade"
      visible={open}
      onRequestClose={() => setOpen(false)}
    >
      <Pressable className="flex-1" onPress={() => setOpen(false)}>
        <View
          onLayout={(event) => {
            setMenuHeight(event.nativeEvent.layout.height);
          }}
          style={{
            position: "absolute",

            // align menu to the trigger
            top,

            // right-align with trigger
            left: Math.min(
              screenWidth - width - 8,
              Math.max(
                8,
                position.x + position.width - width + alignOffset,
              ),
            ),

            width,
          }}
          className="overflow-hidden rounded-2xl border border-border bg-popover shadow-xl dark:border-border-dark dark:bg-popover-dark"
        >
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

export const DropdownMenuItem = forwardRef<
  ComponentRef<typeof Pressable>,
  ComponentPropsWithoutRef<typeof Pressable>
>(({ children, className, disabled, onPress, ...props }, ref) => {
  const { setOpen } = useDropdown("DropdownMenuItem");

  return (
    <Pressable
      ref={ref}
      className={cn(
        "px-4 py-3 active:bg-secondary dark:active:bg-secondary-dark",
        disabled && "opacity-50",
        className,
      )}
      disabled={disabled}
      onPress={(e) => {
        setOpen(false);
        onPress?.(e);
      }}
      {...props}
    >
      {typeof children === "string" ? (
        <Text className="text-base text-foreground dark:text-foreground-dark">
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
});

DropdownMenuItem.displayName = "DropdownMenuItem";
