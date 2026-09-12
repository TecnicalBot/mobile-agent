import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
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
import type { PendingSecretRequest } from "@/core/types/app-state";

export type SecretRequestProps = {
  secretRequest: PendingSecretRequest;
  onDismiss: () => void;
  onSubmit: (value: string) => void;
};

export function SecretRequest({
  secretRequest,
  onDismiss,
  onSubmit,
}: SecretRequestProps) {
  const [attempted, setAttempted] = useState(false);
  const [value, setValue] = useState("");
  const bodyRef = useRef<KeyboardAwareScrollViewRef>(null);
  const empty = value.trim().length === 0;
  const showError = attempted && empty && !secretRequest.alreadyConfigured;
  const canSave = !empty || secretRequest.alreadyConfigured;

  useEffect(() => {
    bodyRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  function handleSubmit() {
    if (!canSave) {
      setAttempted(true);
      return;
    }

    onSubmit(value.trim());
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
          <DrawerTitle>Secret needed</DrawerTitle>
          <DrawerDescription>
            The assistant needs a value for a plugin secret.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3" ref={bodyRef}>
          <View className="flex-col gap-sp-2">
            <Text className="font-sans text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
              PLUGIN
            </Text>
            <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              {secretRequest.pluginName}
            </Text>
          </View>
          <View className="flex-col gap-sp-2">
            <Text className="font-sans text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
              KEY
            </Text>
            <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              {secretRequest.key}
            </Text>
          </View>
          {secretRequest.purpose ? (
            <Text className="font-sans text-sm leading-snug text-muted-foreground dark:text-muted-foreground-dark">
              {secretRequest.purpose}
            </Text>
          ) : null}
          {secretRequest.alreadyConfigured ? (
            <Text className="font-sans text-sm leading-snug text-muted-foreground dark:text-muted-foreground-dark">
              This key already has a value saved on this device. Leave the
              field empty to keep it, or enter a new value to replace it.
            </Text>
          ) : null}
          <SecretInput autoFocus value={value} onChangeText={setValue} />
          {showError ? (
            <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
              Enter a value or choose Later.
            </Text>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <View className="flex-row items-center gap-sp-2">
            <View className="flex-1" />
            <Button onPress={onDismiss} variant="outline">
              Later
            </Button>
            <Button onPress={handleSubmit}>Save</Button>
          </View>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

type SecretInputProps = {
  autoFocus?: boolean;
  onChangeText?: (text: string) => void;
  value?: string;
};

function SecretInput({ autoFocus, onChangeText, value }: SecretInputProps) {
  const theme = useTheme();

  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={autoFocus}
      className="min-h-11 w-full rounded-lg border border-border bg-transparent px-3 py-2.5 font-sans text-sm font-medium text-foreground dark:border-border-dark dark:bg-input-dark/30 dark:text-foreground-dark"
      cursorColor={theme.text}
      onChangeText={onChangeText}
      placeholder="Paste the secret value here…"
      placeholderTextColor={theme.textSecondary}
      secureTextEntry
      selectionColor={theme.backgroundSelected}
      selectionHandleColor={theme.text}
      value={value}
    />
  );
}