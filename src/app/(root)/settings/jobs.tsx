import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { Directory } from "expo-file-system";
import { TextInputWrapper } from "expo-paste-input";
import { useRouter } from "expo-router";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

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
import { DrawerPager, DrawerPagerPage } from "@/components/ui/drawer-pager";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  ExternalFolderSession,
  Schedule,
  ScheduleFrequency,
} from "@/core/types/app-state";
import { parseModelRef } from "@/core/types/app-state";
import { isFolderPickerCancellation } from "@/core/services/external-folder/external-folder-service";
import { cn } from "@/core/utils";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  buildScheduleExpression,
  describeExpression,
} from "@/modules/scheduler";
import {
  hasExactAlarmPermission,
  openExactAlarmSettings,
} from "scheduler-alarm";

const FREQUENCIES: { label: string; value: ScheduleFrequency }[] = [
  { label: "Hourly", value: "hourly" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Custom", value: "custom" },
];

const FREQUENCY_DESCRIPTIONS: Record<ScheduleFrequency, string> = {
  hourly: "Runs at the top of every hour",
  daily: "Runs once a day at a set time",
  weekly: "Runs on the days you pick",
  monthly: "Runs on a set day each month",
  custom: "Build your own interval or cron",
};

const WEEKDAYS = [
  { cron: 1, label: "M", name: "monday", title: "Monday" },
  { cron: 2, label: "T", name: "tuesday", title: "Tuesday" },
  { cron: 3, label: "W", name: "wednesday", title: "Wednesday" },
  { cron: 4, label: "T", name: "thursday", title: "Thursday" },
  { cron: 5, label: "F", name: "friday", title: "Friday" },
  { cron: 6, label: "S", name: "saturday", title: "Saturday" },
  { cron: 0, label: "S", name: "sunday", title: "Sunday" },
] as const;

type CustomIntervalUnit = "minutes" | "hours";

const MIN_PROMPT_HEIGHT = 76;
const MAX_PROMPT_HEIGHT = 160;

export default function SettingsJobsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = useTheme();
  const {
    activeModels,
    createSchedule,
    currentModel,
    deleteSchedule,
    schedules,
    schedulingEnabled,
    updateSchedule,
    updateSchedulingEnabled,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPage, setEditorPage] = useState(0);
  const [exactAlarmGranted, setExactAlarmGranted] = useState<boolean | null>(
    null,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [frequency, setFrequency] = useState<ScheduleFrequency>("daily");
  const [time, setTime] = useState("09:00");
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [weekdays, setWeekdays] = useState<boolean[]>([
    true,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [customExpression, setCustomExpression] = useState("0 9 * * *");
  const [customAdvanced, setCustomAdvanced] = useState(false);
  const [customInterval, setCustomInterval] = useState("2");
  const [customIntervalUnit, setCustomIntervalUnit] =
    useState<CustomIntervalUnit>("hours");
  const [customWeekdays, setCustomWeekdays] = useState<boolean[]>(
    WEEKDAYS.map(() => true),
  );
  const [autoApprove, setAutoApprove] = useState(true);
  const [folderSession, setFolderSession] =
    useState<ExternalFolderSession | null>(null);
  const [promptContentHeight, setPromptContentHeight] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  const promptHeight = Math.min(
    MAX_PROMPT_HEIGHT,
    Math.max(MIN_PROMPT_HEIGHT, promptContentHeight),
  );
  const promptScrollEnabled = promptContentHeight > MAX_PROMPT_HEIGHT;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    hasExactAlarmPermission()
      .then(setExactAlarmGranted)
      .catch(() => {});
  }, [schedulingEnabled]);

  const targetRef = useMemo(() => {
    if (currentModel?.ref) return currentModel.ref;
    return activeModels[0]?.ref ?? null;
  }, [activeModels, currentModel]);

  const sorted = useMemo(
    () =>
      [...schedules].sort(
        (a, b) =>
          Number(Boolean(b.enabled)) - Number(Boolean(a.enabled)) ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [schedules],
  );

  const openCreate = () => {
    setEditingId(null);
    setTitle("");
    setPrompt("");
    setFrequency("daily");
    setTime("09:00");
    setShowTimePicker(false);
    setWeekdays([true, false, false, false, false, false, false]);
    setDayOfMonth("1");
    setCustomExpression("0 9 * * *");
    setCustomAdvanced(false);
    setCustomInterval("2");
    setCustomIntervalUnit("hours");
    setCustomWeekdays(WEEKDAYS.map(() => true));
    setAutoApprove(true);
    setFolderSession(null);
    setPromptContentHeight(0);
    setFormError(null);
    setEditorPage(0);
    setEditorOpen(true);
  };

  const openEdit = (schedule: Schedule) => {
    const detectedFrequency = detectFrequency(schedule.expression);
    const interval = extractCustomInterval(schedule.expression);

    setEditingId(schedule.id);
    setTitle(schedule.title);
    setPrompt(schedule.prompt);
    setFrequency(detectedFrequency);
    setTime(extractTime(schedule.expression));
    setShowTimePicker(false);
    setWeekdays(extractWeekdays(schedule.expression));
    setDayOfMonth(extractDayOfMonth(schedule.expression));
    setCustomExpression(schedule.expression);
    setCustomAdvanced(detectedFrequency === "custom" && interval === null);
    setCustomInterval(interval?.interval ?? "2");
    setCustomIntervalUnit(interval?.unit ?? "hours");
    setCustomWeekdays(extractWeekdays(schedule.expression, true));
    setAutoApprove(schedule.autoApprove);
    setFolderSession(schedule.externalFolderSession);
    setPromptContentHeight(0);
    setFormError(null);
    setEditorPage(0);
    setEditorOpen(true);
  };

  const pickFolder = async () => {
    try {
      setFormError(null);
      const directory = await Directory.pickDirectoryAsync(
        folderSession?.uri ?? undefined,
      );
      setFolderSession({
        uri: directory.uri,
        displayName: directory.name || "Selected folder",
        platform: "android",
        sourceType: "external-folder",
        grantedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (isFolderPickerCancellation(error)) {
        return;
      }
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await action();
    } finally {
      setBusyKey(null);
    }
  };

  const syncCustomExpression = (
    interval: string,
    unit: CustomIntervalUnit,
    weekdays: boolean[],
  ) => {
    try {
      setCustomExpression(
        buildCustomIntervalExpression({ interval, unit, weekdays }),
      );
    } catch {
      // Keep the existing expression until the guided values are valid.
    }
  };

  const save = async () => {
    if (!targetRef) {
      setFormError("No active model is available. Enable a provider first.");
      return;
    }

    if (!title.trim()) {
      setFormError("Give the job a title.");
      return;
    }

    if (!prompt.trim()) {
      setFormError("Describe what the agent should do.");
      return;
    }

    let expression: string;

    try {
      expression = buildScheduleExpression({
        frequency,
        time,
        weekdays: WEEKDAYS.filter((_, index) => weekdays[index]).map(
          (day) => day.name,
        ),
        dayOfMonth: Number(dayOfMonth),
        customExpression:
          frequency === "custom" && !customAdvanced
            ? buildCustomIntervalExpression({
                interval: customInterval,
                unit: customIntervalUnit,
                weekdays: customWeekdays,
              })
            : customExpression,
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
      return;
    }

    const { providerId, modelId } = parseModelRef(targetRef);

    try {
      if (editingId) {
        await updateSchedule(editingId, {
          autoApprove,
          expression,
          externalFolderSession: folderSession,
          prompt: prompt.trim(),
          title: title.trim(),
        });
      } else {
        await createSchedule({
          autoApprove,
          expression,
          externalFolderSession: folderSession,
          modelId,
          prompt: prompt.trim(),
          providerId,
          title: title.trim(),
        });
      }
      setEditorOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleEnabled = (schedule: Schedule) => {
    runAction(`enabled:${schedule.id}`, async () => {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
    }).catch(console.error);
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
          onPress={() => router.push("/settings")}
          size="icon-xs"
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Jobs
          </Text>
        </View>
      </View>

      <Card className="overflow-hidden">
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: schedulingEnabled }}
          className="min-h-14 flex-row items-center justify-between gap-sp-3 px-sp-4 py-sp-3"
          disabled={busyKey !== null}
          onPress={() => {
            runAction("scheduling-enabled", async () => {
              await updateSchedulingEnabled(!schedulingEnabled);
            }).catch(console.error);
          }}
          style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
        >
          <View className="min-w-0 flex-1">
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Jobs
            </Text>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Run the agent automatically on a schedule.
            </Text>
          </View>
          <View pointerEvents="none">
            <Checkbox checked={schedulingEnabled} onCheckedChange={() => {}} />
          </View>
        </Pressable>
      </Card>

      {schedulingEnabled &&
      Platform.OS === "android" &&
      exactAlarmGranted === false ? (
        <Card className="gap-sp-3 px-sp-4 py-sp-4">
          <View className="gap-1">
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Exact alarm permission
            </Text>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Android 12+ requires this for jobs to fire on time. Without it the
              agent falls back to approximate timing.
            </Text>
          </View>
          <Button
            onPress={() => {
              openExactAlarmSettings().catch(console.error);
            }}
            variant="outline"
          >
            Allow
          </Button>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        {sorted.length === 0 ? (
          <Text className="px-sp-4 py-sp-4 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No jobs yet. Ask the agent to “run this every day at 9am”, or create
            one manually.
          </Text>
        ) : (
          sorted.map((schedule, index) => (
            <View key={schedule.id}>
              {index > 0 ? (
                <View className="border-t border-border dark:border-border-dark" />
              ) : null}
              <View
                className={cn(
                  "px-sp-4 py-sp-3",
                  (!schedulingEnabled || !schedule.enabled) && "opacity-50",
                )}
              >
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{
                    checked: schedule.enabled,
                    disabled: !schedulingEnabled,
                  }}
                  disabled={!schedulingEnabled}
                  onPress={() => toggleEnabled(schedule)}
                  style={({ pressed }) =>
                    pressed && schedulingEnabled ? { opacity: 0.84 } : null
                  }
                >
                  <View className="flex-row items-center gap-sp-3">
                    <View className="min-w-0 flex-1">
                      <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
                        {schedule.title}
                      </Text>
                      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        {describeExpression(schedule.expression)}
                      </Text>
                      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        {schedule.nextRunAt
                          ? `Next: ${new Date(schedule.nextRunAt).toLocaleString()}`
                          : "No upcoming run"}
                      </Text>
                    </View>
                    <View pointerEvents="none">
                      <Checkbox
                        checked={schedule.enabled}
                        disabled={!schedulingEnabled}
                        onCheckedChange={() => {}}
                      />
                    </View>
                  </View>
                </Pressable>
                <View className="mt-sp-2 flex-row gap-sp-2">
                  <Button
                    disabled={!schedulingEnabled}
                    leftIcon={<Pencil color={theme.text} size={14} />}
                    onPress={() => openEdit(schedule)}
                    size="sm"
                    variant="outline"
                  >
                    Edit
                  </Button>
                  <Button
                    disabled={!schedulingEnabled}
                    leftIcon={<Trash2 color={theme.destructive} size={14} />}
                    loading={busyKey === `delete:${schedule.id}`}
                    onPress={() => {
                      runAction(`delete:${schedule.id}`, async () => {
                        await deleteSchedule(schedule.id);
                      }).catch(console.error);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    Delete
                  </Button>
                </View>
              </View>
            </View>
          ))
        )}
      </Card>

      <Button
        leftIcon={<Plus color={theme.text} size={16} />}
        onPress={openCreate}
        variant="outline"
      >
        New job
      </Button>

      <Drawer
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditorPage(0);
        }}
        open={editorOpen}
      >
        <DrawerContent contentClassName="overflow-hidden" showCloseButton>
          <DrawerPager onPageChange={setEditorPage} page={editorPage}>
            <DrawerPagerPage>
              <DrawerHeader>
                <DrawerTitle>{editingId ? "Edit job" : "New job"}</DrawerTitle>
              </DrawerHeader>
              <DrawerBody contentContainerClassName="gap-sp-3">
                <View className="gap-sp-1">
                  <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                    Title
                  </Text>
                  <Input
                    disabled={busyKey !== null}
                    onChangeText={setTitle}
                    placeholder="Daily standup"
                    value={title}
                  />
                </View>
                <View className="gap-sp-1">
                  <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                    Prompt
                  </Text>
                  <TextInputWrapper style={{ height: promptHeight }}>
                    <Textarea
                      className="min-h-0"
                      disabled={busyKey !== null}
                      onChangeText={setPrompt}
                      onContentSizeChange={(event) => {
                        setPromptContentHeight(
                          event.nativeEvent.contentSize.height,
                        );
                      }}
                      placeholder="Summarize yesterday's changes and list today's tasks."
                      scrollEnabled={promptScrollEnabled}
                      style={{ height: promptHeight }}
                      value={prompt}
                    />
                  </TextInputWrapper>
                </View>
                {Platform.OS === "android" ? (
                  <View>
                    <Button
                      className="justify-between bg-input dark:bg-input-dark"
                      disabled={busyKey !== null}
                      onPress={() => {
                        runAction("pick-folder", pickFolder).catch(
                          console.error,
                        );
                      }}
                      variant="outline"
                    >
                      <View className="min-w-0 flex-1 flex-row items-center gap-sp-3">
                        <Folder color={theme.textSecondary} size={18} />
                        <Text
                          className={cn(
                            "flex-1 font-sans text-base",
                            folderSession
                              ? "text-foreground dark:text-foreground-dark"
                              : "text-muted-foreground dark:text-muted-foreground-dark",
                          )}
                          numberOfLines={1}
                        >
                          {folderSession
                            ? folderSession.displayName
                            : "Select folder (optional)"}
                        </Text>
                      </View>
                      {folderSession ? (
                        <Pressable
                          accessibilityLabel="Clear target folder"
                          accessibilityRole="button"
                          hitSlop={12}
                          onPress={(event) => {
                            event.stopPropagation();
                            setFolderSession(null);
                          }}
                          style={({ pressed }) =>
                            pressed ? { opacity: 0.7 } : null
                          }
                        >
                          <X color={theme.textSecondary} size={18} />
                        </Pressable>
                      ) : (
                        <ChevronDown color={theme.textSecondary} size={18} />
                      )}
                    </Button>
                  </View>
                ) : null}
                <View className="gap-sp-1">
                  <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                    Frequency
                  </Text>
                  <Pressable
                    accessibilityLabel={`Frequency ${frequency}`}
                    accessibilityRole="button"
                    className="min-h-12 flex-row items-center justify-between rounded-ui border border-border bg-input px-sp-3 dark:border-border-dark dark:bg-input-dark"
                    onPress={() => setEditorPage(1)}
                  >
                    <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                      {FREQUENCIES.find((option) => option.value === frequency)
                        ?.label ?? "Custom"}
                    </Text>
                    <ChevronDown color={theme.textSecondary} size={20} />
                  </Pressable>
                </View>
                {frequency === "hourly" ? (
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    Runs at the top of every hour.
                  </Text>
                ) : null}
                {frequency === "daily" ||
                frequency === "weekly" ||
                frequency === "monthly" ? (
                  <View className="gap-sp-1">
                    <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                      Time
                    </Text>
                    {Platform.OS === "ios" ? (
                      <View className="min-h-12 justify-center rounded-ui border border-border bg-input px-sp-3 dark:border-border-dark dark:bg-input-dark">
                        <DateTimePicker
                          display="compact"
                          mode="time"
                          onValueChange={(_, selectedDate) =>
                            setTime(formatTime(selectedDate))
                          }
                          themeVariant={colorScheme}
                          value={timeToDate(time)}
                        />
                      </View>
                    ) : (
                      <Pressable
                        accessibilityLabel={`Time ${time}`}
                        accessibilityRole="button"
                        className="min-h-12 flex-row items-center justify-between rounded-ui border border-border bg-input px-sp-3 dark:border-border-dark dark:bg-input-dark"
                        onPress={() => setShowTimePicker(true)}
                      >
                        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                          {time}
                        </Text>
                        <ChevronDown color={theme.textSecondary} size={20} />
                      </Pressable>
                    )}
                    {Platform.OS === "android" && showTimePicker ? (
                      <DateTimePicker
                        display="default"
                        is24Hour
                        mode="time"
                        onDismiss={() => setShowTimePicker(false)}
                        onValueChange={(_, selectedDate) => {
                          setTime(formatTime(selectedDate));
                          setShowTimePicker(false);
                        }}
                        presentation="dialog"
                        value={timeToDate(time)}
                      />
                    ) : null}
                  </View>
                ) : null}
                {frequency === "weekly" ? (
                  <View className="gap-sp-1">
                    <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                      Days
                    </Text>
                    <View className="flex-row gap-sp-1">
                      {WEEKDAYS.map((day, index) => {
                        const selected = weekdays[index];
                        return (
                          <Button
                            key={day.name}
                            accessibilityLabel={day.title}
                            className="flex-1 px-0"
                            onPress={() =>
                              setWeekdays((current) => {
                                const next = [...current];
                                next[index] = !next[index];
                                return next;
                              })
                            }
                            size="sm"
                            variant={selected ? "default" : "outline"}
                          >
                            {day.label}
                          </Button>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                {frequency === "monthly" ? (
                  <View className="gap-sp-1">
                    <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                      Day of month
                    </Text>
                    <Input
                      autoCapitalize="none"
                      autoCorrect={false}
                      disabled={busyKey !== null}
                      keyboardType="number-pad"
                      onChangeText={setDayOfMonth}
                      placeholder="1"
                      value={dayOfMonth}
                    />
                  </View>
                ) : null}
                <View className="flex-row items-center justify-between">
                  <View className="min-w-0 flex-1">
                    <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                      Auto-approve
                    </Text>
                    <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      Let the agent use tools without asking.
                    </Text>
                  </View>
                  <Checkbox
                    checked={autoApprove}
                    onCheckedChange={setAutoApprove}
                  />
                </View>
                {formError ? (
                  <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                    {formError}
                  </Text>
                ) : null}
              </DrawerBody>
              <DrawerFooter>
                <Button
                  loading={busyKey === "save"}
                  onPress={() => {
                    runAction("save", save).catch(() => {});
                  }}
                >
                  {editingId ? "Save changes" : "Create job"}
                </Button>
              </DrawerFooter>
            </DrawerPagerPage>

            <DrawerPagerPage>
              <DrawerHeader className="flex-row items-center gap-sp-2">
                <Pressable
                  accessibilityLabel="Back to job"
                  className="h-9 w-9 items-center justify-center rounded-full"
                  onPress={() => setEditorPage(0)}
                >
                  <ChevronLeft color={theme.text} size={22} />
                </Pressable>
                <DrawerTitle>Frequency</DrawerTitle>
              </DrawerHeader>
              <DrawerBody>
                {FREQUENCIES.map((option) => {
                  const selected = frequency === option.value;
                  return (
                    <DrawerOptionRow
                      key={option.value}
                      label={option.label}
                      onPress={() => {
                        setFrequency(option.value);
                        setEditorPage(option.value === "custom" ? 2 : 0);
                      }}
                      selected={selected}
                      showChevron={option.value === "custom"}
                      subtitle={FREQUENCY_DESCRIPTIONS[option.value]}
                    />
                  );
                })}
              </DrawerBody>
            </DrawerPagerPage>

            <DrawerPagerPage>
              <DrawerHeader className="flex-row items-center gap-sp-2">
                <Pressable
                  accessibilityLabel="Back to frequency"
                  className="h-9 w-9 items-center justify-center rounded-full"
                  onPress={() => setEditorPage(1)}
                >
                  <ChevronLeft color={theme.text} size={22} />
                </Pressable>
                <DrawerTitle>Custom schedule</DrawerTitle>
              </DrawerHeader>
              <DrawerBody contentContainerClassName="gap-sp-3">
                <View className="gap-sp-1">
                  <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                    Repeat every
                  </Text>
                  <View className="flex-row gap-sp-2">
                    <Input
                      className="w-24"
                      disabled={busyKey !== null}
                      keyboardType="number-pad"
                      onChangeText={(value) => {
                        setCustomInterval(value);
                        setCustomAdvanced(false);
                        syncCustomExpression(
                          value,
                          customIntervalUnit,
                          customWeekdays,
                        );
                      }}
                      placeholder="2"
                      value={customInterval}
                    />
                    <Select
                      disabled={busyKey !== null}
                      onValueChange={(value) => {
                        const unit = value as CustomIntervalUnit;
                        setCustomIntervalUnit(unit);
                        setCustomAdvanced(false);
                        syncCustomExpression(
                          customInterval,
                          unit,
                          customWeekdays,
                        );
                      }}
                      value={customIntervalUnit}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue>
                          {customIntervalUnit === "minutes"
                            ? "Minutes"
                            : "Hours"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem label="Minutes" value="minutes">
                            Minutes
                          </SelectItem>
                          <SelectItem label="Hours" value="hours">
                            Hours
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </View>
                </View>
                <View className="gap-sp-1">
                  <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                    Days
                  </Text>
                  <View className="flex-row gap-sp-1">
                    {WEEKDAYS.map((day, index) => {
                      const selected = customWeekdays[index];
                      return (
                        <Button
                          key={day.name}
                          accessibilityLabel={day.title}
                          className="flex-1 px-0"
                          onPress={() => {
                            const next = [...customWeekdays];
                            next[index] = !next[index];
                            setCustomWeekdays(next);
                            setCustomAdvanced(false);
                            syncCustomExpression(
                              customInterval,
                              customIntervalUnit,
                              next,
                            );
                          }}
                          size="sm"
                          variant={selected ? "default" : "outline"}
                        >
                          {day.label}
                        </Button>
                      );
                    })}
                  </View>
                </View>
                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  {describeCustomInterval({
                    interval: customInterval,
                    unit: customIntervalUnit,
                    weekdays: customWeekdays,
                  })}
                </Text>
                <View className="flex-row items-center gap-sp-3">
                  <View className="h-px flex-1 bg-border dark:bg-border-dark" />
                  <Text className="font-sans text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground-dark">
                    Or
                  </Text>
                  <View className="h-px flex-1 bg-border dark:bg-border-dark" />
                </View>
                <View className="gap-sp-1">
                  <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                    Cron expression
                  </Text>
                  <Input
                    autoCapitalize="none"
                    autoCorrect={false}
                    disabled={busyKey !== null}
                    onChangeText={(value) => {
                      setCustomExpression(value);
                      setCustomAdvanced(true);
                    }}
                    placeholder="0 9 * * 1"
                    value={customExpression}
                  />
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    Five fields: minute hour day month weekday.
                  </Text>
                </View>
              </DrawerBody>
              <DrawerFooter>
                <Button onPress={() => setEditorPage(0)}>Done</Button>
              </DrawerFooter>
            </DrawerPagerPage>
          </DrawerPager>
        </DrawerContent>
      </Drawer>
    </Container>
  );
}

function detectFrequency(expression: string): ScheduleFrequency {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return "custom";
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const isNumber = (value: string) => /^\d+$/.test(value);

  if (month !== "*" || !isNumber(minute)) return "custom";
  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    return "hourly";
  }
  if (!isNumber(hour)) return "custom";
  if (dayOfMonth === "*" && dayOfWeek === "*") return "daily";
  if (dayOfMonth === "*" && dayOfWeek !== "*") return "weekly";
  if (isNumber(dayOfMonth) && dayOfWeek === "*") return "monthly";
  return "custom";
}

function extractTime(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return "09:00";
  const hour = parts[1];
  if (hour === "*") return "09:00";
  return `${hour.padStart(2, "0")}:${parts[0].padStart(2, "0")}`;
}

function timeToDate(time: string): Date {
  const [hour = "0", minute = "0"] = time.split(":");
  const date = new Date();
  date.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);
  return date;
}

function formatTime(date: Date): string {
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

function extractWeekdays(expression: string, defaultAll = false): boolean[] {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || parts[4] === "*") {
    return WEEKDAYS.map((_, index) => defaultAll || index === 0);
  }
  const selected = parseCronWeekdays(parts[4]);
  return WEEKDAYS.map((day) => selected.has(day.cron));
}

function extractDayOfMonth(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || parts[2] === "*") return "1";
  return parts[2];
}

function extractCustomInterval(
  expression: string,
): { interval: string; unit: CustomIntervalUnit } | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month] = parts;
  if (dayOfMonth !== "*" || month !== "*") return null;

  const minuteStep = /^\*\/([1-9]\d*)$/.exec(minute);
  if (minuteStep && hour === "*") {
    return { interval: minuteStep[1], unit: "minutes" };
  }

  const hourStep = /^\*\/([1-9]\d*)$/.exec(hour);
  if (minute === "0" && hourStep) {
    return { interval: hourStep[1], unit: "hours" };
  }

  return null;
}

function buildCustomIntervalExpression({
  interval,
  unit,
  weekdays,
}: {
  interval: string;
  unit: CustomIntervalUnit;
  weekdays: boolean[];
}) {
  const value = Number(interval);
  const maximum = unit === "minutes" ? 59 : 23;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(
      `Enter a ${unit === "minutes" ? "minute" : "hour"} interval between 1 and ${maximum}.`,
    );
  }

  const selectedDays = WEEKDAYS.filter((_, index) => weekdays[index]);
  if (selectedDays.length === 0) {
    throw new Error("Select at least one day for the custom schedule.");
  }

  const dayField =
    selectedDays.length === WEEKDAYS.length
      ? "*"
      : selectedDays.map((day) => day.cron).join(",");
  return unit === "minutes"
    ? `*/${value} * * * ${dayField}`
    : `0 */${value} * * ${dayField}`;
}

function describeCustomInterval({
  interval,
  unit,
  weekdays,
}: {
  interval: string;
  unit: CustomIntervalUnit;
  weekdays: boolean[];
}) {
  const value = Number(interval);
  if (!Number.isInteger(value) || value < 1) {
    return "Enter how often this job should run.";
  }

  const selectedDays = WEEKDAYS.filter((_, index) => weekdays[index]);
  if (selectedDays.length === 0) {
    return "Select at least one day.";
  }

  const unitLabel = value === 1 ? unit.slice(0, -1) : unit;
  if (selectedDays.length === WEEKDAYS.length) {
    return `Runs every ${value} ${unitLabel} every day.`;
  }
  return `Runs every ${value} ${unitLabel} on ${selectedDays
    .map((day) => day.title)
    .join(", ")}.`;
}

function parseCronWeekdays(field: string) {
  const selected = new Set<number>();
  for (const part of field.split(",")) {
    const [startText, endText] = part.split("-");
    const start = parseCronWeekday(startText);
    const end = endText === undefined ? start : parseCronWeekday(endText);
    if (start === null || end === null || end < start) {
      continue;
    }
    for (let day = start; day <= end; day += 1) {
      selected.add(day % 7);
    }
  }
  return selected;
}

function parseCronWeekday(value: string) {
  const normalized = value.trim().toLowerCase();
  const named = WEEKDAYS.find(
    (day) => normalized === day.name || normalized === day.name.slice(0, 3),
  );
  if (named) return named.cron;

  const numeric = Number(normalized);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 7
    ? numeric % 7
    : null;
}

function DrawerOptionRow({
  label,
  onPress,
  selected = false,
  showChevron = false,
  subtitle,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  showChevron?: boolean;
  subtitle?: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className={cn(
        "min-h-14 flex-row items-center gap-sp-3 rounded-ui border px-sp-4 py-sp-3",
        selected
          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark",
      )}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.86 } : null)}
    >
      <View className="flex-1 gap-1">
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          {label}
        </Text>
        {subtitle ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Check color={theme.text} size={18} /> : null}
      {showChevron ? (
        <ChevronRight color={theme.textSecondary} size={18} />
      ) : null}
    </Pressable>
  );
}
