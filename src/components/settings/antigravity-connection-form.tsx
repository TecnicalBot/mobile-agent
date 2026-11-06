import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { DrawerBody, DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  normalizeAntigravityUrl,
  testAntigravityConnection,
  type AntigravityConnection,
} from "@/modules/harnesses/antigravity";
import {
  loadAntigravityConnection,
  saveAntigravityConnection,
  type SavedAntigravityConnection,
} from "@/modules/harnesses/antigravity-storage";

const EMPTY: SavedAntigravityConnection = {
  url: "http://127.0.0.1:7801",
  token: "",
  cwd: "",
  allowInsecureLan: true,
};

export function AntigravityConnectionForm({
  onConnected,
}: {
  onConnected: () => void;
}) {
  const [connection, setConnection] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    loadAntigravityConnection()
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

  async function connect() {
    if (request.current) return;
    let validatedUrl: string;
    try {
      validatedUrl = normalizeAntigravityUrl(connection.url, {
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
    const next: AntigravityConnection = {
      url: validatedUrl,
      token: connection.token,
      cwd: connection.cwd,
      allowInsecureLan: true,
    };
    try {
      await testAntigravityConnection(next, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      await saveAntigravityConnection(next);
      if (mounted.current) {
        setConnection(next);
        onConnected();
      }
    } catch (cause) {
      if (!mounted.current) return;
      const detail =
        cause instanceof Error ? cause.message.trim() : "";
      if (controller.signal.aborted)
        setError(
          "Antigravity connection timed out. Check the bridge address and network before retrying.",
        );
      else if (/auth|sign.?in|-32000/i.test(detail))
        setError(
          "The bridge is reachable, but Antigravity is not signed in. Run `agy acp --login` on the bridge host, then try again.",
        );
      else if (/401|unauthor/i.test(detail))
        setError(
          "The bridge rejected this token. Use the same token you passed to bridge.mjs.",
        );
      else
        setError(
          `Could not reach the Antigravity bridge.${
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
          placeholder="http://192.168.1.20:7801"
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
          placeholder="The token passed to bridge.mjs"
          onChangeText={(token) => {
            setConnection((current) => ({ ...current, token }));
            setError(null);
          }}
        />
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
            Run the bridge where Antigravity is installed
          </Text>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Sign in once with `agy acp --login`, then start the bridge:
          </Text>
          <Text
            selectable
            className="font-sans text-xs text-foreground dark:text-foreground-dark"
          >
            node tools/antigravity-bridge/bridge.mjs --host 0.0.0.0 --port 7801
            --token YOUR_TOKEN
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
