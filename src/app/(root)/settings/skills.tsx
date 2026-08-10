import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ChevronLeft, Copy, FileDown, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { SkillImportDrawer } from "@/components/skills/skill-import-drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import type { SkillConfig } from "@/core/types/app-state";

export default function SettingsSkillsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { deleteSkill, exportSkillMarkdown, skills, updateSkill } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const enabledSkills = useMemo(
    () => skills.filter((skill) => skill.enabled).length,
    [skills],
  );

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);

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
          onPress={() => {
            router.push("/settings");
          }}
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

      {skills.length === 0 ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No skills configured.
          </Text>
        </Card>
      ) : (
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
                onOpen={() => router.push(`/settings/skills/${skill.id}` as never)}
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
      )}

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
  onToggle,
  skill,
}: {
  busyKey: string | null;
  onDelete: () => void;
  onExport: () => void;
  onOpen: () => void;
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
