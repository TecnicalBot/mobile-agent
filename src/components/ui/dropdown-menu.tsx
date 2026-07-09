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
import { Modal, Pressable, Text, View } from "react-native";

import { cn } from "@/lib/utils";

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

export function DropdownMenuTrigger({ children }: { children: ReactElement }) {
  const ref = useRef<View>(null);

  const { open, setOpen, setPosition } = useDropdown("DropdownMenuTrigger");
  const child = children as ReactElement<any>;
  return cloneElement(child, {
    ref,

    onPress: (...args: any[]) => {
      ref.current?.measureInWindow((x, y, width, height) => {
        setPosition({
          x,
          y,
          width,
          height,
        });

        setOpen(!open);
      });

      child.props.onPress?.(...args);
    },
  });
}

export function DropdownMenuContent({
  children,
  width = 180,
}: {
  children: ReactNode;
  width?: number;
}) {
  const { open, setOpen, position } = useDropdown("DropdownMenuContent");

  if (!open || !position) {
    return null;
  }

  return (
    <Modal
      transparent
      animationType="fade"
      visible={open}
      onRequestClose={() => setOpen(false)}
    >
      <Pressable className="flex-1" onPress={() => setOpen(false)}>
        <View
          style={{
            position: "absolute",

            // align menu to the trigger
            top: position.y + position.height + 4,

            // right-align with trigger
            left: position.x + position.width - width,

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
>(({ children, className, onPress, ...props }, ref) => {
  const { setOpen } = useDropdown("DropdownMenuItem");

  return (
    <Pressable
      ref={ref}
      className={cn(
        "px-4 py-3 active:bg-secondary dark:active:bg-secondary-dark",
        className,
      )}
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
