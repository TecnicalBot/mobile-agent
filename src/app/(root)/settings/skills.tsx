import { useRouter } from "expo-router";
import { ChevronLeft, Plus, Trash2 } from "lucide-react-native";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { BUILT_IN_FILE_TOOL_CONTROLS } from "@/lib/config/built-in-tools";
import { cn } from "@/lib/utils";
import type { BuiltInToolKey, SkillConfig } from "@/types/app-state";

type Draft = {
  autoMatch: boolean;
  description: string;
  enabled: boolean;
  instructions: string;
  keywordsText: string;
  recommendedBuiltInToolKeys: BuiltInToolKey[];
  recommendedMcpServerIds: string[];
  title: string;
};

const EMPTY_DRAFT: Draft = {
  autoMatch: false,
  description: "",
  enabled: true,
  instructions: "",
  keywordsText: "",
  recommendedBuiltInToolKeys: [],
  recommendedMcpServerIds: [],
  title: "",
};

function parseKeywords(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function draftFromSkill(skill: SkillConfig): Draft {
  return {
    autoMatch: skill.autoMatch,
    description: skill.description ?? "",
    enabled: skill.enabled,
    instructions: skill.instructions,
    keywordsText: skill.matchKeywords.join(", "),
    recommendedBuiltInToolKeys: skill.recommendedBuiltInToolKeys,
    recommendedMcpServerIds: skill.recommendedMcpServerIds,
    title: skill.title,
  };
}

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function toggleToolGroup(values: BuiltInToolKey[], keys: BuiltInToolKey[]) {
  const selected = keys.every((key) => values.includes(key));

  return selected
    ? values.filter((key) => !keys.includes(key))
    : Array.from(new Set([...values, ...keys]));
}

export default function SettingsSkillsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { createSkill, deleteSkill, mcpServers, skills, updateSkill } =
    useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingSkill, setEditingSkill] = useState<SkillConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

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

  const openCreate = () => {
    setEditingSkill(null);
    setDraft(EMPTY_DRAFT);
    setOpen(true);
  };

  const openEdit = (skill: SkillConfig) => {
    setEditingSkill(skill);
    setDraft(draftFromSkill(skill));
    setOpen(true);
  };

  const saveDraft = async () => {
    const title = draft.title.trim();
    const instructions = draft.instructions.trim();

    if (!title || !instructions) {
      throw new Error("Title and instructions are required.");
    }

    const input = {
      autoMatch: draft.autoMatch,
      description: draft.description.trim() || null,
      enabled: draft.enabled,
      instructions,
      matchKeywords: parseKeywords(draft.keywordsText),
      recommendedBuiltInToolKeys: draft.recommendedBuiltInToolKeys,
      recommendedMcpServerIds: draft.recommendedMcpServerIds,
      title,
    };

    if (editingSkill) {
      await updateSkill(editingSkill.id, input);
    } else {
      await createSkill(input);
    }

    setOpen(false);
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
          leftIcon={<Plus color={theme.background} size={16} />}
          onPress={openCreate}
          size="sm"
        >
          Add
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
                onEdit={() => openEdit(skill)}
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

      <Drawer onOpenChange={setOpen} open={open}>
        <DrawerContent showCloseButton>
          <DrawerHeader>
            <DrawerTitle>
              {editingSkill ? "Edit skill" : "Add skill"}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <ScrollView className="gap-sp-3">
              <Field label="Title">
                <Input
                  onChangeText={(title) =>
                    setDraft((current) => ({ ...current, title }))
                  }
                  placeholder="Code reviewer"
                  value={draft.title}
                />
              </Field>
              <Field label="Description">
                <Input
                  onChangeText={(description) =>
                    setDraft((current) => ({ ...current, description }))
                  }
                  placeholder="Review changes with a skeptical eye"
                  value={draft.description}
                />
              </Field>
              <Field label="Instructions">
                <Textarea
                  className="min-h-32 max-h-72"
                  onChangeText={(instructions) =>
                    setDraft((current) => ({ ...current, instructions }))
                  }
                  placeholder="Focus on bugs, regressions, and missing tests."
                  value={draft.instructions}
                />
              </Field>
              <SwitchRow
                checked={draft.enabled}
                label="Enabled"
                onCheckedChange={(enabled) =>
                  setDraft((current) => ({ ...current, enabled }))
                }
              />
              <SwitchRow
                checked={draft.autoMatch}
                label="Auto-match"
                onCheckedChange={(autoMatch) =>
                  setDraft((current) => ({ ...current, autoMatch }))
                }
              />
              <Field label="Keywords">
                <Input
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(keywordsText) =>
                    setDraft((current) => ({ ...current, keywordsText }))
                  }
                  placeholder="review, security, tests"
                  value={draft.keywordsText}
                />
              </Field>
              {mcpServers.length > 0 ? (
                <Field label="Recommended MCP servers">
                  <View className="gap-sp-2">
                    {mcpServers.map((server) => (
                      <SelectRow
                        key={server.id}
                        checked={draft.recommendedMcpServerIds.includes(
                          server.id,
                        )}
                        label={server.label}
                        onPress={() =>
                          setDraft((current) => ({
                            ...current,
                            recommendedMcpServerIds: toggleValue(
                              current.recommendedMcpServerIds,
                              server.id,
                            ),
                          }))
                        }
                        subtitle={server.enabled ? "Enabled" : "Disabled"}
                      />
                    ))}
                  </View>
                </Field>
              ) : null}
              <Field label="Recommended built-in tools">
                <View className="gap-sp-2">
                  {BUILT_IN_FILE_TOOL_CONTROLS.map((control) => (
                    <SelectRow
                      key={control.label}
                      checked={control.keys.every((key) =>
                        draft.recommendedBuiltInToolKeys.includes(key),
                      )}
                      label={control.label}
                      onPress={() =>
                        setDraft((current) => ({
                          ...current,
                          recommendedBuiltInToolKeys: toggleToolGroup(
                            current.recommendedBuiltInToolKeys,
                            control.keys,
                          ),
                        }))
                      }
                    />
                  ))}
                </View>
              </Field>
            </ScrollView>
          </DrawerBody>
          <DrawerFooter>
            <Button
              loading={busyKey === "save"}
              onPress={() => {
                runAction("save", saveDraft).catch(console.error);
              }}
            >
              Save
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Container>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View className="gap-sp-2">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      {children}
    </View>
  );
}

function SkillRow({
  busyKey,
  onDelete,
  onEdit,
  onToggle,
  skill,
}: {
  busyKey: string | null;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  skill: SkillConfig;
}) {
  const theme = useTheme();

  return (
    <View className="gap-sp-3 px-sp-4 py-sp-4">
      <Pressable
        accessibilityRole="button"
        className="flex-row items-start gap-sp-3"
        onPress={onEdit}
        style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
      >
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center gap-sp-2">
            <Text className="min-w-0 flex-1 font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
              {skill.title}
            </Text>
            {skill.autoMatch ? <StatusPill text="Auto" /> : null}
          </View>
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

function SelectRow({
  checked,
  label,
  onPress,
  subtitle,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
  subtitle?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      className={cn(
        "min-h-12 flex-row items-center justify-between gap-sp-3 rounded-ui border px-sp-3 py-sp-2",
        checked
          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark",
      )}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
    >
      <View className="min-w-0 flex-1">
        <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
          {label}
        </Text>
        {subtitle ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View pointerEvents="none">
        <Checkbox checked={checked} onCheckedChange={() => {}} />
      </View>
    </Pressable>
  );
}

function SwitchRow({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      className="min-h-12 flex-row items-center justify-between gap-sp-3"
      onPress={() => onCheckedChange(!checked)}
      style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
    >
      <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      <View pointerEvents="none">
        <Checkbox checked={checked} onCheckedChange={() => {}} />
      </View>
    </Pressable>
  );
}

function StatusPill({ text }: { text: string }) {
  return (
    <View className="rounded-ui border border-border bg-secondary px-sp-2 py-1 dark:border-border-dark dark:bg-secondary-dark">
      <Text className="font-sans text-xs text-foreground dark:text-foreground-dark">
        {text}
      </Text>
    </View>
  );
}
