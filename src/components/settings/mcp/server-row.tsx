import { KeyRound, RefreshCw, Trash2 } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import type { McpServerConfig } from "@/types/app-state";

function formatMcpError(message: string) {
  const withoutMachineCode = message.replace(
    /^[a-z][a-z0-9_]*_[a-z0-9_]+:\s*/,
    "",
  );
  const legacyPrefix = /^Could not connect using Streamable HTTP or SSE\.\s*/i;
  if (!legacyPrefix.test(withoutMachineCode)) return withoutMachineCode;

  const transportErrors = withoutMachineCode
    .replace(legacyPrefix, "")
    .split(/\s+\|\s+(?=(?:HTTP|SSE):)/i)
    .map((entry) => entry.replace(/^(?:HTTP|SSE):\s*/i, "").trim())
    .filter(Boolean);
  const specific = transportErrors.find((entry) =>
    /oauth|error_description|unauthori[sz]ed|forbidden|invalid_|\b(?:400|401|403|404|409|422|429)\b/i.test(
      entry,
    ),
  );

  return (specific ?? transportErrors[0] ?? withoutMachineCode).replace(
    /^[a-z][a-z0-9_]*_[a-z0-9_]+:\s*/,
    "",
  );
}

export function McpServerRow({
  busyKey,
  onClearCredentials,
  onConnectOAuth,
  onDelete,
  onEdit,
  onTest,
  onToggle,
  server,
}: {
  busyKey: string | null;
  onClearCredentials: () => void;
  onConnectOAuth: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: (enabled: boolean) => void;
  server: McpServerConfig;
}) {
  const theme = useTheme();
  const statusText =
    server.lastStatus === "connected"
      ? `${server.toolCount ?? 0} tools`
      : server.lastStatus === "failed"
        ? "Failed"
        : "Untested";

  return (
    <View className="gap-sp-3 px-sp-4 py-sp-4">
      <Pressable
        accessibilityRole="button"
        className="flex-row items-start gap-sp-3"
        onPress={onEdit}
        style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
      >
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center gap-sp-2">
            <Text className="min-w-0 flex-1 font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
              {server.label}
            </Text>
            <StatusPill status={server.lastStatus} text={statusText} />
          </View>
          <Text
            className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
            numberOfLines={1}
          >
            {server.transport.toUpperCase()} · {server.authMode} · {server.url}
          </Text>
          {server.lastError ? (
            <Text
              className="font-sans text-xs text-destructive dark:text-destructive-dark"
              numberOfLines={2}
            >
              {formatMcpError(server.lastError)}
            </Text>
          ) : null}
        </View>
        <View pointerEvents="none">
          <Checkbox checked={server.enabled} onCheckedChange={() => {}} />
        </View>
      </Pressable>
      <View className="flex-row flex-wrap gap-sp-2">
        <Button
          disabled={busyKey === `toggle:${server.id}`}
          onPress={() => onToggle(!server.enabled)}
          size="sm"
          variant="outline"
        >
          {server.enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          leftIcon={<RefreshCw color={theme.text} size={14} />}
          loading={busyKey === `test:${server.id}`}
          onPress={onTest}
          size="sm"
          variant="outline"
        >
          Test
        </Button>
        {server.authMode === "oauth" ? (
          <Button
            leftIcon={<KeyRound color={theme.text} size={14} />}
            loading={busyKey === `oauth:${server.id}`}
            onPress={onConnectOAuth}
            size="sm"
            variant="outline"
          >
            OAuth
          </Button>
        ) : null}
        <Button
          loading={busyKey === `clear:${server.id}`}
          onPress={onClearCredentials}
          size="sm"
          variant="ghost"
        >
          Clear auth
        </Button>
        <Button
          leftIcon={<Trash2 color={theme.destructive} size={14} />}
          loading={busyKey === `delete:${server.id}`}
          onPress={onDelete}
          size="sm"
          variant="ghost"
        >
          Delete
        </Button>
      </View>
    </View>
  );
}

function StatusPill({
  status,
  text,
}: {
  status: McpServerConfig["lastStatus"];
  text: string;
}) {
  return (
    <View
      className={cn(
        "rounded-ui border px-sp-2 py-1",
        status === "connected"
          ? "border-border bg-secondary dark:border-border-dark dark:bg-secondary-dark"
          : status === "failed"
            ? "border-destructive bg-destructive/10"
            : "border-border bg-secondary dark:border-border-dark dark:bg-secondary-dark",
      )}
    >
      <Text className="font-sans text-xs text-foreground dark:text-foreground-dark">
        {text}
      </Text>
    </View>
  );
}
