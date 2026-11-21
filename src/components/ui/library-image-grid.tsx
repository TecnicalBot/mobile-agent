import { FlashList, useRecyclingState } from "@shopify/flash-list";
import { Image } from "expo-image";
import { ImageOff } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import type { LibraryFile } from "@/modules/files/library-catalog";
import { useTheme } from "@/hooks/use-theme";
import { useWorkspaceThumbnail } from "@/hooks/use-workspace-thumbnail";

const FALLBACK_BLURHASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

type GalleryProps = {
  files: LibraryFile[];
  onOpen: (file: LibraryFile) => void;
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
      keyboardShouldPersistTaps="handled"
    />
  );
}

function ImageTile({ file, index, gallery }: { file: LibraryFile; index: number; gallery: GalleryProps }) {
  return <LoadedImageTile key={`${file.id}:${file.updatedAt}`} file={file} index={index} gallery={gallery} />;
}

function LoadedImageTile({ file, index, gallery }: { file: LibraryFile; index: number; gallery: GalleryProps }) {
  const theme = useTheme();
  const uri = file.uri;
  const cacheKey = `${file.id}:${file.updatedAt}`;
  // One bounded decode for both aspect ratio and display. The old path
  // decoded a 96px image for measurement, then loaded the original again.
  const thumbnail = useWorkspaceThumbnail(uri, 512);
  const [failed, setFailed] = useRecyclingState(false, [cacheKey]);

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
          source={thumbnail}
          autoplay={false}
          placeholder={{ blurhash: FALLBACK_BLURHASH }}
          placeholderContentFit="cover"
          contentFit="cover"
          cachePolicy="disk"
          recyclingKey={cacheKey}
          transition={250}
          // The bounded decode is async, so `thumbnail` is null on the first
          // frames and `source` resolves to an empty list — expo-image reports
          // that as an error, but it is the placeholder window, not a broken
          // file. Only latch a failure once a real ref is being displayed, and
          // clear it again if a later load for this row succeeds.
          onError={() => {
            if (thumbnail) setFailed(true);
          }}
          onLoad={() => setFailed(false)}
          style={{ width: "100%", aspectRatio: thumbnail && thumbnail.height > 0 ? thumbnail.width / thumbnail.height : (index % 3 === 0 ? 0.75 : index % 3 === 1 ? 1.2 : 1) }}
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
