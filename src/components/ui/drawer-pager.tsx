import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Animated, Easing, View } from "react-native";

import { cn } from "@/core/utils";

type DrawerPagerContextValue = {
  page: number;
  setPage: (page: number) => void;
};

const DrawerPagerContext = createContext<DrawerPagerContextValue | null>(null);

export type DrawerPagerProps = {
  children: ReactNode;
  className?: string;
  duration?: number;
  onPageChange: (page: number) => void;
  page: number;
};

export function DrawerPager({
  children,
  className,
  duration = 220,
  onPageChange,
  page,
}: DrawerPagerProps) {
  const pages = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement[];
  const progress = useRef(new Animated.Value(page)).current;
  const [width, setWidth] = useState(0);

  useEffect(() => {
    Animated.timing(progress, {
      duration,
      easing: Easing.out(Easing.cubic),
      toValue: page,
      useNativeDriver: true,
    }).start();
  }, [duration, page, progress]);

  return (
    <DrawerPagerContext.Provider value={{ page, setPage: onPageChange }}>
      <View
        className={cn("min-h-0 flex-1 overflow-hidden", className)}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0
          ? pages.map((child, index) => (
              <Animated.View
                className="absolute inset-0"
                key={child.key ?? index}
                pointerEvents={page === index ? "auto" : "none"}
                style={{
                  transform: [
                    {
                      translateX: Animated.add(
                        index * width,
                        Animated.multiply(progress, -width),
                      ),
                    },
                  ],
                }}
              >
                {child}
              </Animated.View>
            ))
          : null}
      </View>
    </DrawerPagerContext.Provider>
  );
}

export type DrawerPagerPageProps = {
  children: ReactNode;
  className?: string;
};

export function DrawerPagerPage({ children, className }: DrawerPagerPageProps) {
  return <View className={cn("flex-1 gap-sp-4", className)}>{children}</View>;
}

export function useDrawerPager() {
  const context = useContext(DrawerPagerContext);

  if (!context) {
    throw new Error("useDrawerPager must be used within DrawerPager");
  }

  return context;
}
