import * as Clipboard from "expo-clipboard";
import { useState } from "react";
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
import { PHONE_BRIDGE_PORT } from "@/modules/bridge/native-http-server";
import { useHarness } from "@/providers/harness-state";
import { attachOpenCodePhoneTools } from "@/modules/harnesses/opencode-phone-tools";

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
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent showCloseButton showHandle size={720}>
        <DrawerHeader>
          <DrawerTitle>Phone tools</DrawerTitle>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Share selected capabilities with any MCP-compatible harness. Every
            tool call needs approval on this phone. Keep Mobile Agent open.
          </Text>
          {bridge.sharing ? (
            <>
              <Text className="font-sans text-base text-foreground dark:text-foreground-dark">{`${bridge.sharing.toolCount} tools shared`}</Text>
              <Text
                selectable
                className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
              >
                {bridge.sharing.url}
              </Text>
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Termux can use this URL directly. A desktop needs a secure
                tunnel to this phone. With USB debugging connected:
              </Text>
              <Text
                selectable
                className="font-sans text-sm text-foreground dark:text-foreground-dark"
              >{`adb forward tcp:${PHONE_BRIDGE_PORT} tcp:${PHONE_BRIDGE_PORT}`}</Text>
              {harness.connected ? (
                <Button
                  variant="outline"
                  loading={attaching}
                  onPress={() => {
                    const shared = bridge.sharing;
                    const client = harness.client;
                    if (!shared || !client || attaching) return;
                    setAttaching(true);
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 30000);
                    void attachOpenCodePhoneTools({
                      client,
                      url: shared.url,
                      token: shared.token,
                      signal: controller.signal,
                    })
                      .then((remove) => {
                        bridge.onRevoke(remove);
                        setNotice("OpenCode connected to phone tools.");
                      })
                      .catch(() =>
                        setNotice(
                          "OpenCode could not reach this phone. Set up the tunnel first.",
                        ),
                      )
                      .finally(() => {
                        clearTimeout(timeout);
                        setAttaching(false);
                      });
                  }}
                >
                  Connect OpenCode
                </Button>
              ) : null}
              <Button
                variant="outline"
                onPress={() => {
                  if (!bridge.sharing) return;
                  void Clipboard.setStringAsync(
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
                  )
                    .then(() =>
                      setNotice("MCP connection copied. Treat it as a secret."),
                    )
                    .catch(() => setNotice("Could not copy the connection."));
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
        <DrawerFooter>
          {bridge.sharing ? (
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
