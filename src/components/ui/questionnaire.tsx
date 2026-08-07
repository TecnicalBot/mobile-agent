import { useState } from "react";
import { Pressable, Text, View } from "react-native";

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
import { Textarea } from "@/components/ui/textarea";
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

function isDraftValid(
  questionnaire: PendingQuestionnaire,
  selections: ChoiceSelections,
  freeform: FreeformText,
) {
  return questionnaire.items.every((item) => {
    if (!item.required) {
      return true;
    }

    return itemHasValue(item, selections, freeform);
  });
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
  const [selections, setSelections] = useState<ChoiceSelections>({});
  const [freeform, setFreeform] = useState<FreeformText>({});
  const valid = isDraftValid(questionnaire, selections, freeform);

  return (
    <Drawer dismissible={false} open>
      <DrawerContent
        closeOnOverlayPress={false}
        showCloseButton={false}
        showHandle
      >
        <DrawerHeader>
          <DrawerTitle>{questionnaire.chatTitle}</DrawerTitle>
          <DrawerDescription>
            The assistant paused to ask you a few questions.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-4">
          {questionnaire.items.map((item, index) => {
            const selected = getSelectedChoices(selections, item);

            return (
              <View
                key={item.id}
                className="gap-sp-2 rounded-ui border border-border bg-card p-sp-4 dark:border-border-dark dark:bg-card-dark"
              >
                <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
                  {index + 1}. {item.prompt}
                  {item.required ? (
                    <Text className="text-destructive dark:text-destructive-dark">
                      {" "}
                      *
                    </Text>
                  ) : null}
                </Text>
                {item.description ? (
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    {item.description}
                  </Text>
                ) : null}
                {item.choices ? (
                  <View className="flex-row flex-wrap gap-sp-2">
                    {item.choices.map((choice) => {
                      const active = selected.includes(choice);

                      return (
                        <ChoiceChip
                          key={choice}
                          active={active}
                          label={choice}
                          onPress={() =>
                            toggleChoice(item, choice, selections, setSelections)
                          }
                        />
                      );
                    })}
                  </View>
                ) : null}
                {item.allowFreeform ? (
                  <Textarea
                    maxLength={MAX_FREEFORM_LENGTH}
                    onChangeText={(text) =>
                      setFreeform((prev) => ({ ...prev, [item.id]: text }))
                    }
                    placeholder={
                      item.choices ? "Type a custom answer…" : "Type your answer…"
                    }
                    value={freeform[item.id] ?? ""}
                  />
                ) : null}
              </View>
            );
          })}
        </DrawerBody>
        <DrawerFooter>
          <Button onPress={onDismiss} variant="ghost">
            Skip for now
          </Button>
          <Button
            disabled={!valid}
            onPress={() => onSubmit(buildAnswers(questionnaire, selections, freeform))}
          >
            Submit
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

type ChoiceChipProps = {
  active: boolean;
  label: string;
  onPress: () => void;
};

function ChoiceChip({ active, label, onPress }: ChoiceChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      className={cn(
        "rounded-full border px-sp-4 py-sp-2",
        active
          ? "border-foreground bg-foreground dark:border-foreground-dark dark:bg-foreground-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark",
      )}
      onPress={onPress}
    >
      <Text
        className={cn(
          "font-sans text-sm font-medium",
          active
            ? "text-background dark:text-background-dark"
            : "text-foreground dark:text-foreground-dark",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
