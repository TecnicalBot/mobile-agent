import { useRouter } from "expo-router";
import { ChevronLeft, Plus } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { SkillImportDrawer } from "@/components/skills/skill-import-drawer";
import { SearchBox } from "@/components/shared/search-box";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import type { SkillConfig } from "@/core/types/app-state";
import {
  fetchSkillCatalogCached,
  type SkillCatalogEntry,
} from "@/modules/skills/catalog";

export default function SkillCatalogScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { importSkillMarkdown, skills, syncSkill } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [entries, setEntries] = useState<SkillCatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (!needle) return entries;

    return entries.filter(
      (entry) =>
        entry.label.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  useEffect(() => {
    const controller = new AbortController();

    setCatalogLoading(true);
    setCatalogError(null);

    fetchSkillCatalogCached(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setEntries(result.entries);
      })
      .catch((catalogLoadError) => {
        if (controller.signal.aborted) return;
        setCatalogError(
          catalogLoadError instanceof Error
            ? catalogLoadError.message
            : "Could not load skills.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });

    return () => controller.abort();
  }, []);

  const installEntry = async (entry: SkillCatalogEntry) => {
    setBusyKey(entry.id);
    setError(null);
    setNotice(null);

    try {
      const { fetchSkillMarkdownFromUrl } = await import(
        "@/modules/skills/skill-github"
      );
      const { content } = await fetchSkillMarkdownFromUrl(entry.url);
      const existing = skills.find(
        (skill) => skill.title.toLowerCase() === entry.label.toLowerCase(),
      );

      await importSkillMarkdown({
        markdown: content,
        replaceById: existing?.id ?? null,
        sourceUrl: entry.url,
        extraFiles: entry.extraFiles,
      });
    } catch (installError) {
      setError(
        installError instanceof Error
          ? installError.message
          : "Could not install the skill.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const updateEntry = async (
    entry: SkillCatalogEntry,
    skill: SkillConfig,
  ) => {
    setBusyKey(entry.id);
    setError(null);
    setNotice(null);

    try {
      const result = await syncSkill(skill.id);

      if (result.error) {
        throw new Error(result.error);
      }

      setNotice(
        result.updated
          ? `Updated "${result.title}".`
          : `"${result.title}" is already up to date.`,
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not update the skill.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.back()}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Skills
          </Text>
        </View>
        <Button
          className="ml-auto"
          leftIcon={<Plus color={theme.text} size={16} />}
          onPress={() => setImportOpen(true)}
          size="sm"
          variant="outline"
        >
          Add custom
        </Button>
      </View>

      {entries.length > 0 ? (
        <>
          <SearchBox
            onChangeText={setQuery}
            placeholder="Search skills"
            value={query}
          />
          {filteredEntries.length > 0 ? (
            <Card className="overflow-hidden">
              {filteredEntries.map((entry, index) => {
                const installedSkill = skills.find(
                  (skill) =>
                    skill.title.toLowerCase() === entry.label.toLowerCase(),
                );
                const installed = Boolean(installedSkill);
                const canUpdate = installedSkill?.source?.url
                  ? installedSkill
                  : null;

                return (
                  <View key={entry.id}>
                    {index > 0 ? <Separator /> : null}
                    <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-4">
                      <View className="min-w-0 flex-1 gap-1">
                        <View className="flex-row items-center gap-sp-2">
                          <Text
                            className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark"
                            numberOfLines={1}
                          >
                            {entry.label}
                          </Text>
                          {entry.source ? (
                            <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                              {entry.source}
                            </Text>
                          ) : null}
                        </View>
                        <Text
                          className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                          numberOfLines={3}
                        >
                          {entry.description}
                        </Text>
                      </View>
                      <Button
                        disabled={installed && !canUpdate}
                        loading={busyKey === entry.id}
                        onPress={() =>
                          canUpdate
                            ? updateEntry(entry, canUpdate).catch(console.error)
                            : installEntry(entry).catch(console.error)
                        }
                        size="sm"
                        variant={installed && !canUpdate ? "secondary" : "outline"}
                      >
                        {canUpdate ? "Update" : installed ? "Added" : "Install"}
                      </Button>
                    </View>
                  </View>
                );
              })}
            </Card>
          ) : (
            <Card className="px-sp-4 py-sp-4">
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                {`No skills match "${query}".`}
              </Text>
            </Card>
          )}
        </>
      ) : catalogLoading ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Loading skills…
          </Text>
        </Card>
      ) : (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No skills found. Use Add custom above to import your own.
          </Text>
        </Card>
      )}

      {catalogError ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {catalogError}
        </Text>
      ) : null}
      {notice ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <SkillImportDrawer onOpenChange={setImportOpen} open={importOpen} />
    </Container>
  );
}
