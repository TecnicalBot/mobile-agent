import { AcpConnectionForm } from "@/components/settings/acp-connection-form";
import { CLAUDE_PROFILE } from "@/modules/harnesses/acp-profile";

export function ClaudeConnectionForm({
  onConnected,
}: {
  onConnected: () => void;
}) {
  return <AcpConnectionForm profile={CLAUDE_PROFILE} onConnected={onConnected} />;
}
