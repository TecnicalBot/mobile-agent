import { useRouter } from "expo-router";
import { ChevronLeft, Search } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { listInstalledApps, type InstalledApp } from "device-automation";

function togglePackage(packages: string[], packageName: string) {
  return packages.includes(packageName)
    ? packages.filter((name) => name !== packageName)
    : [...packages, packageName];
}

export default function SettingsProtectedAppsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { protectedApps, updateProtectedApps } = useConfig();
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    listInstalledApps()
      .then((installed) => {
        if (!active) return;
        setApps(installed);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : "Failed to load apps.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredApps = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = apps;
    if (!needle) return list;
    return list.filter(
      (app) =>
        app.label.toLowerCase().includes(needle) ||
        app.packageName.toLowerCase().includes(needle),
    );
  }, [apps, query]);

  const protectedCount = protectedApps.length;

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.push("/settings/tools/device" as never)}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Protected apps
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Do-not-touch list · {protectedCount} protected
          </Text>
        </View>
      </View>

      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        The agent will refuse to read, control, open, or screenshot any app on
        this list. Back / Home navigation stays available so it can always leave
        a protected app.
      </Text>

      <View className="flex-row items-center gap-sp-2">
        <Search color={theme.textSecondary} size={16} />
        <Input
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={setQuery}
          placeholder="Search apps"
          value={query}
        />
      </View>

      {loading ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Loading installed apps…
        </Text>
      ) : loadError ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {loadError}
        </Text>
      ) : filteredApps.length === 0 ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {query
            ? `No apps match "${query}".`
            : "No launchable apps were found."}
        </Text>
      ) : (
        <Card className="overflow-hidden">
          {filteredApps.map((app, index) => {
            const checked = protectedApps.includes(app.packageName);
            return (
              <View key={app.packageName}>
                {index > 0 ? (
                  <View className="h-px bg-border dark:bg-border-dark" />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
                  onPress={() => {
                    updateProtectedApps(
                      togglePackage(protectedApps, app.packageName),
                    ).catch(console.error);
                  }}
                  style={({ pressed }) => (pressed ? { opacity: 0.86 } : null)}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                      {app.label}
                    </Text>
                    <Text
                      className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                      numberOfLines={1}
                    >
                      {app.packageName}
                    </Text>
                  </View>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => {
                      updateProtectedApps(
                        togglePackage(protectedApps, app.packageName),
                      ).catch(console.error);
                    }}
                  />
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}
    </Container>
  );
}
