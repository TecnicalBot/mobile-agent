import { FlashList, useRecyclingState } from "@shopify/flash-list";
import { Image } from "expo-image";
import { ImageOff } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import type { WorkspaceFile } from "@/core/types/app-state";
import { useTheme } from "@/hooks/use-theme";

const FALLBACK_BLURHASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
type Thumbnail = { aspectRatio: number };
const thumbnails = new Map<string, Promise<Thumbnail>>();

function loadThumbnail(uri: string, cacheKey: string): Promise<Thumbnail> {
  const cached = thumbnails.get(cacheKey);
  if (cached) return cached;
  const pending = Image.loadAsync(uri, { maxWidth: 96, maxHeight: 96 })
    .then((image) => ({
      aspectRatio: image.width > 0 && image.height > 0 ? image.width / image.height : 1,
    }))
    .catch(() => ({ aspectRatio: 1 }));
  if (thumbnails.size >= 256) thumbnails.delete(thumbnails.keys().next().value!);
  thumbnails.set(cacheKey, pending);
  return pending;
}

type GalleryProps = {
  files: WorkspaceFile[];
  onOpen: (file: WorkspaceFile) => void;
};

export function LibraryImageGrid(props: GalleryProps) {
  return (
    <FlashList
      data={props.files}
      masonry
      numColumns={2}
      drawDistance={300}
      keyExtractor={(file) => file.id}
      contentContainerStyle={{ paddingBottom: 16 }}
      renderItem={({ item, index }) => <ImageTile file={item} index={index} gallery={props} />}
      showsVerticalScrollIndicator={false}
    />
  );
}

function ImageTile({ file, index, gallery }: { file: WorkspaceFile; index: number; gallery: GalleryProps }) {
  const theme = useTheme();
  const uri = resolveWorkspaceFile(file.relativePath).uri;
  const cacheKey = `${file.id}:${file.updatedAt}`;
  const [thumbnail, setThumbnail] = useRecyclingState<Thumbnail | null>(null, [cacheKey]);
  const [failed, setFailed] = useRecyclingState(false, [cacheKey]);

  useEffect(() => {
    let cancelled = false;
    void loadThumbnail(uri, cacheKey).then((result) => {
      if (!cancelled) setThumbnail(result);
    });
    return () => { cancelled = true; };
  }, [cacheKey, uri, setThumbnail]);

  return (
    <View style={{ paddingHorizontal: 5, paddingBottom: 14 }}>
      <Pressable
        accessibilityLabel={`Preview ${file.displayName}`}
        accessibilityRole="button"
        onPress={() => gallery.onOpen(file)}
        className="overflow-hidden rounded-2xl bg-secondary dark:bg-secondary-dark"
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <Image
          source={{ uri }}
          placeholder={{ blurhash: FALLBACK_BLURHASH }}
          placeholderContentFit="cover"
          contentFit="cover"
          cachePolicy="disk"
          recyclingKey={cacheKey}
          transition={250}
          onError={() => setFailed(true)}
          style={{ width: "100%", aspectRatio: thumbnail?.aspectRatio ?? (index % 3 === 0 ? 0.75 : index % 3 === 1 ? 1.2 : 1) }}
        />
        {failed ? (
          <View className="absolute inset-0 items-center justify-center gap-2 bg-secondary dark:bg-secondary-dark">
            <ImageOff color={theme.textSecondary} size={24} />
            <Text className="font-sans text-xs" style={{ color: theme.textSecondary }}>Image unavailable</Text>
          </View>
        ) : null}
        <View pointerEvents="none" className="absolute inset-x-0 bottom-0" style={{ height: 72 }}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="captionShade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000" stopOpacity={0} />
                <Stop offset="1" stopColor="#000" stopOpacity={0.7} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#captionShade)" />
          </Svg>
        </View>
        <Text
          pointerEvents="none"
          numberOfLines={1}
          className="absolute inset-x-0 bottom-0 px-3 pb-3 font-sans text-xs font-semibold"
          style={{ color: "#fff", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } }}
        >
          {file.displayName}
        </Text>
      </Pressable>
    </View>
  );
}
