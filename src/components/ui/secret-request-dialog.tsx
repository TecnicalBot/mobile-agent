import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  return (
    <SecretEntryDialog
      secretRequest={secretRequest}
      onDismiss={onDismiss}
      onSubmit={(value) => onSubmit(value)}
    />
  );
}

export function SecretEntryDialog({
  secretRequest,
  onDismiss,
  onSubmit,
  editableKey = false,
  title = "Secret needed",
  description = "The assistant needs a value for a plugin secret.",
  loading = false,
  error,
  cancelLabel = "Later",
  showContext = true,
}: {
  secretRequest: Pick<PendingSecretRequest, "pluginName" | "key" | "purpose" | "alreadyConfigured">;
  onDismiss: () => void;
  onSubmit: (value: string, key: string) => void;
  editableKey?: boolean;
  title?: string;
  description?: string;
  loading?: boolean;
  error?: string | null;
  cancelLabel?: string;
  showContext?: boolean;
}) {
  const [attempted, setAttempted] = useState(false);
  const [value, setValue] = useState("");
  const [key, setKey] = useState(secretRequest.key);
  const bodyRef = useRef<KeyboardAwareScrollViewRef>(null);
  const empty = value.trim().length === 0;
  const showError = attempted && empty && !secretRequest.alreadyConfigured;
  const canSave = (!editableKey || key.trim().length > 0) && (!empty || secretRequest.alreadyConfigured);

  useEffect(() => {
    bodyRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  function handleSubmit() {
    if (!canSave) {
      setAttempted(true);
      return;
    }

    if (!loading) onSubmit(value.trim(), key.trim());
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
           <DrawerTitle>{title}</DrawerTitle>
           {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3" ref={bodyRef}>
          {showContext ? <View className="flex-col gap-sp-2">
            <Text className="font-sans text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
              PLUGIN
            </Text>
            <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              {secretRequest.pluginName}
            </Text>
          </View> : null}
          <View className="flex-col gap-sp-2">
            {showContext ? (
              <Text className="font-sans text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">KEY</Text>
            ) : <Label>Key</Label>}
            {editableKey ? <Input
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="KEY_NAME"
              value={key}
              onChangeText={setKey}
              disabled={loading}
            /> : showContext ? <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              {secretRequest.key}
            </Text> : <Input
              autoCapitalize="none"
              autoCorrect={false}
              value={key}
              disabled
            />}
          </View>
          {showContext && secretRequest.purpose ? (
            <Text className="font-sans text-sm leading-snug text-muted-foreground dark:text-muted-foreground-dark">
              {secretRequest.purpose}
            </Text>
          ) : null}
          {showContext && secretRequest.alreadyConfigured ? (
            <Text className="font-sans text-sm leading-snug text-muted-foreground dark:text-muted-foreground-dark">
              This key already has a value saved on this device. Leave the
              field empty to keep it, or enter a new value to replace it.
            </Text>
          ) : null}
           {showContext ? (
             <SecretInput autoFocus value={value} onChangeText={setValue} />
           ) : (
             <View className="gap-sp-2">
               <Label>Value</Label>
               <Input
                 autoCapitalize="none"
                 autoCorrect={false}
                 autoFocus={!editableKey}
                 secureTextEntry
                 placeholder="Enter secret value"
                 value={value}
                 onChangeText={setValue}
                 disabled={loading}
               />
             </View>
           )}
          {showError ? (
            <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
              Enter a value or choose Later.
            </Text>
          ) : null}
          {attempted && editableKey && !key.trim() ? <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">Enter a key name.</Text> : null}
          {error ? <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">{error}</Text> : null}
        </DrawerBody>
        <DrawerFooter>
          <View className="flex-row items-center gap-sp-2">
            <View className="flex-1" />
            <Button disabled={loading} onPress={onDismiss} variant="outline">
              {cancelLabel}
            </Button>
            <Button loading={loading} disabled={loading} onPress={handleSubmit}>Save</Button>
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
