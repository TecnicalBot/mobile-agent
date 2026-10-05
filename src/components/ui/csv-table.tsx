import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

export function CsvTableLoading() {
  const theme = useTheme();
  return (
    <View accessibilityLabel="Loading spreadsheet" accessibilityState={{ busy: true }} className="overflow-hidden">
      <View className="flex-row items-center gap-3 px-sp-4 py-3" style={{ borderBottomWidth: 1, borderColor: theme.border }}>
        <ActivityIndicator color={theme.textSecondary} size="small" />
        <Text className="font-sans text-sm" style={{ color: theme.textSecondary }}>Loading spreadsheet…</Text>
      </View>
      <View style={{ height: 336 }}>
        {Array.from({ length: 12 }, (_, row) => (
          <View key={row} className="flex-row" style={{ opacity: Math.max(0.15, 1 - row * 0.07) }}>
            {Array.from({ length: 3 }, (_, column) => (
              <View key={column} style={{ width: 160, height: 42, justifyContent: "center", paddingHorizontal: 10, borderBottomWidth: 1, borderRightWidth: 1, borderColor: theme.border, backgroundColor: row === 0 ? theme.backgroundSelected : undefined }}>
                <View style={{ height: 9, width: 55 + ((row + column) % 3) * 25, borderRadius: 4, backgroundColor: theme.border }} />
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Simple fixed-column spreadsheet table. Columns use a fixed width so every
 * row aligns into a true grid; long cells wrap.
 */
export function CsvTable({ rows }: { rows: string[][] }) {
  const theme = useTheme();

  if (rows.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-sp-5">
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          This file is empty.
        </Text>
      </View>
    );
  }

  const columnCount = rows.reduce(
    (max, row) => Math.max(max, row.length),
    0,
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <ScrollView showsVerticalScrollIndicator>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: "row" }}>
            {Array.from({ length: columnCount }, (_, columnIndex) => (
              <View
                key={columnIndex}
                style={{
                  borderBottomWidth: 1,
                  borderColor: theme.border,
                  borderRightWidth: columnIndex < columnCount - 1 ? 1 : 0,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  width: 160,
                }}
              >
                <Text
                  style={{
                    color: theme.text,
                    fontFamily: rowIndex === 0 ? undefined : "monospace",
                    fontSize: 12,
                    fontWeight: rowIndex === 0 ? "600" : "400",
                  }}
                >
                  {row[columnIndex] ?? ""}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </ScrollView>
  );
}
