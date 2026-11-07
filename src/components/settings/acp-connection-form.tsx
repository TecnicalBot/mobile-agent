import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { DrawerBody, DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  normalizeAcpUrl,
  testAcpConnection,
  type AcpConnection,
} from "@/modules/harnesses/acp-client";
import {
  ACP_AUTH_ERROR_PATTERN,
  type AcpHarnessProfile,
} from "@/modules/harnesses/acp-profile";
import {
  loadAcpConnection,
  loadSharedAcpToken,
  saveAcpConnection,
  type SavedAcpConnection,
} from "@/modules/harnesses/acp-storage";

const EMPTY_DEFAULT = "http://127.0.0.1";

function initialConnection(profile: AcpHarnessProfile): SavedAcpConnection {
  return {
    url: `${EMPTY_DEFAULT}:${profile.defaultPort}`,
    token: "",
    cwd: "",
    allowInsecureLan: true,
  };
}

export function AcpConnectionForm({
  profile,
  onConnected,
}: {
  profile: AcpHarnessProfile;
  onConnected: () => void;
}) {
  const [connection, setConnection] = useState<SavedAcpConnection>(() =>
    initialConnection(profile),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    setConnection(initialConnection(profile));
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

  async function connect() {
    if (request.current) return;
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

  return (
    <>
      <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
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
          One stable token is shared by every harness bridge. On the bridge host
          it lives in ~/.config/mobile-agent/bridge-token (or
          %APPDATA%\mobile-agent\bridge-token on Windows). Paste it here once.
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
            Download the single-file bridge once, then run it:
          </Text>
          <Text
            selectable
            className="font-sans text-xs text-foreground dark:text-foreground-dark"
          >
            curl -fsSL
            https://raw.githubusercontent.com/tecnicalbot/mobile-agent/main/tools/acp-bridge/bridge.mjs
            -o mobile-agent-bridge.mjs
          </Text>
          <Text
            selectable
            className="font-sans text-xs text-foreground dark:text-foreground-dark"
          >
            node mobile-agent-bridge.mjs --harness {profile.id} --host 0.0.0.0
            --port {profile.defaultPort}
          </Text>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            The bridge creates one stable token on first run and reuses it after
            every restart. Both harnesses share the same token file, so you only
            need to paste the token once.
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Starting both harnesses? Run{" "}
            <Text className="font-mono">
              node mobile-agent-bridge.mjs --harness all --lan
            </Text>{" "}
            once instead. Repo contributors can use{" "}
            <Text className="font-mono">
              node tools/{profile.bridgeDirectory}/bridge.mjs
            </Text>
            .
          </Text>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Use the computer&apos;s LAN address here. For internet access, put
            the bridge behind HTTPS or a private tunnel rather than exposing
            plain HTTP.
          </Text>
        </View>
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
          disabled={loading || busy}
          onPress={() => {
            void connect();
          }}
        >
          Connect
        </Button>
      </DrawerFooter>
    </>
  );
}
