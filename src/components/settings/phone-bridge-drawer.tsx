import * as Clipboard from "expo-clipboard";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { StatusRow } from "@/components/settings/provider-detail-rows";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useTheme } from "@/hooks/use-theme";
import { PHONE_BRIDGE_PORT } from "@/modules/bridge/native-http-server";
import type { BridgeReach } from "@/modules/bridge/reach";
import { usePhoneBridge } from "@/providers/phone-bridge-state";

const NETWORK_LABEL = {
  auto: "Automatic",
  loopback: "This phone",
  lan: "Local network (unencrypted)",
  tailnet: "Tailscale",
} as const;

export function PhoneBridgeDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const bridge = usePhoneBridge();
  const theme = useTheme();
  const [page, setPage] = useState(0);
  const [workspace, setWorkspace] = useState(
    bridge.sharing?.grant.workspace ?? false,
  );
  const [skills, setSkills] = useState(bridge.sharing?.grant.skills ?? false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState(bridge.manualAddress ?? "");

  useEffect(() => {
    setManualDraft(bridge.manualAddress ?? "");
  }, [bridge.manualAddress]);

  const commitManualAddress = () => {
    const next = manualDraft.trim() || null;
    if (next !== (bridge.manualAddress ?? null)) bridge.setManualAddress(next);
  };
  const copy = (value: string, message: string) => {
    void Clipboard.setStringAsync(value)
      .then(() => setNotice(message))
      .catch(() => setNotice("Could not copy."));
  };
  const addresses = [
    bridge.urls.lan && { reach: "lan" as const, url: bridge.urls.lan },
    bridge.urls.tailnet && {
      reach: "tailnet" as const,
      url: bridge.urls.tailnet,
    },
    { reach: "loopback" as const, url: bridge.urls.loopback },
  ].filter((item): item is { reach: BridgeReach; url: string } =>
    Boolean(item),
  );
  const status = (
    <>
      {notice ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {notice}
        </Text>
      ) : null}
      {bridge.error ? (
        <Text
          accessibilityRole="alert"
          className="font-sans text-sm text-destructive dark:text-destructive-dark"
        >
          {bridge.error}
        </Text>
      ) : null}
    </>
  );

  return (
    <Drawer
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) {
          setPage(0);
          setNotice(null);
        }
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
              <DrawerTitle>Device sharing</DrawerTitle>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="pb-sp-4">
              <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                <StatusRow
                  label="Status"
                  value={
                    bridge.busy
                      ? "Updating"
                      : bridge.sharing
                        ? "Sharing"
                        : "Not shared"
                  }
                />
                <Separator />
                <StatusRow label="Protocol" value="MCP" />
                {bridge.sharing ? (
                  <>
                    <Separator />
                    <StatusRow
                      label="Network"
                      value={NETWORK_LABEL[bridge.sharing.reach]}
                    />
                    <Separator />
                    <StatusRow
                      label="Shared tools"
                      value={String(bridge.sharing.toolCount)}
                    />
                  </>
                ) : null}
              </View>

              <View className="gap-sp-2">
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  Shared access
                </Text>
                <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                  <Pressable
                    accessibilityRole="button"
                    disabled={bridge.busy || !!bridge.sharing}
                    onPress={() => {
                      void bridge.pickFolder().catch(() => {});
                    }}
                    className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
                    style={({ pressed }) =>
                      pressed ? { opacity: 0.82 } : null
                    }
                  >
                    <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
                      Folder
                    </Text>
                    <Text
                      numberOfLines={1}
                      className="max-w-40 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                    >
                      {bridge.folder?.displayName ?? "Not shared"}
                    </Text>
                    {!bridge.sharing ? (
                      <ChevronRight color={theme.textSecondary} size={18} />
                    ) : null}
                  </Pressable>
                  <Separator />
                  <Checkbox
                    className="min-h-14 px-sp-4 py-sp-3"
                    accessibilityLabel="Share app files and media"
                    disabled={bridge.busy || !!bridge.sharing}
                    checked={bridge.sharing?.grant.workspace ?? workspace}
                    onCheckedChange={setWorkspace}
                  >
                    App files &amp; media
                  </Checkbox>
                  <Separator />
                  <Checkbox
                    className="min-h-14 px-sp-4 py-sp-3"
                    accessibilityLabel="Share enabled skills"
                    disabled={bridge.busy || !!bridge.sharing}
                    checked={bridge.sharing?.grant.skills ?? skills}
                    onCheckedChange={setSkills}
                  >
                    Skills
                  </Checkbox>
                </View>
                {bridge.folder && !bridge.sharing ? (
                  <Button
                    variant="outline"
                    disabled={bridge.busy}
                    onPress={() => {
                      void bridge.clearFolder();
                    }}
                  >
                    Remove folder
                  </Button>
                ) : null}
              </View>

              {bridge.sharing ? (
                <View className="gap-sp-2">
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    MCP connection
                  </Text>
                  <View className="rounded-card border border-border px-sp-4 py-sp-3 dark:border-border-dark">
                    <Text
                      selectable
                      className="font-sans text-sm text-foreground dark:text-foreground-dark"
                    >
                      {bridge.sharing.url}
                    </Text>
                  </View>
                  {bridge.sharing.needsOverride ? (
                    <Text
                      accessibilityRole="alert"
                      className="font-sans text-sm text-destructive dark:text-destructive-dark"
                    >
                      No matching network. Choose an address in Advanced.
                    </Text>
                  ) : null}
                  <Button
                    variant="secondary"
                    onPress={() => {
                      const shared = bridge.sharing;
                      if (shared)
                        copy(
                          JSON.stringify(
                            {
                              url: shared.url,
                              headers: {
                                Authorization: `Bearer ${shared.token}`,
                              },
                            },
                            null,
                            2,
                          ),
                          "MCP connection copied. Treat it as a secret.",
                        );
                    }}
                  >
                    Copy MCP connection
                  </Button>
                  <Button
                    variant="outline"
                    disabled={bridge.busy}
                    onPress={() => {
                      setNotice(null);
                      void bridge.stop();
                    }}
                  >
                    Stop sharing
                  </Button>
                </View>
              ) : (
                <Button
                  variant="secondary"
                  loading={bridge.busy}
                  disabled={!bridge.folder && !workspace && !skills}
                  onPress={() => {
                    setNotice(null);
                    void bridge.start({
                      folder: bridge.folder,
                      workspace,
                      skills,
                    });
                  }}
                >
                  Start sharing
                </Button>
              )}

              <Pressable
                accessibilityRole="button"
                onPress={() => setPage(1)}
                className="min-h-14 flex-row items-center gap-sp-3 rounded-card border border-border px-sp-4 py-sp-3 dark:border-border-dark"
                style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
              >
                <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
                  Advanced
                </Text>
                <ChevronRight color={theme.textSecondary} size={18} />
              </Pressable>
              {status}
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
                <DrawerTitle>Advanced</DrawerTitle>
              </View>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="pb-sp-4">
              <View className="gap-sp-2">
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  Network
                </Text>
                <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                  {(["auto", "loopback", "lan", "tailnet"] as const).map(
                    (option, index) => (
                      <View key={option}>
                        {index > 0 ? <Separator /> : null}
                        <Pressable
                          accessibilityRole="radio"
                          accessibilityState={{
                            checked: bridge.preference === option,
                            disabled: bridge.busy,
                          }}
                          disabled={bridge.busy}
                          onPress={() => bridge.setPreference(option)}
                          className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
                          style={({ pressed }) =>
                            pressed ? { opacity: 0.82 } : null
                          }
                        >
                          <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
                            {NETWORK_LABEL[option]}
                          </Text>
                          {bridge.preference === option ? (
                            <Check color={theme.text} size={18} />
                          ) : null}
                        </Pressable>
                      </View>
                    ),
                  )}
                </View>
              </View>
              {bridge.sharing ? (
                <View className="gap-sp-2">
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    Addresses
                  </Text>
                  <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                    {addresses.map((item, index) => (
                      <View key={item.url}>
                        {index > 0 ? <Separator /> : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Copy ${NETWORK_LABEL[item.reach]} address`}
                          onPress={() => copy(item.url, "Address copied.")}
                          className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
                          style={({ pressed }) =>
                            pressed ? { opacity: 0.82 } : null
                          }
                        >
                          <View className="flex-1 gap-1">
                            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                              {NETWORK_LABEL[item.reach]}
                            </Text>
                            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                              {item.url}
                            </Text>
                          </View>
                          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                            Copy
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              <View className="gap-sp-2">
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  Address override
                </Text>
                <Input
                  autoCapitalize="none"
                  autoCorrect={false}
                  disabled={bridge.busy}
                  keyboardType="numbers-and-punctuation"
                  placeholder="Automatic"
                  value={manualDraft}
                  onBlur={commitManualAddress}
                  onChangeText={setManualDraft}
                  onEndEditing={commitManualAddress}
                  onSubmitEditing={commitManualAddress}
                />
              </View>
              <View className="gap-sp-2">
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  USB forwarding
                </Text>
                <View className="rounded-card border border-border px-sp-4 py-sp-3 dark:border-border-dark">
                  <Text
                    selectable
                    className="font-sans text-sm text-foreground dark:text-foreground-dark"
                  >{`adb forward tcp:${bridge.sharing?.port ?? PHONE_BRIDGE_PORT} tcp:${bridge.sharing?.port ?? PHONE_BRIDGE_PORT}`}</Text>
                </View>
              </View>
              <Button
                variant="outline"
                disabled={bridge.busy}
                onPress={() => {
                  setNotice(null);
                  void bridge.revoke();
                }}
              >
                Revoke pairing
              </Button>
              {status}
            </DrawerBody>
          </DrawerPagerPage>
        </DrawerPager>
      </DrawerContent>
    </Drawer>
  );
}
