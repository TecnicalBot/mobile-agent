import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { usePhoneBridge } from "@/providers/phone-bridge-state";
import { Button } from "@/components/ui/button";
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
import { useHarness } from "@/providers/harness-state";
import type { BridgeReach } from "@/modules/bridge/reach";

const REACH_LABEL: Record<BridgeReach, string> = {
  loopback: "This phone",
  lan: "Local network",
  tailnet: "Tailscale",
};

const REACH_PREFERENCE_LABEL = {
  auto: "Automatic",
  loopback: "This phone",
  lan: "Local network",
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
  const harness = useHarness();
  const [attaching, setAttaching] = useState(false);
  const [workspace, setWorkspace] = useState(false);
  const [skills, setSkills] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
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
    bridge.urls.tailnet && { reach: "tailnet" as const, url: bridge.urls.tailnet },
    { reach: "loopback" as const, url: bridge.urls.loopback },
  ].filter((item): item is { reach: BridgeReach; url: string } => Boolean(item));

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent showCloseButton showHandle size={720}>
        <DrawerHeader>
          <DrawerTitle>Phone tools</DrawerTitle>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Share selected capabilities with a harness. Every tool call needs
            approval on this phone. A stable pairing token means a harness is
            configured once, not on every session.
          </Text>
          <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
            Reach
          </Text>
          <View className="flex-row flex-wrap gap-sp-2">
            {(["auto", "loopback", "lan", "tailnet"] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={bridge.preference === option ? "secondary" : "ghost"}
                onPress={() => bridge.setPreference(option)}
              >
                {REACH_PREFERENCE_LABEL[option]}
              </Button>
            ))}
          </View>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Local network sharing is not encrypted. Prefer Tailscale on
            untrusted Wi-Fi; loopback never leaves the phone.
          </Text>
          {bridge.sharing ? (
            <>
              <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                {`${bridge.sharing.toolCount} tools shared · ${REACH_LABEL[bridge.sharing.reach]}`}
              </Text>
              <Text
                selectable
                className="font-sans text-sm text-foreground dark:text-foreground-dark"
              >
                {bridge.sharing.url}
              </Text>
              {bridge.sharing.needsOverride ? (
                <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                  The harness address could not be matched to an interface on
                  this phone. Pick the address it can reach below.
                </Text>
              ) : null}
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Reachable addresses
              </Text>
              {addresses.map((item) => (
                <View
                  key={item.url}
                  className="flex-row items-center justify-between gap-sp-3"
                >
                  <View className="flex-1">
                    <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                      {REACH_LABEL[item.reach]}
                      {item.url === bridge.sharing?.url ? " · in use" : ""}
                    </Text>
                    <Text
                      selectable
                      className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                    >
                      {item.url}
                    </Text>
                  </View>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      copy(
                        item.url,
                        `${REACH_LABEL[item.reach]} URL copied.`,
                      )
                    }
                  >
                    Copy
                  </Button>
                </View>
              ))}
              {harness.connected ? (
                <Button
                  variant="outline"
                  loading={attaching}
                  onPress={() => {
                    if (attaching) return;
                    setAttaching(true);
                    void harness
                      .connectPhoneTools()
                      .then(() => setNotice("OpenCode reconnected."))
                      .catch(() =>
                        setNotice(
                          "OpenCode could not reach this phone on that address.",
                        ),
                      )
                      .finally(() => setAttaching(false));
                  }}
                >
                  {harness.phoneToolsEnabled
                    ? "Reconnect OpenCode"
                    : "Connect OpenCode"}
                </Button>
              ) : null}
              <Button
                variant="outline"
                onPress={() => {
                  if (!bridge.sharing) return;
                  copy(
                    JSON.stringify(
                      {
                        url: bridge.sharing.url,
                        headers: {
                          Authorization: `Bearer ${bridge.sharing.token}`,
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
            </>
          ) : (
            <>
              <Button
                disabled={bridge.busy}
                variant="outline"
                onPress={() => {
                  void bridge.pickFolder().catch(() => {});
                }}
              >
                {bridge.folder?.displayName ?? "Choose phone folder"}
              </Button>
              {bridge.folder ? (
                <Button
                  disabled={bridge.busy}
                  variant="ghost"
                  onPress={() => {
                    void bridge.clearFolder();
                  }}
                >
                  Remove folder
                </Button>
              ) : null}
              <View className="flex-row items-center justify-between gap-sp-3">
                <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
                  App workspace and document/video generation
                </Text>
                <Checkbox
                  disabled={bridge.busy}
                  checked={workspace}
                  onCheckedChange={setWorkspace}
                />
              </View>
              <View className="flex-row items-center justify-between gap-sp-3">
                <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
                  Enabled skills and supporting files
                </Text>
                <Checkbox
                  disabled={bridge.busy}
                  checked={skills}
                  onCheckedChange={setSkills}
                />
              </View>
            </>
          )}

          <Button
            size="sm"
            variant="ghost"
            onPress={() => setAdvanced((value) => !value)}
          >
            {advanced ? "Hide advanced" : "Advanced"}
          </Button>
          {advanced ? (
            <View className="gap-sp-2">
              <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                Advertise a specific address
              </Text>
              <Input
                autoCapitalize="none"
                autoCorrect={false}
                disabled={bridge.busy}
                keyboardType="numbers-and-punctuation"
                placeholder="192.168.1.5 or 100.101.102.103"
                value={manualDraft}
                onBlur={commitManualAddress}
                onChangeText={setManualDraft}
                onEndEditing={commitManualAddress}
                onSubmitEditing={commitManualAddress}
              />
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Leave empty to pick the address the harness is using. USB
                debugging still works if both devices are connected:
              </Text>
              <Text
                selectable
                className="font-sans text-xs text-foreground dark:text-foreground-dark"
              >{`adb forward tcp:${bridge.sharing?.port ?? 43877} tcp:${bridge.sharing?.port ?? 43877}`}</Text>
            </View>
          ) : null}

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
        </DrawerBody>
        <DrawerFooter className="gap-sp-2">
          {bridge.sharing ? (
            <>
              <Button
                className="w-full"
                variant="outline"
                onPress={() => {
                  setNotice(null);
                  void bridge.stop();
                }}
              >
                Stop sharing
              </Button>
              <Button
                className="w-full"
                variant="ghost"
                onPress={() => {
                  setNotice(null);
                  void bridge.revoke();
                }}
              >
                Revoke pairing
              </Button>
            </>
          ) : (
            <Button
              className="w-full"
              loading={bridge.busy}
              disabled={!bridge.folder && !workspace && !skills}
              onPress={() => {
                setNotice(null);
                void bridge.start({ folder: bridge.folder, workspace, skills });
              }}
            >
              Start sharing
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
