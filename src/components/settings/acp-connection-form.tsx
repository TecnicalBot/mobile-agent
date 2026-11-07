import { CameraView, useCameraPermissions } from "expo-camera";
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
  normalizeAcpUrl,
  testAcpConnection,
  type AcpConnection,
} from "@/modules/harnesses/acp-client";
import {
  parseAcpPairingPayload,
  redeemAcpPairing,
  type AcpPairingPayload,
} from "@/modules/harnesses/acp-pairing";
import {
  ACP_AUTH_ERROR_PATTERN,
  ACP_PROFILES,
  type AcpHarnessProfile,
} from "@/modules/harnesses/acp-profile";
import {
  loadAcpConnection,
  loadSharedAcpToken,
  saveAcpConnection,
  type SavedAcpConnection,
} from "@/modules/harnesses/acp-storage";

function initialConnection(): SavedAcpConnection {
  return {
    url: "",
    token: "",
    cwd: "",
    allowInsecureLan: true,
  };
}

type PairResult = {
  profile: AcpHarnessProfile;
  connection: SavedAcpConnection | null;
  phase: "redeem" | "save" | "verify";
  error: Error | null;
};

function pairErrorMessage(result: PairResult, aborted: boolean): string {
  if (aborted) {
    return `${result.profile.label} pairing timed out. Check the bridge address and network.`;
  }
  const detail = result.error?.message.trim() ?? "";
  if (result.phase === "redeem") {
    return `Could not redeem the ${result.profile.label} pairing code. Run \`mabridge\` again for a fresh QR.${
      detail ? ` (${detail})` : ""
    }`;
  }
  if (result.phase === "save") {
    return `The ${result.profile.label} pairing code was redeemed, but the connection could not be saved securely.${
      detail ? ` (${detail})` : ""
    }`;
  }
  if (/401|unauthor/i.test(detail)) {
    return `The ${result.profile.label} bridge rejected the shared token. Try a fresh pairing QR.`;
  }
  if (ACP_AUTH_ERROR_PATTERN.test(detail)) {
    return result.profile.signInHint;
  }
  return `Could not reach the ${result.profile.label} bridge.${
    detail ? ` (${detail})` : ""
  }`;
}

export function AcpConnectionForm({
  profile,
  onConnected,
}: {
  profile: AcpHarnessProfile;
  onConnected: () => void;
}) {
  const [connection, setConnection] = useState<SavedAcpConnection>(() =>
    initialConnection(),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"qr" | "manual">("qr");
  const [pairing, setPairing] = useState<AcpPairingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [cameraError, setCameraError] = useState(false);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const scanned = useRef(false);
  const requested = useRef(false);

  useEffect(() => {
    mounted.current = true;
    setConnection(initialConnection());
    Promise.all([loadAcpConnection(profile), loadSharedAcpToken()])
      .then(([value, shared]) => {
        if (!mounted.current) return;
        if (value) setConnection(value);
        else if (shared)
          setConnection((current) => ({ ...current, token: shared }));
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
    // The profile is fixed for the life of a form instance.
  }, [profile]);

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
    if (request.current) return;
    if (!connection.url.trim()) {
      setError(
        `Enter the bridge URL, for example http://192.168.1.20:${profile.defaultPort}.`,
      );
      return;
    }
    let validatedUrl: string;
    try {
      validatedUrl = normalizeAcpUrl(connection.url, {
        allowInsecureLan: true,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid bridge URL.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    const timeout = setTimeout(() => controller.abort(), 30000);
    const next: AcpConnection = {
      url: validatedUrl,
      token: connection.token,
      cwd: connection.cwd,
      allowInsecureLan: true,
    };
    try {
      await testAcpConnection(next, {
        agentLabel: profile.label,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      await saveAcpConnection(profile, next);
      if (mounted.current) {
        setConnection(next);
        onConnected();
      }
    } catch (cause) {
      if (!mounted.current) return;
      const detail = cause instanceof Error ? cause.message.trim() : "";
      if (controller.signal.aborted)
        setError(
          `${profile.label} connection timed out. Check the bridge address and network before retrying.`,
        );
      else if (/401|unauthor/i.test(detail))
        setError(
          "The bridge rejected this token. Paste the token printed on the bridge's first run, or read it from ~/.config/mobile-agent/bridge-token.",
        );
      else if (ACP_AUTH_ERROR_PATTERN.test(detail))
        setError(profile.signInHint);
      else
        setError(
          `Could not reach the ${profile.label} bridge.${
            detail ? ` (${detail})` : ""
          }`,
        );
    } finally {
      clearTimeout(timeout);
      request.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  async function pairFromQr(payload: AcpPairingPayload) {
    if (request.current) return;
    const ownEntry = payload.bridges.find((entry) => entry.id === profile.id);
    if (!ownEntry) {
      setError(
        `This QR code does not include ${profile.label}. Run \`mabridge\` with both harnesses, then scan again.`,
      );
      scanned.current = false;
      setPairing(null);
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    const timeout = setTimeout(() => controller.abort(), 45000);

    const results = await Promise.all(
      payload.bridges.map(async (entry): Promise<PairResult> => {
        const entryProfile = ACP_PROFILES.find(
          (candidate) => candidate.id === entry.id,
        );
        if (!entryProfile) {
          return {
            profile,
            connection: null,
            phase: "redeem",
            error: new Error("Unsupported harness."),
          };
        }
        let token: string;
        try {
          token = await redeemAcpPairing(entry, {
            signal: controller.signal,
          });
        } catch (cause) {
          return {
            profile: entryProfile,
            connection: null,
            phase: "redeem",
            error:
              cause instanceof Error ? cause : new Error("Pairing failed."),
          };
        }

        const next: SavedAcpConnection = {
          url: entry.url,
          token,
          cwd: "",
          allowInsecureLan: true,
        };
        try {
          // Save the stable token immediately. A consumed QR code must not be
          // needed again if only the verification step fails.
          await saveAcpConnection(entryProfile, next);
        } catch (cause) {
          return {
            profile: entryProfile,
            connection: next,
            phase: "save",
            error:
              cause instanceof Error
                ? cause
                : new Error("Could not save the connection."),
          };
        }

        try {
          await testAcpConnection(next, {
            agentLabel: entryProfile.label,
            signal: controller.signal,
          });
          return {
            profile: entryProfile,
            connection: next,
            phase: "verify",
            error: null,
          };
        } catch (cause) {
          return {
            profile: entryProfile,
            connection: next,
            phase: "verify",
            error:
              cause instanceof Error
                ? cause
                : new Error("Verification failed."),
          };
        }
      }),
    );

    clearTimeout(timeout);
    request.current = null;

    if (!mounted.current) return;

    const own = results.find((result) => result.profile.id === profile.id);
    const failures = results.filter((result) => result.error);

    if (own?.connection) {
      setConnection(own.connection);
    }

    if (own?.error) {
      setError(pairErrorMessage(own, controller.signal.aborted));
      if (own.connection) {
        // The code was redeemed and the token saved, so a manual retry needs
        // no fresh QR.
        setPairing(null);
        setMode("manual");
        scanned.current = false;
      }
    } else if (own) {
      setConnection(own.connection ?? connection);
      setPairing(null);
      scanned.current = false;
      onConnected();
    }

    if (mounted.current) setBusy(false);
    if (own?.error) return;

    if (failures.length > 0) {
      const labels = failures.map((result) => result.profile.label).join(", ");
      setError(
        `Paired ${profile.label}. The ${labels} bridge could not be verified; open its connection settings to retry.`,
      );
    }
  }

  function resetScan() {
    scanned.current = false;
    setPairing(null);
    setError(null);
  }

  const footerDisabled =
    mode === "qr" ? loading || busy || !pairing : loading || busy;

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
                      const parsed = parseAcpPairingPayload(data);
                      setPairing(parsed);
                      setError(null);
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Not a supported Mobile Agent pairing code.",
                      );
                      scanned.current = false;
                    }
                  }}
                />
              ) : null}
              <View pointerEvents="none" style={styles.overlay}>
                {pairing ? (
                  <Text className="text-center font-sans text-base text-white">
                    QR code scanned
                  </Text>
                ) : (
                  <View style={styles.guide} />
                )}
              </View>
            </View>
            {pairing ? (
              <>
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  {pairing.name
                    ? `Pairing with ${pairing.name}.`
                    : "Pairing QR scanned."}{" "}
                  Tap Connect to save every harness in this code.
                </Text>
                <Pressable
                  accessibilityRole="link"
                  className="self-center"
                  hitSlop={8}
                  disabled={busy}
                  onPress={resetScan}
                  style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
                >
                  <Text className="font-sans text-sm text-muted-foreground underline dark:text-muted-foreground-dark">
                    Scan a different QR
                  </Text>
                </Pressable>
              </>
            ) : (
              <View className="gap-sp-2">
                <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  On the computer, run:
                </Text>
                <Text
                  selectable
                  className="text-center font-mono text-sm text-foreground dark:text-foreground-dark"
                >
                  mabridge
                </Text>
                <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  Then scan the one-time pairing QR. It configures every harness
                  printed in the code.
                </Text>
              </View>
            )}
            {cameraError ? (
              <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Camera unavailable. Use manual details instead.
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
              Bridge URL
            </Text>
            <Input
              value={connection.url}
              disabled={loading || busy}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={`http://192.168.1.20:${profile.defaultPort}`}
              onChangeText={(url) => {
                setConnection((current) => ({ ...current, url }));
                setError(null);
              }}
            />
            <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
              Token
            </Text>
            <Input
              value={connection.token}
              disabled={loading || busy}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="The token printed by the bridge on first run"
              onChangeText={(token) => {
                setConnection((current) => ({ ...current, token }));
                setError(null);
              }}
            />
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              One stable token is shared by every harness bridge. On the bridge
              host it lives in ~/.config/mobile-agent/bridge-token (or
              %APPDATA%\mobile-agent\bridge-token on Windows). QR pairing fills
              this in automatically.
            </Text>
            <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
              Working directory
            </Text>
            <Input
              value={connection.cwd}
              disabled={loading || busy}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Optional. Leave blank for the bridge default."
              onChangeText={(cwd) => {
                setConnection((current) => ({ ...current, cwd }));
                setError(null);
              }}
            />
            <View className="gap-sp-2 rounded-card border border-border p-sp-3 dark:border-border-dark">
              <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                Run the bridge where {profile.label} is installed
              </Text>
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                {profile.bridgeHint}
              </Text>
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Install once, then start both harnesses:
              </Text>
              <Text
                selectable
                className="font-sans text-xs text-foreground dark:text-foreground-dark"
              >
                curl -fsSL
                https://raw.githubusercontent.com/tecnicalbot/mobile-agent/main/tools/install.sh
                | sh
              </Text>
              <Text
                selectable
                className="font-sans text-xs text-foreground dark:text-foreground-dark"
              >
                mabridge
              </Text>
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                `mabridge` prints a one-time QR and creates one stable token
                shared by both bridges. Use `mabridge --no-pair` to print the
                URLs and token instead.
              </Text>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Starting one harness? Run{" "}
                <Text className="font-mono">
                  node bridge.mjs --harness {profile.id} --host 0.0.0.0 --port{" "}
                  {profile.defaultPort}
                </Text>
                . Repo contributors can use{" "}
                <Text className="font-mono">
                  node tools/{profile.bridgeDirectory}/bridge.mjs
                </Text>
                .
              </Text>
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Use the computer&apos;s LAN address here. For internet access,
                put the bridge behind HTTPS or a private tunnel rather than
                exposing plain HTTP.
              </Text>
            </View>
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
          disabled={footerDisabled}
          onPress={() => {
            if (mode === "qr" && pairing) void pairFromQr(pairing);
            else void connect();
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
            {mode === "qr"
              ? "Use manual details instead"
              : "Scan QR code instead"}
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
