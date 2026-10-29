import { CameraView, useCameraPermissions } from "expo-camera";
import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "@/components/ui/button";
import { DrawerBody, DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  makeOpenCodeClient,
  normalizeOpenCodeUrl,
  parseOpenCodePairingLink,
} from "@/modules/harnesses/opencode";
import {
  loadOpenCodeConnection,
  saveOpenCodeConnection,
  type SavedOpenCodeConnection,
} from "@/modules/harnesses/opencode-storage";

const EMPTY: SavedOpenCodeConnection = {
  url: "http://127.0.0.1:4096",
  username: "opencode",
  password: "",
  directory: "",
};

export function OpenCodeConnectionForm({
  onConnected,
}: {
  onConnected: () => void;
}) {
  const [connection, setConnection] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"qr" | "manual">("qr");
  const [pairing, setPairing] = useState<{ url: string; code: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [cameraError, setCameraError] = useState(false);
  const [pairingServerUrl, setPairingServerUrl] = useState("");
  const allowInsecureLan = true;
  const [pastedLink, setPastedLink] = useState("");
  const [redeemed, setRedeemed] = useState(false);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const requested = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const endpointUrl = pairingServerUrl;

  useEffect(() => {
    mounted.current = true;
    loadOpenCodeConnection()
      .then((value) => {
        if (mounted.current && value) setConnection(value);
      })
      .catch(() => {
        if (mounted.current) setError("Could not load the saved connection.");
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (mode !== "qr" || requested.current) return;
    requested.current = true;
    void requestPermission().catch(() => {
      if (mounted.current) setCameraError(true);
    });
  }, [mode, requestPermission]);

  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
      if (state === "active") void getPermission().catch(() => {});
    });
    return () => listener.remove();
  }, [getPermission]);

  async function connect() {
    if (request.current || (!pairing && !redeemed)) return;
    let validatedUrl: string;
    try {
      validatedUrl = normalizeOpenCodeUrl(endpointUrl, { allowInsecureLan });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid server URL.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    const timeout = setTimeout(() => controller.abort(), 15000);
    let phase: "pair" | "verify" | "save" =
      pairing && !redeemed ? "pair" : "verify";
    try {
      let next = { ...connection, url: validatedUrl, allowInsecureLan };
      if (pairing && !redeemed) {
        const url = validatedUrl;
        const api = makeOpenCodeClient(
          { ...EMPTY, url, allowInsecureLan },
          expoFetch as typeof globalThis.fetch,
        );
        const session = await api.server.connect(
          { code: pairing.code },
          { signal: controller.signal },
        );
        next = {
          ...connection,
          url,
          allowInsecureLan,
          username: "opencode",
          password: session.token,
          sessionID: undefined,
        };
        // Retain a single-use pairing token even if the subsequent check fails.
        if (controller.signal.aborted) return;
        await saveOpenCodeConnection(next);
        if (mounted.current) {
          setConnection(next);
          setPairing(null);
          setRedeemed(true);
        }
      }
      const api = makeOpenCodeClient(
        next,
        expoFetch as typeof globalThis.fetch,
      );
      phase = "verify";
      const info = await api.server.info({ signal: controller.signal });
      if (!/^2\./.test(info.version)) throw new Error("version");
      await api.session.list({ limit: 1 }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      phase = "save";
      await saveOpenCodeConnection(next);
      if (mounted.current) onConnected();
    } catch {
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? "OpenCode connection timed out. Check the server address and network before retrying."
            : ["127.0.0.1", "localhost", "[::1]"].includes(
                  new URL(validatedUrl).hostname,
                )
              ? "This QR points to localhost on the phone. For desktop pairing, generate the QR with opencode pair --url http://DESKTOP_IP:PORT. Use localhost only if OpenCode runs on this phone."
              : phase === "pair"
                ? "Could not redeem the pairing code. Check the desktop address, then scan a fresh OpenCode pairing QR."
                : phase === "save"
                  ? "OpenCode responded, but the connection could not be saved securely."
                  : "Pairing credentials were saved, but OpenCode verification failed. Retry Connect without scanning again.",
        );
    } finally {
      clearTimeout(timeout);
      request.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <>
      <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
        {mode === "qr" ? (
          <>
            <View
              className="overflow-hidden rounded-card bg-black"
              style={styles.scanner}
            >
              {permission?.granted && foreground && !pairing && !cameraError ? (
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onMountError={() => setCameraError(true)}
                  onBarcodeScanned={({ data }) => {
                    if (scanned.current || busy) return;
                    scanned.current = true;
                    try {
                      const parsed = parseOpenCodePairingLink(data, {
                        allowAddressOverride: true,
                      });
                      setPairing(parsed);
                      setRedeemed(false);
                      setPairingServerUrl(parsed.url);
                      setError(null);
                    } catch {
                      setError("Not a supported OpenCode pairing code.");
                      scanned.current = false;
                    }
                  }}
                />
              ) : null}
              <View pointerEvents="none" style={styles.overlay}>
                {pairing ? (
                  <Text className="font-sans text-base text-white">
                    QR code scanned
                  </Text>
                ) : (
                  <View style={styles.guide} />
                )}
              </View>
            </View>
            {pairing ? (
              <>
                <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                  Server URL
                </Text>
                <Input
                  value={pairingServerUrl}
                  disabled={busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={(url) => {
                    setPairingServerUrl(url);
                    setError(null);
                  }}
                />
                {/^http:\/\/(127\.|localhost|0\.0\.0\.0)/i.test(pairing.url) ? (
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    For a desktop on Wi-Fi, replace localhost with its LAN IP.
                    Keep the port unchanged.
                  </Text>
                ) : null}
              </>
            ) : (
              <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Scan your OpenCode pairing code
              </Text>
            )}
            {cameraError ? (
              <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Camera unavailable. Use the server URL instead.
              </Text>
            ) : null}
            {permission && !permission.granted ? (
              <Button
                variant="outline"
                onPress={() => {
                  if (permission.canAskAgain)
                    void requestPermission().catch(() => setCameraError(true));
                  else void Linking.openSettings().catch(() => {});
                }}
              >
                {permission.canAskAgain
                  ? "Allow camera"
                  : "Open camera settings"}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
              Pairing link
            </Text>
            <Input
              value={pastedLink}
              disabled={loading || busy}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://your-server/auth/connect/…"
              secureTextEntry
              onChangeText={(link) => {
                setPastedLink(link);
                setRedeemed(false);
                setError(null);
                try {
                  const parsed = parseOpenCodePairingLink(link, {
                    allowAddressOverride: true,
                  });
                  setPairing(parsed);
                  setPairingServerUrl(parsed.url);
                } catch {
                  setPairing(null);
                  setPairingServerUrl("");
                }
              }}
            />
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Paste the full link from OpenCode Pair. No password is required.
            </Text>
            {pairing ? (
              <>
                <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                  Server URL
                </Text>
                <Input
                  value={pairingServerUrl}
                  disabled={busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={(url) => {
                    setPairingServerUrl(url);
                    setError(null);
                  }}
                />
                {/^http:\/\/(127\.|localhost|0\.0\.0\.0)/i.test(pairing.url) ? (
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    For Wi-Fi, enter the desktop LAN IP and keep the port.
                  </Text>
                ) : null}
              </>
            ) : null}
          </>
        )}
        {error ? (
          <Text
            accessibilityRole="alert"
            className="font-sans text-sm text-destructive dark:text-destructive-dark"
          >
            {error}
          </Text>
        ) : null}
      </DrawerBody>
      <DrawerFooter className="items-center gap-sp-3">
        <Button
          className="w-full"
          loading={busy}
          disabled={loading || busy || (!pairing && !redeemed)}
          onPress={() => {
            void connect();
          }}
        >
          Connect
        </Button>
        <Pressable
          accessibilityRole="link"
          className="items-center"
          hitSlop={8}
          disabled={busy}
          onPress={() => {
            setMode((value) => (value === "qr" ? "manual" : "qr"));
            setError(null);
          }}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <Text className="font-sans text-sm text-muted-foreground underline dark:text-muted-foreground-dark">
            {mode === "qr" ? "Use server URL instead" : "Scan QR code instead"}
          </Text>
        </Pressable>
      </DrawerFooter>
    </>
  );
}

const styles = StyleSheet.create({
  scanner: { height: 280, width: "100%" },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  guide: {
    width: 200,
    height: 200,
    borderWidth: 2,
    borderColor: "white",
    borderRadius: 16,
  },
});
