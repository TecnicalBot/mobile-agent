import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, KeyRound, Plus, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { secureSecretStore } from "@/core/services/secrets";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";

type SecretRow = { key: string; configured: boolean };

export default function SettingsPluginDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { deletePlugin, plugins, updatePlugin } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configuredKeys, setConfiguredKeys] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [customKey, setCustomKey] = useState("");
  const [customValue, setCustomValue] = useState("");

  const plugin = plugins.find((item) => item.id === id);

  const refreshConfiguredKeys = useCallback(async () => {
    if (!id) return;
    const keys = await secureSecretStore.listPluginSecretKeys(id);
    setConfiguredKeys(keys);
  }, [id]);

  useEffect(() => {
    refreshConfiguredKeys().catch(() => setConfiguredKeys([]));
  }, [refreshConfiguredKeys]);

  if (!plugin) {
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
          <Text className="min-w-0 flex-1 font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Plugin
          </Text>
        </View>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Plugin not found.
        </Text>
      </Container>
    );
  }

  const customKeys = configuredKeys.filter(
    (key) => !plugin.requiredSecrets.includes(key),
  );
  const rows: SecretRow[] = [
    ...plugin.requiredSecrets.map((key) => ({
      key,
      configured: configuredKeys.includes(key),
    })),
    ...customKeys.map((key) => ({ key, configured: true })),
  ];

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Secret action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveSecret = (key: string) => {
    const value = (values[key] ?? "").trim();
    if (!value) return;
    return runAction(`save:${key}`, async () => {
      await secureSecretStore.setPluginSecret(plugin.id, key, value);
      setValues((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await refreshConfiguredKeys();
    });
  };

  const handleClearSecret = (key: string) => {
    return runAction(`clear:${key}`, async () => {
      await secureSecretStore.deletePluginSecret(plugin.id, key);
      setValues((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await refreshConfiguredKeys();
    });
  };

  const handleAddCustomSecret = () => {
    const key = customKey.trim();
    const value = customValue.trim();
    if (!key || !value) return;
    setCustomKey("");
    setCustomValue("");
    return runAction(`add:${key}`, async () => {
      await secureSecretStore.setPluginSecret(plugin.id, key, value);
      await refreshConfiguredKeys();
    });
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
          <Text
            className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark"
            numberOfLines={1}
          >
            {plugin.name}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            v{plugin.version}
            {plugin.sourceUrl ? " · auto-updates on" : ""}
          </Text>
        </View>
      </View>

      <Card className="gap-sp-3 px-sp-4 py-sp-4">
        <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
          {plugin.description || "No description."}
        </Text>
        {plugin.lastError ? (
          <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
            {plugin.lastError}
          </Text>
        ) : null}
        <View className="flex-row gap-sp-2">
          <Button
            loading={busyKey === `toggle:${plugin.id}`}
            onPress={() =>
              runAction(`toggle:${plugin.id}`, () =>
                updatePlugin(plugin.id, { enabled: !plugin.enabled }),
              )
            }
            size="sm"
            variant="outline"
          >
            {plugin.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            leftIcon={<Trash2 color={theme.destructive} size={14} />}
            loading={busyKey === `delete:${plugin.id}`}
            onPress={() =>
              runAction(`delete:${plugin.id}`, () =>
                deletePlugin(plugin.id).then(() => router.back()),
              )
            }
            size="sm"
            variant="ghost"
          >
            Delete
          </Button>
        </View>
      </Card>

      <Card className="gap-sp-3 px-sp-4 py-sp-4">
        <View className="flex-row items-center gap-sp-2">
          <KeyRound color={theme.text} size={16} />
          <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
            Secrets
          </Text>
        </View>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          API keys and tokens the plugin needs. Values are stored encrypted
          on-device and are never sent to the model or the chat.
        </Text>

        {rows.length === 0 ? (
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            This plugin references no secrets. Add one below if its tools need
            a key.
          </Text>
        ) : (
          rows.map((row, index) => (
            <View key={row.key}>
              {index > 0 ? <Separator /> : null}
              <View className="gap-sp-2 pt-sp-2">
                <Label>{row.key}</Label>
                <View className="flex-row items-center gap-sp-2">
                  <Input
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="flex-1 font-mono"
                    onChangeText={(text) =>
                      setValues((current) => ({ ...current, [row.key]: text }))
                    }
                    placeholder={
                      row.configured ? "••••••••  (set — replace)" : "Enter value"
                    }
                    secureTextEntry
                    value={values[row.key] ?? ""}
                  />
                  <Button
                    disabled={!(values[row.key] ?? "").trim()}
                    loading={busyKey === `save:${row.key}`}
                    onPress={() => handleSaveSecret(row.key)}
                    size="sm"
                  >
                    Save
                  </Button>
                  {row.configured ? (
                    <Button
                      loading={busyKey === `clear:${row.key}`}
                      onPress={() => handleClearSecret(row.key)}
                      size="sm"
                      variant="ghost"
                    >
                      Clear
                    </Button>
                  ) : null}
                </View>
              </View>
            </View>
          ))
        )}

        <Separator />

        <View className="gap-sp-2">
          <Label>Add a secret key</Label>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            className="font-mono"
            onChangeText={setCustomKey}
            placeholder="KEY_NAME (e.g. MY_API_KEY)"
            value={customKey}
          />
          <View className="flex-row items-center gap-sp-2">
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 font-mono"
              onChangeText={setCustomValue}
              placeholder="Value"
              secureTextEntry
              value={customValue}
            />
            <Button
              disabled={!customKey.trim() || !customValue.trim()}
              leftIcon={<Plus color={theme.text} size={14} />}
              loading={busyKey === `add:${customKey.trim()}`}
              onPress={handleAddCustomSecret}
              size="sm"
            >
              Add
            </Button>
          </View>
        </View>
      </Card>

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}
    </Container>
  );
}