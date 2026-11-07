import { AcpConnectionForm } from "@/components/settings/acp-connection-form";
import { ANTIGRAVITY_PROFILE } from "@/modules/harnesses/acp-profile";

export function AntigravityConnectionForm({
  onConnected,
}: {
  onConnected: () => void;
}) {
  return (
    <AcpConnectionForm profile={ANTIGRAVITY_PROFILE} onConnected={onConnected} />
  );
}
