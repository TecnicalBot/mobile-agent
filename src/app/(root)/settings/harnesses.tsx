import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { DrawerPager, DrawerPagerPage } from "@/components/ui/drawer-pager";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { AntigravityConnectionForm } from "@/components/settings/antigravity-connection-form";
import { OpenCodeConnectionForm } from "@/components/settings/opencode-connection-form";
import {
  ProviderModelRow,
  StatusRow,
} from "@/components/settings/provider-detail-rows";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  SUPPORTED_HARNESSES,
  type HarnessID,
} from "@/modules/harnesses/catalog";
import { useHarness } from "@/providers/harness-state";
import { usePhoneBridge } from "@/providers/phone-bridge-state";

export default function SettingsHarnessesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const harness = useHarness();
  const bridge = usePhoneBridge();
  const { selectModel } = useConfig();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedID, setSelectedID] = useState<HarnessID>("opencode");
  const [modelQuery, setModelQuery] = useState("");
  const [connectingPhoneTools, setConnectingPhoneTools] = useState(false);

  const definition =
    SUPPORTED_HARNESSES.find((entry) => entry.id === selectedID) ??
    SUPPORTED_HARNESSES[0];
  const controller = harness.harnesses[selectedID];
  const loading = controller.status === "connecting";
  const authRequired =
    selectedID === "antigravity" && harness.harnesses.antigravity.authRequired;
  const query = modelQuery.trim().toLowerCase();
  const displayModels = controller.availableModels.filter(
    (model) =>
      !query ||
      model.label.toLowerCase().includes(query) ||
      model.modelId.toLowerCase().includes(query),
  );

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
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Harnesses
        </Text>
      </View>
      <Card className="overflow-hidden">
        {SUPPORTED_HARNESSES.map((entry, index) => {
          const state = harness.harnesses[entry.id];
          return (
            <View key={entry.id}>
              {index > 0 ? <Separator /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={entry.label}
                className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
                onPress={() => {
                  setSelectedID(entry.id);
                  setPage(0);
                  setModelQuery("");
                  setOpen(true);
                }}
                style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
              >
                <View className="flex-1">
                  <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                    {entry.label}
                  </Text>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {entry.phoneTools
                      ? "Host harness with device sharing"
                      : "Host harness over an ACP bridge"}
                  </Text>
                </View>
                <Text className="text-right font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  {state.status === "connecting"
                    ? "Connecting"
                    : entry.id === "antigravity" &&
                        harness.harnesses.antigravity.authRequired
                      ? "Sign in required"
                      : state.connected
                        ? `${state.models.length} available`
                        : "Connect"}
                </Text>
                <ChevronRight color={theme.textSecondary} size={18} />
              </Pressable>
            </View>
          );
        })}
      </Card>
      <Drawer
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setPage(0);
        }}
      >
        <DrawerContent
          contentClassName="overflow-hidden"
          showCloseButton
          showHandle
          size={720}
        >
          <DrawerPager page={page} onPageChange={setPage}>
            <DrawerPagerPage>
              <DrawerHeader>
                <DrawerTitle>{definition.label}</DrawerTitle>
              </DrawerHeader>
              <DrawerBody contentContainerClassName="pb-sp-4">
                <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                  <StatusRow
                    label="Status"
                    value={
                      loading
                        ? "Connecting"
                        : authRequired
                          ? "Sign in required"
                          : controller.connected
                            ? "Connected"
                            : "Not set up"
                    }
                  />
                  <Separator />
                  <StatusRow label="Family" value="Harness" />
                  {controller.active && controller.currentModel ? (
                    <>
                      <Separator />
                      <StatusRow
                        label="Current model"
                        value={controller.currentModel.label}
                      />
                    </>
                  ) : null}
                  {authRequired ? (
                    <>
                      <Separator />
                      <StatusRow label="Host sign-in" value="Required" />
                    </>
                  ) : null}
                </View>
                <View className="gap-sp-2">
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    {controller.connected ? "Active connection" : "Connection"}
                  </Text>
                  {controller.connected ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setPage(1)}
                        style={({ pressed }) =>
                          pressed ? { opacity: 0.82 } : null
                        }
                        className="flex-row items-center justify-between overflow-hidden rounded-card border border-border px-sp-4 py-sp-3 dark:border-border-dark"
                      >
                        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                          {definition.label}
                        </Text>
                        <View className="flex-row items-center gap-sp-1">
                          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                            Manage
                          </Text>
                          <ChevronRight color={theme.textSecondary} size={18} />
                        </View>
                      </Pressable>
                      <Button
                        variant="outline"
                        disabled={controller.mutating}
                        onPress={controller.disconnect}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      loading={loading}
                      onPress={() => setPage(1)}
                    >
                      Connect
                    </Button>
                  )}
                </View>
                {authRequired ? (
                  <View className="gap-sp-2 rounded-card border border-border p-sp-3 dark:border-border-dark">
                    <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                      Sign in on the bridge host
                    </Text>
                    <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                      Run `agy acp --login` on the computer running the bridge,
                      then tap Refresh below. The app never stores Antigravity
                      credentials.
                    </Text>
                  </View>
                ) : null}
                {definition.phoneTools ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Manage device sharing"
                      className="min-h-14 flex-row items-center gap-sp-3 rounded-card border border-border px-sp-4 py-sp-3 dark:border-border-dark"
                      onPress={() => {
                        setOpen(false);
                        router.push({
                          pathname: "/settings/integrations",
                          params: { phoneTools: "1" },
                        });
                      }}
                      style={({ pressed }) =>
                        pressed ? { opacity: 0.82 } : null
                      }
                    >
                      <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
                        Device sharing
                      </Text>
                      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                        {controller.phoneToolsEnabled
                          ? "Connected"
                          : bridge.sharing
                            ? "Not connected"
                            : "Not shared"}
                      </Text>
                      <ChevronRight color={theme.textSecondary} size={18} />
                    </Pressable>
                    {controller.connected && bridge.sharing ? (
                      <Button
                        variant="outline"
                        loading={connectingPhoneTools}
                        onPress={() => {
                          if (connectingPhoneTools) return;
                          setConnectingPhoneTools(true);
                          void controller
                            .connectPhoneTools()
                            .catch(() => {})
                            .finally(() => setConnectingPhoneTools(false));
                        }}
                      >
                        {controller.phoneToolsEnabled
                          ? "Reconnect device sharing"
                          : "Connect device sharing"}
                      </Button>
                    ) : null}
                    {controller.phoneToolsError ? (
                      <Text
                        accessibilityRole="alert"
                        className="font-sans text-sm text-destructive dark:text-destructive-dark"
                      >
                        {controller.phoneToolsError}
                      </Text>
                    ) : null}
                  </>
                ) : null}
                {controller.connected ? (
                  <View className="gap-sp-3">
                    <View className="flex-row items-center justify-between gap-sp-3">
                      <Text className="flex-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                        Models from {definition.label}
                      </Text>
                      <Button
                        size="xs"
                        variant="outline"
                        loading={loading}
                        disabled={controller.mutating}
                        onPress={() => {
                          // OpenCode reloads its catalog by reconnecting;
                          // Antigravity can reuse its live bridge client.
                          void (selectedID === "antigravity"
                            ? controller.refresh()
                            : controller.connect());
                        }}
                      >
                        Refresh
                      </Button>
                    </View>
                    <Input
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={setModelQuery}
                      placeholder="Search models"
                      value={modelQuery}
                    />
                    <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                      {displayModels.map((model, index) => (
                        <View key={model.ref}>
                          {index > 0 ? <Separator /> : null}
                          <ProviderModelRow
                            capabilityBadges={model.isFree ? ["Free"] : []}
                            checkColor={theme.text}
                            current={controller.currentModel?.ref === model.ref}
                            disabled={controller.mutating}
                            label={model.label}
                            modelId={model.modelId}
                            stateLabel={
                              controller.currentModel?.ref === model.ref
                                ? "Current"
                                : "Use"
                            }
                            onPress={() => {
                              void selectModel(model.ref).catch(() => {});
                            }}
                          />
                        </View>
                      ))}
                      {displayModels.length === 0 ? (
                        <Text className="px-sp-4 py-sp-4 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                          {query
                            ? "No models match your search."
                            : authRequired
                              ? "Sign in on the bridge host, then tap Refresh."
                              : "No models available."}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                {controller.error ? (
                  <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                    {controller.error}
                  </Text>
                ) : null}
              </DrawerBody>
            </DrawerPagerPage>
            <DrawerPagerPage>
              <DrawerHeader>
                <View className="flex-row items-center gap-sp-2">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    leftIcon={<ChevronLeft color={theme.text} size={16} />}
                    onPress={() => setPage(0)}
                  />
                  <DrawerTitle>Connect</DrawerTitle>
                </View>
              </DrawerHeader>
              {open && page === 1 ? (
                selectedID === "antigravity" ? (
                  <AntigravityConnectionForm
                    key="antigravity"
                    onConnected={() => {
                      void controller.connect().then(() => setPage(0));
                    }}
                  />
                ) : (
                  <OpenCodeConnectionForm
                    key="opencode"
                    onConnected={() => {
                      void controller.connect().then(() => setPage(0));
                    }}
                  />
                )
              ) : null}
            </DrawerPagerPage>
          </DrawerPager>
        </DrawerContent>
      </Drawer>
    </Container>
  );
}
