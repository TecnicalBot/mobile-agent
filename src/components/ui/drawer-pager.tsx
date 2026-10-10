import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Animated, Easing, View, useWindowDimensions } from "react-native";

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
  const pages = useMemo(
    () =>
      Children.toArray(children).filter(isValidElement) as ReactElement[],
    [children],
  );
  const progress = useRef(new Animated.Value(page)).current;
  // Init from window width so page 0 renders on the first commit.
  // Previously width started at 0 and rendered null until onLayout,
  // which caused the blank flash on provider drawer open.
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const [visited, setVisited] = useState(() => new Set([page]));

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(page)) return prev;
      const next = new Set(prev);
      next.add(page);
      return next;
    });
  }, [page]);

  useEffect(() => {
    Animated.timing(progress, {
      duration,
      easing: Easing.out(Easing.cubic),
      toValue: page,
      useNativeDriver: true,
    }).start();
  }, [duration, page, progress]);

  const transforms = useMemo(() => {
    if (width <= 0) return [];
    return pages.map((_, index) =>
      Animated.add(index * width, Animated.multiply(progress, -width)),
    );
  }, [pages, progress, width]);

  return (
    <DrawerPagerContext.Provider value={{ page, setPage: onPageChange }}>
      <View
        className={cn("min-h-0 flex-1 overflow-hidden", className)}
        onLayout={(event) => {
          const nextWidth = event.nativeEvent.layout.width;
          setWidth((prev) => (prev === nextWidth ? prev : nextWidth));
        }}
      >
        {width > 0
          ? pages.map((child, index) => {
              // Lazy-mount offscreen pages: skip commit of heavy page 1
              // until it has been visited. Keeps provider drawer open fast.
              if (!visited.has(index) && index !== page) return null;
              return (
                <Animated.View
                  className="absolute inset-0"
                  key={child.key ?? index}
                  pointerEvents={page === index ? "auto" : "none"}
                  style={{
                    transform: [{ translateX: transforms[index] }],
                  }}
                >
                  {child}
                </Animated.View>
              );
            })
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
