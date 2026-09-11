import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";

import { settleProxyOAuthCallback } from "@/modules/mcp/oauth";
import { setProxyOAuthSession } from "@/modules/mcp/proxy";

function firstParam(value: string[] | string | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function McpOAuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    error?: string[] | string;
    proxy?: string[] | string;
    server?: string[] | string;
  }>();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) {
      return;
    }
    handled.current = true;

    const server = firstParam(params.server);
    const proxy = firstParam(params.proxy);
    const error = firstParam(params.error);

    (async () => {
      try {
        if (server && proxy) {
          await setProxyOAuthSession(server, proxy);
          settleProxyOAuthCallback(server, proxy);
        } else if (server && error) {
          settleProxyOAuthCallback(server, null, error);
        } else if (server) {
          settleProxyOAuthCallback(server, null, "MCP OAuth proxy returned no credentials.");
        }
      } finally {
        router.replace("/settings/mcp/connected" as never);
      }
    })();
  }, [params, router]);

  return (
    <View className="flex-1 items-center justify-center gap-sp-2 bg-background">
      <Text className="font-sans text-sm text-foreground">
        Finishing MCP connection…
      </Text>
    </View>
  );
}