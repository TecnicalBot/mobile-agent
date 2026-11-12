import { Text, View } from "react-native";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/hooks/use-theme";
import type { ContextBreakdown, ContextBreakdownPart } from "@/core/types/app-state";

function formatTokens(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return Math.round(value).toLocaleString();
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

export function ContextBreakdownView({
  breakdown,
  compactionCount,
  modelContextWindow,
  modelLabel,
  reportedTokens,
}: {
  breakdown: ContextBreakdown | null;
  compactionCount: number;
  modelContextWindow: number | null;
  modelLabel: string | null;
  reportedTokens: number | null;
}) {
  const theme = useTheme();

  const colorForPart = (key: string) => {
    switch (key) {
      case "system":
        return theme.syntaxFunction;
      case "tools":
        return theme.syntaxString;
      case "tool-management":
        return theme.syntaxOperator;
      case "mcp":
        return theme.syntaxKeyword;
      case "skills":
        return theme.syntaxNumber;
      case "memory":
        return theme.syntaxRegex;
      case "plugins":
        return theme.syntaxConstant;
      case "messages":
        return theme.text;
      case "reserved":
        return theme.textSecondary;
      case "free":
        return theme.border;
      default:
        return theme.textSecondary;
    }
  };

  // Keep labels consistent for snapshots captured before a category rename.
  const labelForPart = (part: ContextBreakdownPart) => {
    if (part.key === "reserved") return "Output & safety reserve";
    if (part.key === "tool-management") return "Agent runtime tools";
    return part.label;
  };

  const parts = breakdown?.parts.filter((part) => part.tokens > 0) ?? [];
  const contextWindow = breakdown?.contextWindow ?? null;
  const usedTokens = breakdown?.usedTokens ?? null;
  const freePart = parts.find((part) => part.key === "free");
  const usedPercent =
    contextWindow !== null && contextWindow > 0 && usedTokens !== null
      ? (usedTokens / contextWindow) * 100
      : null;

  if (!breakdown || contextWindow === null || usedTokens === null) {
    return (
      <Card>
        <CardHeader className="gap-sp-1">
          <CardTitle className="text-lg">No context snapshot yet</CardTitle>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Send a message in a local chat. After the turn completes, this
            shows where the context window went.
          </Text>
        </CardHeader>
        <CardContent className="gap-sp-2">
          <SummaryMetric label="Model" value={modelLabel ?? "None selected"} />
          <SummaryMetric
            label="Context window"
            value={formatTokens(modelContextWindow)}
          />
          {reportedTokens !== null ? (
            <SummaryMetric
              label="Last reported usage"
              value={formatTokens(reportedTokens)}
            />
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="gap-sp-1">
          <CardTitle className="text-lg">Context usage</CardTitle>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {modelLabel ?? "Current model"} · {formatTokens(contextWindow)} token
            window
          </Text>
        </CardHeader>
        <CardContent className="gap-sp-3">
          <View className="h-3 flex-row overflow-hidden rounded-full bg-muted dark:bg-muted-dark">
            {parts.map((part) => (
              <View
                key={part.key}
                style={{
                  backgroundColor: colorForPart(part.key),
                  flex: Math.max(part.tokens, 1),
                }}
              />
            ))}
          </View>

          <View className="flex-row flex-wrap gap-sp-3">
            <SummaryMetric
              label="Used"
              value={`${formatTokens(usedTokens)}${
                usedPercent !== null ? ` · ${formatPercent(usedPercent)}` : ""
              }`}
            />
            <SummaryMetric
              label="Free"
              value={formatTokens(freePart?.tokens ?? 0)}
            />
            <SummaryMetric
              label="Reserved"
              value={formatTokens(breakdown.reserved)}
            />
          </View>

          {reportedTokens !== null ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              The provider reported {formatTokens(reportedTokens)} tokens for the
              latest turn.
            </Text>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="gap-sp-1">
          <CardTitle className="text-lg">Breakdown</CardTitle>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {compactionCount > 0
              ? `History was compacted ${compactionCount} time${
                  compactionCount === 1 ? "" : "s"
                }; this reflects the latest run.`
              : "Token counts are estimates (4 characters ≈ 1 token)."}
          </Text>
        </CardHeader>
        <CardContent className="gap-sp-1">
          {parts.map((part, index) => (
            <View key={part.key}>
              {index > 0 ? <Separator /> : null}
              <BreakdownRow
                color={colorForPart(part.key)}
                label={labelForPart(part)}
                part={part}
                total={contextWindow}
              />
            </View>
          ))}
        </CardContent>
      </Card>

      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Estimates are taken before the model starts the turn. Provider reported
        usage covers the final model step and remains the source of truth for
        billing.
      </Text>
    </>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-32 gap-sp-1">
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        {label}
      </Text>
      <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
        {value}
      </Text>
    </View>
  );
}

function BreakdownRow({
  color,
  label,
  part,
  total,
}: {
  color: string;
  label: string;
  part: ContextBreakdownPart;
  total: number;
}) {
  const percent = total > 0 ? (part.tokens / total) * 100 : 0;

  return (
    <View className="min-h-11 flex-row items-center gap-sp-3 py-sp-2">
      <View
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <Text className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {formatTokens(part.tokens)}
      </Text>
      <Text className="w-14 text-right font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        {formatPercent(percent)}
      </Text>
    </View>
  );
}
