import { Redirect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  ChevronLeft,
  Copy,
  FileDown,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { SkillImportDrawer } from "@/components/skills/skill-import-drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useAppState } from "@/hooks/use-app-state";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import type { SkillConfig } from "@/core/types/app-state";

export default function ConnectedSkillsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { ready } = useAppState();
  const { deleteSkill, exportSkillMarkdown, skills, syncAllSkills, syncSkill, updateSkill } =
    useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const enabledSkills = useMemo(
    () => skills.filter((skill) => skill.enabled).length,
    [skills],
  );
  const syncableSkills = useMemo(
    () => skills.filter((skill) => skill.source?.url),
    [skills],
  );

  if (ready && skills.length === 0) {
    return <Redirect href={"/settings/skills/list" as never} />;
  }

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    setNotice(null);

    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Skill action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const syncOne = (skill: SkillConfig) => {
    Alert.alert(
      "Sync skill?",
      `Download the latest version of "${skill.title}" from its source. Local edits to its instructions will be replaced.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sync",
          onPress: () =>
            runAction(`sync:${skill.id}`, async () => {
              const result = await syncSkill(skill.id);

              if (result.error) {
                throw new Error(result.error);
              }

              setNotice(
                result.updated
                  ? `Updated "${result.title}".`
                  : `"${result.title}" is already up to date.`,
              );
            }),
        },
      ],
    );
  };

  const syncAll = () => {
    if (syncableSkills.length === 0) {
      return;
    }

    Alert.alert(
      "Sync all skills?",
      `Check ${syncableSkills.length} imported ${
        syncableSkills.length === 1 ? "skill" : "skills"
      } for updates. Local edits to their instructions will be replaced.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sync all",
          onPress: () =>
            runAction("sync-all", async () => {
              const results = await syncAllSkills();
              const failed = results.filter((result) => result.error);
              const updated = results.filter((result) => result.updated).length;
              const upToDate = results.length - updated - failed.length;

              setNotice(
                `Synced ${results.length} ${
                  results.length === 1 ? "skill" : "skills"
                }: ${updated} updated, ${upToDate} up to date${
                  failed.length > 0 ? `, ${failed.length} failed` : ""
                }.`,
              );

              if (failed.length > 0) {
                setError(
                  failed
                    .map((result) => `${result.title}: ${result.error}`)
                    .join("\n"),
                );
              }
            }),
        },
      ],
    );
  };

  const copySkillMarkdown = async (skillId: string) => {
    const markdown = exportSkillMarkdown(skillId);
    await Clipboard.setStringAsync(markdown);
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
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {enabledSkills} active
          </Text>
        </View>
        <Button
          leftIcon={<FileDown color={theme.text} size={16} />}
          onPress={() => setImportOpen(true)}
          size="sm"
          variant="outline"
        >
          Import
        </Button>
      </View>

      {!ready ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Loading skills…
          </Text>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            {skills.map((skill, index) => (
              <View key={skill.id}>
                <SkillRow
                  busyKey={busyKey}
                  onDelete={() =>
                    runAction(`delete:${skill.id}`, async () => {
                      await deleteSkill(skill.id);
                    })
                  }
                  onExport={() =>
                    runAction(`export:${skill.id}`, () =>
                      copySkillMarkdown(skill.id),
                    )
                  }
                  onOpen={() =>
                    router.push(`/settings/skills/${skill.id}` as never)
                  }
                  onSync={
                    skill.source?.url ? () => syncOne(skill) : undefined
                  }
                  onToggle={(enabled) =>
                    runAction(`toggle:${skill.id}`, async () => {
                      await updateSkill(skill.id, { enabled });
                    })
                  }
                  skill={skill}
                />
                {index < skills.length - 1 ? <Separator /> : null}
              </View>
            ))}
          </Card>
          <View className="flex-row flex-wrap gap-sp-2">
            <Button
              className="flex-1"
              leftIcon={<Plus color={theme.text} size={16} />}
              onPress={() => router.push("/settings/skills/list" as never)}
              variant="outline"
            >
              Add more
            </Button>
            {syncableSkills.length > 0 ? (
              <Button
                className="flex-1"
                leftIcon={<RefreshCw color={theme.text} size={16} />}
                loading={busyKey === "sync-all"}
                onPress={syncAll}
                variant="outline"
              >
                Sync all
              </Button>
            ) : null}
          </View>
        </>
      )}

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

function SkillRow({
  busyKey,
  onDelete,
  onExport,
  onOpen,
  onSync,
  onToggle,
  skill,
}: {
  busyKey: string | null;
  onDelete: () => void;
  onExport: () => void;
  onOpen: () => void;
  onSync?: () => void;
  onToggle: (enabled: boolean) => void;
  skill: SkillConfig;
}) {
  const theme = useTheme();

  return (
    <View className="gap-sp-3 px-sp-4 py-sp-4">
      <Pressable
        accessibilityRole="button"
        className="flex-row items-start gap-sp-3"
        onPress={onOpen}
        style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
      >
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
            {skill.title}
          </Text>
          {skill.description ? (
            <Text
              className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
              numberOfLines={2}
            >
              {skill.description}
            </Text>
          ) : null}
          {skill.matchKeywords.length > 0 ? (
            <Text
              className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
              numberOfLines={1}
            >
              {skill.matchKeywords.join(", ")}
            </Text>
          ) : null}
          {skill.source?.url ? (
            <Text
              className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
              numberOfLines={1}
            >
              Imported from {sourceLabel(skill.source.url)}
            </Text>
          ) : null}
        </View>
        <View pointerEvents="none">
          <Checkbox checked={skill.enabled} onCheckedChange={() => {}} />
        </View>
      </Pressable>
      <View className="flex-row flex-wrap gap-sp-2">
        <Button
          disabled={busyKey === `toggle:${skill.id}`}
          onPress={() => onToggle(!skill.enabled)}
          size="sm"
          variant="outline"
        >
          {skill.enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          leftIcon={<Copy color={theme.text} size={14} />}
          loading={busyKey === `export:${skill.id}`}
          onPress={onExport}
          size="sm"
          variant="ghost"
        >
          Copy
        </Button>
        {onSync ? (
          <Button
            leftIcon={<RefreshCw color={theme.text} size={14} />}
            loading={busyKey === `sync:${skill.id}`}
            onPress={onSync}
            size="sm"
            variant="ghost"
          >
            Sync
          </Button>
        ) : null}
        <Button
          leftIcon={<Trash2 color={theme.destructive} size={14} />}
          loading={busyKey === `delete:${skill.id}`}
          onPress={onDelete}
          size="sm"
          variant="ghost"
        >
          Delete
        </Button>
      </View>
    </View>
  );
}

/** Show a compact source instead of the full URL in the skill row. */
function sourceLabel(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}
