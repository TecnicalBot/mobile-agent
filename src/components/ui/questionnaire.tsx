import { Check } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/core/utils";
import type {
  PendingQuestionnaire,
  PendingQuestionnaireAnswer,
  QuestionnaireItem,
} from "@/core/types/app-state";
import { MAX_FREEFORM_LENGTH } from "@/modules/tools/built-in/question";

type ChoiceSelections = Record<string, string | string[] | null>;
type FreeformText = Record<string, string>;

function getSelectedChoices(
  selections: ChoiceSelections,
  item: QuestionnaireItem,
): string[] {
  const value = selections[item.id];

  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === "string" ? [value] : [];
}

function hasChoiceValue(item: QuestionnaireItem, selections: ChoiceSelections) {
  return getSelectedChoices(selections, item).length > 0;
}

function hasFreeformValue(item: QuestionnaireItem, freeform: FreeformText) {
  return (freeform[item.id] ?? "").trim().length > 0;
}

function itemHasValue(
  item: QuestionnaireItem,
  selections: ChoiceSelections,
  freeform: FreeformText,
) {
  return hasChoiceValue(item, selections) || hasFreeformValue(item, freeform);
}

function buildAnswers(
  questionnaire: PendingQuestionnaire,
  selections: ChoiceSelections,
  freeform: FreeformText,
): PendingQuestionnaireAnswer[] {
  return questionnaire.items.flatMap((item) => {
    const selected = getSelectedChoices(selections, item);
    const freeformText = (freeform[item.id] ?? "").trim();
    let value: string | string[] | null;

    if (item.multiple) {
      const combined = [...selected, ...(freeformText ? [freeformText] : [])];

      value = combined.length > 0 ? combined : null;
    } else {
      value = selected[0] ?? (freeformText || null);
    }

    return value === null ? [] : [{ id: item.id, value }];
  });
}

function toggleChoice(
  item: QuestionnaireItem,
  choice: string,
  selections: ChoiceSelections,
  setSelections: (updater: (current: ChoiceSelections) => ChoiceSelections) => void,
) {
  const current = getSelectedChoices(selections, item);

  if (item.multiple) {
    const next = current.includes(choice)
      ? current.filter((entry) => entry !== choice)
      : [...current, choice];

    setSelections((prev) => ({ ...prev, [item.id]: next }));
    return;
  }

  const next = current.includes(choice) ? null : choice;

  setSelections((prev) => ({ ...prev, [item.id]: next }));
}

export type QuestionnaireProps = {
  questionnaire: PendingQuestionnaire;
  onDismiss: () => void;
  onSubmit: (answers: PendingQuestionnaireAnswer[]) => void;
};

export function Questionnaire({
  questionnaire,
  onDismiss,
  onSubmit,
}: QuestionnaireProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [selections, setSelections] = useState<ChoiceSelections>({});
  const [freeform, setFreeform] = useState<FreeformText>({});
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<KeyboardAwareScrollViewRef>(null);
  const total = questionnaire.items.length;
  const item = questionnaire.items[activeIndex];
  const hasValue = itemHasValue(item, selections, freeform);
  const showError = attempted[item.id] === true && !hasValue;
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === total - 1;

  useEffect(() => {
    bodyRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeIndex]);

  function markAttempted() {
    setAttempted((prev) => ({ ...prev, [item.id]: true }));
  }

  function goPrevious() {
    setActiveIndex((index) => Math.max(0, index - 1));
  }

  function goNext() {
    if (!hasValue) {
      markAttempted();
      return;
    }

    setActiveIndex((index) => Math.min(total - 1, index + 1));
  }

  function skipCurrent() {
    if (isLast) {
      onSubmit(buildAnswers(questionnaire, selections, freeform));
      return;
    }

    setActiveIndex((index) => index + 1);
  }

  function handleSubmit() {
    if (!hasValue) {
      markAttempted();
      return;
    }

    onSubmit(buildAnswers(questionnaire, selections, freeform));
  }

  return (
    <Drawer
      dismissible
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
      open
    >
      <DrawerContent
        closeOnOverlayPress={false}
        showCloseButton
        showHandle
      >
        <DrawerHeader>
          <DrawerTitle>{questionnaire.chatTitle}</DrawerTitle>
          <DrawerDescription>
            The assistant paused to ask you a few questions.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3" ref={bodyRef}>
          <Text
            accessibilityLabel="Questionnaire progress"
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            className="font-sans text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            Question {activeIndex + 1} of {total}
          </Text>
          <View className="flex-col gap-sp-3">
            <Text className="font-sans text-base leading-snug font-medium text-foreground dark:text-foreground-dark">
              {item.prompt}
            </Text>
            {item.description ? (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                {item.description}
              </Text>
            ) : null}
            {item.choices ? (
              <View className="gap-sp-2">
                {item.choices.map((choice) => {
                  const checked = getSelectedChoices(selections, item).includes(
                    choice,
                  );

                  return (
                    <ChoiceRow
                      key={choice}
                      checked={checked}
                      label={choice}
                      multiple={item.multiple ?? false}
                      onPress={() =>
                        toggleChoice(item, choice, selections, setSelections)
                      }
                    />
                  );
                })}
              </View>
            ) : null}
            {item.allowFreeform ? (
              <FreeformInput
                maxLength={MAX_FREEFORM_LENGTH}
                onChangeText={(text) =>
                  setFreeform((prev) => ({ ...prev, [item.id]: text }))
                }
                placeholder={
                  item.choices ? "Another answer" : "Type your answer…"
                }
                value={freeform[item.id] ?? ""}
              />
            ) : null}
            {showError ? (
              <Text className="mt-sp-2 font-sans text-sm text-destructive dark:text-destructive-dark">
                {item.required
                  ? "Choose an answer to continue."
                  : "Choose an answer or skip this question."}
              </Text>
            ) : null}
          </View>
        </DrawerBody>
        <DrawerFooter>
          <View className="flex-row items-center gap-sp-2">
            {total > 1 && !isFirst ? (
              <Button onPress={goPrevious} variant="outline">
                Previous
              </Button>
            ) : null}
            <View className="flex-1" />
            {!item.required ? (
              <Button onPress={skipCurrent} variant="outline">
                Skip
              </Button>
            ) : null}
            {total > 1 && !isLast ? (
              <Button onPress={goNext}>Next</Button>
            ) : (
              <Button onPress={handleSubmit}>Submit</Button>
            )}
          </View>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

type ChoiceRowProps = {
  checked: boolean;
  label: string;
  multiple: boolean;
  onPress: () => void;
};

function ChoiceRow({ checked, label, multiple, onPress }: ChoiceRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole={multiple ? "checkbox" : "radio"}
      accessibilityState={{ checked }}
      className={cn(
        "min-h-11 flex-row items-start gap-2.5 rounded-lg border px-3 py-2.5",
        "dark:bg-input-dark/20 active:bg-muted/50 dark:active:bg-muted-dark/50",
        checked
          ? "border-foreground/40 bg-muted dark:border-foreground-dark/40 dark:bg-muted-dark"
          : "border-border bg-transparent dark:border-border-dark",
      )}
      onPress={onPress}
    >
      <View
        className={cn(
          "mt-[2px] size-4 items-center justify-center border",
          multiple ? "rounded-[4px]" : "rounded-full",
          checked
            ? "border-foreground bg-foreground dark:border-foreground-dark dark:bg-foreground-dark"
            : "border-border bg-transparent dark:border-border-dark dark:bg-input-dark/30",
        )}
      >
        {checked
          ? multiple
            ? (
                <Check color={theme.background} size={14} />
              )
            : (
                <View className="size-2 rounded-full bg-background dark:bg-background-dark" />
              )
          : null}
      </View>
      <Text className="flex-1 font-sans text-sm leading-snug font-medium text-foreground dark:text-foreground-dark">
        {label}
      </Text>
    </Pressable>
  );
}

type FreeformInputProps = {
  maxLength?: number;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  value?: string;
};

function FreeformInput({
  maxLength,
  onChangeText,
  placeholder,
  value,
}: FreeformInputProps) {
  const theme = useTheme();

  return (
    <TextInput
      className="min-h-11 w-full rounded-lg border border-border bg-transparent px-2.5 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark/30 dark:text-foreground-dark"
      cursorColor={theme.text}
      maxLength={maxLength}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      selectionColor={theme.backgroundSelected}
      selectionHandleColor={theme.text}
      value={value}
    />
  );
}
